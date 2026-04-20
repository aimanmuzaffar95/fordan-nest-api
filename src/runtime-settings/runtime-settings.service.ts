import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AdminSettings,
  ADMIN_SETTINGS_SINGLETON_ID,
} from './admin-settings.entity';
import { UpdateAdminSettingsDto } from './dto/update-admin-settings.dto';
import { SettingsAuditLog } from './settings-audit-log.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPE } from '../notifications/notification-type.constants';
import {
  deepMergeMessagingPatch,
  mergeCustomerMessagingTemplates,
} from '../customer-messaging/customer-messaging.merge';
import { validateCustomerMessagingTemplates } from '../customer-messaging/customer-messaging.validate';
import type { CustomerMessagingTemplates } from '../customer-messaging/customer-messaging.types';
import {
  mergeCrmAppearancePatch,
  mergeCrmAppearanceSettings,
} from '../crm-appearance/crm-appearance.merge';
import {
  normalizeCrmAppearanceSettings,
  validateCrmAppearanceSettings,
} from '../crm-appearance/crm-appearance.validate';
import type { CrmAppearanceSettings } from '../crm-appearance/crm-appearance.types';
import {
  mergeCompanyProfilePatch,
  mergeCompanyProfileSettings,
} from '../company-profile/company-profile.merge';
import {
  normalizeCompanyProfileSettings,
  validateCompanyProfileSettings,
} from '../company-profile/company-profile.validate';
import type { CompanyProfileSettings } from '../company-profile/company-profile.types';
import {
  mergeBillingPatch,
  mergeBillingSettings,
} from '../billing/billing-settings.merge';
import {
  normalizeBillingSettings,
  validateBillingSettings,
} from '../billing/billing-settings.validate';
import type { BillingSettings } from '../billing/billing-settings.types';
import {
  mergeDocumentNumberingPatch,
  mergeDocumentNumberingSettings,
} from '../document-numbering/document-numbering.merge';
import {
  normalizeDocumentNumberingSettings,
  validateDocumentNumberingSettings,
} from '../document-numbering/document-numbering.validate';
import type { DocumentNumberingSettings } from '../document-numbering/document-numbering.types';

export type AdminSettingsPayload = {
  overridePreMeter: boolean;
  calendarScopeEnforced: boolean;
  invoiceOverdueDays: number;
  preMeterPendingDays: number;
  installWarningDays: number;
  postMeterDeadlineDays: number;
  quickLeadDefaultSystemSizeKw: number;
  quickLeadDefaultBatterySizeKwh: number;
  quickLeadDefaultProjectPrice: number;
  esignPublicBaseUrl: string | null;
  esignTokenTtlDays: number;
  esignRequireVerificationToView: boolean;
  esignEmailMagicLinkEnabled: boolean;
  esignSmsOtpEnabled: boolean;
  esignProposalTermsMarkdown: string | null;
  esignProposalTermsVersion: number;
  esignProposalAcceptanceMarkdown: string | null;
  esignProposalAcceptanceVersion: number;
  esignProposalShowSystemDetails: boolean;
  esignProposalShowIncludedServices: boolean;
  esignProposalIncludedServicesMarkdown: string | null;
  esignProposalIncludedServicesVersion: number;
  esignProposalShowWarranty: boolean;
  esignProposalWarrantyMarkdown: string | null;
  esignProposalWarrantyVersion: number;
  esignProposalShowAssumptions: boolean;
  esignProposalAssumptionsMarkdown: string | null;
  esignProposalAssumptionsVersion: number;
  esignProposalQuoteAdjustmentsJson: string | null;
  esignProposalQuoteAdjustmentsVersion: number;
  complianceRequireSignature: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPassSet: boolean;
  smtpSecure: boolean | null;
  mailFrom: string | null;
  mailFromName: string | null;
  customerMessagingTemplates: CustomerMessagingTemplates;
  crmAppearanceSettings: CrmAppearanceSettings;
  companyProfileSettings: CompanyProfileSettings;
  billingSettings: BillingSettings;
  documentNumberingSettings: DocumentNumberingSettings;
};

