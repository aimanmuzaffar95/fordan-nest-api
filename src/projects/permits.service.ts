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
import { In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { UserRole } from '../users/entities/user-role.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPE } from '../notifications/notification-type.constants';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { isFeatureEnabled } from '../feature-flags/feature-flags.config';
import { Permit, PermitStatus } from './entities/permit.entity';
import { Project } from './entities/project.entity';
import { CreatePermitDto, UpdatePermitDto } from './dto/permit.dto';

/** Days a submitted permit may sit before it counts as stalled. */
const STALLED_AFTER_DAYS = 21;

/** Statuses that mean "with the authority, waiting". */
const IN_FLIGHT: PermitStatus[] = [
  PermitStatus.SUBMITTED,
  PermitStatus.RESUBMITTED,
];

/**
 * Own timer rather than the shared task sweep: `TasksModule` cannot import
 * `ProjectsModule` (which already imports it), and a `forwardRef` to buy one
 * fewer interval is not worth the indirection.
 */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

@Injectable()
export class PermitsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PermitsService.name);
  private sweepHandle: ReturnType<typeof setInterval> | null = null;

  onModuleInit(): void {
    this.sweepHandle = setInterval(() => {
      this.sweepStalled().catch((err: unknown) => {
        this.logger.error('Permit stall sweep failed', err);
      });
    }, SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.sweepHandle !== null) {
      clearInterval(this.sweepHandle);
      this.sweepHandle = null;
    }
  }

  constructor(
    @InjectRepository(Permit)
    private readonly permitRepo: Repository<Permit>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    private readonly notifications: NotificationsService,
    private readonly settings: RuntimeSettingsService,
  ) {}

  private async assertEnabled(role: UserRole): Promise<void> {
    const flags = await this.settings.getFeatureFlags();
    if (!isFeatureEnabled(flags, 'permitTracking', role)) {
      throw new ForbiddenException(
        'Permit tracking is not enabled for your role',
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
  ): Promise<Permit[]> {
    await this.assertEnabled(viewer.role);
    await this.loadProject(projectId, viewer);
    return this.permitRepo.find({
      where: { projectId },
      order: { createdAt: 'ASC' },
    });
  }

  async create(
    projectId: string,
    dto: CreatePermitDto,
    viewer: { userId: string; role: UserRole },
  ): Promise<Permit> {
    await this.assertEnabled(viewer.role);
    await this.loadProject(projectId, viewer);
    return this.permitRepo.save(
      this.permitRepo.create({
        projectId,
        permitType: dto.permitType,
        authorityName: dto.authorityName,
        status: dto.status ?? PermitStatus.NOT_STARTED,
        referenceNumber: dto.referenceNumber ?? null,
        targetSubmissionDate: dto.targetSubmissionDate ?? null,
        targetApprovalDate: dto.targetApprovalDate ?? null,
        feeAmount: dto.feeAmount === undefined ? null : String(dto.feeAmount),
        notes: dto.notes ?? null,
        createdByUserId: viewer.userId,
        revisionCount: 0,
      }),
    );
  }

  async update(
    id: string,
    dto: UpdatePermitDto,
    viewer: { userId: string; role: UserRole },
  ): Promise<Permit> {
    await this.assertEnabled(viewer.role);
    const permit = await this.permitRepo.findOne({ where: { id } });
    if (!permit) throw new NotFoundException(`Permit ${id} not found`);
    await this.loadProject(permit.projectId, viewer);

    if (dto.status !== undefined && dto.status !== permit.status) {
      const today = new Date().toISOString().slice(0, 10);

      if (dto.status === PermitStatus.REVISION_REQUESTED) {
        // Each round-trip is counted — a permit on its fourth revision is a
        // problem the ops manager needs to see, not just a status.
        permit.revisionCount += 1;
      }
      if (IN_FLIGHT.includes(dto.status)) {
        permit.submittedDate =
          dto.submittedDate ?? permit.submittedDate ?? today;
        // A fresh submission deserves a fresh stall clock.
        permit.stalledAlertSentAt = null;
      }
      if (dto.status === PermitStatus.APPROVED) {
        permit.approvedDate = dto.approvedDate ?? today;
      }
      if (dto.status === PermitStatus.REJECTED) {
        const reason = dto.rejectionReason?.trim() ?? permit.rejectionReason;
        if (!reason) {
          throw new BadRequestException(
            'A rejection reason is required to reject a permit',
          );
        }
        permit.rejectionReason = reason;
      }
      permit.status = dto.status;
    }

    if (dto.permitType !== undefined) permit.permitType = dto.permitType;
    if (dto.authorityName !== undefined)
      permit.authorityName = dto.authorityName;
    if (dto.referenceNumber !== undefined) {
      permit.referenceNumber = dto.referenceNumber;
    }
    if (dto.targetSubmissionDate !== undefined) {
      permit.targetSubmissionDate = dto.targetSubmissionDate;
    }
    if (dto.submittedDate !== undefined)
      permit.submittedDate = dto.submittedDate;
    if (dto.targetApprovalDate !== undefined) {
      permit.targetApprovalDate = dto.targetApprovalDate;
    }
    if (dto.approvedDate !== undefined) permit.approvedDate = dto.approvedDate;
    if (dto.expiryDate !== undefined) permit.expiryDate = dto.expiryDate;
    if (dto.revisionNotes !== undefined)
      permit.revisionNotes = dto.revisionNotes;
    if (dto.rejectionReason !== undefined) {
      permit.rejectionReason = dto.rejectionReason;
    }
    if (dto.feeAmount !== undefined) {
      permit.feeAmount = dto.feeAmount === null ? null : String(dto.feeAmount);
    }
    if (dto.notes !== undefined) permit.notes = dto.notes;

    return this.permitRepo.save(permit);
  }

  async remove(
    id: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<{ deleted: true }> {
    await this.assertEnabled(viewer.role);
    if (viewer.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can delete permits');
    }
    const permit = await this.permitRepo.findOne({ where: { id } });
    if (!permit) throw new NotFoundException(`Permit ${id} not found`);
    await this.permitRepo.delete({ id });
    return { deleted: true };
  }

  /**
   * Alert on permits sitting with an authority past the stall threshold.
   * Fires once per submission — `stalledAlertSentAt` is cleared on resubmit.
   */
  async sweepStalled(now: Date = new Date()): Promise<{ alerted: number }> {
    const flags = await this.settings.getFeatureFlags();
    if (!isFeatureEnabled(flags, 'permitTracking')) return { alerted: 0 };

    const cutoff = new Date(
      now.getTime() - STALLED_AFTER_DAYS * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);

    const stalled = await this.permitRepo.find({
      where: {
        status: In(IN_FLIGHT),
        stalledAlertSentAt: IsNull(),
        submittedDate: LessThanOrEqual(cutoff),
      },
      relations: { project: true },
    });
    if (stalled.length === 0) return { alerted: 0 };

    for (const permit of stalled) {
      const managerId = permit.project?.projectManagerUserId;
      if (managerId) {
        await this.notifications.sendToUsers([managerId], {
          type: NOTIFICATION_TYPE.PERMIT_STALLED,
          title: 'Permit stalled with the authority',
          body: `${permit.permitType} at ${permit.authorityName} has been pending since ${permit.submittedDate} on ${permit.project?.projectNumber ?? ''}`,
          metadata: { permitId: permit.id, projectId: permit.projectId },
        });
      }
      permit.stalledAlertSentAt = now;
    }
    await this.permitRepo.save(stalled);
    this.logger.log(`Permit sweep flagged ${stalled.length} stalled permit(s)`);
    return { alerted: stalled.length };
  }
}
