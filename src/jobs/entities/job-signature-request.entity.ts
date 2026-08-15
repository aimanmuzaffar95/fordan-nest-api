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
import { Job } from './job.entity';

export type JobSignatureRequestStatus =
  | 'pending'
  | 'viewed'
  | 'signed'
  | 'expired'
  | 'cancelled'
  /**
   * Proposal-source only: this request's link was superseded by a fresh
   * `send-proposal` call (a new `ProposalVersion` was minted rather than
   * reusing this one — see `job-proposal-send.service.ts`). Distinct from
   * `cancelled`, which means the *customer* declined — a superseded link
   * must never be reported to the customer as "you declined this".
   */
  | 'superseded';

@Entity('job_signature_requests')
@Index(['tokenHash'], { unique: true })
@Index(['jobId', 'status'])
export class JobSignatureRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  jobId: string;

  @ManyToOne(() => Job, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobId' })
  job: Job;

  @Column({ type: 'varchar', length: 20 })
  status: JobSignatureRequestStatus;

  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ type: 'varchar', length: 24, unique: true })
  referenceCode: string;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  viewedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  signedAt: Date | null;

  @Column({ type: 'varchar', length: 255 })
  signerEmail: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  signerName: string | null;

  @Column({ type: 'uuid', nullable: true })
  signedFileId: string | null;

  @Column({ type: 'json', nullable: true })
  auditPayload: Record<string, unknown> | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  /**
   * Which document this signing link is for. `quotation` is the original
   * e-sign MVP; `proposal` (P6) reuses the same request/token machinery but
   * signs the stored `ProposalVersion.sentPdfFileId` snapshot instead, and
   * completion accepts the proposal version rather than flipping
   * `job.contractSigned`.
   */
  @Column({ type: 'varchar', length: 20, default: 'quotation' })
  documentSource: 'quotation' | 'proposal';

  @Column({ type: 'uuid', nullable: true })
  proposalVersionId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
