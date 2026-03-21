import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Customer } from '../../customers/entities/customer.entity';
import { JobPipelineStage } from '../job-pipeline-stage.enum';
import { JobSystemType } from '../job-system-type.enum';

@Entity('jobs')
export class Job {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Customer, { nullable: false })
  customer: Customer;

  @Column({ type: 'uuid' })
  customerId: string;

  // Frontend expects: 'solar' | 'battery' | 'both'
  @Column({
    type: 'enum',
    enum: JobSystemType,
    enumName: 'jobs_systemtype_enum',
  })
  systemType: JobSystemType;

  @Column({
    type: 'enum',
    enum: JobPipelineStage,
    enumName: 'jobs_jobstatus_enum',
    default: JobPipelineStage.LEAD,
  })
  jobStatus: JobPipelineStage;

  // Baseline requirement: kW size used for capacity + reporting.
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  systemSizeKw: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  batterySizeKwh: string | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    default: 0,
  })
  projectPrice: string | null;

  @Column({ type: 'boolean', default: false })
  contractSigned: boolean;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  depositAmount: string;

  // Useful for future invoice rules (deposit paid vs not)
  @Column({ type: 'boolean', default: false })
  depositPaid: boolean;

  @Column({ type: 'date', nullable: true })
  depositDate: string | null;

  // UI seed currently provides etaCompletionDate.
  @Column({ type: 'date', nullable: true })
  etaCompletionDate: string | null;

  // Canonical enum keys from apps/web/src/data/models.ts
  @Column({ type: 'varchar', length: 50, default: 'lead' })
  pipelineStage: string;

  // UI pipeline ordering within each `pipelineStage` column.
  // Stored as a stable integer so drag/drop order persists across reloads.
  @Column({ type: 'int', default: 0 })
  pipelinePosition: number;

  @Column({ type: 'date', nullable: true })
  installDate: string | null;

  // Denormalized helpers for the current UI; authoritative schedule may be via `assignments`.
  @Column({ type: 'uuid', nullable: true })
  assignedTeamId: string | null;

  @Column({ type: 'uuid', nullable: true })
  assignedStaffUserId: string | null;

  @Column({ type: 'date', nullable: true })
  scheduledDate: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  scheduledSlot: string | null;

  @Column({ type: 'uuid', nullable: true })
  managerId: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  jobStatus: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  invoiceStatus: string | null;

  @Column({ type: 'date', nullable: true })
  invoiceDate: string | null;

  @Column({ type: 'date', nullable: true })
  invoiceDueDate: string | null;

  @Column({ type: 'date', nullable: true })
  paidDate: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
