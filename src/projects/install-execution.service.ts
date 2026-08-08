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
  DefectSeverity,
  DefectStatus,
  InstallDefect,
  InstallVisit,
  InstallVisitStatus,
} from './entities/install-visit.entity';
import { Project, ProjectStage } from './entities/project.entity';
import {
  UpsertInstallVisitDto,
  UpsertDefectDto,
} from './dto/install-execution.dto';

/** Scalar-only project patch — `Partial<Project>` pulls in the `job` relation. */
type ProjectScalarPatch = {
  stage?: ProjectStage;
  actualInstallDate?: string | null;
  actualPtoDate?: string | null;
  completedAt?: Date | null;
};

@Injectable()
export class InstallExecutionService {
  constructor(
    @InjectRepository(InstallVisit)
    private readonly visitRepo: Repository<InstallVisit>,
    @InjectRepository(InstallDefect)
    private readonly defectRepo: Repository<InstallDefect>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    private readonly settings: RuntimeSettingsService,
    private readonly tasks: TasksService,
  ) {}

  private async assertEnabled(role: UserRole): Promise<void> {
    const flags = await this.settings.getFeatureFlags();
    if (!isFeatureEnabled(flags, 'projectSplit', role)) {
      throw new ForbiddenException(
        'The project module is not enabled for your role',
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

  // ─── Visits ───────────────────────────────────────────────────────────────

  async listVisits(
    projectId: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<InstallVisit[]> {
    await this.assertEnabled(viewer.role);
    await this.loadProject(projectId, viewer);
    return this.visitRepo.find({
      where: { projectId },
      order: { visitNumber: 'ASC' },
    });
  }

  /**
   * Create or update an install visit.
   *
   * A `partial` visit must say what's outstanding — a partial completion with
   * no follow-up description is exactly the state that gets forgotten until
   * the customer calls.
   */
  async upsertVisit(
    projectId: string,
    dto: UpsertInstallVisitDto,
    viewer: { userId: string; role: UserRole },
  ): Promise<InstallVisit> {
    await this.assertEnabled(viewer.role);
    const project = await this.loadProject(projectId, viewer);

    let visit: InstallVisit | null = null;
    if (dto.id) {
      visit = await this.visitRepo.findOne({
        where: { id: dto.id, projectId },
      });
      if (!visit)
        throw new NotFoundException(`Install visit ${dto.id} not found`);
    } else {
      const existing = await this.visitRepo.find({
        where: { projectId },
        order: { visitNumber: 'DESC' },
        take: 1,
      });
      visit = this.visitRepo.create({
        projectId,
        visitNumber: (existing[0]?.visitNumber ?? 0) + 1,
        status: InstallVisitStatus.SCHEDULED,
      });
    }

    if (dto.status !== undefined) {
      if (
        dto.status === InstallVisitStatus.PARTIAL &&
        !dto.outstandingWork?.trim() &&
        !visit.outstandingWork
      ) {
        throw new BadRequestException(
          'A partially completed visit must record what work is still outstanding',
        );
      }
      if (
        dto.status === InstallVisitStatus.ABORTED &&
        !dto.abortReason?.trim() &&
        !visit.abortReason
      ) {
        throw new BadRequestException(
          'An aborted visit must record why it was aborted',
        );
      }
      if (dto.status === InstallVisitStatus.IN_PROGRESS && !visit.startedAt) {
        visit.startedAt = new Date();
      }
      if (
        dto.status === InstallVisitStatus.COMPLETED ||
        dto.status === InstallVisitStatus.PARTIAL
      ) {
        visit.completedAt = visit.completedAt ?? new Date();
      } else {
        // A visit that moves back to scheduled/aborted is no longer
        // "completed as of" its old timestamp — clear it so the timeline
        // doesn't stamp e.g. "Aborted" at a stale completion instant.
        visit.completedAt = null;
      }
      if (dto.status === InstallVisitStatus.SCHEDULED) {
        // Reverting to scheduled means the work-in-progress clock resets too.
        visit.startedAt = null;
      }
      visit.status = dto.status;
      visit.updatedByUserId = viewer.userId;
    }

    if (dto.scheduledDate !== undefined)
      visit.scheduledDate = dto.scheduledDate;
    if (dto.crewUserIds !== undefined) visit.crewUserIds = dto.crewUserIds;
    if (dto.leadInstallerUserId !== undefined) {
      visit.leadInstallerUserId = dto.leadInstallerUserId;
    }
    if (dto.completionPercent !== undefined) {
      visit.completionPercent = dto.completionPercent;
    }
    if (dto.outstandingWork !== undefined) {
      visit.outstandingWork = dto.outstandingWork;
    }
    if (dto.abortReason !== undefined) visit.abortReason = dto.abortReason;
    if (dto.notes !== undefined) visit.notes = dto.notes;

    const saved = await this.visitRepo.save(visit);
    await this.syncProjectFromVisits(project);

    if (saved.status === InstallVisitStatus.PARTIAL && saved.outstandingWork) {
      await this.tasks
        .create(
          {
            jobId: project.jobId,
            title: `Schedule follow-up visit for ${project.projectNumber}`,
            description: saved.outstandingWork,
          },
          { userId: viewer.userId, role: viewer.role },
        )
        .catch(() => undefined);
    }

    return saved;
  }

  /**
   * Derive the project's install state from its visits. A project is only
   * `installed` when a visit completed in full and nothing is left partial.
   */
  private async syncProjectFromVisits(project: Project): Promise<void> {
    const visits = await this.visitRepo.find({
      where: { projectId: project.id },
    });
    const anyStarted = visits.some(
      (v) =>
        v.status === InstallVisitStatus.IN_PROGRESS ||
        v.status === InstallVisitStatus.PARTIAL,
    );
    const completed = visits.filter(
      (v) => v.status === InstallVisitStatus.COMPLETED,
    );
    const outstanding = visits.some(
      (v) => v.status === InstallVisitStatus.PARTIAL,
    );

    const patch: ProjectScalarPatch = {};
    if (completed.length > 0 && !outstanding) {
      if (
        project.stage === ProjectStage.SCHEDULED ||
        project.stage === ProjectStage.IN_PROGRESS
      ) {
        patch.stage = ProjectStage.INSTALLED;
      }
      const lastDate = completed
        .map((v) => v.completedAt)
        .filter((d): d is Date => d instanceof Date)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      if (lastDate && !project.actualInstallDate) {
        patch.actualInstallDate = lastDate.toISOString().slice(0, 10);
      }
    } else if (anyStarted && project.stage === ProjectStage.SCHEDULED) {
      patch.stage = ProjectStage.IN_PROGRESS;
    }

    if (Object.keys(patch).length > 0) {
      await this.projectRepo.update({ id: project.id }, patch);
    }
  }

  // ─── Defects ──────────────────────────────────────────────────────────────

  async listDefects(
    projectId: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<InstallDefect[]> {
    await this.assertEnabled(viewer.role);
    await this.loadProject(projectId, viewer);
    return this.defectRepo.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
  }

  async upsertDefect(
    projectId: string,
    dto: UpsertDefectDto,
    viewer: { userId: string; role: UserRole },
  ): Promise<InstallDefect> {
    await this.assertEnabled(viewer.role);
    const project = await this.loadProject(projectId, viewer);

    let defect: InstallDefect | null = null;
    if (dto.id) {
      defect = await this.defectRepo.findOne({
        where: { id: dto.id, projectId },
      });
      if (!defect) throw new NotFoundException(`Defect ${dto.id} not found`);
    } else {
      if (!dto.title?.trim()) {
        throw new BadRequestException('A defect needs a title');
      }
      defect = this.defectRepo.create({
        projectId,
        title: dto.title,
        severity: dto.severity ?? DefectSeverity.MINOR,
        status: DefectStatus.OPEN,
        reportedByUserId: viewer.userId,
      });
    }

    if (dto.title !== undefined) defect.title = dto.title;
    if (dto.description !== undefined) defect.description = dto.description;
    if (dto.severity !== undefined) defect.severity = dto.severity;
    if (dto.installVisitId !== undefined) {
      defect.installVisitId = dto.installVisitId;
    }
    if (dto.assignedUserId !== undefined) {
      defect.assignedUserId = dto.assignedUserId;
    }
    if (dto.photoFileIds !== undefined) defect.photoFileIds = dto.photoFileIds;
    if (dto.resolutionNotes !== undefined) {
      defect.resolutionNotes = dto.resolutionNotes;
    }

    if (dto.status !== undefined && dto.status !== defect.status) {
      if (dto.status === DefectStatus.WAIVED) {
        const reason = dto.waiverReason?.trim() ?? defect.waiverReason;
        if (!reason) {
          throw new BadRequestException(
            'Waiving a defect requires a reason — an unexplained waiver is an audit hole',
          );
        }
        if (defect.severity === DefectSeverity.CRITICAL) {
          throw new BadRequestException(
            'A critical (safety) defect cannot be waived; it must be resolved',
          );
        }
        defect.waiverReason = reason;
      }
      if (dto.status === DefectStatus.RESOLVED) {
        defect.resolvedAt = new Date();
        defect.resolvedByUserId = viewer.userId;
      }
      defect.status = dto.status;
      defect.updatedByUserId = viewer.userId;
    }
    if (dto.waiverReason !== undefined) defect.waiverReason = dto.waiverReason;

    const saved = await this.defectRepo.save(defect);

    // A critical defect stops the world — raise it as urgent work immediately.
    if (
      saved.severity === DefectSeverity.CRITICAL &&
      saved.status === DefectStatus.OPEN
    ) {
      await this.tasks
        .create(
          {
            jobId: project.jobId,
            title: `CRITICAL defect: ${saved.title}`,
            description: saved.description ?? undefined,
            assigneeUserId: saved.assignedUserId ?? undefined,
          },
          { userId: viewer.userId, role: viewer.role },
        )
        .catch(() => undefined);
    }

    return saved;
  }

  /** Unresolved defects blocking handover (major/critical, not waived). */
  async blockingDefects(
    projectId: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<InstallDefect[]> {
    await this.assertEnabled(viewer.role);
    await this.loadProject(projectId, viewer);
    return this.defectRepo.find({
      where: {
        projectId,
        severity: In([DefectSeverity.MAJOR, DefectSeverity.CRITICAL]),
        status: In([DefectStatus.OPEN, DefectStatus.IN_PROGRESS]),
      },
    });
  }
}
