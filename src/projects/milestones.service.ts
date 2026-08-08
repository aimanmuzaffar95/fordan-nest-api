import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UserRole } from '../users/entities/user-role.enum';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { isFeatureEnabled } from '../feature-flags/feature-flags.config';
import { TasksService } from '../tasks/tasks.service';
import {
  MilestoneStatus,
  MilestoneType,
  ProjectMilestone,
} from './entities/project-milestone.entity';
import { Project, ProjectStage } from './entities/project.entity';
import {
  DefectSeverity,
  DefectStatus,
  InstallDefect,
} from './entities/install-visit.entity';
import { UpsertMilestoneDto } from './dto/milestone.dto';

/** Which project stage each milestone type implies once it passes. */
const STAGE_ON_PASS: Record<MilestoneType, ProjectStage> = {
  [MilestoneType.INSPECTION]: ProjectStage.INTERCONNECTION,
  [MilestoneType.INTERCONNECTION]: ProjectStage.PTO,
  [MilestoneType.PTO]: ProjectStage.COMPLETED,
};

/** Scalar-only project patch — `Partial<Project>` pulls in the `job` relation. */
type ProjectScalarPatch = {
  stage?: ProjectStage;
  actualInstallDate?: string | null;
  actualPtoDate?: string | null;
  completedAt?: Date | null;
};

@Injectable()
export class MilestonesService {
  constructor(
    @InjectRepository(ProjectMilestone)
    private readonly milestoneRepo: Repository<ProjectMilestone>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(InstallDefect)
    private readonly defectRepo: Repository<InstallDefect>,
    private readonly settings: RuntimeSettingsService,
    private readonly tasks: TasksService,
  ) {}

  /**
   * Unresolved major/critical defects block sign-off. `blockingDefects()` on
   * `InstallExecutionService` exposes the same set for display; this is the
   * enforcement, so a project cannot pass inspection or reach PTO with open
   * defects against it.
   */
  private async assertNoBlockingDefects(projectId: string): Promise<void> {
    const blocking = await this.defectRepo.find({
      where: {
        projectId,
        severity: In([DefectSeverity.MAJOR, DefectSeverity.CRITICAL]),
        status: In([DefectStatus.OPEN, DefectStatus.IN_PROGRESS]),
      },
    });
    if (blocking.length === 0) return;

    const summary = blocking.map((d) => `${d.severity}: ${d.title}`).join('; ');
    throw new BadRequestException(
      `Resolve or waive the outstanding defects first — ${summary}`,
    );
  }

  private async assertEnabled(role: UserRole): Promise<void> {
    const flags = await this.settings.getFeatureFlags();
    if (!isFeatureEnabled(flags, 'inspectionPto', role)) {
      throw new ForbiddenException(
        'Inspection/interconnection/PTO tracking is not enabled for your role',
      );
    }
  }

