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

export enum InstallVisitStatus {
  SCHEDULED = 'scheduled',
  IN_PROGRESS = 'in_progress',
  /** Everything planned for this visit was finished. */
  COMPLETED = 'completed',
  /** Some work done; a follow-up visit is needed. */
  PARTIAL = 'partial',
  ABORTED = 'aborted',
  CANCELLED = 'cancelled',
}

/**
 * One crew visit to site (PRD v2 Phase 3).
 *
 * Modelling installs as repeatable visits — rather than a single date on the
 * job — is what makes partial completion and follow-up work representable at
 * all; a one-date model has to lie when a crew gets rained off at lunchtime.
 */
@Entity('install_visits')
@Index('idx_install_visits_project', ['projectId'])
@Index('idx_install_visits_status', ['status'])
export class InstallVisit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Project, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project: Project;

  @Column({ type: 'uuid' })
  projectId: string;

  @Column({ type: 'int', default: 1 })
  visitNumber: number;

  @Column({
    type: 'varchar',
    length: 20,
    default: InstallVisitStatus.SCHEDULED,
  })
  status: InstallVisitStatus;

  @Column({ type: 'date', nullable: true })
  scheduledDate: string | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  startedAt: Date | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  completedAt: Date | null;

  /** Crew member user ids on this visit. */
  @Column({ type: 'json', nullable: true })
  crewUserIds: string[] | null;

  @Column({ type: 'uuid', nullable: true })
  leadInstallerUserId: string | null;

  /** Rough share of the total install finished after this visit, 0–100. */
  @Column({ type: 'int', nullable: true })
  completionPercent: number | null;

  /** What is still outstanding when `status` is `partial`. */
  @Column({ type: 'text', nullable: true })
  outstandingWork: string | null;

  /** Why a visit was aborted (weather, access, missing equipment). */
  @Column({ type: 'varchar', length: 200, nullable: true })
  abortReason: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

export enum DefectSeverity {
  /** Cosmetic; fix when convenient. */
  MINOR = 'minor',
  /** Must be fixed before handover. */
  MAJOR = 'major',
  /** Safety issue; system stays off until resolved. */
  CRITICAL = 'critical',
}

export enum DefectStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  /** Accepted as-is, with a reason. */
  WAIVED = 'waived',
}

/** A defect found during or after installation. */
@Entity('install_defects')
@Index('idx_install_defects_project', ['projectId'])
@Index('idx_install_defects_status', ['status'])
export class InstallDefect {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  projectId: string;

  /** The visit it was found on, when known. */
  @Column({ type: 'uuid', nullable: true })
  installVisitId: string | null;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 20, default: DefectSeverity.MINOR })
  severity: DefectSeverity;

  @Column({ type: 'varchar', length: 20, default: DefectStatus.OPEN })
  status: DefectStatus;

  @Column({ type: 'uuid', nullable: true })
  reportedByUserId: string | null;

  @Column({ type: 'uuid', nullable: true })
  assignedUserId: string | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  resolvedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  resolvedByUserId: string | null;

  @Column({ type: 'text', nullable: true })
  resolutionNotes: string | null;

  /** Required when waiving — an unexplained waiver is an audit hole. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  waiverReason: string | null;

  @Column({ type: 'json', nullable: true })
  photoFileIds: string[] | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
