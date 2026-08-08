import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  Not,
  Repository,
  type FindOptionsWhere,
  type SelectQueryBuilder,
} from 'typeorm';
import { Job } from '../jobs/entities/job.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPE } from '../notifications/notification-type.constants';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { LeadRoutingService } from '../territories/lead-routing.service';
import { ProposalsService } from '../proposals/proposals.service';
import { FinancingService } from '../financing/financing.service';
import { isFeatureEnabled } from '../feature-flags/feature-flags.config';
import {
  findStageConfig,
  type PipelineStageTaskTemplate,
} from '../pipeline-stages/pipeline-stage.config';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksQueryDto, type TaskSortField } from './dto/tasks-query.dto';
import { TaskResponseDto, TasksListResponseDto } from './dto/task-response.dto';
import { Task } from './entities/task.entity';
import {
  ACTIVE_TASK_STATUSES,
  TaskPriority,
  TaskSource,
  TaskStatus,
} from './entities/task-status.enum';

/** How often the SLA sweep runs. Matches the alerts engine's cadence. */
const SLA_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Hours past the SLA deadline before each successive escalation. Level 1 fires
 * at breach, level 2 a day later, level 3 two days after that, then it stops —
 * escalation should nag, not spam.
 */
const ESCALATION_STEP_HOURS = [0, 24, 72];
const MAX_ESCALATION_LEVEL = ESCALATION_STEP_HOURS.length;

const MS_PER_HOUR = 60 * 60 * 1000;

type Viewer = { userId: string; role: UserRole };

function hoursBetween(later: Date, earlier: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / MS_PER_HOUR);
}

