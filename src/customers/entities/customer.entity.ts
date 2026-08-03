import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { resolveTimestampColumnType } from '../../common/timestamp-column-type.util';

export type LeadOwnershipEntry = {
  userId: string;
  assignedAt: string;
  assignedByUserId: string | null;
  reason?: string;
};

@Entity('customers')
@Index('idx_customers_household_key', ['householdKey'])
@Index('idx_customers_qualification_status', ['qualificationStatus'])
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  firstName: string;

  @Column({ type: 'varchar', length: 100 })
  lastName: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  lat: number | null;

  @Column({ type: 'decimal', precision: 11, scale: 7, nullable: true })
  lng: number | null;

  @Column({ type: 'varchar', length: 30 })
  phone: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  secondaryPhone: string | null;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  acquisitionSource: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  acquisitionSourceOther: string | null;

  // ─── Lead attribution (PRD v2, Phase 0) ─────────────────────────────────
  // First-class columns replacing the `__FORDAN_LEAD_META__` JSON blob that
  // the public lead form used to stuff into a job note. Reportable, filterable
  // and preserved across job changes.

  /** Channel family: `website_form`, `referral`, `phone`, `partner`, … */
  @Column({ type: 'varchar', length: 60, nullable: true })
  leadSource: string | null;

  /** utm_medium, e.g. `cpc`, `organic`, `email`. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  leadMedium: string | null;

  /** utm_campaign. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  leadCampaign: string | null;

  /** Public form slug the lead arrived through. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  leadFormSlug: string | null;

  /** Referring page URL. text, not varchar — jobs-adjacent row-size caution. */
  @Column({ type: 'text', nullable: true })
  leadPageReferrer: string | null;

  /** "How did you hear about us?" as typed by the customer. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  leadSelfReportedSource: string | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  leadCapturedAt: Date | null;

  /** Current lead owner (sales rep). */
  @Column({ type: 'uuid', nullable: true })
  leadOwnerUserId: string | null;

  /**
   * Append-only ownership trail:
   * `[{ userId, assignedAt, assignedByUserId, reason }]`.
   */
  @Column({ type: 'json', nullable: true })
  leadOwnershipHistory: LeadOwnershipEntry[] | null;

  // ─── Qualification (PRD v2, Phase 1) ────────────────────────────────────

  /** `unqualified` | `working` | `qualified` | `disqualified` | `nurture`. */
  @Column({ type: 'varchar', length: 20, default: 'unqualified' })
  qualificationStatus: string;

  /** Score from the configured criteria at the time of the last assessment. */
  @Column({ type: 'int', nullable: true })
  qualificationScore: number | null;

  /** Raw answers, keyed by criterion id — kept so a score can be explained. */
  @Column({ type: 'json', nullable: true })
  qualificationAnswers: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  disqualificationReason: string | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  qualifiedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  qualifiedByUserId: string | null;

  /** When a nurture lead should resurface as a follow-up task. */
  @Column({ type: resolveTimestampColumnType(), nullable: true })
  nurtureUntil: Date | null;

  // ─── Household (PRD v2, Phase 1) ────────────────────────────────────────

  /**
   * Normalised address key used for household/duplicate matching. Derived, not
   * user-entered — see `normalizeAddressKey`.
   */
  @Column({ type: 'varchar', length: 180, nullable: true })
  householdKey: string | null;

  /** Set on the losing record when two customers are merged. */
  @Column({ type: 'uuid', nullable: true })
  mergedIntoCustomerId: string | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  mergedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
