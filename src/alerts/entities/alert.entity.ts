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

@Entity('alerts')
export class Alert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Job, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobId' })
  job: Job;

  @Column({ type: 'uuid' })
  jobId: string;

  @Column({ type: 'varchar', length: 80 })
  type: string;

  @Column({ type: 'varchar', length: 10 })
  severity: string;

  @Column({ type: 'text' })
  message: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  acknowledgedAt: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'acknowledgedByUserId' })
  acknowledgedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  acknowledgedByUserId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resolvedByUserId' })
  resolvedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  resolvedByUserId: string | null;

  // Alerts may later support `updatedAt` when resolution/ack fields change.
  @UpdateDateColumn()
  updatedAt: Date;
}