@Injectable()
export class RuntimeSettingsService {
  constructor(
    @InjectRepository(AdminSettings)
    private readonly settingsRepo: Repository<AdminSettings>,
    @InjectRepository(SettingsAuditLog)
    private readonly settingsAuditRepo: Repository<SettingsAuditLog>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getSettings(): Promise<AdminSettingsPayload> {
    const settings = await this.getOrCreateSettingsEntity();
    return this.toPayload(settings);
  }

  async updateSettings(
    updates: UpdateAdminSettingsDto,
    updatedByUserId: string,
  ): Promise<AdminSettingsPayload> {
    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('At least one settings field is required');
    }

    const settings = await this.getOrCreateSettingsEntity();
    const patch = { ...updates } as Record<string, unknown>;
    const smtpPassRaw = patch['smtpPass'];
    delete patch['smtpPass'];
    const messagingRaw = patch['customerMessagingTemplates'];
    delete patch['customerMessagingTemplates'];
    const appearanceRaw = patch['crmAppearanceSettings'];
    delete patch['crmAppearanceSettings'];
    const companyRaw = patch['companyProfileSettings'];
    delete patch['companyProfileSettings'];
    const billingRaw = patch['billingSettings'];
    delete patch['billingSettings'];
    const numberingRaw = patch['documentNumberingSettings'];
    delete patch['documentNumberingSettings'];
    const cleaned = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    Object.assign(settings, cleaned, {
      updatedByUserId,
    });
    if (smtpPassRaw !== undefined) {
      if (
        smtpPassRaw === null ||
        smtpPassRaw === '' ||
        (typeof smtpPassRaw === 'string' && smtpPassRaw.trim() === '')
      ) {
        settings.smtpPass = null;
      } else if (typeof smtpPassRaw === 'string') {
        settings.smtpPass = smtpPassRaw;
      } else {
        throw new BadRequestException('smtpPass must be a string or null');
      }
    }
    if (messagingRaw !== undefined) {
      const current = mergeCustomerMessagingTemplates(
        settings.customerMessagingTemplates,
      );
      const next = deepMergeMessagingPatch(current, messagingRaw);
      validateCustomerMessagingTemplates(next);
      settings.customerMessagingTemplates = next;
    }
    if (appearanceRaw !== undefined) {
      const current = mergeCrmAppearanceSettings(
        settings.crmAppearanceSettings,
      );
      const next = mergeCrmAppearancePatch(current, appearanceRaw);
      const normalized = normalizeCrmAppearanceSettings(next);
      validateCrmAppearanceSettings(normalized);
      settings.crmAppearanceSettings = normalized;
    }
    if (companyRaw !== undefined) {
      const current = mergeCompanyProfileSettings(
        settings.companyProfileSettings,
      );
      const next = mergeCompanyProfilePatch(current, companyRaw);
      const normalized = normalizeCompanyProfileSettings(next);
      validateCompanyProfileSettings(normalized);
      settings.companyProfileSettings = normalized;
    }
    if (billingRaw !== undefined) {
      const current = mergeBillingSettings(settings.billingSettings);
      const next = mergeBillingPatch(current, billingRaw);
      const normalized = normalizeBillingSettings(next);
      validateBillingSettings(normalized);
      settings.billingSettings = normalized;
    }
    if (numberingRaw !== undefined) {
      const current = mergeDocumentNumberingSettings(
        settings.documentNumberingSettings,
      );
      const next = mergeDocumentNumberingPatch(current, numberingRaw);
      const normalized = normalizeDocumentNumberingSettings(next);
      validateDocumentNumberingSettings(normalized);
      settings.documentNumberingSettings = normalized;
    }

    const changedFields = Object.keys(updates).sort();
    const saved = await this.settingsRepo.save(settings);

    const auditPatch: Record<string, unknown> = { ...updates } as Record<
      string,
      unknown
    >;
    if ('smtpPass' in auditPatch) {
      // Never store plaintext credentials in audit.
      auditPatch['smtpPass'] = auditPatch['smtpPass'] ? '[set]' : null;
    }
    await this.settingsAuditRepo.save(
      this.settingsAuditRepo.create({
        actorUserId: updatedByUserId,
        action: 'settings_updated',
        changedFields,
        patch: auditPatch,
      }),
    );

    const adminUsers = await this.usersRepo.find({
      where: {
        role: UserRole.ADMIN,
        active: true,
      },
      select: ['id'],
    });

    await this.notificationsService.sendToUsers(
      adminUsers
        .map((user) => user.id)
        .filter((userId) => userId !== updatedByUserId),
      {
        type: NOTIFICATION_TYPE.SETTINGS_UPDATED,
        title: 'System settings updated',
        body:
          changedFields.length > 0
            ? `Updated fields: ${changedFields.join(', ')}.`
            : 'Global settings were updated.',
        metadata: {
          updatedByUserId,
          changedFields,
        },
      },
    );

    return this.toPayload(saved);
  }

