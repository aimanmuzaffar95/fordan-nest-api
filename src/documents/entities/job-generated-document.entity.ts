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

export type JobGeneratedDocumentStatus =
  | 'generated'
  | 'sign_pending'
  | 'signed'
  | 'failed';

@Entity('job_generated_documents')
@Index(['jobId', 'createdAt'])
export class JobGeneratedDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  jobId: string;

  @ManyToOne(() => Job, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobId' })
  job: Job;

  @Column({ type: 'varchar', length: 64 })
  templateId: string;

  @Column({ type: 'varchar', length: 32 })
  status: JobGeneratedDocumentStatus;

  @Column({ type: 'uuid', nullable: true })
  fileId: string | null;

  @Column({ type: 'json', nullable: true })
  fields: Record<string, unknown> | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
