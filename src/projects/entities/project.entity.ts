import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { resolveTimestampColumnType } from '../../common/timestamp-column-type.util';
import { Job } from '../../jobs/entities/job.entity';

/**
 * Execution stages, owned by the Project rather than the Job.
 *
 * Deliberately *not* the `JobPipelineStage` enum: the point of the split is
 * that sales stages (Job/Opportunity) and delivery stages (Project) move
 * independently, so reporting on one never distorts the other.
 */
export enum ProjectStage {
  /** Just created from a signed contract; nothing started. */
  INITIATED = 'initiated',
  PERMITTING = 'permitting',
  /** Permits done, waiting on readiness checks. */
  READY_FOR_INSTALL = 'ready_for_install',
  SCHEDULED = 'scheduled',
  IN_PROGRESS = 'in_progress',
  INSTALLED = 'installed',
  INSPECTION = 'inspection',
  INTERCONNECTION = 'interconnection',
  /** Permission to operate granted — the delivery finish line. */
  PTO = 'pto',
  COMPLETED = 'completed',
  ON_HOLD = 'on_hold',
  CANCELLED = 'cancelled',
}

export const PROJECT_STAGE_ORDER: ProjectStage[] = [
  ProjectStage.INITIATED,
  ProjectStage.PERMITTING,
  ProjectStage.READY_FOR_INSTALL,
  ProjectStage.SCHEDULED,
  ProjectStage.IN_PROGRESS,
  ProjectStage.INSTALLED,
  ProjectStage.INSPECTION,
  ProjectStage.INTERCONNECTION,
  ProjectStage.PTO,
  ProjectStage.COMPLETED,
];

/**
 * The delivery half of the Opportunity/Project split (PRD v2 Phase 3).
 *
 * Created automatically when a job's contract is signed. It carries a *copy*
 * of the customer/address/system context at signing — the contract is a
 * snapshot, and later edits to the opportunity must not silently rewrite what
 * the crew was dispatched to build.
 */
@Entity('projects')
@Index('idx_projects_stage', ['stage'])
@Index('idx_projects_customer', ['customerId'])
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 1:1 with the originating job (the Opportunity). */
  @OneToOne(() => Job, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobId' })
  job: Job;

  @Column({ type: 'uuid', unique: true })
  jobId: string;

  /** Human-facing reference, derived from the job's order number. */
  @Column({ type: 'varchar', length: 50, unique: true })
  projectNumber: string;

  @Column({ type: 'uuid' })
  customerId: string;

  @Column({
    type: 'varchar',
    length: 30,
    default: ProjectStage.INITIATED,
  })
  stage: ProjectStage;

  // ─── Snapshot at contract signing ───────────────────────────────────────

  @Column({ type: 'varchar', length: 255, nullable: true })
  siteAddress: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  systemSizeKw: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  batterySizeKwh: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  contractValue: string | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  contractSignedAt: Date | null;

  // ─── Delivery milestones ────────────────────────────────────────────────

  @Column({ type: 'uuid', nullable: true })
  projectManagerUserId: string | null;

  @Column({ type: 'date', nullable: true })
  targetInstallDate: string | null;

  @Column({ type: 'date', nullable: true })
  actualInstallDate: string | null;

  @Column({ type: 'date', nullable: true })
  targetPtoDate: string | null;

  @Column({ type: 'date', nullable: true })
  actualPtoDate: string | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  completedAt: Date | null;

  // ─── Readiness ──────────────────────────────────────────────────────────

  /**
   * Ticked readiness-checklist item ids, from `installReadinessConfig`.
   * The checklist definition is config; only the ticks are data.
   */
  @Column({ type: 'json', nullable: true })
  readinessChecklist: Record<string, boolean> | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  readinessConfirmedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  readinessConfirmedByUserId: string | null;

  // ─── Hold / cancellation ────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 200, nullable: true })
  holdReason: string | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  heldAt: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /**
   * The signed-contract path (`createFromSignedJob`) sets this from the
   * authenticated user whose action triggered the conversion. Nullable for
   * projects created before this column existed, or by a system-triggered
   * path with no principal.
   */
  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  /** Who last changed `stage` — the authenticated principal, never client input. */
  @Column({ type: 'uuid', nullable: true })
  updatedByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
