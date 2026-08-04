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
import { Job } from '../../jobs/entities/job.entity';

export enum SurveyStatus {
  SCHEDULED = 'scheduled',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  /** Property is not viable — carries `outcomeNotes`. */
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum SurveyOutcome {
  /** Proceed to proposal as designed. */
  PROCEED = 'proceed',
  /** Viable, but the system design needs changing. */
  REDESIGN_REQUIRED = 'redesign_required',
  /** Extra work needed first (switchboard upgrade, tree removal, …). */
  REMEDIATION_REQUIRED = 'remediation_required',
  /** Not viable. */
  NOT_VIABLE = 'not_viable',
}

/**
 * Site survey (PRD v2 Phase 2).
 *
 * The measured findings live in typed columns because they drive design and
 * pricing; anything free-form goes in `extra` so field staff can capture the
 * unexpected without a schema change.
 */
@Entity('site_surveys')
@Index('idx_site_surveys_job', ['jobId'])
@Index('idx_site_surveys_status', ['status'])
// The offline queue replays the same capture with one `clientRequestId`, often
// several at once when connectivity returns. The service check alone is
// check-then-act; this constraint is what actually makes the replay idempotent.
@Index('uq_site_surveys_job_client_request', ['jobId', 'clientRequestId'], {
  unique: true,
  where: '"clientRequestId" IS NOT NULL',
})
export class SiteSurvey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Job, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobId' })
  job: Job;

  @Column({ type: 'uuid' })
  jobId: string;

  @Column({ type: 'varchar', length: 20, default: SurveyStatus.SCHEDULED })
  status: SurveyStatus;

  @Column({ type: 'varchar', length: 30, nullable: true })
  outcome: SurveyOutcome | null;

  @Column({ type: 'uuid', nullable: true })
  assignedUserId: string | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  scheduledAt: Date | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  startedAt: Date | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  completedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  completedByUserId: string | null;

  // ─── Roof ───────────────────────────────────────────────────────────────

  /** `tile` | `metal` | `colorbond` | `slate` | `concrete` | `other`. */
  @Column({ type: 'varchar', length: 30, nullable: true })
  roofType: string | null;

  @Column({ type: 'int', nullable: true })
  roofAgeYears: number | null;

  /** Pitch in degrees. */
  @Column({ type: 'int', nullable: true })
  roofPitchDegrees: number | null;

  /** Compass orientation of the main array face, 0–359. */
  @Column({ type: 'int', nullable: true })
  roofOrientationDegrees: number | null;

  @Column({ type: 'int', nullable: true })
  storeys: number | null;

  /** Usable roof area in m², after setbacks. */
  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  usableRoofAreaSqm: string | null;

  @Column({ type: 'boolean', nullable: true })
  roofConditionAcceptable: boolean | null;

  // ─── Shading ────────────────────────────────────────────────────────────

  /** `none` | `light` | `moderate` | `heavy`. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  shadingLevel: string | null;

  @Column({ type: 'text', nullable: true })
  shadingNotes: string | null;

  // ─── Switchboard / electrical ───────────────────────────────────────────

  /** `single` | `three`. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  phaseType: string | null;

  @Column({ type: 'boolean', nullable: true })
  switchboardUpgradeRequired: boolean | null;

  @Column({ type: 'text', nullable: true })
  switchboardNotes: string | null;

  @Column({ type: 'int', nullable: true })
  mainSwitchRatingAmps: number | null;

  /** Metres of cable run from the array to the switchboard. */
  @Column({ type: 'int', nullable: true })
  cableRunMetres: number | null;

  // ─── Access ─────────────────────────────────────────────────────────────

  /** `easy` | `moderate` | `difficult`. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  accessDifficulty: string | null;

  @Column({ type: 'boolean', nullable: true })
  scaffoldRequired: boolean | null;

  @Column({ type: 'boolean', nullable: true })
  craneRequired: boolean | null;

  @Column({ type: 'text', nullable: true })
  accessNotes: string | null;

  // ─── Outcome ────────────────────────────────────────────────────────────

  @Column({ type: 'text', nullable: true })
  outcomeNotes: string | null;

  /** Extra cost the survey uncovered, folded into the proposal. */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  remediationCost: string | null;

  /** Uploaded photo file ids (see the `files` module). */
  @Column({ type: 'json', nullable: true })
  photoFileIds: string[] | null;

  /** Free-form answers that don't warrant a column. */
  @Column({ type: 'json', nullable: true })
  extra: Record<string, unknown> | null;

  /**
   * Client-generated id from the mobile offline queue. Unique per job, so a
   * retried upload updates rather than duplicating the survey.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  clientRequestId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
