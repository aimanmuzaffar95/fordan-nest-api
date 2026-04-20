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

  @Column({ type: 'varchar', length: 512, nullable: true })
  esignPublicBaseUrl: string | null;

  @Column({ type: 'int', default: 14 })
  esignTokenTtlDays: number;

  /**
   * When true, public signing links require verification (magic link / OTP)
   * before any proposal content is returned.
   */
  @Column({ type: 'boolean', default: true })
  esignRequireVerificationToView: boolean;

  /** Email magic-link verification (recommended baseline). */
  @Column({ type: 'boolean', default: true })
  esignEmailMagicLinkEnabled: boolean;

  /** Optional SMS OTP verification (provider integration is future). */
  @Column({ type: 'boolean', default: false })
  esignSmsOtpEnabled: boolean;

  /** Proposal terms/policies shown on the public proposal page (frozen into snapshot). */
  @Column({ type: 'text', nullable: true })
  esignProposalTermsMarkdown: string | null;

  @Column({ type: 'int', default: 1 })
  esignProposalTermsVersion: number;

  /** Acceptance block copy shown above signature pad (frozen into snapshot). */
  @Column({ type: 'text', nullable: true })
  esignProposalAcceptanceMarkdown: string | null;

  @Column({ type: 'int', default: 1 })
  esignProposalAcceptanceVersion: number;

  @Column({ type: 'boolean', default: true })
  esignProposalShowSystemDetails: boolean;

  @Column({ type: 'boolean', default: true })
  esignProposalShowIncludedServices: boolean;

  @Column({ type: 'text', nullable: true })
  esignProposalIncludedServicesMarkdown: string | null;

  @Column({ type: 'int', default: 1 })
  esignProposalIncludedServicesVersion: number;

  @Column({ type: 'boolean', default: true })
  esignProposalShowWarranty: boolean;

  @Column({ type: 'text', nullable: true })
  esignProposalWarrantyMarkdown: string | null;

  @Column({ type: 'int', default: 1 })
  esignProposalWarrantyVersion: number;

  @Column({ type: 'boolean', default: true })
  esignProposalShowAssumptions: boolean;

  @Column({ type: 'text', nullable: true })
  esignProposalAssumptionsMarkdown: string | null;

  @Column({ type: 'int', default: 1 })
  esignProposalAssumptionsVersion: number;

  /** Optional quote adjustments (discounts/incentives) as JSON array (frozen into snapshot). */
  @Column({ type: 'text', nullable: true })
  esignProposalQuoteAdjustmentsJson: string | null;

  @Column({ type: 'int', default: 1 })
  esignProposalQuoteAdjustmentsVersion: number;

  @Column({ type: 'boolean', default: true })
  complianceRequireSignature: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  smtpHost: string | null;

  @Column({ type: 'int', nullable: true })
  smtpPort: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  smtpUser: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
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
