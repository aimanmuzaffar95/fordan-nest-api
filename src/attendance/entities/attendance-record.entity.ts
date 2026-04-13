import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Job } from '../../jobs/entities/job.entity';
import { User } from '../../users/entities/user.entity';
import { ATTENDANCE_LOCATION_STATUSES } from '../attendance-location-status.enum';

@Entity('attendance_records')
@Index('idx_attendance_job_id', ['jobId'])
@Index('idx_attendance_staff_id', ['staffId'])
export class AttendanceRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Job, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobId' })
  job: Job;

  @Column({ type: 'uuid' })
  jobId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'staffId' })
  staff: User;

  @Column({ type: 'uuid' })
  staffId: string;

  @Column({ type: 'timestamp' })
  clockInAt: Date;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  clockInLat: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  clockInLng: string | null;

  @Column({ type: 'int', nullable: true })
  clockInAccuracyM: number | null;

  @Column({ type: 'timestamp', nullable: true })
  clockOutAt: Date | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  clockOutLat: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  clockOutLng: string | null;

  @Column({ type: 'int', nullable: true })
  clockOutAccuracyM: number | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: ATTENDANCE_LOCATION_STATUSES[0],
  })
  locationStatus: string;

  @Column({ type: 'text', nullable: true })
  photoUrl: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'correctedBy' })
  correctedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  correctedBy: string | null;

  @Column({ type: 'text', nullable: true })
  correctionNote: string | null;

  @Column({ type: 'timestamp', nullable: true })
  correctedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
