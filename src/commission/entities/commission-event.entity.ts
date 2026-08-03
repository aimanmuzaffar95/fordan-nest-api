import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { resolveTimestampColumnType } from '../../common/timestamp-column-type.util';

/** What earned the commission. */
export enum CommissionEventType {
  /** Sale closed — the usual trigger. */
  CONTRACT_SIGNED = 'contract_signed',
  DEPOSIT_RECEIVED = 'deposit_received',
  INSTALL_COMPLETED = 'install_completed',
  /** Final payment in — the usual payable trigger. */
  PAYMENT_RECEIVED = 'payment_received',
  /** Manual adjustment up. */
  BONUS = 'bonus',
  /** Manual adjustment down (negative amount). */
  ADJUSTMENT = 'adjustment',
  /** Reverses an already-paid commission. */
  CLAWBACK = 'clawback',
}

export enum CommissionStatus {
  /** Earned but not yet confirmed payable. */
  PENDING = 'pending',
  /** Confirmed; will be included in the next payout run. */
  APPROVED = 'approved',
  PAID = 'paid',
  /** Rejected before payment, with a reason. */
  VOID = 'void',
  /** Reversed after payment. */
  CLAWED_BACK = 'clawed_back',
}

/**
 * A commission entry against a person and a job (PRD v2 Phase 4).
 *
 * Append-only in spirit: a mistake is corrected with an offsetting
 * `adjustment` or `clawback` row, never by editing a paid row — that's what
 * makes a payout run reconcilable after the fact.
 */
@Entity('commission_events')
@Index('idx_commission_user_status', ['userId', 'status'])
@Index('idx_commission_job', ['jobId'])
@Index('idx_commission_status', ['status'])
export class CommissionEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Who earned it. */
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'uuid', nullable: true })
  jobId: string | null;

  @Column({ type: 'uuid', nullable: true })
  projectId: string | null;

  @Column({ type: 'varchar', length: 30 })
  eventType: CommissionEventType;

  @Column({ type: 'varchar', length: 20, default: CommissionStatus.PENDING })
  status: CommissionStatus;

  /** Negative for adjustments and clawbacks. */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @Column({ type: 'varchar', length: 3, default: 'AUD' })
  currency: string;

  /** The value the rate was applied to, for auditability. */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  basisAmount: string | null;

  /** Percentage applied to `basisAmount`, when rate-based. */
  @Column({ type: 'numeric', precision: 6, scale: 3, nullable: true })
  ratePercent: string | null;

  /** The commission plan or rule this came from. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  planName: string | null;

  /** Set on a clawback: the event it reverses. */
  @Column({ type: 'uuid', nullable: true })
  reversesEventId: string | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  approvedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  approvedByUserId: string | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  paidAt: Date | null;

  /** Groups events paid together — the payout run reference. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  payoutReference: string | null;

  /** Required to void or claw back. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  reason: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
