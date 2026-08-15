import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { resolveTimestampColumnType } from '../../common/timestamp-column-type.util';
import { Job } from '../../jobs/entities/job.entity';

/** How the customer pays — drives which pricing fields matter. */
export enum PricingMode {
  CASH = 'cash',
  LOAN = 'loan',
  LEASE = 'lease',
  PPA = 'ppa',
}

export enum ProposalStatus {
  DRAFT = 'draft',
  SENT = 'sent',
  VIEWED = 'viewed',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  EXPIRED = 'expired',
  SUPERSEDED = 'superseded',
}

/**
 * Statuses under which a version is a live, current offer — the thing a
 * customer-facing document may present pricing off of. `DRAFT` is not yet
 * offered to anyone; `DECLINED`/`EXPIRED`/`SUPERSEDED` were offered but are
 * no longer live — presenting their price as a confident current quote is
 * exactly the "declined proposal still prints a confident ROI" defect this
 * predicate exists to close off. Kept next to `ProposalStatus` (not
 * duplicated at each consuming call site) so there is exactly one place that
 * answers "is this version still a live offer".
 */
const LIVE_PROPOSAL_STATUSES: ReadonlySet<ProposalStatus> = new Set([
  ProposalStatus.SENT,
  ProposalStatus.VIEWED,
  ProposalStatus.ACCEPTED,
]);

export function isLiveProposalStatus(status: ProposalStatus): boolean {
  return LIVE_PROPOSAL_STATUSES.has(status);
}

/**
 * An immutable-once-sent snapshot of a quote (PRD v2 Phase 2).
 *
 * The existing configurator writes the *current* selection onto the job; a
 * version freezes what the customer was actually shown, so an accepted price
 * can never be rewritten by a later edit.
 */
@Entity('proposal_versions')
@Unique('uq_proposal_version_job_number', ['jobId', 'versionNumber'])
@Index('idx_proposal_versions_job', ['jobId'])
@Index('idx_proposal_versions_status', ['status'])
export class ProposalVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Job, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobId' })
  job: Job;

  @Column({ type: 'uuid' })
  jobId: string;

  /** 1-based, per job. */
  @Column({ type: 'int' })
  versionNumber: number;

  @Column({ type: 'varchar', length: 20, default: ProposalStatus.DRAFT })
  status: ProposalStatus;

  @Column({ type: 'varchar', length: 10, default: PricingMode.CASH })
  pricingMode: PricingMode;

  // ─── Frozen commercial terms ────────────────────────────────────────────

  /**
   * Nullable so "no price supplied yet" (`null`) is distinguishable from
   * "priced at $0" (`'0.00'`) — see `resolveAgreedPrice` in
   * `jobs/roof-proposal.service.ts`. Existing rows created before this
   * change persisted an unset price as `'0.00'`; those are left as-is (see
   * the migration) rather than guessed at.
   */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  totalPrice: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  depositAmount: string;

  /** STC/rebate value applied, for the customer-facing breakdown. */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  rebateAmount: string | null;

  // ─── Finance terms (loan/lease/PPA) ─────────────────────────────────────

  @Column({ type: 'numeric', precision: 6, scale: 3, nullable: true })
  interestRatePercent: string | null;

  @Column({ type: 'int', nullable: true })
  termMonths: number | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  monthlyPayment: string | null;

  /** PPA only — price per kWh. */
  @Column({ type: 'numeric', precision: 8, scale: 4, nullable: true })
  ppaRatePerKwh: string | null;

  // ─── Snapshot ───────────────────────────────────────────────────────────

  /** Frozen line items and system config as shown to the customer. */
  @Column({ type: 'json', nullable: true })
  lineItemsSnapshot: Record<string, unknown> | null;

  @Column({ type: 'json', nullable: true })
  systemSnapshot: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // ─── Lifecycle tracking ─────────────────────────────────────────────────

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  sentAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  sentByUserId: string | null;

  @Column({ type: 'varchar', length: 320, nullable: true })
  sentToEmail: string | null;

  /** First open. Later opens only bump `viewCount`. */
  @Column({ type: resolveTimestampColumnType(), nullable: true })
  firstViewedAt: Date | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  lastViewedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  viewCount: number;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  expiresAt: Date | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  acceptedAt: Date | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  declinedAt: Date | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  declineReason: string | null;

  /**
   * The exact PDF (job file) generated and emailed at send time. Every
   * subsequent public view/sign/accept reads this stored file — never
   * regenerates from the live design/pricing — so an accepted proposal is
   * always bound to precisely what the customer was shown, even if the
   * design or proposal config changes afterwards.
   */
  @Column({ type: 'uuid', nullable: true })
  sentPdfFileId: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
