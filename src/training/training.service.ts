import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import { NOTIFICATION_TYPE } from '../notifications/notification-type.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemAuditLogService } from '../system-audit/system-audit-log.service';
import { UserRole } from '../users/entities/user-role.enum';
import { User } from '../users/entities/user.entity';
import {
  CreateTrainingModuleDto,
  TrainingQuestionInputDto,
  UpdateTrainingModuleDto,
} from './dto/training.dto';
import { TrainingAttempt } from './entities/training-attempt.entity';
import { TrainingModuleEntity } from './entities/training-module.entity';
import { TrainingQuestion } from './entities/training-question.entity';

export type TrainingStatus = 'not_started' | 'failed' | 'passed';

export type Viewer = { userId: string; role: UserRole; canManage: boolean };

type ModuleStats = {
  status: TrainingStatus;
  bestScorePercent: number | null;
  attemptCount: number;
  lastAttemptAt: string | null;
};

function validateQuestions(questions: TrainingQuestionInputDto[]): void {
  questions.forEach((q, i) => {
    if (q.correctIndex >= q.options.length) {
      throw new BadRequestException(
        `questions[${i}].correctIndex is out of range`,
      );
    }
  });
}

function statsOf(attempts: TrainingAttempt[]): ModuleStats {
  if (attempts.length === 0) {
    return {
      status: 'not_started',
      bestScorePercent: null,
      attemptCount: 0,
      lastAttemptAt: null,
    };
  }
  return {
    status: attempts.some((a) => a.passed) ? 'passed' : 'failed',
    bestScorePercent: Math.max(...attempts.map((a) => a.scorePercent)),
    attemptCount: attempts.length,
    lastAttemptAt: new Date(
      Math.max(...attempts.map((a) => new Date(a.createdAt).getTime())),
    ).toISOString(),
  };
}

@Injectable()
export class TrainingService {
  private readonly logger = new Logger(TrainingService.name);

  constructor(
    @InjectRepository(TrainingModuleEntity)
    private readonly modules: Repository<TrainingModuleEntity>,
    @InjectRepository(TrainingQuestion)
    private readonly questions: Repository<TrainingQuestion>,
    @InjectRepository(TrainingAttempt)
    private readonly attempts: Repository<TrainingAttempt>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    private readonly audit: SystemAuditLogService,
  ) {}

  // ---- manager CRUD -------------------------------------------------------