@Injectable()
export class TasksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TasksService.name);
  private sweepHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notifications: NotificationsService,
    private readonly settings: RuntimeSettingsService,
    private readonly leadRouting: LeadRoutingService,
    private readonly proposals: ProposalsService,
    private readonly financing: FinancingService,
  ) {}

  onModuleInit(): void {
    this.sweepHandle = setInterval(() => {
      this.sweepSlas().catch((err: unknown) => {
        this.logger.error('SLA sweep failed', err);
      });
      // Every time-based rule rides this one timer — one sweep, one wake-up.
      // Each is independently caught so a failure in one can't stop the rest.
      this.leadRouting.reassignStaleLeads().catch((err: unknown) => {
        this.logger.error('Lead SLA reassignment failed', err);
      });
      this.proposals.expireOverdue().catch((err: unknown) => {
        this.logger.error('Proposal expiry sweep failed', err);
      });
      this.financing.sweepExpiries().catch((err: unknown) => {
        this.logger.error('Financing expiry sweep failed', err);
      });
    }, SLA_SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.sweepHandle !== null) {
      clearInterval(this.sweepHandle);
      this.sweepHandle = null;
    }
  }

  // ─── Stage templates ──────────────────────────────────────────────────────

  /**
   * Materialise the configured task templates for the stage a job just entered.
   *
   * Idempotent on `(jobId, stage, templateId)`: re-entering a stage (or a
   * retried write) never duplicates a task. Never throws into the caller — a
   * template problem must not fail the pipeline move that triggered it.
   */
  async materialiseStageTasks(
    jobId: string,
    stage: string,
    actorUserId: string | null,
    now: Date = new Date(),
  ): Promise<Task[]> {
    try {
      const flags = await this.settings.getFeatureFlags();
      if (!isFeatureEnabled(flags, 'taskEngine')) return [];

      const config = await this.settings.getPipelineStageConfig();
      const stageConfig = findStageConfig(config, stage);
      if (!stageConfig || stageConfig.taskTemplates.length === 0) return [];

      const job = await this.jobRepo.findOne({ where: { id: jobId } });
      if (!job) return [];

      const templateIds = stageConfig.taskTemplates.map((t) => t.id);
      const existing = await this.taskRepo.find({
        where: {
          jobId,
          stage,
          templateId: In(templateIds),
        },
        select: { id: true, templateId: true },
      });
      const alreadyMade = new Set(
        existing.map((t) => t.templateId).filter((id): id is string => !!id),
      );

      const toCreate = stageConfig.taskTemplates.filter(
        (t) => !alreadyMade.has(t.id),
      );
      if (toCreate.length === 0) return [];

      const rows = toCreate.map((template) => {
        const dueAt = new Date(
          now.getTime() + template.dueOffsetHours * MS_PER_HOUR,
        );
        return this.taskRepo.create({
          jobId,
          title: template.title,
          description: template.description ?? null,
          status: TaskStatus.OPEN,
          priority: template.priority as TaskPriority,
          source: TaskSource.STAGE_TEMPLATE,
          stage,
          templateId: template.id,
          assigneeUserId: this.resolveTemplateAssignee(
            template,
            job,
            actorUserId,
          ),
          createdByUserId: actorUserId,
          dueAt,
          slaDueAt: dueAt,
          escalationLevel: 0,
        });
      });

      const saved = await this.taskRepo.save(rows);
      await this.notifyAssigned(saved);
      return saved;
    } catch (err: unknown) {
      this.logger.error(
        `Failed to materialise stage tasks for job ${jobId} / stage ${stage}`,
        err,
      );
      return [];
    }
  }

  private resolveTemplateAssignee(
    template: PipelineStageTaskTemplate,
    job: Job,
    actorUserId: string | null,
  ): string | null {
    switch (template.assignTo) {
      case 'manager':
        return job.managerId ?? actorUserId;
      case 'assigned_staff':
        return job.assignedStaffUserId ?? job.managerId ?? null;
      case 'actor':
        return actorUserId;
      case 'unassigned':
      default:
        return null;
    }
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async create(dto: CreateTaskDto, viewer: Viewer): Promise<TaskResponseDto> {
    await this.assertTaskEngineEnabled(viewer.role);

    if (dto.jobId) {
      const job = await this.jobRepo.findOne({ where: { id: dto.jobId } });
      if (!job) throw new NotFoundException(`Job ${dto.jobId} not found`);
      this.assertJobInScope(job, viewer);
    } else if (
      viewer.role !== UserRole.ADMIN &&
      viewer.role !== UserRole.MANAGER
    ) {
      throw new ForbiddenException(
        'Only admins and managers can create tasks that are not attached to a job',
      );
    }

    const assigneeUserId = dto.assigneeUserId ?? null;
    if (assigneeUserId) await this.assertAssigneeExists(assigneeUserId);

    // Non-privileged users may only create work for themselves.
    if (
      viewer.role !== UserRole.ADMIN &&
      viewer.role !== UserRole.MANAGER &&
      assigneeUserId !== null &&
      assigneeUserId !== viewer.userId
    ) {
      throw new ForbiddenException('You can only assign tasks to yourself');
    }

    const dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    const slaDueAt = dto.slaDueAt ? new Date(dto.slaDueAt) : dueAt;

    const saved = await this.taskRepo.save(
      this.taskRepo.create({
        jobId: dto.jobId ?? null,
        title: dto.title,
        description: dto.description ?? null,
        status: TaskStatus.OPEN,
        priority: dto.priority ?? TaskPriority.NORMAL,
        source: TaskSource.MANUAL,
        stage: dto.stage ?? null,
        templateId: null,
        assigneeUserId:
          assigneeUserId ??
          (viewer.role === UserRole.ADMIN || viewer.role === UserRole.MANAGER
            ? null
            : viewer.userId),
        createdByUserId: viewer.userId,
        dueAt,
        slaDueAt,
        escalationLevel: 0,
      }),
    );

    await this.notifyAssigned([saved]);
    return this.toResponse(saved);
  }

  async findAll(
    filters: TasksQueryDto,
    viewer: Viewer,
  ): Promise<TasksListResponseDto> {
    await this.assertTaskEngineEnabled(viewer.role);

    const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
    const offset = Math.max(0, filters.offset ?? 0);

    const where = await this.buildWhere(filters, viewer);
    if (where === null) {
      return { items: [], total: 0, breachedCount: 0 };
    }

    let rows: Task[];
    let total: number;
    if (!filters.sortBy) {
      // Unchanged default path — same call shape existing callers rely on.
      [rows, total] = await this.taskRepo.findAndCount({
        where,
        relations: { job: { customer: true }, assigneeUser: true },
        order: {
          // Breached and soonest-due first. No `nulls: 'LAST'` — TypeORM emits
          // `NULLS LAST`, which prod MariaDB rejects; clients sort the handful of
          // SLA-less tasks themselves.
          slaDueAt: 'ASC',
          createdAt: 'DESC',
        },
        take: limit,
        skip: offset,
      });
    } else {
      const qb = this.taskRepo
        .createQueryBuilder('task')
        .leftJoinAndSelect('task.job', 'job')
        .leftJoinAndSelect('job.customer', 'customer')
        .leftJoinAndSelect('task.assigneeUser', 'assigneeUser')
        .where(where)
        .take(limit)
        .skip(offset);
      this.applySort(qb, filters.sortBy, filters.sortDir ?? 'ASC');
      [rows, total] = await qb.getManyAndCount();
    }

    const breachedCount = await this.taskRepo.count({
      where: Array.isArray(where)
        ? where.map((w) => ({
            ...w,
            status: In(ACTIVE_TASK_STATUSES),
            slaBreachedAt: Not(IsNull()),
          }))
        : {
            ...where,
            status: In(ACTIVE_TASK_STATUSES),
            slaBreachedAt: Not(IsNull()),
          },
    });

    return {
      items: rows.map((t) => this.toResponse(t)),
      total,
      breachedCount,
    };
  }

  async findOne(id: string, viewer: Viewer): Promise<TaskResponseDto> {
    const task = await this.loadVisibleTask(id, viewer);
    return this.toResponse(task);
  }

  async update(
    id: string,
    dto: UpdateTaskDto,
    viewer: Viewer,
  ): Promise<TaskResponseDto> {
    const task = await this.loadVisibleTask(id, viewer);
    const privileged =
      viewer.role === UserRole.ADMIN || viewer.role === UserRole.MANAGER;

    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one field is required');
    }

    // An assignee who is not privileged may only move their own task along —
    // not retitle it, reassign it, or renegotiate its deadlines.
    if (!privileged) {
      const allowed = new Set(['status']);
      const attempted = Object.keys(dto).filter(
        (k) => (dto as Record<string, unknown>)[k] !== undefined,
      );
      const forbidden = attempted.filter((k) => !allowed.has(k));
      if (forbidden.length > 0) {
        throw new ForbiddenException(
          `You may only update the status of your tasks (rejected: ${forbidden.join(', ')})`,
        );
      }
    }

    const previousAssignee = task.assigneeUserId;

    if (dto.title !== undefined) task.title = dto.title;
    if (dto.description !== undefined) task.description = dto.description;
    if (dto.priority !== undefined) task.priority = dto.priority;
    if (dto.assigneeUserId !== undefined) {
      if (dto.assigneeUserId)
        await this.assertAssigneeExists(dto.assigneeUserId);
      task.assigneeUserId = dto.assigneeUserId;
    }
    if (dto.dueAt !== undefined) {
      task.dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    }
    if (dto.slaDueAt !== undefined) {
      task.slaDueAt = dto.slaDueAt ? new Date(dto.slaDueAt) : null;
      // A renegotiated commitment starts its countdown clean.
      task.slaBreachedAt = null;
      task.escalationLevel = 0;
      task.escalatedAt = null;
    }
    if (dto.status !== undefined && dto.status !== task.status) {
      task.status = dto.status;
      if (
        dto.status === TaskStatus.DONE ||
        dto.status === TaskStatus.CANCELLED
      ) {
        task.completedAt = new Date();
        task.completedByUserId = viewer.userId;
      } else {
        task.completedAt = null;
        task.completedByUserId = null;
      }
    }

    const saved = await this.taskRepo.save(task);

    if (
      saved.assigneeUserId &&
      saved.assigneeUserId !== previousAssignee &&
      saved.assigneeUserId !== viewer.userId
    ) {
      await this.notifyAssigned([saved]);
    }

    return this.toResponse(saved);
  }

  async remove(id: string, viewer: Viewer): Promise<{ deleted: true }> {
    const task = await this.loadVisibleTask(id, viewer);
    if (viewer.role !== UserRole.ADMIN && viewer.role !== UserRole.MANAGER) {
      throw new ForbiddenException('Only admins and managers can delete tasks');
    }
    await this.taskRepo.delete({ id: task.id });
    return { deleted: true };
  }

  // ─── SLA engine ───────────────────────────────────────────────────────────

  /**
   * Mark newly-breached SLAs and escalate the ones that keep sitting. Runs on
   * the interval above and can be triggered by an admin.
   */
  async sweepSlas(now: Date = new Date()): Promise<{
    breached: number;
    escalated: number;
  }> {
    const flags = await this.settings.getFeatureFlags();
    if (!isFeatureEnabled(flags, 'taskEngine')) {
      return { breached: 0, escalated: 0 };
    }

    // Newly breached: past the deadline, still active, not yet flagged.
    const newlyBreached = await this.taskRepo.find({
      where: {
        status: In(ACTIVE_TASK_STATUSES),
        slaBreachedAt: IsNull(),
        slaDueAt: LessThanOrEqual(now),
      },
      relations: { job: true },
    });
    for (const task of newlyBreached) {
      task.slaBreachedAt = task.slaDueAt ?? now;
    }
    if (newlyBreached.length > 0) {
      await this.taskRepo.save(newlyBreached);
    }

    // Escalation: everything still active and breached, including the batch
    // above (re-read so a task can breach and escalate in the same sweep).
    const breached = await this.taskRepo.find({
      where: {
        status: In(ACTIVE_TASK_STATUSES),
        slaBreachedAt: Not(IsNull()),
        escalationLevel: LessThan(MAX_ESCALATION_LEVEL),
      },
      relations: { job: true },
    });

    const escalatedTasks: Task[] = [];
    for (const task of breached) {
      const breachedAt = task.slaBreachedAt;
      if (!breachedAt) continue;
      const hoursOverdue = hoursBetween(now, breachedAt);
      let level = task.escalationLevel;
      while (
        level < MAX_ESCALATION_LEVEL &&
        hoursOverdue >= ESCALATION_STEP_HOURS[level]
      ) {
        level += 1;
      }
      if (level > task.escalationLevel) {
        task.escalationLevel = level;
        task.escalatedAt = now;
        escalatedTasks.push(task);
      }
    }
    if (escalatedTasks.length > 0) {
      await this.taskRepo.save(escalatedTasks);
      await this.notifyEscalated(escalatedTasks);
    }

    if (newlyBreached.length > 0 || escalatedTasks.length > 0) {
      this.logger.log(
        `SLA sweep: ${newlyBreached.length} breached, ${escalatedTasks.length} escalated`,
      );
    }

    return {
      breached: newlyBreached.length,
      escalated: escalatedTasks.length,
    };
  }

  // ─── Notifications ────────────────────────────────────────────────────────

  private async notifyAssigned(tasks: Task[]): Promise<void> {
    for (const task of tasks) {
      if (!task.assigneeUserId) continue;
      await this.notifications.sendToUsers([task.assigneeUserId], {
        type: NOTIFICATION_TYPE.TASK_ASSIGNED,
        title: 'New task assigned',
        body: task.dueAt
          ? `${task.title} — due ${task.dueAt.toISOString()}`
          : task.title,
        metadata: {
          taskId: task.id,
          jobId: task.jobId,
          stage: task.stage,
        },
      });
    }
  }

  /**
   * Level 1 pings the assignee; higher levels also pull in the job's manager
   * and, at the top level, every admin.
   */
  private async notifyEscalated(tasks: Task[]): Promise<void> {
    const admins = tasks.some((t) => t.escalationLevel >= MAX_ESCALATION_LEVEL)
      ? await this.userRepo.find({
          where: { role: UserRole.ADMIN, active: true },
          select: { id: true },
        })
      : [];

    for (const task of tasks) {
      const recipients = new Set<string>();
      if (task.assigneeUserId) recipients.add(task.assigneeUserId);
      if (task.escalationLevel >= 2 && task.job?.managerId) {
        recipients.add(task.job.managerId);
      }
      if (task.escalationLevel >= MAX_ESCALATION_LEVEL) {
        for (const admin of admins) recipients.add(admin.id);
      }
      if (recipients.size === 0) continue;

      await this.notifications.sendToUsers([...recipients], {
        type: NOTIFICATION_TYPE.TASK_SLA_BREACHED,
        title: `Task overdue (escalation ${task.escalationLevel})`,
        body: `${task.title}${task.job ? ` — job ${task.job.orderNumber}` : ''}`,
        metadata: {
          taskId: task.id,
          jobId: task.jobId,
          escalationLevel: task.escalationLevel,
          slaDueAt: task.slaDueAt?.toISOString() ?? null,
        },
      });
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async assertTaskEngineEnabled(role: UserRole): Promise<void> {
    const flags = await this.settings.getFeatureFlags();
    if (!isFeatureEnabled(flags, 'taskEngine', role)) {
      throw new ForbiddenException(
        'The task engine is not enabled for your role',
      );
    }
  }

  private async assertAssigneeExists(userId: string): Promise<void> {
    const user = await this.userRepo.findOne({
      where: { id: userId, active: true },
      select: { id: true },
    });
    if (!user) {
      throw new BadRequestException(`Assignee ${userId} is not an active user`);
    }
  }

  private assertJobInScope(job: Job, viewer: Viewer): void {
    if (viewer.role === UserRole.ADMIN) return;
    if (viewer.role === UserRole.MANAGER) {
      if (job.managerId !== viewer.userId) {
        throw new ForbiddenException('That job is not one of yours');
      }
      return;
    }
    if (job.assignedStaffUserId !== viewer.userId) {
      throw new ForbiddenException('That job is not assigned to you');
    }
  }

  /**
   * Build the query predicate for a list request, or `null` when the viewer
   * provably has no visible tasks (so the caller can short-circuit).
   */
  private async buildWhere(
    filters: TasksQueryDto,
    viewer: Viewer,
  ): Promise<FindOptionsWhere<Task> | FindOptionsWhere<Task>[] | null> {
    const base: FindOptionsWhere<Task> = {};

    if (filters.status === 'active') {
      base.status = In(ACTIVE_TASK_STATUSES);
    } else if (filters.status) {
      base.status = filters.status;
    }
    if (filters.priority) base.priority = filters.priority;
    if (filters.stage) base.stage = filters.stage;
    if (filters.breachedOnly === 'true') base.slaBreachedAt = Not(IsNull());
    if (filters.dueWithinHours !== undefined) {
      base.dueAt = LessThanOrEqual(
        new Date(Date.now() + filters.dueWithinHours * MS_PER_HOUR),
      );
    }

    if (filters.jobId) {
      const job = await this.jobRepo.findOne({ where: { id: filters.jobId } });
      if (!job) return null;
      this.assertJobInScope(job, viewer);
      base.jobId = filters.jobId;
    }

    // Installers and employees never see anyone else's tasks.
    const privileged =
      viewer.role === UserRole.ADMIN || viewer.role === UserRole.MANAGER;
    const scope = privileged ? (filters.scope ?? 'all') : 'mine';

    if (scope === 'mine') {
      return { ...base, assigneeUserId: viewer.userId };
    }
    if (viewer.role === UserRole.ADMIN) {
      return base;
    }
    // Manager `all`: their managed jobs, plus anything assigned to them
    // directly (including tasks with no job).
    return [
      { ...base, job: { managerId: viewer.userId } },
      { ...base, assigneeUserId: viewer.userId },
    ];
  }

  /**
   * Apply a whitelisted sort to the tasks list query builder. `sortBy` is
   * validated by `TasksQueryDto` against `TASK_SORT_FIELDS`; nothing here is
   * ever built from a raw client string, so there's no SQL injection surface.
   *
   * Nullable sort keys (SLA-less tasks, job-less tasks, unassigned tasks)
   * always sink to the end regardless of `sortDir` — a `CASE WHEN ... IS
   * NULL` flag ordered before the real column, rather than `NULLS LAST`,
   * which prod MariaDB rejects. A `task.id` tiebreaker keeps pagination
   * stable when the primary/secondary keys collide.
   */
  private applySort(
    qb: SelectQueryBuilder<Task>,
    sortBy: TaskSortField,
    sortDir: 'ASC' | 'DESC',
  ): void {
    switch (sortBy) {
      case 'slaDueAt':
        qb.addSelect(
          'CASE WHEN task.slaDueAt IS NULL THEN 1 ELSE 0 END',
          'sla_null_last',
        )
          .addOrderBy('sla_null_last', 'ASC')
          .addOrderBy('task.slaDueAt', sortDir)
          .addOrderBy('task.createdAt', 'DESC');
        break;
      case 'jobOrderNumber':
        qb.addSelect(
          'CASE WHEN job.orderNumber IS NULL THEN 1 ELSE 0 END',
          'job_order_null_last',
        )
          .addOrderBy('job_order_null_last', 'ASC')
          .addOrderBy('job.orderNumber', sortDir)
          .addOrderBy('task.createdAt', 'DESC');
        break;
      case 'assignee':
        qb.addSelect(
          'CASE WHEN task.assigneeUserId IS NULL THEN 1 ELSE 0 END',
          'assignee_null_last',
        )
          .addOrderBy('assignee_null_last', 'ASC')
          .addOrderBy('assigneeUser.firstName', sortDir)
          .addOrderBy('assigneeUser.lastName', sortDir)
          .addOrderBy('task.createdAt', 'DESC');
        break;
      case 'priority':
        qb.addOrderBy('task.priority', sortDir).addOrderBy(
          'task.createdAt',
          'DESC',
        );
        break;
      case 'status':
        qb.addOrderBy('task.status', sortDir).addOrderBy(
          'task.createdAt',
          'DESC',
        );
        break;
      case 'createdAt':
      default:
        qb.addOrderBy('task.createdAt', sortDir);
        break;
    }
    // Stable tiebreaker so identical sort keys can't duplicate or drop rows
    // across pages.
    qb.addOrderBy('task.id', 'ASC');
  }

  private async loadVisibleTask(id: string, viewer: Viewer): Promise<Task> {
    await this.assertTaskEngineEnabled(viewer.role);
    const task = await this.taskRepo.findOne({
      where: { id },
      relations: { job: { customer: true }, assigneeUser: true },
    });
    if (!task) throw new NotFoundException(`Task ${id} not found`);

    if (viewer.role === UserRole.ADMIN) return task;
    if (task.assigneeUserId === viewer.userId) return task;
    if (
      viewer.role === UserRole.MANAGER &&
      (task.job?.managerId === viewer.userId ||
        task.createdByUserId === viewer.userId)
    ) {
      return task;
    }
    // Don't leak existence to users outside the scope.
    throw new NotFoundException(`Task ${id} not found`);
  }

  private toResponse(task: Task): TaskResponseDto {
    const isClosed =
      task.status === TaskStatus.DONE || task.status === TaskStatus.CANCELLED;
    const customer = task.job?.customer;
    return {
      id: task.id,
      jobId: task.jobId,
      jobOrderNumber: task.job?.orderNumber ?? null,
      customerName: customer
        ? `${customer.firstName} ${customer.lastName}`.trim()
        : null,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      source: task.source,
      stage: task.stage,
      templateId: task.templateId,
      assigneeUserId: task.assigneeUserId,
      assigneeName: task.assigneeUser
        ? `${task.assigneeUser.firstName ?? ''} ${task.assigneeUser.lastName ?? ''}`.trim() ||
          null
        : null,
      dueAt: task.dueAt ? task.dueAt.toISOString() : null,
      slaDueAt: task.slaDueAt ? task.slaDueAt.toISOString() : null,
      slaBreachedAt: task.slaBreachedAt
        ? task.slaBreachedAt.toISOString()
        : null,
      slaHoursRemaining:
        task.slaDueAt && !isClosed
          ? hoursBetween(task.slaDueAt, new Date())
          : null,
      escalationLevel: task.escalationLevel,
      escalatedAt: task.escalatedAt ? task.escalatedAt.toISOString() : null,
      completedAt: task.completedAt ? task.completedAt.toISOString() : null,
      createdByUserId: task.createdByUserId,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  }
}