  async listAuditLog(opts?: { limit?: number }): Promise<
    Array<{
      id: string;
      actorUserId: string | null;
      actorName: string | null;
      action: string;
      changedFields: string[];
      patch: Record<string, unknown> | null;
      createdAt: string;
    }>
  > {
    const limit = Math.min(200, Math.max(1, opts?.limit ?? 50));
    const rows = await this.settingsAuditRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
      relations: { actorUser: true },
      select: {
        id: true,
        actorUserId: true,
        action: true,
        changedFields: true,
        patch: true,
        createdAt: true,
        actorUser: { id: true, firstName: true, lastName: true },
      },
    });

    return rows.map((r) => {
      const first = r.actorUser?.firstName?.trim() ?? '';
      const last = r.actorUser?.lastName?.trim() ?? '';
      const actorName = `${first} ${last}`.trim() || null;
      return {
        id: r.id,
        actorUserId: r.actorUserId,
        actorName,
        action: r.action,
        changedFields: r.changedFields ?? [],
        patch: r.patch ?? null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  async getCalendarScopeEnforced(): Promise<boolean> {
    const settings = await this.getOrCreateSettingsEntity();
    return settings.calendarScopeEnforced;
  }

  /** Safe, unauthenticated read for login and other pre-auth surfaces. */
  async getPublicCrmAppearance(): Promise<CrmAppearanceSettings> {
    const settings = await this.getOrCreateSettingsEntity();
    return mergeCrmAppearanceSettings(settings.crmAppearanceSettings);
  }

  private async getOrCreateSettingsEntity(): Promise<AdminSettings> {
    const existing = await this.settingsRepo.findOne({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID },
    });
    if (existing) {
      return existing;
    }

    const created = this.settingsRepo.create({
      id: ADMIN_SETTINGS_SINGLETON_ID,
      overridePreMeter: false,
      calendarScopeEnforced: true,
      invoiceOverdueDays: 14,
      preMeterPendingDays: 7,
      installWarningDays: 3,
      postMeterDeadlineDays: 2,
      quickLeadDefaultSystemSizeKw: '6.6',
      quickLeadDefaultBatterySizeKwh: '10',
      quickLeadDefaultProjectPrice: '0',
      esignPublicBaseUrl: null,
      esignTokenTtlDays: 14,
      esignRequireVerificationToView: true,
      esignEmailMagicLinkEnabled: true,
      esignSmsOtpEnabled: false,
      esignProposalTermsMarkdown: null,
      esignProposalTermsVersion: 1,
      esignProposalAcceptanceMarkdown: null,
      esignProposalAcceptanceVersion: 1,
      esignProposalShowSystemDetails: true,
      esignProposalShowIncludedServices: true,
      esignProposalIncludedServicesMarkdown: null,
      esignProposalIncludedServicesVersion: 1,
      esignProposalShowWarranty: true,
      esignProposalWarrantyMarkdown: null,
      esignProposalWarrantyVersion: 1,
      esignProposalShowAssumptions: true,
      esignProposalAssumptionsMarkdown: null,
      esignProposalAssumptionsVersion: 1,
      esignProposalQuoteAdjustmentsJson: null,
      esignProposalQuoteAdjustmentsVersion: 1,
      complianceRequireSignature: true,
      updatedByUserId: null,
    });

    return this.settingsRepo.save(created);
  }

  private toPayload(settings: AdminSettings): AdminSettingsPayload {
    return {
      overridePreMeter: settings.overridePreMeter,
      calendarScopeEnforced: settings.calendarScopeEnforced,
      invoiceOverdueDays: settings.invoiceOverdueDays,
      preMeterPendingDays: settings.preMeterPendingDays,
      installWarningDays: settings.installWarningDays,
      postMeterDeadlineDays: settings.postMeterDeadlineDays,
      quickLeadDefaultSystemSizeKw: Number(
        settings.quickLeadDefaultSystemSizeKw,
      ),
      quickLeadDefaultBatterySizeKwh: Number(
        settings.quickLeadDefaultBatterySizeKwh,
      ),
      quickLeadDefaultProjectPrice: Number(
        settings.quickLeadDefaultProjectPrice,
      ),
      esignPublicBaseUrl: settings.esignPublicBaseUrl?.trim()
        ? settings.esignPublicBaseUrl.trim()
        : null,
      esignTokenTtlDays: settings.esignTokenTtlDays ?? 14,
      esignRequireVerificationToView:
        settings.esignRequireVerificationToView !== false,
      esignEmailMagicLinkEnabled: settings.esignEmailMagicLinkEnabled !== false,
      esignSmsOtpEnabled: settings.esignSmsOtpEnabled === true,
      esignProposalTermsMarkdown:
        typeof settings.esignProposalTermsMarkdown === 'string'
          ? settings.esignProposalTermsMarkdown
          : null,
      esignProposalTermsVersion: Number(settings.esignProposalTermsVersion ?? 1),
      esignProposalAcceptanceMarkdown:
        typeof settings.esignProposalAcceptanceMarkdown === 'string'
          ? settings.esignProposalAcceptanceMarkdown
          : null,
      esignProposalAcceptanceVersion: Number(
        settings.esignProposalAcceptanceVersion ?? 1,
      ),
      esignProposalShowSystemDetails:
        settings.esignProposalShowSystemDetails !== false,
      esignProposalShowIncludedServices:
        settings.esignProposalShowIncludedServices !== false,
      esignProposalIncludedServicesMarkdown:
        typeof settings.esignProposalIncludedServicesMarkdown === 'string'
          ? settings.esignProposalIncludedServicesMarkdown
          : null,
      esignProposalIncludedServicesVersion: Number(
        settings.esignProposalIncludedServicesVersion ?? 1,
      ),
      esignProposalShowWarranty: settings.esignProposalShowWarranty !== false,
      esignProposalWarrantyMarkdown:
        typeof settings.esignProposalWarrantyMarkdown === 'string'
          ? settings.esignProposalWarrantyMarkdown
          : null,
      esignProposalWarrantyVersion: Number(
        settings.esignProposalWarrantyVersion ?? 1,
      ),
      esignProposalShowAssumptions:
        settings.esignProposalShowAssumptions !== false,
      esignProposalAssumptionsMarkdown:
        typeof settings.esignProposalAssumptionsMarkdown === 'string'
          ? settings.esignProposalAssumptionsMarkdown
          : null,
      esignProposalAssumptionsVersion: Number(
        settings.esignProposalAssumptionsVersion ?? 1,
      ),
      esignProposalQuoteAdjustmentsJson:
        typeof settings.esignProposalQuoteAdjustmentsJson === 'string'
          ? settings.esignProposalQuoteAdjustmentsJson
          : null,
      esignProposalQuoteAdjustmentsVersion: Number(
        settings.esignProposalQuoteAdjustmentsVersion ?? 1,
      ),
      complianceRequireSignature: settings.complianceRequireSignature !== false,
      smtpHost: settings.smtpHost?.trim() ? settings.smtpHost.trim() : null,
      smtpPort:
        settings.smtpPort != null && Number.isFinite(Number(settings.smtpPort))
          ? Number(settings.smtpPort)
          : null,
      smtpUser: settings.smtpUser?.trim() ? settings.smtpUser.trim() : null,
      smtpPassSet: Boolean(settings.smtpPass?.trim()),
      smtpSecure:
        settings.smtpSecure === true || settings.smtpSecure === false
          ? settings.smtpSecure
          : null,
      mailFrom: settings.mailFrom?.trim() ? settings.mailFrom.trim() : null,
      mailFromName: settings.mailFromName?.trim()
        ? settings.mailFromName.trim()
        : null,
      customerMessagingTemplates: mergeCustomerMessagingTemplates(
        settings.customerMessagingTemplates,
      ),
      crmAppearanceSettings: mergeCrmAppearanceSettings(
        settings.crmAppearanceSettings,
      ),
      companyProfileSettings: mergeCompanyProfileSettings(
        settings.companyProfileSettings,
      ),
      billingSettings: mergeBillingSettings(settings.billingSettings),
      documentNumberingSettings: mergeDocumentNumberingSettings(
        settings.documentNumberingSettings,
      ),
    };
  }
}
