import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Job } from '../../jobs/entities/job.entity';
import { User } from '../../users/entities/user.entity';
import { ComplianceFormTemplate } from './compliance-form-template.entity';

@Entity('job_compliance_submissions')
@Unique('UQ_job_compliance_job_template', ['jobId', 'templateId'])
export class JobComplianceSubmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  jobId: string;

  @ManyToOne(() => Job, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobId' })
  job: Job;

  @Column({ type: 'uuid' })
  templateId: string;

  @ManyToOne(() => ComplianceFormTemplate, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'templateId' })
  template: ComplianceFormTemplate;

  @Column({ type: 'json' })
  answers: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  signaturePngBase64: string | null;

  @Column({ type: 'timestamp' })
  completedAt: Date;

  @Column({ type: 'uuid', nullable: true })
  completedByUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'completedByUserId' })
  completedByUser: User | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
