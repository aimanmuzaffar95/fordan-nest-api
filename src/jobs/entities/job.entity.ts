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

  @Column({ type: 'date', nullable: true })
  installDate: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
