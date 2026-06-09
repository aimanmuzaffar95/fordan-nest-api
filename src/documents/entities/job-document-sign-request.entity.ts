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
import { Job } from '../../jobs/entities/job.entity';
import { JobGeneratedDocument } from './job-generated-document.entity';

export type JobDocumentSignRequestMode = 'email' | 'on_device';

export type JobDocumentSignRequestStatus =
  | 'pending'
  | 'sent'
  | 'signed'
  | 'cancelled';

@Entity('job_document_sign_requests')
@Index(['jobId', 'documentId'])
export class JobDocumentSignRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  jobId: string;

  @ManyToOne(() => Job, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobId' })
  job: Job;

  @Column({ type: 'uuid' })
  documentId: string;

  @ManyToOne(() => JobGeneratedDocument, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'documentId' })
  document: JobGeneratedDocument;

  @Column({ type: 'varchar', length: 16 })
  mode: JobDocumentSignRequestMode;

  @Column({ type: 'varchar', length: 255, nullable: true })
  recipientEmail: string | null;

  @Column({ type: 'varchar', length: 32 })
  status: JobDocumentSignRequestStatus;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