  private async loadProject(
    projectId: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<Project> {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
    if (
      viewer.role === UserRole.MANAGER &&
      project.projectManagerUserId !== viewer.userId
    ) {
      throw new ForbiddenException('That project is not one of yours');
    }
    return project;
  }

  async listForProject(
    projectId: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<ProjectMilestone[]> {
    await this.assertEnabled(viewer.role);
    await this.loadProject(projectId, viewer);
    return this.milestoneRepo.find({
      where: { projectId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Create or advance a milestone.
   *
   * A failed inspection does not overwrite the failure — it opens a new
   * attempt, so the correction history survives. That's what makes
   * "how many re-inspections did we need?" answerable.
   */
  async upsert(
    projectId: string,
    dto: UpsertMilestoneDto,
    viewer: { userId: string; role: UserRole },
  ): Promise<ProjectMilestone> {
    await this.assertEnabled(viewer.role);
    const project = await this.loadProject(projectId, viewer);

    let milestone: ProjectMilestone | null = null;
    if (dto.id) {
      milestone = await this.milestoneRepo.findOne({
        where: { id: dto.id, projectId },
      });
      if (!milestone)
        throw new NotFoundException(`Milestone ${dto.id} not found`);
    } else {
      // Latest attempt of this type, if any.
      const existing = await this.milestoneRepo.find({
        where: { projectId, type: dto.type },
        order: { attemptNumber: 'DESC' },
        take: 1,
      });
      milestone = existing[0] ?? null;
      // A closed attempt starts a new one rather than being rewritten.
      if (
        milestone &&
        (milestone.status === MilestoneStatus.FAILED ||
          milestone.status === MilestoneStatus.PASSED)
      ) {
        if (
          dto.status === MilestoneStatus.PASSED &&
          milestone.status === MilestoneStatus.PASSED
        ) {
          throw new BadRequestException(
            `${dto.type} has already passed for this project`,
          );
        }
        milestone = this.milestoneRepo.create({
          projectId,
          type: dto.type,
          attemptNumber: milestone.attemptNumber + 1,
          status: MilestoneStatus.NOT_STARTED,
          createdByUserId: viewer.userId,
        });
      }
    }

    if (!milestone) {
      milestone = this.milestoneRepo.create({
        projectId,
        type: dto.type,
        attemptNumber: 1,
        status: MilestoneStatus.NOT_STARTED,
        createdByUserId: viewer.userId,
      });
    }

    if (dto.status !== undefined) {
      if (
        dto.status === MilestoneStatus.FAILED &&
        !dto.correctionList?.trim() &&
        !milestone.correctionList
      ) {
        throw new BadRequestException(
          'A correction list is required when recording a failure',
        );
      }
      if (dto.status === MilestoneStatus.PASSED) {
        await this.assertNoBlockingDefects(projectId);
      }
      milestone.status = dto.status;
      milestone.updatedByUserId = viewer.userId;
      if (
        dto.status === MilestoneStatus.PASSED ||
        dto.status === MilestoneStatus.FAILED
      ) {
        milestone.completedDate =
          dto.completedDate ?? new Date().toISOString().slice(0, 10);
      }
    }

    if (dto.authorityName !== undefined) {
      milestone.authorityName = dto.authorityName;
    }
    if (dto.referenceNumber !== undefined) {
      milestone.referenceNumber = dto.referenceNumber;
    }
    if (dto.targetDate !== undefined) milestone.targetDate = dto.targetDate;
    if (dto.scheduledAt !== undefined) {
      milestone.scheduledAt = dto.scheduledAt
        ? new Date(dto.scheduledAt)
        : null;
    }
    if (dto.completedDate !== undefined) {
      milestone.completedDate = dto.completedDate;
    }
    if (dto.correctionList !== undefined) {
      milestone.correctionList = dto.correctionList;
    }
    if (dto.notes !== undefined) milestone.notes = dto.notes;

    const saved = await this.milestoneRepo.save(milestone);

    if (dto.status === MilestoneStatus.PASSED) {
      await this.advanceProject(project, dto.type, saved);
    }
    if (dto.status === MilestoneStatus.FAILED) {
      // A correction list nobody is holding is a correction list nobody does.
      await this.tasks
        .create(
          {
            jobId: project.jobId,
            title: `Rectify ${dto.type} corrections on ${project.projectNumber}`,
            description: saved.correctionList ?? undefined,
          },
          { userId: viewer.userId, role: viewer.role },
        )
        .catch(() => undefined);
    }

    return saved;
  }

  /** Move the project on when a gate passes, and stamp the PTO date. */
  private async advanceProject(
    project: Project,
    type: MilestoneType,
    milestone: ProjectMilestone,
  ): Promise<void> {
    const nextStage = STAGE_ON_PASS[type];
    const patch: ProjectScalarPatch = {};

    // Never move a project backwards — a late-recorded inspection pass must
    // not drag a project that already reached PTO back down the funnel.
    const order = [
      ProjectStage.INITIATED,
      ProjectStage.PERMITTING,
      ProjectStage.READY_FOR_INSTALL,
      ProjectStage.SCHEDULED,
      ProjectStage.IN_PROGRESS,
      ProjectStage.INSTALLED,
      ProjectStage.INSPECTION,
      ProjectStage.INTERCONNECTION,
      ProjectStage.PTO,
      ProjectStage.COMPLETED,
    ];
    if (order.indexOf(nextStage) > order.indexOf(project.stage)) {
      patch.stage = nextStage;
    }

    if (type === MilestoneType.PTO) {
      patch.actualPtoDate =
        milestone.completedDate ?? new Date().toISOString().slice(0, 10);
      patch.completedAt = new Date();
    }

    if (Object.keys(patch).length > 0) {
      await this.projectRepo.update({ id: project.id }, patch);
    }
  }
}
