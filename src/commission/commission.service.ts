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
import { SystemAuditLogService } from '../system-audit/system-audit-log.service';
import {
  CommissionEvent,
  CommissionEventType,
  CommissionStatus,
} from './entities/commission-event.entity';
import {
  CreateCommissionEventDto,
  UpdateCommissionEventDto,
} from './dto/commission.dto';

/** Legal status moves. Paid is terminal except for a clawback. */
const ALLOWED_TRANSITIONS: Record<CommissionStatus, CommissionStatus[]> = {
  [CommissionStatus.PENDING]: [
    CommissionStatus.APPROVED,
    CommissionStatus.VOID,
  ],
  [CommissionStatus.APPROVED]: [
    CommissionStatus.PAID,
    CommissionStatus.VOID,
    CommissionStatus.PENDING,
  ],
  [CommissionStatus.PAID]: [CommissionStatus.CLAWED_BACK],
  [CommissionStatus.VOID]: [],
  [CommissionStatus.CLAWED_BACK]: [],
};

export type CommissionSummary = {
  userId: string;
  pending: number;
  approved: number;
  paid: number;
  clawedBack: number;
  /** approved + pending — what the rep can expect. */
  outstanding: number;
};

@Injectable()
export class CommissionService {
  constructor(
    @InjectRepository(CommissionEvent)
    private readonly eventRepo: Repository<CommissionEvent>,
    private readonly settings: RuntimeSettingsService,
    private readonly systemAudit: SystemAuditLogService,
  ) {}

  private async assertEnabled(role: UserRole): Promise<void> {
    const flags = await this.settings.getFeatureFlags();
    if (!isFeatureEnabled(flags, 'commission', role)) {
      throw new ForbiddenException('Commission is not enabled for your role');
    }
  }

  /** Money others earned is admin-only; a rep may only see their own. */
  private assertCanViewUser(
    targetUserId: string,
    viewer: { userId: string; role: UserRole },
  ): void {
    if (viewer.role === UserRole.ADMIN) return;
    if (targetUserId !== viewer.userId) {
      throw new ForbiddenException(
        'You can only view your own commission records',
      );
    }
  }

