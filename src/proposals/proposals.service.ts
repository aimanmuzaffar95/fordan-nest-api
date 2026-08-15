import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { Job } from '../jobs/entities/job.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { isFeatureEnabled } from '../feature-flags/feature-flags.config';
import { RoofDesignService } from '../solar-design/roof-design.service';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import {
  PricingMode,
  ProposalStatus,
  ProposalVersion,
} from './entities/proposal-version.entity';
import { CreateProposalVersionDto, SendProposalDto } from './dto/proposal.dto';

/** Statuses a version can no longer be edited from. */
const TERMINAL_STATUSES: ProposalStatus[] = [
  ProposalStatus.ACCEPTED,
  ProposalStatus.DECLINED,
  ProposalStatus.EXPIRED,
  ProposalStatus.SUPERSEDED,
];

@Injectable()
export class ProposalsService {
  constructor(
    @InjectRepository(ProposalVersion)
    private readonly versionRepo: Repository<ProposalVersion>,
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,
    @InjectRepository(TimelineEvent)
    private readonly timelineRepo: Repository<TimelineEvent>,
    private readonly dataSource: DataSource,
    private readonly settings: RuntimeSettingsService,
    private readonly roofDesigns: RoofDesignService,
  ) {}

  private async assertEnabled(role: UserRole): Promise<void> {
    const flags = await this.settings.getFeatureFlags();
    if (!isFeatureEnabled(flags, 'proposalVersioning', role)) {
      throw new ForbiddenException(
        'Proposal versioning is not enabled for your role',
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
  ): Promise<ProposalVersion[]> {
    await this.assertEnabled(viewer.role);
    await this.assertJobInScope(jobId, viewer);
    return this.versionRepo.find({
      where: { jobId },
      order: { versionNumber: 'DESC' },
    });
  }

  /**
   * Create the next version for a job.
   *
   * The version number is allocated inside a transaction, and the unique
   * `(jobId, versionNumber)` index is the real guard — two coordinators
   * clicking at once must not both mint "version 3".
   */
  async createVersion(
    jobId: string,
    dto: CreateProposalVersionDto,
    viewer: { userId: string; role: UserRole },
  ): Promise<ProposalVersion> {
    await this.assertEnabled(viewer.role);
    await this.assertJobInScope(jobId, viewer);
    this.assertPricingCoherent(dto);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ProposalVersion);
      const latest = await repo.findOne({
        where: { jobId },
        order: { versionNumber: 'DESC' },
      });

      return repo.save(
        repo.create({
          jobId,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          status: ProposalStatus.DRAFT,
          pricingMode: dto.pricingMode ?? PricingMode.CASH,
          // Absent means "not priced yet", not "priced at $0" — persist as
          // `null` so `resolveAgreedPrice` can tell the two apart. Existing
          // rows created before this change already persisted `'0.00'` for
          // an unset price and are left untouched (see the migration).
          totalPrice:
            dto.totalPrice === undefined ? null : String(dto.totalPrice),
          depositAmount: String(dto.depositAmount ?? 0),
          rebateAmount:
            dto.rebateAmount === undefined ? null : String(dto.rebateAmount),
          interestRatePercent:
            dto.interestRatePercent === undefined
              ? null
              : String(dto.interestRatePercent),
          termMonths: dto.termMonths ?? null,
          monthlyPayment:
            dto.monthlyPayment === undefined
              ? null
              : String(dto.monthlyPayment),
          ppaRatePerKwh:
            dto.ppaRatePerKwh === undefined ? null : String(dto.ppaRatePerKwh),
          lineItemsSnapshot: dto.lineItemsSnapshot ?? null,
          systemSnapshot: dto.systemSnapshot ?? null,
          notes: dto.notes ?? null,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          createdByUserId: viewer.userId,
        }),
      );
    });
  }

  /** Financed modes need terms; cash must not carry them. */
  private assertPricingCoherent(dto: CreateProposalVersionDto): void {
    const mode = dto.pricingMode ?? PricingMode.CASH;
    if (mode === PricingMode.PPA && dto.ppaRatePerKwh === undefined) {
      throw new BadRequestException('PPA proposals require ppaRatePerKwh');
    }
    if (
      (mode === PricingMode.LOAN || mode === PricingMode.LEASE) &&
      (dto.termMonths === undefined || dto.monthlyPayment === undefined)
    ) {
      throw new BadRequestException(
        `${mode} proposals require termMonths and monthlyPayment`,
      );
    }
    if (mode === PricingMode.CASH && dto.termMonths !== undefined) {
      throw new BadRequestException(
        'Cash proposals cannot carry a finance term',
      );
    }
  }

  /**
   * Mark a version sent. Supersedes every other non-terminal version for the
   * job so exactly one proposal is ever live with the customer.
   */
  async send(
    id: string,
    dto: SendProposalDto,
    viewer: { userId: string; role: UserRole },
  ): Promise<ProposalVersion> {
    const version = await this.load(id, viewer);
    if (TERMINAL_STATUSES.includes(version.status)) {
      throw new BadRequestException(
        `A ${version.status} proposal cannot be sent again`,
      );
    }

    await this.versionRepo.update(
      {
        jobId: version.jobId,
        id: Not(version.id),
        status: ProposalStatus.SENT,
      },
      { status: ProposalStatus.SUPERSEDED },
    );
    await this.versionRepo.update(
      {
        jobId: version.jobId,
        id: Not(version.id),
        status: ProposalStatus.VIEWED,
      },
      { status: ProposalStatus.SUPERSEDED },
    );

    version.status = ProposalStatus.SENT;
    version.sentAt = new Date();
    version.sentByUserId = viewer.userId;
    version.sentToEmail = dto.email ?? null;
    if (dto.expiresAt !== undefined) {
      version.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }

    // Freeze the current roof design (if any) into the snapshot so a sent
    // proposal never changes when the coordinator keeps editing the design.
    const roofDesign = await this.roofDesigns.getForJob(version.jobId);
    if (roofDesign) {
      version.systemSnapshot = {
        ...(version.systemSnapshot ?? {}),
        roofDesign,
      };
    }

    const saved = await this.versionRepo.save(version);

    await this.timelineRepo.save(
      this.timelineRepo.create({
        jobId: saved.jobId,
        type: 'proposal_sent',
        payload: {
          proposalVersionId: saved.id,
          versionNumber: saved.versionNumber,
          recipientEmail: saved.sentToEmail,
          sentAt: saved.sentAt?.toISOString() ?? null,
        },
        createdByUserId: viewer.userId,
      }),
    );

    return saved;
  }

  /**
   * Record a customer view. Called from the public proposal page, so it takes
   * no viewer and must stay side-effect-free beyond the counters.
   */
  async recordView(id: string): Promise<void> {
    const version = await this.versionRepo.findOne({ where: { id } });
    if (!version) return;
    // Only a live proposal counts — a view of an expired link is not interest.
    if (
      version.status !== ProposalStatus.SENT &&
      version.status !== ProposalStatus.VIEWED
    ) {
      return;
    }
    const now = new Date();
    const isFirstView = !version.firstViewedAt;
    await this.versionRepo.update(
      { id },
      {
        status: ProposalStatus.VIEWED,
        firstViewedAt: version.firstViewedAt ?? now,
        lastViewedAt: now,
        viewCount: version.viewCount + 1,
      },
    );
    if (isFirstView) {
      await this.timelineRepo.save(
        this.timelineRepo.create({
          jobId: version.jobId,
          type: 'proposal_viewed',
          payload: {
            proposalVersionId: version.id,
            versionNumber: version.versionNumber,
            firstViewedAt: now.toISOString(),
          },
          createdByUserId: null,
        }),
      );
    }
  }

  async accept(
    id: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<ProposalVersion> {
    // Scope check first, outside the transaction — it does not need the lock.
    await this.load(id, viewer);
    return this.acceptCore(id, viewer.userId);
  }

  /**
   * Customer-facing acceptance via the public signing token (P6). No RBAC —
   * the token itself is the authorization, and it is single-purpose
   * (`documentSource: 'proposal'`), scoped to exactly one job/version by
   * `JobSignatureService`. Otherwise identical to the staff-triggered path.
   */
  async acceptViaPublicToken(id: string): Promise<ProposalVersion> {
    return this.acceptCore(id, null);
  }

  private async acceptCore(
    id: string,
    acceptedByUserId: string | null,
  ): Promise<ProposalVersion> {
    // Accepting is the money decision: it sets the job's contract price. Do it
    // under a row lock so two concurrent callers cannot both read a non-terminal
    // status and both proceed, and supersede every sibling in the same
    // transaction so a job can only ever hold one accepted version.
    const saved = await this.versionRepo.manager.transaction(async (tx) => {
      const version = await tx.findOne(ProposalVersion, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!version) {
        throw new NotFoundException(`Proposal version ${id} not found`);
      }

      if (TERMINAL_STATUSES.includes(version.status)) {
        throw new BadRequestException(
          `A ${version.status} proposal cannot be accepted`,
        );
      }
      if (version.expiresAt && version.expiresAt < new Date()) {
        throw new BadRequestException(
          'That proposal has expired — issue a new version',
        );
      }

      const alreadyAccepted = await tx.count(ProposalVersion, {
        where: {
          jobId: version.jobId,
          id: Not(version.id),
          status: ProposalStatus.ACCEPTED,
        },
      });
      if (alreadyAccepted > 0) {
        throw new BadRequestException(
          'Another version of this proposal has already been accepted — decline it first',
        );
      }

      version.status = ProposalStatus.ACCEPTED;
      version.acceptedAt = new Date();
      const saved = await tx.save(version);

      // The accepted version is the record of what was sold: push its price onto
      // the job so downstream invoicing and reporting agree with the contract.
      await tx.update(
        Job,
        { id: version.jobId },
        {
          projectPrice: version.totalPrice,
          depositAmount: version.depositAmount,
        },
      );

      // Every other live version is now moot — drafts included. Leaving drafts
      // alone previously left them independently acceptable.
      await tx.update(
        ProposalVersion,
        {
          jobId: version.jobId,
          id: Not(version.id),
          status: In([
            ProposalStatus.DRAFT,
            ProposalStatus.SENT,
            ProposalStatus.VIEWED,
          ]),
        },
        { status: ProposalStatus.SUPERSEDED },
      );

      return saved;
    });

    await this.timelineRepo.save(
      this.timelineRepo.create({
        jobId: saved.jobId,
        type: 'proposal_accepted',
        payload: {
          proposalVersionId: saved.id,
          versionNumber: saved.versionNumber,
          totalPrice: saved.totalPrice,
          acceptedAt: saved.acceptedAt?.toISOString() ?? null,
        },
        createdByUserId: acceptedByUserId,
      }),
    );

    return saved;
  }

  async decline(
    id: string,
    reason: string | null,
    viewer: { userId: string; role: UserRole },
  ): Promise<ProposalVersion> {
    await this.load(id, viewer);
    return this.declineCore(id, reason);
  }

  /** Customer-facing decline via the public signing token (P6). No RBAC. */
  async declineViaPublicToken(
    id: string,
    reason: string | null,
  ): Promise<ProposalVersion> {
    return this.declineCore(id, reason);
  }

  private async declineCore(
    id: string,
    reason: string | null,
  ): Promise<ProposalVersion> {
    const version = await this.versionRepo.findOne({ where: { id } });
    if (!version) throw new NotFoundException(`Proposal ${id} not found`);
    if (TERMINAL_STATUSES.includes(version.status)) {
      throw new BadRequestException(
        `A ${version.status} proposal cannot be declined`,
      );
    }
    version.status = ProposalStatus.DECLINED;
    version.declinedAt = new Date();
    version.declineReason = reason;
    const saved = await this.versionRepo.save(version);

    await this.timelineRepo.save(
      this.timelineRepo.create({
        jobId: saved.jobId,
        type: 'proposal_declined',
        payload: {
          proposalVersionId: saved.id,
          versionNumber: saved.versionNumber,
          reason: saved.declineReason,
          declinedAt: saved.declinedAt?.toISOString() ?? null,
        },
        createdByUserId: null,
      }),
    );

    return saved;
  }

  /** Expire proposals past their date. Run from the SLA sweep. */
  async expireOverdue(now: Date = new Date()): Promise<{ expired: number }> {
    const flags = await this.settings.getFeatureFlags();
    if (!isFeatureEnabled(flags, 'proposalVersioning')) {
      return { expired: 0 };
    }
    const live = await this.versionRepo.find({
      where: [
        { status: ProposalStatus.SENT },
        { status: ProposalStatus.VIEWED },
      ],
    });
    const stale = live.filter(
      (v) => v.expiresAt !== null && v.expiresAt <= now,
    );
    if (stale.length === 0) return { expired: 0 };
    await this.versionRepo.save(
      stale.map((v) => ({ ...v, status: ProposalStatus.EXPIRED })),
    );
    return { expired: stale.length };
  }

  private async load(
    id: string,
    viewer: { userId: string; role: UserRole },
  ): Promise<ProposalVersion> {
    await this.assertEnabled(viewer.role);
    const version = await this.versionRepo.findOne({ where: { id } });
    if (!version) throw new NotFoundException(`Proposal ${id} not found`);
    await this.assertJobInScope(version.jobId, viewer);
    return version;
  }
}
