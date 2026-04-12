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

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 6.6 })
  quickLeadDefaultSystemSizeKw: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 10 })
  quickLeadDefaultBatterySizeKwh: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  quickLeadDefaultProjectPrice: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  esignPublicBaseUrl: string | null;

  @Column({ type: 'int', default: 14 })
  esignTokenTtlDays: number;

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
