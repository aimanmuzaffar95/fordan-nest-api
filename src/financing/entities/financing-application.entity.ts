import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { resolveTimestampColumnType } from '../../common/timestamp-column-type.util';
import { Job } from '../../jobs/entities/job.entity';

export enum FinancingStatus {
  /** Customer has expressed interest; nothing submitted. */
  INTENT = 'intent',
  SUBMITTED = 'submitted',
  /** Lender wants more documents. */
  INFO_REQUESTED = 'info_requested',
  APPROVED = 'approved',
  DECLINED = 'declined',
  /** Approval lapsed before the contract was signed. */
  EXPIRED = 'expired',
  WITHDRAWN = 'withdrawn',
  /** Money drawn down; the job can proceed. */
  SETTLED = 'settled',
}

/**
 * A financing application against a job (PRD v2 Phase 2).
 *
 * Approvals expire, and an expired approval discovered on install day is a
 * cancelled job — `approvalExpiresAt` is therefore first-class and swept.
 */
@Entity('financing_applications')
@Index('idx_financing_job', ['jobId'])
@Index('idx_financing_status', ['status'])
@Index('idx_financing_expiry', ['approvalExpiresAt'])
export class FinancingApplication {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Job, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobId' })
  job: Job;

  @Column({ type: 'uuid' })
  jobId: string;

  @Column({ type: 'varchar', length: 20, default: FinancingStatus.INTENT })
  status: FinancingStatus;

  @Column({ type: 'varchar', length: 120 })
  lenderName: string;

  /** Lender's product name, e.g. "Green Loan 7yr". */
  @Column({ type: 'varchar', length: 120, nullable: true })
  productName: string | null;

  /** The lender's own reference, for chasing them up. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  externalReference: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  requestedAmount: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  approvedAmount: string | null;

  @Column({ type: 'numeric', precision: 6, scale: 3, nullable: true })
  interestRatePercent: string | null;

  @Column({ type: 'int', nullable: true })
  termMonths: number | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  monthlyPayment: string | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  submittedAt: Date | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  decisionAt: Date | null;

  /** Approvals lapse; the sweep flags and then expires them. */
  @Column({ type: resolveTimestampColumnType(), nullable: true })
  approvalExpiresAt: Date | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  settledAt: Date | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  declineReason: string | null;

  /** What the lender asked for while in `info_requested`. */
  @Column({ type: 'text', nullable: true })
  outstandingRequirements: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Set when an expiry reminder has been sent, so it only fires once. */
  @Column({ type: resolveTimestampColumnType(), nullable: true })
  expiryReminderSentAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