  async listAll(active?: 'true' | 'false') {
    const rows = await this.modules.find({
      where: active ? { active: active === 'true' } : {},
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return this.present(rows, true);
  }

  async create(dto: CreateTrainingModuleDto, actorUserId: string) {
    validateQuestions(dto.questions);
    const id = await this.dataSource.transaction(async (em) => {
      const mod = await em.save(
        em.create(TrainingModuleEntity, {
          title: dto.title,
          description: dto.description?.trim() || null,
          videoUrl: dto.videoUrl,
          policy: dto.policy ?? 'soft',
          passMarkPercent: dto.passMarkPercent ?? 80,
          roles: dto.roles ?? [],
          active: dto.active ?? true,
          sortOrder: dto.sortOrder ?? 0,
          createdByUserId: actorUserId,
        }),
      );
      await em.save(this.buildQuestions(em, mod.id, dto.questions));
      return mod.id;
    });
    await this.audit.record({
      action: 'training.module.create',
      actorUserId,
      resourceType: 'training_module',
      resourceId: id,
      metadata: { title: dto.title, policy: dto.policy ?? 'soft' },
    });
    return this.getOne(id, {
      userId: actorUserId,
      role: UserRole.ADMIN,
      canManage: true,
    });
  }

  async update(id: string, dto: UpdateTrainingModuleDto, actorUserId: string) {
    if (dto.questions) validateQuestions(dto.questions);
    await this.dataSource.transaction(async (em) => {
      const mod = await em.findOne(TrainingModuleEntity, { where: { id } });
      if (!mod) throw new NotFoundException('Training module not found');
      if (dto.title !== undefined) mod.title = dto.title;
      if (dto.description !== undefined)
        mod.description = dto.description?.trim() || null;
      if (dto.videoUrl !== undefined) mod.videoUrl = dto.videoUrl;
      if (dto.policy !== undefined) mod.policy = dto.policy;
      if (dto.passMarkPercent !== undefined)
        mod.passMarkPercent = dto.passMarkPercent;
      if (dto.roles !== undefined) mod.roles = dto.roles;
      if (dto.active !== undefined) mod.active = dto.active;
      if (dto.sortOrder !== undefined) mod.sortOrder = dto.sortOrder;
      await em.save(mod);
      if (dto.questions) {
        await em.delete(TrainingQuestion, { moduleId: id });
        await em.save(this.buildQuestions(em, id, dto.questions));
      }
    });
    await this.audit.record({
      action: 'training.module.update',
      actorUserId,
      resourceType: 'training_module',
      resourceId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return this.getOne(id, {
      userId: actorUserId,
      role: UserRole.ADMIN,
      canManage: true,
    });
  }

  async remove(id: string, actorUserId: string) {
    const mod = await this.modules.findOne({ where: { id } });
    if (!mod) throw new NotFoundException('Training module not found');
    await this.modules.delete({ id });
    await this.audit.record({
      action: 'training.module.delete',
      actorUserId,
      resourceType: 'training_module',
      resourceId: id,
      metadata: { title: mod.title },
    });
    return { id };
  }

  // ---- staff --------------------------------------------------------------

  async getOne(id: string, viewer: Viewer) {
    const mod = await this.modules.findOne({ where: { id } });
    if (
      !mod ||
      (!viewer.canManage && !(mod.active && this.applies(mod, viewer.role)))
    ) {
      throw new NotFoundException('Training module not found');
    }
    return (await this.present([mod], viewer.canManage))[0];
  }

  async me(viewer: Viewer) {
    const mods = (
      await this.modules.find({
        where: { active: true },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      })
    ).filter((m) => this.applies(m, viewer.role));
    const presented = await this.present(mods, false);
    const attempts = await this.attempts.find({
      where: { userId: viewer.userId },
    });
    const modules = presented.map((module) => ({
      module,
      ...statsOf(attempts.filter((a) => a.moduleId === module.id)),
    }));
    const strictPending = modules.filter(
      (m) => m.module.policy === 'strict' && m.status !== 'passed',
    ).length;
    return {
      modules,
      strictPending,
      onboardingTrainingComplete: strictPending === 0,
    };
  }

  async submitAttempt(id: string, answers: number[], viewer: Viewer) {
    const mod = await this.modules.findOne({ where: { id } });
    if (!mod) throw new NotFoundException('Training module not found');
    if (!mod.active || !this.applies(mod, viewer.role)) {
      throw new BadRequestException('Module is not available');
    }
    const qs = await this.questions.find({
      where: { moduleId: id },
      order: { sortOrder: 'ASC' },
    });
    if (answers.length !== qs.length) {
      throw new BadRequestException(
        `Expected ${qs.length} answers, got ${answers.length}`,
      );
    }
    if (answers.some((a, i) => a >= qs[i].options.length)) {
      throw new BadRequestException('Answer index out of range');
    }
    const correctCount = qs.filter(
      (q, i) => q.correctIndex === answers[i],
    ).length;
    const total = qs.length;
    const scorePercent = total ? Math.round((correctCount / total) * 100) : 0;
    const passed = scorePercent >= mod.passMarkPercent;
    const attempt = await this.attempts.save(
      this.attempts.create({
        moduleId: id,
        userId: viewer.userId,
        answers,
        scorePercent,
        passed,
      }),
    );
    await this.audit.record({
      action: 'training.attempt',
      actorUserId: viewer.userId,
      resourceType: 'training_module',
      resourceId: id,
      metadata: { moduleId: id, scorePercent, passed },
    });

    if (!passed && mod.policy === 'strict') {
      await this.notifyStrictFail(mod, attempt, viewer.userId, scorePercent);
    }

    const prior = await this.attempts.find({
      where: { moduleId: id, userId: viewer.userId },
    });
    return {
      scorePercent,
      passed,
      correctCount,
      total,
      passMarkPercent: mod.passMarkPercent,
      policy: mod.policy,
      status: statsOf(prior).status,
    };
  }

  async progress(userId?: string) {
    const staff = await this.users.find({
      where: {
        active: true,
        deletedAt: IsNull(),
        role: Not(UserRole.ADMIN),
        ...(userId ? { id: userId } : {}),
      },
      order: { firstName: 'ASC', lastName: 'ASC' },
    });
    const mods = await this.modules.find({ where: { active: true } });
    const attempts = staff.length
      ? await this.attempts.find({
          where: { userId: In(staff.map((u) => u.id)) },
        })
      : [];
    return {
      users: staff.map((u) => {
        const rows = mods
          .filter((m) => this.applies(m, u.role))
          .map((m) => ({
            moduleId: m.id,
            policy: m.policy,
            ...statsOf(
              attempts.filter((a) => a.userId === u.id && a.moduleId === m.id),
            ),
          }));
        const strictPending = rows.filter(
          (r) => r.policy === 'strict' && r.status !== 'passed',
        ).length;
        return {
          userId: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
          strictPending,
          onboardingTrainingComplete: strictPending === 0,
          modules: rows.map((r) => ({
            moduleId: r.moduleId,
            status: r.status,
            bestScorePercent: r.bestScorePercent,
            attemptCount: r.attemptCount,
            lastAttemptAt: r.lastAttemptAt,
          })),
        };
      }),
    };
  }

  // ---- helpers ------------------------------------------------------------

  private applies(mod: TrainingModuleEntity, role: UserRole): boolean {
    return mod.roles.length === 0 || mod.roles.includes(role);
  }

  private buildQuestions(
    em: EntityManager,
    moduleId: string,
    qs: TrainingQuestionInputDto[],
  ): TrainingQuestion[] {
    return qs.map((q, i) =>
      em.create(TrainingQuestion, {
        moduleId,
        prompt: q.prompt,
        options: q.options,
        correctIndex: q.correctIndex,
        sortOrder: i,
      }),
    );
  }

  private async present(mods: TrainingModuleEntity[], withAnswers: boolean) {
    const qs = mods.length
      ? await this.questions.find({
          where: { moduleId: In(mods.map((m) => m.id)) },
          order: { sortOrder: 'ASC' },
        })
      : [];
    return mods.map((m) => {
      const questions = qs
        .filter((q) => q.moduleId === m.id)
        .map((q) => ({
          id: q.id,
          prompt: q.prompt,
          options: q.options,
          sortOrder: q.sortOrder,
          ...(withAnswers ? { correctIndex: q.correctIndex } : {}),
        }));
      return {
        id: m.id,
        title: m.title,
        description: m.description,
        videoUrl: m.videoUrl,
        policy: m.policy,
        passMarkPercent: m.passMarkPercent,
        roles: m.roles,
        active: m.active,
        sortOrder: m.sortOrder,
        questionCount: questions.length,
        questions,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
      };
    });
  }

  private async notifyStrictFail(
    mod: TrainingModuleEntity,
    attempt: TrainingAttempt,
    userId: string,
    scorePercent: number,
  ): Promise<void> {
    try {
      const u = await this.users.findOne({ where: { id: userId } });
      const payload = {
        type: NOTIFICATION_TYPE.TRAINING_STRICT_FAILED,
        title: 'Required training failed',
        body: `${u ? `${u.firstName} ${u.lastName}` : 'A staff member'} scored ${scorePercent}% on "${mod.title}" (pass mark ${mod.passMarkPercent}%).`,
        dedupeKey: `training-strict-failed:${attempt.id}`,
        metadata: {
          moduleId: mod.id,
          userId,
          attemptId: attempt.id,
          scorePercent,
        },
      };
      await this.notifications.sendToRole(UserRole.ADMIN, payload);
      await this.notifications.sendToRole(UserRole.MANAGER, payload);
    } catch (err) {
      this.logger.warn(`Strict-fail notification failed: ${String(err)}`);
    }
  }
}
