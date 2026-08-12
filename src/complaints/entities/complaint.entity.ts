import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  resolveEnumColumnType,
  resolveTimestampColumnType,
} from '../../common/timestamp-column-type.util';
import { Customer } from '../../customers/entities/customer.entity';
import { Job } from '../../jobs/entities/job.entity';
import { User } from '../../users/entities/user.entity';
import { ComplaintPriority, ComplaintStatus } from './complaint-status.enum';

/**
 * A customer complaint/ticket, Zendesk-lifecycle-shaped: `new` is entry-only
 * (never re-enterable once left) and `closed` is terminal. The message body
 * and full audit trail live in `ComplaintEvent`; this row is the current
 * state snapshot the list/board views query against.
 */
@Entity('complaints')
@Index('idx_complaints_status', ['status'])
@Index('idx_complaints_assignee_status', ['assigneeUserId', 'status'])
@Index('idx_complaints_customer', ['customerId'])
@Index('idx_complaints_job', ['jobId'])
export class Complaint {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  subject: string;

  @Column({
    type: resolveEnumColumnType(),
    enum: ComplaintStatus,
    enumName: 'complaints_status_enum',
    default: ComplaintStatus.NEW,
  })
  status: ComplaintStatus;

  @Column({
    type: resolveEnumColumnType(),
    enum: ComplaintPriority,
    enumName: 'complaints_priority_enum',
    default: ComplaintPriority.NORMAL,
  })
  priority: ComplaintPriority;

  @ManyToOne(() => Customer, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'customerId' })
  customer: Customer | null;

  @Column({ type: 'uuid', nullable: true })
  customerId: string | null;

  @ManyToOne(() => Job, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'jobId' })
  job: Job | null;

  @Column({ type: 'uuid', nullable: true })
  jobId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigneeUserId' })
  assigneeUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  assigneeUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdByUserId' })
  createdByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  /** Set the first time the complaint reaches `solved`; cleared if it never has. */
  @Column({ type: resolveTimestampColumnType(), nullable: true })
  solvedAt: Date | null;

  /** Set when the complaint reaches the terminal `closed` status. */
  @Column({ type: resolveTimestampColumnType(), nullable: true })
  closedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
