import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { Job } from '../jobs/entities/job.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPE } from '../notifications/notification-type.constants';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { isFeatureEnabled } from '../feature-flags/feature-flags.config';
import {
  FinancingApplication,
  FinancingStatus,
} from './entities/financing-application.entity';
import {
  CreateFinancingApplicationDto,
  UpdateFinancingApplicationDto,
} from './dto/financing.dto';

/** Days before an approval lapses that we warn the job's manager. */
const EXPIRY_WARNING_DAYS = 7;

/**
 * Legal status transitions. Financing drives whether a job can proceed, so an
 * arbitrary status jump (e.g. declined → settled) must be impossible.
 */
const ALLOWED_TRANSITIONS: Record<FinancingStatus, FinancingStatus[]> = {
  [FinancingStatus.INTENT]: [
    FinancingStatus.SUBMITTED,
    FinancingStatus.WITHDRAWN,
  ],
  [FinancingStatus.SUBMITTED]: [
    FinancingStatus.INFO_REQUESTED,
    FinancingStatus.APPROVED,
    FinancingStatus.DECLINED,
    FinancingStatus.WITHDRAWN,
  ],
  [FinancingStatus.INFO_REQUESTED]: [
    FinancingStatus.SUBMITTED,
    FinancingStatus.APPROVED,
    FinancingStatus.DECLINED,
    FinancingStatus.WITHDRAWN,
  ],
  [FinancingStatus.APPROVED]: [
    FinancingStatus.SETTLED,
    FinancingStatus.EXPIRED,
    FinancingStatus.WITHDRAWN,
  ],
  // Terminal.
  [FinancingStatus.DECLINED]: [],
  [FinancingStatus.EXPIRED]: [],
  [FinancingStatus.WITHDRAWN]: [],
  [FinancingStatus.SETTLED]: [],
};

@Injectable()
export class FinancingService {
  private readonly logger = new Logger(FinancingService.name);

  constructor(
    @InjectRepository(FinancingApplication)
    private readonly appRepo: Repository<FinancingApplication>,
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,
    private readonly notifications: NotificationsService,
    private readonly settings: RuntimeSettingsService,
  ) {}

  private async assertEnabled(role: UserRole): Promise<void> {
    const flags = await this.settings.getFeatureFlags();
    if (!isFeatureEnabled(flags, 'financing', role)) {
      throw new ForbiddenException(
        'The financing workflow is not enabled for your role',
      );
    }
  }

