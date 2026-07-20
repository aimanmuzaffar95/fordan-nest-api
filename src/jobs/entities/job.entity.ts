import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  resolveEnumColumnType,
  resolveTimestampColumnType,
} from '../../common/timestamp-column-type.util';
import { Customer } from '../../customers/entities/customer.entity';
import { JobPipelineStage } from '../job-pipeline-stage.enum';
import { JobSystemType } from '../job-system-type.enum';

@Entity('jobs')
export class Job {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  orderNumber: string;

  @ManyToOne(() => Customer, { nullable: false })
  customer: Customer;

  @Column({ type: 'uuid' })
  customerId: string;

  // Frontend expects: 'solar' | 'battery' | 'both'
  @Column({
    type: resolveEnumColumnType(),
    enum: JobSystemType,
    enumName: 'jobs_systemtype_enum',
  })
  systemType: JobSystemType;

  @Column({
    type: resolveEnumColumnType(),
    enum: JobPipelineStage,
    enumName: 'jobs_jobstatus_enum',
    default: JobPipelineStage.LEAD,
  })
  jobStatus: JobPipelineStage;

  // Baseline requirement: kW size used for capacity + reporting.
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  systemSizeKw: string | null;

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

  // Canonical enum keys from apps/web/src/data/models.ts
  @Column({ type: 'varchar', length: 50, default: 'lead' })
  pipelineStage: string;

  // UI pipeline ordering within each `pipelineStage` column.
  // Stored as a stable integer so drag/drop order persists across reloads.
  @Column({ type: 'int', default: 0 })
  pipelinePosition: number;

  @Column({ type: 'date', nullable: true })
  installDate: string | null;

  @Column({ type: 'uuid', nullable: true })
  assignedStaffUserId: string | null;

  @Column({ type: 'date', nullable: true })
  scheduledDate: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  scheduledSlot: string | null;

  @Column({ type: 'uuid', nullable: true })
  managerId: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  invoiceStatus: string | null;

  @Column({ type: 'date', nullable: true })
  invoiceDate: string | null;

  @Column({ type: 'date', nullable: true })
  invoiceDueDate: string | null;

  @Column({ type: 'date', nullable: true })
  paidDate: string | null;

  // Lost-deal state (QA finding WEB-05). `lostAt != null` marks the job as
  // lost without introducing a new pipeline stage — stage enums and the
  // kanban columns stay intact.
  @Column({ type: resolveTimestampColumnType(), nullable: true })
  lostAt: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  lostReason: string | null;

  @Column({ type: 'uuid', nullable: true })
  lostByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
