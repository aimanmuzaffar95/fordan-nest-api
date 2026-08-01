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

/**
 * Manual completion state for a CEC checklist item on a job. Items are defined
 * centrally in admin_settings.complianceChecklistConfig; ticks reference them
 * by their configured string id (not a FK — config items are editable).
 */
@Entity('job_cec_item_ticks')
@Unique('UQ_job_cec_tick_job_item', ['jobId', 'itemId'])
export class JobCecItemTick {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  jobId: string;

  @ManyToOne(() => Job, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobId' })
  job: Job;

  @Column({ type: 'varchar', length: 64 })
  itemId: string;

  @Column({ type: 'boolean', default: false })
  done: boolean;

  @Column({ type: 'timestamp', nullable: true })
  doneAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  doneByUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'doneByUserId' })
  doneByUser: User | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
