import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  JoinColumn,
} from 'typeorm';
import { Job } from '../../jobs/entities/job.entity';
import { User } from '../../users/entities/user.entity';

@Entity('meter_applications')
export class MeterApplication {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Job, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobId' })
  job: Job;

  @Column({ type: 'uuid' })
  jobId: string;

  @Column({ type: 'varchar', length: 20 })
  type: string; // pre_meter | post_meter

  @Column({ type: 'varchar', length: 20 })
  status: string; // pending | approved | rejected

  @Column({ type: 'date' })
  dateSubmitted: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'submittedByUserId' })
  submittedByUser: User;

  @Column({ type: 'uuid' })
  submittedByUserId: string;

  @Column({ type: 'date', nullable: true })
  approvalDate: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approvedByUserId' })
  approvedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  approvedByUserId: string | null;

  @Column({ type: 'date', nullable: true })
  rejectedAt: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'rejectedByUserId' })
  rejectedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  rejectedByUserId: string | null;

  @Column({ type: 'text', nullable: true })
  rejectionReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