  private async assertJobInScope(
    jobId: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<Job> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);
    if (viewer.role === UserRole.MANAGER && job.managerId !== viewer.userId) {
      throw new ForbiddenException('That job is not one of yours');
    }
    return job;
  }

  async listForJob(
    jobId: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<FinancingApplication[]> {
    await this.assertEnabled(viewer.role);
    await this.assertJobInScope(jobId, viewer);
    return this.appRepo.find({
      where: { jobId },
      order: { createdAt: 'DESC' },
    });
  }

  async create(
    jobId: string,
    dto: CreateFinancingApplicationDto,
    viewer: { userId: string; role: UserRole },
  ): Promise<FinancingApplication> {
    await this.assertEnabled(viewer.role);
    await this.assertJobInScope(jobId, viewer);

    return this.appRepo.save(
      this.appRepo.create({
        jobId,
        status: FinancingStatus.INTENT,
        lenderName: dto.lenderName,
        productName: dto.productName ?? null,
        externalReference: dto.externalReference ?? null,
        requestedAmount:
          dto.requestedAmount === undefined
            ? null
            : String(dto.requestedAmount),
        interestRatePercent:
          dto.interestRatePercent === undefined
            ? null
            : String(dto.interestRatePercent),
        termMonths: dto.termMonths ?? null,
        notes: dto.notes ?? null,
        createdByUserId: viewer.userId,
      }),
    );
  }

  async update(
    id: string,
    dto: UpdateFinancingApplicationDto,
    viewer: { userId: string; role: UserRole },
  ): Promise<FinancingApplication> {
    await this.assertEnabled(viewer.role);
    const application = await this.appRepo.findOne({ where: { id } });
    if (!application) {
      throw new NotFoundException(`Financing application ${id} not found`);
    }
    await this.assertJobInScope(application.jobId, viewer);

    if (dto.status !== undefined && dto.status !== application.status) {
      const allowed = ALLOWED_TRANSITIONS[application.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Cannot move a financing application from ${application.status} to ${dto.status}`,
        );
      }
      this.applyStatusSideEffects(application, dto);
      application.status = dto.status;
    }

    if (dto.lenderName !== undefined) application.lenderName = dto.lenderName;
    if (dto.productName !== undefined)
      application.productName = dto.productName;
    if (dto.externalReference !== undefined) {
      application.externalReference = dto.externalReference;
    }
    if (dto.requestedAmount !== undefined) {
      application.requestedAmount =
        dto.requestedAmount === null ? null : String(dto.requestedAmount);
    }
    if (dto.approvedAmount !== undefined) {
      application.approvedAmount =
        dto.approvedAmount === null ? null : String(dto.approvedAmount);
    }
    if (dto.interestRatePercent !== undefined) {
      application.interestRatePercent =
        dto.interestRatePercent === null
          ? null
          : String(dto.interestRatePercent);
    }
    if (dto.termMonths !== undefined) application.termMonths = dto.termMonths;
    if (dto.monthlyPayment !== undefined) {
      application.monthlyPayment =
        dto.monthlyPayment === null ? null : String(dto.monthlyPayment);
    }
    if (dto.approvalExpiresAt !== undefined) {
      application.approvalExpiresAt = dto.approvalExpiresAt
        ? new Date(dto.approvalExpiresAt)
        : null;
      // A re-dated approval deserves a fresh warning.
      application.expiryReminderSentAt = null;
    }
    if (dto.declineReason !== undefined) {
      application.declineReason = dto.declineReason;
    }
    if (dto.outstandingRequirements !== undefined) {
      application.outstandingRequirements = dto.outstandingRequirements;
    }
    if (dto.notes !== undefined) application.notes = dto.notes;

    return this.appRepo.save(application);
  }

  private applyStatusSideEffects(
    application: FinancingApplication,
    dto: UpdateFinancingApplicationDto,
  ): void {
    const now = new Date();
    switch (dto.status) {
      case FinancingStatus.SUBMITTED:
        application.submittedAt = application.submittedAt ?? now;
        break;
      case FinancingStatus.APPROVED:
        application.decisionAt = now;
        if (!dto.approvalExpiresAt && !application.approvalExpiresAt) {
          throw new BadRequestException(
            'An approval must carry approvalExpiresAt — approvals lapse and an expired one discovered on install day cancels the job',
          );
        }
        break;
      case FinancingStatus.DECLINED:
        application.decisionAt = now;
        if (!dto.declineReason?.trim() && !application.declineReason) {
          throw new BadRequestException(
            'A decline reason is required to decline a financing application',
          );
        }
        break;
      case FinancingStatus.SETTLED:
        application.settledAt = now;
        break;
      default:
        break;
    }
  }

  /**
   * Warn on approvals nearing expiry and expire the ones that have lapsed.
   * Runs on the shared SLA sweep.
   */
  async sweepExpiries(now: Date = new Date()): Promise<{
    warned: number;
    expired: number;
  }> {
    const flags = await this.settings.getFeatureFlags();
    if (!isFeatureEnabled(flags, 'financing')) {
      return { warned: 0, expired: 0 };
    }

    // Lapsed approvals first, so a single sweep can't both warn and expire.
    const lapsed = await this.appRepo.find({
      where: {
        status: FinancingStatus.APPROVED,
        approvalExpiresAt: LessThanOrEqual(now),
      },
      relations: { job: true },
    });
    for (const application of lapsed) {
      application.status = FinancingStatus.EXPIRED;
    }
    if (lapsed.length > 0) await this.appRepo.save(lapsed);

    const warnCutoff = new Date(
      now.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000,
    );
    const nearing = await this.appRepo.find({
      where: {
        status: FinancingStatus.APPROVED,
        expiryReminderSentAt: IsNull(),
        approvalExpiresAt: LessThanOrEqual(warnCutoff),
      },
      relations: { job: true },
    });

    for (const application of nearing) {
      const managerId = application.job?.managerId;
      if (managerId) {
        await this.notifications.sendToUsers([managerId], {
          type: NOTIFICATION_TYPE.FINANCING_APPROVAL_EXPIRING,
          title: 'Financing approval expiring soon',
          body: `${application.lenderName} approval for job ${
            application.job?.orderNumber ?? ''
          } expires ${application.approvalExpiresAt?.toISOString().slice(0, 10)}`,
          metadata: {
            financingApplicationId: application.id,
            jobId: application.jobId,
          },
        });
      }
      application.expiryReminderSentAt = now;
    }
    if (nearing.length > 0) await this.appRepo.save(nearing);

    if (lapsed.length > 0 || nearing.length > 0) {
      this.logger.log(
        `Financing sweep: ${nearing.length} warned, ${lapsed.length} expired`,
      );
    }
    return { warned: nearing.length, expired: lapsed.length };
  }
}
