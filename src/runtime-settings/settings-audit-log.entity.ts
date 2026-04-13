import {
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Column,
  JoinColumn,
} from 'typeorm';
import { User } from '../users/entities/user.entity';

@Entity('settings_audit_log')
export class SettingsAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  actorUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actorUserId' })
  actorUser: User | null;

  @Column({ type: 'varchar', length: 80 })
  action: string;

  @Column({ type: 'json' })
  changedFields: string[];

  @Column({ type: 'json', nullable: true })
  patch: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;
}
