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
import { resolveTimestampColumnType } from '../../common/timestamp-column-type.util';
import { Project } from './project.entity';

/**
 * The three post-install gates. One table rather than three: they share every
 * field (scheduled → result → corrections → done) and differ only in who is
 * on the other end, so three near-identical tables would be duplication.
 */
export enum MilestoneType {
  /** Council/electrical inspection. */
  INSPECTION = 'inspection',
  /** Utility interconnection approval. */
  INTERCONNECTION = 'interconnection',
  /** Permission to operate. */
  PTO = 'pto',
}

export enum MilestoneStatus {
  NOT_STARTED = 'not_started',
  SCHEDULED = 'scheduled',
  SUBMITTED = 'submitted',
  PASSED = 'passed',
  /** Failed with a correction list; a re-inspection follows. */
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

@Entity('project_milestones')
@Index('idx_project_milestones_project', ['projectId'])
@Index('idx_project_milestones_type_status', ['type', 'status'])
export class ProjectMilestone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project: Project;

  @Column({ type: 'uuid' })
  projectId: string;

  @Column({ type: 'varchar', length: 20 })
  type: MilestoneType;

  @Column({ type: 'varchar', length: 20, default: MilestoneStatus.NOT_STARTED })
  status: MilestoneStatus;

  /** Council, utility, or network operator. */
  @Column({ type: 'varchar', length: 160, nullable: true })
  authorityName: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  referenceNumber: string | null;

  @Column({ type: 'date', nullable: true })
  targetDate: string | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  scheduledAt: Date | null;

  @Column({ type: 'date', nullable: true })
  completedDate: string | null;

  /** Correction list from a failed inspection. */
  @Column({ type: 'text', nullable: true })
  correctionList: string | null;

  /** Which attempt this is — a re-inspection increments it. */
  @Column({ type: 'int', default: 1 })
  attemptNumber: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
