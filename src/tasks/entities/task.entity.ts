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
import { Job } from '../../jobs/entities/job.entity';
import { User } from '../../users/entities/user.entity';
import { TaskPriority, TaskSource, TaskStatus } from './task-status.enum';

/**
 * A unit of work with an owner, a due date and an SLA countdown.
 *
 * Tasks generalise the existing rule-generated `Alert`s: an alert is one
 * producer of tasks (`source = alert`), stage templates are another
 * (`source = stage_template`), and users create the rest by hand.
 */
@Entity('tasks')
@Index('idx_tasks_job_id', ['jobId'])
@Index('idx_tasks_assignee_status', ['assigneeUserId', 'status'])
@Index('idx_tasks_status_due', ['status', 'dueAt'])
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Tasks are job-scoped today; nullable so standalone tasks can land later. */
  @ManyToOne(() => Job, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobId' })
  job: Job | null;

  @Column({ type: 'uuid', nullable: true })
  jobId: string | null;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: resolveEnumColumnType(),
    enum: TaskStatus,
    enumName: 'tasks_status_enum',
    default: TaskStatus.OPEN,
  })
  status: TaskStatus;

  @Column({
    type: resolveEnumColumnType(),
    enum: TaskPriority,
    enumName: 'tasks_priority_enum',
    default: TaskPriority.NORMAL,
  })
  priority: TaskPriority;

  @Column({
    type: resolveEnumColumnType(),
    enum: TaskSource,
    enumName: 'tasks_source_enum',
    default: TaskSource.MANUAL,
  })
  source: TaskSource;

  /** Pipeline stage this task belongs to (a `JobPipelineStage` value). */
  @Column({ type: 'varchar', length: 50, nullable: true })
  stage: string | null;

  /**
   * `stageTaskTemplate.id` for template-generated tasks. Combined with
   * (jobId, stage) it makes materialisation idempotent across re-entries.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  templateId: string | null;

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

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  dueAt: Date | null;

  /**
   * SLA deadline. Defaults to `dueAt` on creation but is kept separate so a
   * due date can be renegotiated without erasing the original commitment.
   */
  @Column({ type: resolveTimestampColumnType(), nullable: true })
  slaDueAt: Date | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  slaBreachedAt: Date | null;

  /** 0 = never escalated. Incremented once per escalation interval past SLA. */
  @Column({ type: 'int', default: 0 })
  escalationLevel: number;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  escalatedAt: Date | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  completedAt: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'completedByUserId' })
  completedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  completedByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
