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
import { SystemAuditLogService } from '../system-audit/system-audit-log.service';
import { SYSTEM_AUDIT_ACTION } from '../system-audit/system-audit-action.constants';
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
    private readonly systemAudit: SystemAuditLogService,
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

    const changedFields = Object.keys(updates as Record<string, unknown>)
      .filter((k) => (updates as Record<string, unknown>)[k] !== undefined)
      .sort();
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

    await this.systemAudit.record({
      action: SYSTEM_AUDIT_ACTION.ADMIN_SETTINGS_UPDATED,
      actorUserId: updatedByUserId,
      resourceType: 'admin_settings',
      resourceId: ADMIN_SETTINGS_SINGLETON_ID,
      metadata: { changedFields },
    });

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

  private decodeSmtpSettings(settings: AdminSettings): {
    smtpHost: string | null;
    smtpPort: number | null;
    smtpSecure: boolean | null;
    smtpUser: string | null;
    smtpPass: string | null;
    mailFrom: string | null;
    mailFromName: string | null;
  } {
    return {
      smtpHost: settings.smtpHost?.trim() ? settings.smtpHost.trim() : null,
      smtpPort:
        settings.smtpPort != null && Number.isFinite(Number(settings.smtpPort))
          ? Number(settings.smtpPort)
          : null,
      smtpSecure:
        settings.smtpSecure === true || settings.smtpSecure === false
          ? settings.smtpSecure
          : null,
      smtpUser: settings.smtpUser?.trim() ? settings.smtpUser.trim() : null,
      smtpPass: settings.smtpPass?.trim() ? settings.smtpPass.trim() : null,
      mailFrom: settings.mailFrom?.trim() ? settings.mailFrom.trim() : null,
      mailFromName: settings.mailFromName?.trim()
        ? settings.mailFromName.trim()
        : null,
    };
  }
}
