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
  | 'cancelled';

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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
