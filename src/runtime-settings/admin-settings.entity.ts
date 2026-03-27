import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/entities/user.entity';

export const ADMIN_SETTINGS_SINGLETON_ID = 'global';

@Entity('admin_settings')
export class AdminSettings {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id: string;

  @Column({ type: 'boolean', default: false })
  overridePreMeter: boolean;

  @Column({ type: 'boolean', default: true })
  calendarScopeEnforced: boolean;

  @Column({ type: 'int', default: 14 })
  invoiceOverdueDays: number;

  @Column({ type: 'int', default: 7 })
  preMeterPendingDays: number;

  @Column({ type: 'int', default: 3 })
  installWarningDays: number;

  @Column({ type: 'int', default: 2 })
  postMeterDeadlineDays: number;

  @Column({ type: 'int', default: 2 })
  maxJobsPerTeamPerDay: number;

  @Column({ type: 'varchar', length: 20, default: 'audit_only' })
  attendanceGeofenceMode: string;

  @Column({ type: 'int', default: 150 })
  attendanceGeofenceRadiusMeters: number;

  @Column({ type: 'int', default: 100 })
  attendanceMaxGpsAccuracyMeters: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updatedByUserId' })
  updatedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  updatedByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
