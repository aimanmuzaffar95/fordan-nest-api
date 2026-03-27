import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Assignment } from '../../assignments/entities/assignment.entity';
import { Job } from '../../jobs/entities/job.entity';
import { User } from '../../users/entities/user.entity';

@Entity('attendance_sessions')
export class AttendanceSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => Job, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'jobId' })
  job: Job | null;

  @Column({ type: 'uuid', nullable: true })
  jobId: string | null;

  @ManyToOne(() => Assignment, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assignmentId' })
  assignment: Assignment | null;

  @Column({ type: 'uuid', nullable: true })
  assignmentId: string | null;

  @Column({ type: 'timestamp' })
  clockInAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  clockOutAt: Date | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  clockInLatitude: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  clockInLongitude: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  clockInAccuracyMeters: string | null;

  @Column({ type: 'timestamp', nullable: true })
  clockInCapturedAt: Date | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  clockOutLatitude: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  clockOutLongitude: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  clockOutAccuracyMeters: string | null;

  @Column({ type: 'timestamp', nullable: true })
  clockOutCapturedAt: Date | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  distanceFromSiteMetersIn: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  distanceFromSiteMetersOut: string | null;

  @Column({ type: 'boolean', default: false })
  geofenceFlaggedIn: boolean;

  @Column({ type: 'boolean', default: false })
  geofenceFlaggedOut: boolean;

  @Column({ type: 'text', nullable: true })
  offSiteAcknowledgedReasonIn: string | null;

  @Column({ type: 'text', nullable: true })
  offSiteAcknowledgedReasonOut: string | null;

  @Column({ type: 'text', nullable: true })
  correctionNote: string | null;

  @Column({ type: 'timestamp', nullable: true })
  correctedAt: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'correctedByUserId' })
  correctedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  correctedByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
