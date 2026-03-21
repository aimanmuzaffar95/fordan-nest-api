import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { JobAuditAction } from '../job-audit-action.enum';
import { JobAuditValue } from '../types/job-audit-value.type';
import { Job } from './job.entity';

@Entity('job_audit_logs')
export class JobAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Job, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobId' })
  job: Job;

  @Column({ type: 'uuid' })
  jobId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'performedById' })
  performedBy: User | null;

  @Column({ type: 'uuid', nullable: true })
  performedById: string | null;

  @Column({
    type: 'enum',
    enum: JobAuditAction,
    enumName: 'job_audit_logs_action_enum',
  })
  action: JobAuditAction;

  @Column({ type: 'varchar', length: 100, nullable: true })
  field: string | null;

  @Column({ type: 'json', nullable: true })
  oldValue: JobAuditValue | null;

  @Column({ type: 'json', nullable: true })
  newValue: JobAuditValue | null;

  @Column({ type: 'json', nullable: true })
  metadata: JobAuditValue | null;

  @CreateDateColumn()
  createdAt: Date;
}
