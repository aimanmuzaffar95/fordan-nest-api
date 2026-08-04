import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { isFeatureEnabled } from '../feature-flags/feature-flags.config';
import { TasksService } from '../tasks/tasks.service';
import {
  PROJECT_STAGE_ORDER,
  Project,
  ProjectStage,
} from './entities/project.entity';
import { UpdateProjectDto } from './dto/project.dto';

/** Readiness items that must be ticked before a project can be scheduled. */
export const INSTALL_READINESS_ITEMS = [
  { id: 'permits_approved', label: 'All required permits approved' },
  { id: 'equipment_allocated', label: 'Equipment allocated and in stock' },
  { id: 'crew_assigned', label: 'Crew assigned and briefed' },
  { id: 'customer_confirmed', label: 'Install date confirmed with customer' },
  { id: 'site_access_arranged', label: 'Site access arranged' },
  { id: 'swms_complete', label: 'SWMS and safety paperwork complete' },
  { id: 'deposit_received', label: 'Deposit received' },
  { id: 'financing_settled', label: 'Financing settled (if applicable)' },
] as const;

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
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

  /**
   * Create the delivery Project for a signed job.
   *
   * The heart of the strangler split. Idempotent on `jobId` (which is unique),
   * and self-guarding: contract signing must never fail because project
   * creation did — an unsigned contract is a lost sale, a missing project is a
   * five-second fix.
   */
  async createFromSignedJob(
    jobId: string,
    actorUserId: string | null,
  ): Promise<Project | null> {
    try {
      const flags = await this.settings.getFeatureFlags();
      if (!isFeatureEnabled(flags, 'projectSplit')) return null;

      const existing = await this.projectRepo.findOne({ where: { jobId } });
      if (existing) return existing;

      const job = await this.jobRepo.findOne({ where: { id: jobId } });
      if (!job || !job.contractSigned) return null;

      const customer = await this.customerRepo.findOne({
        where: { id: job.customerId },
      });

      const project = await this.projectRepo.save(
        this.projectRepo.create({
          jobId: job.id,
          // Derived from the order number so the two are obviously paired on
          // any report that shows both.
          projectNumber: `P-${job.orderNumber}`,
          customerId: job.customerId,
          stage: ProjectStage.INITIATED,
          // Snapshot: later edits to the opportunity must not rewrite what the
          // crew was dispatched to build.
          siteAddress: customer?.address ?? null,
          systemSizeKw: job.systemSizeKw,
          batterySizeKwh: job.batterySizeKwh,
          contractValue: job.projectPrice,
          contractSignedAt: new Date(),
          projectManagerUserId: job.managerId,
          targetInstallDate: job.installDate,
          readinessChecklist: {},
        }),
      );

      // Kick off the delivery work the moment the project exists.
      await this.tasks
        .create(
          {
            jobId: job.id,
            title: `Start permitting for ${project.projectNumber}`,
            description:
              'Contract signed — lodge the required permits and grid applications.',
            stage: 'won',
          },
          { userId: actorUserId ?? '', role: UserRole.ADMIN },
        )
        .catch(() => undefined);

      this.logger.log(
        `Created project ${project.projectNumber} from signed job ${job.orderNumber}`,
      );
      return project;
    } catch (err: unknown) {
      this.logger.error(`Project auto-create failed for job ${jobId}`, err);
      return null;
    }
  }

  /**
   * `limit`/`offset` are optional and default to the previous behaviour. They
   * exist so a caller past the cap can page rather than silently receiving a
   * truncated list with no indication it was cut.
   */
  async list(
    viewer: { userId: string; role: UserRole },
    page: { limit?: number; offset?: number } = {},
  ): Promise<Project[]> {
    await this.assertEnabled(viewer.role);
    const take = Math.min(page.limit ?? 500, 500);
    const skip = page.offset ?? 0;

    return this.projectRepo.find({
      ...(viewer.role === UserRole.ADMIN
        ? {}
        : { where: { projectManagerUserId: viewer.userId } }),
      order: { createdAt: 'DESC', id: 'DESC' },
      take,
      skip,
    });
  }

  async findOne(
    id: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<Project> {
    await this.assertEnabled(viewer.role);
    const project = await this.projectRepo.findOne({ where: { id } });
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    if (
      viewer.role === UserRole.MANAGER &&
      project.projectManagerUserId !== viewer.userId
    ) {
      throw new ForbiddenException('That project is not one of yours');
    }
    return project;
  }

  async findByJob(
    jobId: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<Project | null> {
    await this.assertEnabled(viewer.role);
    return this.projectRepo.findOne({ where: { jobId } });
  }

  async update(
    id: string,
    dto: UpdateProjectDto,
    viewer: { userId: string; role: UserRole },
  ): Promise<Project> {
    const project = await this.findOne(id, viewer);

    if (dto.stage !== undefined && dto.stage !== project.stage) {
      this.assertStageMoveAllowed(project, dto.stage);
      project.stage = dto.stage;
      if (dto.stage === ProjectStage.COMPLETED) {
        project.completedAt = new Date();
      }
      if (dto.stage === ProjectStage.ON_HOLD) {
        if (!dto.holdReason?.trim()) {
          throw new BadRequestException(
            'A hold reason is required to put a project on hold',
          );
        }
        project.heldAt = new Date();
      } else {
        project.heldAt = null;
        project.holdReason = null;
      }
    }

    if (dto.holdReason !== undefined) project.holdReason = dto.holdReason;
    if (dto.projectManagerUserId !== undefined) {
      project.projectManagerUserId = dto.projectManagerUserId;
    }
    if (dto.targetInstallDate !== undefined) {
      project.targetInstallDate = dto.targetInstallDate;
    }
    if (dto.actualInstallDate !== undefined) {
      project.actualInstallDate = dto.actualInstallDate;
    }
    if (dto.targetPtoDate !== undefined) {
      project.targetPtoDate = dto.targetPtoDate;
    }
    if (dto.actualPtoDate !== undefined) {
      project.actualPtoDate = dto.actualPtoDate;
    }
    if (dto.notes !== undefined) project.notes = dto.notes;

    if (dto.readinessChecklist !== undefined) {
      const valid = new Set<string>(INSTALL_READINESS_ITEMS.map((i) => i.id));
      const cleaned: Record<string, boolean> = {
        ...(project.readinessChecklist ?? {}),
      };
      for (const [key, value] of Object.entries(dto.readinessChecklist)) {
        if (!valid.has(key)) {
          throw new BadRequestException(`Unknown readiness item "${key}"`);
        }
        cleaned[key] = value === true;
      }
      project.readinessChecklist = cleaned;

      if (this.isReadinessComplete(cleaned)) {
        project.readinessConfirmedAt = new Date();
        project.readinessConfirmedByUserId = viewer.userId;
      } else {
        project.readinessConfirmedAt = null;
        project.readinessConfirmedByUserId = null;
      }
    }

    return this.projectRepo.save(project);
  }

  private isReadinessComplete(checklist: Record<string, boolean>): boolean {
    return INSTALL_READINESS_ITEMS.every((item) => checklist[item.id] === true);
  }

  /**
   * Gate stage moves.
   *
   * Scheduling without a complete readiness checklist is the specific mistake
   * this exists to prevent — it's the one that sends a crew to a site that
   * isn't ready, which costs a day and a customer's goodwill.
   */
  private assertStageMoveAllowed(project: Project, target: ProjectStage): void {
    if (project.stage === ProjectStage.CANCELLED) {
      throw new BadRequestException(
        'A cancelled project cannot change stage; reopen it first',
      );
    }
    if (
      target === ProjectStage.SCHEDULED &&
      !this.isReadinessComplete(project.readinessChecklist ?? {})
    ) {
      const missing = INSTALL_READINESS_ITEMS.filter(
        (item) => project.readinessChecklist?.[item.id] !== true,
      ).map((item) => item.label);
      throw new BadRequestException(
        `Install readiness is incomplete — outstanding: ${missing.join('; ')}`,
      );
    }
    if (target === ProjectStage.PTO && !project.actualInstallDate) {
      throw new BadRequestException(
        'A project cannot reach PTO before it has been installed',
      );
    }
    // Skipping forward past inspection is allowed (not every market inspects),
    // but going backwards past a completed install is not.
    const fromIndex = PROJECT_STAGE_ORDER.indexOf(project.stage);
    const toIndex = PROJECT_STAGE_ORDER.indexOf(target);
    if (
      fromIndex >= PROJECT_STAGE_ORDER.indexOf(ProjectStage.INSTALLED) &&
      toIndex >= 0 &&
      toIndex < PROJECT_STAGE_ORDER.indexOf(ProjectStage.INSTALLED)
    ) {
      throw new BadRequestException(
        'An installed project cannot move back before installation',
      );
    }
  }

  /** The readiness checklist definition plus a project's current ticks. */
  async readiness(
    id: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<{
    items: Array<{ id: string; label: string; done: boolean }>;
    complete: boolean;
    confirmedAt: string | null;
  }> {
    const project = await this.findOne(id, viewer);
    const checklist = project.readinessChecklist ?? {};
    return {
      items: INSTALL_READINESS_ITEMS.map((item) => ({
        id: item.id,
        label: item.label,
        done: checklist[item.id] === true,
      })),
      complete: this.isReadinessComplete(checklist),
      confirmedAt: project.readinessConfirmedAt
        ? project.readinessConfirmedAt.toISOString()
        : null,
    };
  }
}