  async list(
    filters: {
      userId?: string;
      jobId?: string;
      status?: CommissionStatus;
      limit?: number;
      offset?: number;
    },
    viewer: { userId: string; role: UserRole },
  ): Promise<CommissionEvent[]> {
    await this.assertEnabled(viewer.role);
    const targetUserId =
      viewer.role === UserRole.ADMIN
        ? filters.userId
        : (filters.userId ?? viewer.userId);
    if (targetUserId) this.assertCanViewUser(targetUserId, viewer);

    return this.eventRepo.find({
      where: {
        ...(targetUserId ? { userId: targetUserId } : {}),
        ...(filters.jobId ? { jobId: filters.jobId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      // Optional paging so a caller past the cap is not silently truncated.
      take: Math.min(filters.limit ?? 500, 500),
      skip: filters.offset ?? 0,
    });
  }

  async summary(
    userId: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<CommissionSummary> {
    await this.assertEnabled(viewer.role);
    this.assertCanViewUser(userId, viewer);

    const events = await this.eventRepo.find({ where: { userId } });
    const total = (status: CommissionStatus): number =>
      events
        .filter((e) => e.status === status)
        .reduce((sum, e) => sum + Number(e.amount), 0);

    const pending = total(CommissionStatus.PENDING);
    const approved = total(CommissionStatus.APPROVED);

    return {
      userId,
      pending: round2(pending),
      approved: round2(approved),
      paid: round2(total(CommissionStatus.PAID)),
      clawedBack: round2(total(CommissionStatus.CLAWED_BACK)),
      outstanding: round2(pending + approved),
    };
  }

  async create(
    dto: CreateCommissionEventDto,
    viewer: { userId: string; role: UserRole },
  ): Promise<CommissionEvent> {
    await this.assertEnabled(viewer.role);
    if (viewer.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can create commission records');
    }

    // A rate-based entry must show its working — basis and rate, so the amount
    // can be re-derived during a payout dispute.
    if (dto.ratePercent !== undefined && dto.basisAmount === undefined) {
      throw new BadRequestException(
        'A rate-based commission must also record the basisAmount it was applied to',
      );
    }
    if (
      (dto.eventType === CommissionEventType.CLAWBACK ||
        dto.eventType === CommissionEventType.ADJUSTMENT) &&
      dto.amount > 0
    ) {
      throw new BadRequestException(
        `${dto.eventType} amounts must be zero or negative`,
      );
    }
    if (
      dto.eventType !== CommissionEventType.CLAWBACK &&
      dto.eventType !== CommissionEventType.ADJUSTMENT &&
      dto.amount < 0
    ) {
      throw new BadRequestException(
        'Only adjustments and clawbacks may be negative',
      );
    }

    const saved = await this.eventRepo.save(
      this.eventRepo.create({
        userId: dto.userId,
        jobId: dto.jobId ?? null,
        projectId: dto.projectId ?? null,
        eventType: dto.eventType,
        status: CommissionStatus.PENDING,
        amount: dto.amount.toFixed(2),
        currency: dto.currency ?? 'AUD',
        basisAmount:
          dto.basisAmount === undefined ? null : dto.basisAmount.toFixed(2),
        ratePercent:
          dto.ratePercent === undefined ? null : String(dto.ratePercent),
        planName: dto.planName ?? null,
        reversesEventId: dto.reversesEventId ?? null,
        notes: dto.notes ?? null,
        createdByUserId: viewer.userId,
      }),
    );

    await this.systemAudit.record({
      action: 'COMMISSION_EVENT_CREATED',
      actorUserId: viewer.userId,
      resourceType: 'commission_event',
      resourceId: saved.id,
      metadata: {
        userId: saved.userId,
        amount: saved.amount,
        eventType: saved.eventType,
      },
    });

    return saved;
  }

  async update(
    id: string,
    dto: UpdateCommissionEventDto,
    viewer: { userId: string; role: UserRole },
  ): Promise<CommissionEvent> {
    await this.assertEnabled(viewer.role);
    if (viewer.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can change commission records');
    }

    const event = await this.eventRepo.findOne({ where: { id } });
    if (!event) throw new NotFoundException(`Commission event ${id} not found`);

    if (dto.status !== undefined && dto.status !== event.status) {
      const allowed = ALLOWED_TRANSITIONS[event.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Cannot move a commission record from ${event.status} to ${dto.status}`,
        );
      }
      if (
        (dto.status === CommissionStatus.VOID ||
          dto.status === CommissionStatus.CLAWED_BACK) &&
        !dto.reason?.trim()
      ) {
        throw new BadRequestException(
          `A reason is required to ${dto.status === CommissionStatus.VOID ? 'void' : 'claw back'} a commission record`,
        );
      }
      if (dto.status === CommissionStatus.APPROVED) {
        event.approvedAt = new Date();
        event.approvedByUserId = viewer.userId;
      }
      if (dto.status === CommissionStatus.PAID) {
        event.paidAt = new Date();
      }
      event.status = dto.status;
    }

    // A paid record's money fields are frozen: correct it with an offsetting
    // adjustment so the payout run stays reconcilable.
    const isPaid =
      event.status === CommissionStatus.PAID ||
      event.status === CommissionStatus.CLAWED_BACK;
    if (isPaid && (dto.amount !== undefined || dto.basisAmount !== undefined)) {
      throw new BadRequestException(
        'A paid commission record cannot be re-priced; post an offsetting adjustment instead',
      );
    }

    if (dto.amount !== undefined) event.amount = dto.amount.toFixed(2);
    if (dto.basisAmount !== undefined) {
      event.basisAmount =
        dto.basisAmount === null ? null : dto.basisAmount.toFixed(2);
    }
    if (dto.payoutReference !== undefined) {
      event.payoutReference = dto.payoutReference;
    }
    if (dto.reason !== undefined) event.reason = dto.reason;
    if (dto.notes !== undefined) event.notes = dto.notes;

    const saved = await this.eventRepo.save(event);

    await this.systemAudit.record({
      action: 'COMMISSION_EVENT_UPDATED',
      actorUserId: viewer.userId,
      resourceType: 'commission_event',
      resourceId: saved.id,
      metadata: { status: saved.status, reason: saved.reason },
    });

    return saved;
  }

  /**
   * Mark a batch approved and paid under one payout reference.
   * Only `approved` records are eligible — paying something unapproved is the
   * mistake this guards against.
   */
  async recordPayout(
    params: { eventIds: string[]; payoutReference: string },
    viewer: { userId: string; role: UserRole },
  ): Promise<{ paid: number; total: number }> {
    await this.assertEnabled(viewer.role);
    if (viewer.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can record commission payouts');
    }
    if (params.eventIds.length === 0) {
      throw new BadRequestException('No commission records selected');
    }

    const events = await this.eventRepo.find({
      where: { id: In(params.eventIds) },
    });
    const ineligible = events.filter(
      (e) => e.status !== CommissionStatus.APPROVED,
    );
    if (ineligible.length > 0) {
      throw new BadRequestException(
        `Only approved records can be paid — ${ineligible.length} of the selected records are not approved`,
      );
    }

    const now = new Date();
    for (const event of events) {
      event.status = CommissionStatus.PAID;
      event.paidAt = now;
      event.payoutReference = params.payoutReference;
    }
    await this.eventRepo.save(events);

    const total = round2(events.reduce((sum, e) => sum + Number(e.amount), 0));

    await this.systemAudit.record({
      action: 'COMMISSION_PAYOUT_RECORDED',
      actorUserId: viewer.userId,
      resourceType: 'commission_payout',
      resourceId: params.payoutReference,
      metadata: { count: events.length, total },
    });

    return { paid: events.length, total };
  }

  /** Flat rows for an accounting export. */
  async exportRows(
    filters: { status?: CommissionStatus; payoutReference?: string },
    viewer: { userId: string; role: UserRole },
  ): Promise<
    Array<{
      id: string;
      userId: string;
      jobId: string | null;
      eventType: string;
      status: string;
      amount: number;
      currency: string;
      payoutReference: string | null;
      paidAt: string | null;
      createdAt: string;
    }>
  > {
    await this.assertEnabled(viewer.role);
    if (viewer.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can export commission data');
    }
    // An accounting export that silently stops at a row cap is worse than one
    // that fails: the omission is invisible downstream. Page through instead,
    // so the extract is always complete.
    const where = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.payoutReference
        ? { payoutReference: filters.payoutReference }
        : {}),
    };
    const pageSize = 1000;
    const events: CommissionEvent[] = [];
    for (let skip = 0; ; skip += pageSize) {
      const page = await this.eventRepo.find({
        where,
        order: { createdAt: 'ASC', id: 'ASC' },
        skip,
        take: pageSize,
      });
      events.push(...page);
      if (page.length < pageSize) break;
    }

    return events.map((e) => ({
      id: e.id,
      userId: e.userId,
      jobId: e.jobId,
      eventType: e.eventType,
      status: e.status,
      amount: Number(e.amount),
      currency: e.currency,
      payoutReference: e.payoutReference,
      paidAt: e.paidAt ? e.paidAt.toISOString() : null,
      createdAt: e.createdAt.toISOString(),
    }));
  }
}

/** Money must not drift on float addition. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
