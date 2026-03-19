import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Customer } from '../../customers/entities/customer.entity';
import { User } from '../../users/entities/user.entity';
import { JobMeterStatus, JobStatus, JobSystemType } from '../enums/job.enums';
import { JobAuditLog } from './job-audit-log.entity';

@Entity('jobs')
@Index('idx_jobs_customer_id', ['customerId'])
@Index('idx_jobs_manager_id', ['managerId'])
@Index('idx_jobs_deleted_at', ['deletedAt'])
export class Job {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  customerId: string;

  @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customerId' })
  customer: Customer;

  @Column({ type: 'uuid' })
  managerId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'managerId' })
  manager: User;

  @ManyToMany(() => User, { onDelete: 'RESTRICT' })
  @JoinTable({
    name: 'job_installers',
    joinColumn: { name: 'jobId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'userId', referencedColumnName: 'id' },
  })
  installers: User[];

  @Column({
    type: 'simple-enum',
    enum: JobSystemType,
  })
  systemType: JobSystemType;

  @Column({ type: 'boolean', default: false })
  contractSigned: boolean;

  @Column({ type: 'boolean', default: false })
  depositPaid: boolean;

  @Column({ type: 'date', nullable: true })
  installDate: string | null;

  @Column({
    type: 'simple-enum',
    enum: JobMeterStatus,
    default: JobMeterStatus.NOT_STARTED,
  })
  preMeterStatus: JobMeterStatus;

  @Column({
    type: 'simple-enum',
    enum: JobMeterStatus,
    default: JobMeterStatus.NOT_STARTED,
  })
  postMeterStatus: JobMeterStatus;

  @Column({
    type: 'simple-enum',
    enum: JobStatus,
    default: JobStatus.LEAD,
  })
  jobStatus: JobStatus;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'text', nullable: true })
  internalComments: string | null;

  @OneToMany(() => JobAuditLog, (jobAuditLog) => jobAuditLog.job)
  auditLogs: JobAuditLog[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn({ nullable: true })
  deletedAt: Date | null;
}
