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

export enum PermitStatus {
  NOT_STARTED = 'not_started',
  PREPARING = 'preparing',
  SUBMITTED = 'submitted',
  /** Authority asked for changes; `revisionCount` tracks the loop. */
  REVISION_REQUESTED = 'revision_requested',
  RESUBMITTED = 'resubmitted',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  NOT_REQUIRED = 'not_required',
}

/**
 * A permit or authority approval on a project (PRD v2 Phase 3).
 *
 * Generic by design — `permitType` and `authorityName` are free text because
 * every market names these differently, and hardcoding an enum would make the
 * CRM unusable outside the market it was written for.
 */
@Entity('permits')
@Index('idx_permits_project', ['projectId'])
@Index('idx_permits_status', ['status'])
export class Permit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project: Project;

  @Column({ type: 'uuid' })
  projectId: string;

  /** e.g. `building`, `electrical`, `grid_connection`, `heritage`. */
  @Column({ type: 'varchar', length: 60 })
  permitType: string;

  @Column({ type: 'varchar', length: 160 })
  authorityName: string;

  @Column({ type: 'varchar', length: 20, default: PermitStatus.NOT_STARTED })
  status: PermitStatus;

  /** The authority's own reference number. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  referenceNumber: string | null;

  @Column({ type: 'date', nullable: true })
  targetSubmissionDate: string | null;

  @Column({ type: 'date', nullable: true })
  submittedDate: string | null;

  @Column({ type: 'date', nullable: true })
  targetApprovalDate: string | null;

  @Column({ type: 'date', nullable: true })
  approvedDate: string | null;

  @Column({ type: 'date', nullable: true })
  expiryDate: string | null;

  /** How many times the authority has sent it back. */
  @Column({ type: 'int', default: 0 })
  revisionCount: number;

  @Column({ type: 'text', nullable: true })
  revisionNotes: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  rejectionReason: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  feeAmount: string | null;

  /**
   * Set when a stalled-permit alert has fired, so it only fires once per
   * submission rather than every sweep.
   */
  @Column({ type: resolveTimestampColumnType(), nullable: true })
  stalledAlertSentAt: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
