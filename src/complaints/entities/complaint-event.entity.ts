import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  resolveEnumColumnType,
  resolveLongTextColumnType,
} from '../../common/timestamp-column-type.util';
import { User } from '../../users/entities/user.entity';
import { Complaint } from './complaint.entity';
import { ComplaintEventType } from './complaint-event-type.enum';
import { ComplaintPriority, ComplaintStatus } from './complaint-status.enum';

/**
 * Append-only timeline row for a complaint — the HubSpot-style "History"
 * feed. `created`/`reply`/`note` carry a `body`; `status_change` and
 * `assignment_change` carry the from/to pair instead. A `reply` event may
 * also carry `statusTo` when the status was changed in the same request
 * (the HubSpot reply+status pattern) without needing a second row.
 */
@Entity('complaint_events')
@Index('idx_complaint_events_complaint', ['complaintId', 'createdAt'])
export class ComplaintEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Complaint, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complaintId' })
  complaint: Complaint;

  @Column({ type: 'uuid' })
  complaintId: string;

  @Column({
    type: resolveEnumColumnType(),
    enum: ComplaintEventType,
    enumName: 'complaint_events_type_enum',
  })
  type: ComplaintEventType;

  /** Message body for `created` / `reply` / `note`; null for audit-only events. */
  @Column({ type: resolveLongTextColumnType(), nullable: true })
  body: string | null;

  @Column({
    type: resolveEnumColumnType(),
    enum: ComplaintStatus,
    enumName: 'complaint_events_status_from_enum',
    nullable: true,
  })
  statusFrom: ComplaintStatus | null;

  @Column({
    type: resolveEnumColumnType(),
    enum: ComplaintStatus,
    enumName: 'complaint_events_status_to_enum',
    nullable: true,
  })
  statusTo: ComplaintStatus | null;

  @Column({
    type: resolveEnumColumnType(),
    enum: ComplaintPriority,
    enumName: 'complaint_events_priority_to_enum',
    nullable: true,
  })
  priorityTo: ComplaintPriority | null;

  @Column({ type: 'uuid', nullable: true })
  assigneeFromUserId: string | null;

  @Column({ type: 'uuid', nullable: true })
  assigneeToUserId: string | null;

  /** Who performed the action; null for system-generated events. */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actorUserId' })
  actorUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  actorUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
