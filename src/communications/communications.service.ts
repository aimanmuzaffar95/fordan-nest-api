import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { isFeatureEnabled } from '../feature-flags/feature-flags.config';
import {
  CommunicationChannel,
  CommunicationDirection,
  CommunicationLog,
  CommunicationStatus,
} from './entities/communication-log.entity';
import { LogCommunicationDto } from './dto/communication.dto';

@Injectable()
export class CommunicationsService {
  constructor(
    @InjectRepository(CommunicationLog)
    private readonly logRepo: Repository<CommunicationLog>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,
    @InjectRepository(TimelineEvent)
    private readonly timelineRepo: Repository<TimelineEvent>,
    private readonly settings: RuntimeSettingsService,
  ) {}

  private async assertEnabled(role: UserRole): Promise<void> {
    const flags = await this.settings.getFeatureFlags();
    if (!isFeatureEnabled(flags, 'smsChannel', role)) {
      throw new ForbiddenException(
        'SMS and call logging is not enabled for your role',
      );
    }
  }

  async listForCustomer(
    customerId: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<CommunicationLog[]> {
    await this.assertEnabled(viewer.role);
    const customer = await this.customerRepo.findOne({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }
    return this.logRepo.find({
      where: { customerId },
      order: { occurredAt: 'DESC' },
      take: 500,
    });
  }

  /**
   * Record a communication and mirror it into the customer timeline.
   *
   * The timeline write is what makes this useful — a log nobody sees next to
   * the rest of the history may as well not exist.
   */
  async log(
    dto: LogCommunicationDto,
    viewer: { userId: string; role: UserRole },
  ): Promise<CommunicationLog> {
    await this.assertEnabled(viewer.role);

    const customer = await this.customerRepo.findOne({
      where: { id: dto.customerId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${dto.customerId} not found`);
    }

    if (dto.jobId) {
      const job = await this.jobRepo.findOne({ where: { id: dto.jobId } });
      if (!job) throw new NotFoundException(`Job ${dto.jobId} not found`);
      if (job.customerId !== dto.customerId) {
        throw new BadRequestException(
          'That job does not belong to the given customer',
        );
      }
      if (viewer.role === UserRole.MANAGER && job.managerId !== viewer.userId) {
        throw new ForbiddenException('That job is not one of yours');
      }
    }

    if (
      dto.channel === CommunicationChannel.SMS &&
      dto.direction === CommunicationDirection.OUTBOUND &&
      !dto.body?.trim()
    ) {
      throw new BadRequestException('An outbound SMS needs a message body');
    }

    const saved = await this.logRepo.save(
      this.logRepo.create({
        customerId: dto.customerId,
        jobId: dto.jobId ?? null,
        channel: dto.channel,
        direction: dto.direction,
        status: dto.status ?? defaultStatusFor(dto),
        counterparty: dto.counterparty ?? null,
        body: dto.body ?? null,
        durationSeconds: dto.durationSeconds ?? null,
        externalId: dto.externalId ?? null,
        providerName: dto.providerName ?? null,
        failureReason: dto.failureReason ?? null,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
        staffUserId: viewer.userId,
      }),
    );

    // Mirrored, not moved: the timeline is a read model, this table is the
    // record. A failed mirror must not lose the log itself.
    if (dto.jobId) {
      try {
        await this.timelineRepo.save(
          this.timelineRepo.create({
            jobId: dto.jobId,
            type: `communication_${saved.channel}`,
            payload: {
              communicationId: saved.id,
              direction: saved.direction,
              status: saved.status,
              counterparty: saved.counterparty,
              durationSeconds: saved.durationSeconds,
              preview: saved.body ? saved.body.slice(0, 200) : null,
            } as unknown as Record<string, unknown>,
            createdByUserId: viewer.userId,
          }),
        );
      } catch {
        // Deliberately swallowed — see above.
      }
    }

    return saved;
  }

  /**
   * Hard delete, matching the precedent set by project notes and customer
   * notes: a logged communication is a mistake-correction target (wrong
   * customer, test data, mis-logged call), not something that needs a
   * soft-delete audit trail of its own — the timeline mirror already
   * preserves context for anything that mattered. Restricted to admins,
   * same as the notes stores, since removing someone else's record is a
   * bigger action than creating one.
   */
  async remove(
    id: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<{ deleted: true }> {
    await this.assertEnabled(viewer.role);
    if (viewer.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can delete communications');
    }
    const log = await this.logRepo.findOne({ where: { id } });
    if (!log) throw new NotFoundException(`Communication ${id} not found`);
    await this.logRepo.delete({ id });
    return { deleted: true };
  }

  async updateStatus(
    id: string,
    status: CommunicationStatus,
    failureReason: string | null,
    viewer: { userId: string; role: UserRole },
  ): Promise<CommunicationLog> {
    await this.assertEnabled(viewer.role);
    const log = await this.logRepo.findOne({ where: { id } });
    if (!log) throw new NotFoundException(`Communication ${id} not found`);
    log.status = status;
    if (failureReason !== undefined) log.failureReason = failureReason;
    return this.logRepo.save(log);
  }
}

/** Inbound records are already received; outbound starts queued. */
function defaultStatusFor(dto: LogCommunicationDto): CommunicationStatus {
  if (dto.direction === CommunicationDirection.INBOUND) {
    return CommunicationStatus.RECEIVED;
  }
  if (
    dto.channel === CommunicationChannel.CALL ||
    dto.channel === CommunicationChannel.MEETING
  ) {
    return CommunicationStatus.COMPLETED;
  }
  return CommunicationStatus.QUEUED;
}
