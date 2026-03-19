import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { JobAuditAction } from '../enums/job-audit-action.enum';
import { JobAuditValue } from '../types/job-audit-value.type';
import { Job } from './job.entity';

@Entity('job_audit_logs')
@Index('idx_job_audit_logs_job_id_created_at', ['jobId', 'createdAt'])
@Index('idx_job_audit_logs_action', ['action'])
export class JobAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  jobId: string;

  @ManyToOne(() => Job, (job) => job.auditLogs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobId' })
  job: Job;

  @Column({ type: 'uuid', nullable: true })
  performedById: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'performedById' })
  performedBy: User | null;

  @Column({ type: 'simple-enum', enum: JobAuditAction })
  action: JobAuditAction;

  @Column({ type: 'varchar', length: 100, nullable: true })
  field: string | null;

  @Column({ type: 'json', nullable: true })
  oldValue: JobAuditValue | null;

  @Column({ type: 'json', nullable: true })
  newValue: JobAuditValue | null;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, JobAuditValue> | null;

  @CreateDateColumn()
  createdAt: Date;
}
