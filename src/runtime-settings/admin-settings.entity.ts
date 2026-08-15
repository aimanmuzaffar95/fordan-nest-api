import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/entities/user.entity';
import type { CustomerMessagingTemplates } from '../customer-messaging/customer-messaging.types';
import type { CrmAppearanceSettings } from '../crm-appearance/crm-appearance.types';
import type { CompanyProfileSettings } from '../company-profile/company-profile.types';
import type { BillingSettings } from '../billing/billing-settings.types';
import type { DocumentNumberingSettings } from '../document-numbering/document-numbering.types';
import type { ComplianceChecklistConfig } from '../compliance-checklist/compliance-checklist.config';
import type { FeatureFlags } from '../feature-flags/feature-flags.config';
import type { PipelineStageConfig } from '../pipeline-stages/pipeline-stage.config';
import type { QualificationConfig } from '../qualification/qualification.config';
import type { DocumentTaxonomyConfig } from '../document-taxonomy/document-taxonomy.config';

export const ADMIN_SETTINGS_SINGLETON_ID = 'global';

@Entity('admin_settings')
export class AdminSettings {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id: string;

  @Column({ type: 'boolean', default: false })
  overridePreMeter: boolean;

  @Column({ type: 'boolean', default: true })
  calendarScopeEnforced: boolean;

  @Column({ type: 'int', default: 14 })
  invoiceOverdueDays: number;

  @Column({ type: 'int', default: 7 })
  preMeterPendingDays: number;

  @Column({ type: 'int', default: 3 })
  installWarningDays: number;

  @Column({ type: 'int', default: 2 })
  postMeterDeadlineDays: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 6.6 })
  quickLeadDefaultSystemSizeKw: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 10 })
  quickLeadDefaultBatterySizeKwh: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  quickLeadDefaultProjectPrice: string;

  // text (not varchar): admin_settings' combined inline varchar width sat at
  // MariaDB's 8126-byte row cap, making every table rebuild fail in prod.
  @Column({ type: 'text', nullable: true })
  esignPublicBaseUrl: string | null;

  @Column({ type: 'int', default: 14 })
  esignTokenTtlDays: number;

  @Column({ type: 'boolean', default: true })
  complianceRequireSignature: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  smtpHost: string | null;

  @Column({ type: 'int', nullable: true })
  smtpPort: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  smtpUser: string | null;

  @Column({ type: 'text', nullable: true })
  smtpPass: string | null;

  @Column({ type: 'boolean', nullable: true })
  smtpSecure: boolean | null;

  @Column({ type: 'varchar', length: 320, nullable: true })
  mailFrom: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  mailFromName: string | null;

  @Column({ type: 'json', nullable: true })
  customerMessagingTemplates: CustomerMessagingTemplates | null;

  @Column({ type: 'json', nullable: true })
  crmAppearanceSettings: CrmAppearanceSettings | null;

  @Column({ type: 'json', nullable: true })
  companyProfileSettings: CompanyProfileSettings | null;

  @Column({ type: 'json', nullable: true })
  billingSettings: BillingSettings | null;

  @Column({ type: 'json', nullable: true })
  documentNumberingSettings: DocumentNumberingSettings | null;

  @Column({ type: 'json', nullable: true })
  complianceChecklistConfig: ComplianceChecklistConfig | null;

  @Column({ type: 'json', nullable: true })
  featureFlags: FeatureFlags | null;

  @Column({ type: 'json', nullable: true })
  pipelineStageConfig: PipelineStageConfig | null;

  @Column({ type: 'json', nullable: true })
  qualificationConfig: QualificationConfig | null;

  @Column({ type: 'json', nullable: true })
  documentTaxonomy: DocumentTaxonomyConfig | null;

  // Runtime override for the roof designer's satellite imagery provider —
  // lets an admin switch free (esri) vs. paid (google/mapbox) without
  // editing server env vars. `null` = fall back to `SOLAR_IMAGERY_PROVIDER`.
  @Column({ type: 'varchar', length: 20, nullable: true })
  solarImageryProvider: string | null;

  // encryptSettingsValue() output (same AES-GCM helper as smtpPass /
  // linked-mailbox passwords) — never returned by any endpoint. text (not
  // varchar): see the comment on esignPublicBaseUrl above re: MariaDB's
  // 8126-byte inline row cap.
  @Column({ type: 'text', nullable: true })
  solarImageryGoogleKeyEncrypted: string | null;

  @Column({ type: 'text', nullable: true })
  solarImageryMapboxTokenEncrypted: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updatedByUserId' })
  updatedByUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  updatedByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
