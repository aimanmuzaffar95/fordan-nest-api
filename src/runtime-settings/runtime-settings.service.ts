import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AdminSettings,
  ADMIN_SETTINGS_SINGLETON_ID,
} from './admin-settings.entity';
import { UpdateAdminSettingsDto } from './dto/update-admin-settings.dto';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPE } from '../notifications/notification-type.constants';
import { SystemAuditLogService } from '../system-audit/system-audit-log.service';
import { SYSTEM_AUDIT_ACTION } from '../system-audit/system-audit-action.constants';
import {
  decryptSettingsValue,
  encryptSettingsValue,
} from '../common/crypto.util';

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
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  smtpUser: string | null;
  smtpPassSet: boolean;
  mailFrom: string | null;
  mailFromName: string | null;
  smtpConfigured: boolean;
};

export type RuntimeSmtpConfig =
  | {
      configured: false;
      host: null;
      port: null;
      secure: null;
      user: null;
      pass: null;
      mailFrom: null;
      mailFromName: null;
    }
  | {
      configured: true;
      host: string;
      port: number;
      secure: boolean;
      user: string;
      pass: string;
      mailFrom: string;
      mailFromName: string;
    };

type NormalizedSettingsUpdates = Omit<
  UpdateAdminSettingsDto,
  | 'smtpHost'
  | 'smtpPort'
  | 'smtpSecure'
  | 'smtpUser'
  | 'smtpPass'
  | 'mailFrom'
  | 'mailFromName'
> & {
  smtpHost?: string | null;
  smtpPort?: string | null;
  smtpSecure?: string | null;
  smtpUser?: string | null;
  smtpPass?: string | null;
  mailFrom?: string | null;
  mailFromName?: string | null;
};

@Injectable()
export class RuntimeSettingsService {
  constructor(
    @InjectRepository(AdminSettings)
    private readonly settingsRepo: Repository<AdminSettings>,
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
    const normalizedUpdates = this.normalizeUpdates(updates);

    Object.assign(settings, normalizedUpdates, {
      updatedByUserId,
    });

    const changedFields = Object.keys(normalizedUpdates).sort();
    const saved = await this.settingsRepo.save(settings);

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

  async getCalendarScopeEnforced(): Promise<boolean> {
    const settings = await this.getOrCreateSettingsEntity();
    return settings.calendarScopeEnforced;
  }

  async getSmtpConfig(): Promise<RuntimeSmtpConfig> {
    const settings = await this.getOrCreateSettingsEntity();

    const decoded = this.decodeSmtpSettings(settings);

    if (
      decoded.smtpHost === null ||
      decoded.smtpPort === null ||
      decoded.smtpSecure === null ||
      decoded.smtpUser === null ||
      decoded.smtpPass === null ||
      decoded.mailFrom === null ||
      decoded.mailFromName === null
    ) {
      return {
        configured: false,
        host: null,
        port: null,
        secure: null,
        user: null,
        pass: null,
        mailFrom: null,
        mailFromName: null,
      };
    }

    return {
      configured: true,
      host: decoded.smtpHost,
      port: decoded.smtpPort,
      secure: decoded.smtpSecure,
      user: decoded.smtpUser,
      pass: decoded.smtpPass,
      mailFrom: decoded.mailFrom,
      mailFromName: decoded.mailFromName,
    };
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
      smtpHost: null,
      smtpPort: null,
      smtpSecure: null,
      smtpUser: null,
      smtpPass: null,
      mailFrom: null,
      mailFromName: null,
      updatedByUserId: null,
    });

    return this.settingsRepo.save(created);
  }

  private toPayload(settings: AdminSettings): AdminSettingsPayload {
    const decoded = this.decodeSmtpSettings(settings);
    const smtpConfigured =
      decoded.smtpHost !== null &&
      decoded.smtpPort !== null &&
      decoded.smtpSecure !== null &&
      decoded.smtpUser !== null &&
      decoded.smtpPass !== null &&
      decoded.mailFrom !== null &&
      decoded.mailFromName !== null;

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
      smtpHost: decoded.smtpHost,
      smtpPort: decoded.smtpPort,
      smtpSecure: decoded.smtpSecure,
      smtpUser: decoded.smtpUser,
      smtpPassSet: settings.smtpPass !== null,
      mailFrom: decoded.mailFrom,
      mailFromName: decoded.mailFromName,
      smtpConfigured,
    };
  }

  private normalizeUpdates(
    updates: UpdateAdminSettingsDto,
  ): NormalizedSettingsUpdates {
    const normalized: NormalizedSettingsUpdates = {};

    if (typeof updates.overridePreMeter === 'boolean') {
      normalized.overridePreMeter = updates.overridePreMeter;
    }

    if (typeof updates.calendarScopeEnforced === 'boolean') {
      normalized.calendarScopeEnforced = updates.calendarScopeEnforced;
    }

    if (typeof updates.invoiceOverdueDays === 'number') {
      normalized.invoiceOverdueDays = updates.invoiceOverdueDays;
    }

    if (typeof updates.preMeterPendingDays === 'number') {
      normalized.preMeterPendingDays = updates.preMeterPendingDays;
    }

    if (typeof updates.installWarningDays === 'number') {
      normalized.installWarningDays = updates.installWarningDays;
    }

    if (typeof updates.postMeterDeadlineDays === 'number') {
      normalized.postMeterDeadlineDays = updates.postMeterDeadlineDays;
    }

    if (typeof updates.quickLeadDefaultSystemSizeKw === 'number') {
      normalized.quickLeadDefaultSystemSizeKw =
        updates.quickLeadDefaultSystemSizeKw;
    }

    if (typeof updates.quickLeadDefaultBatterySizeKwh === 'number') {
      normalized.quickLeadDefaultBatterySizeKwh =
        updates.quickLeadDefaultBatterySizeKwh;
    }

    if (typeof updates.quickLeadDefaultProjectPrice === 'number') {
      normalized.quickLeadDefaultProjectPrice =
        updates.quickLeadDefaultProjectPrice;
    }

    if (typeof updates.smtpHost === 'string') {
      const trimmed = updates.smtpHost.trim();
      normalized.smtpHost =
        trimmed.length > 0 ? encryptSettingsValue(trimmed) : null;
    }

    if (typeof updates.smtpPort === 'number') {
      normalized.smtpPort = encryptSettingsValue(String(updates.smtpPort));
    } else if ((updates as { smtpPort?: number | null }).smtpPort === null) {
      normalized.smtpPort = null;
    }

    if (typeof updates.smtpSecure === 'boolean') {
      normalized.smtpSecure = encryptSettingsValue(String(updates.smtpSecure));
    }

    if (typeof updates.smtpUser === 'string') {
      const trimmed = updates.smtpUser.trim();
      normalized.smtpUser =
        trimmed.length > 0 ? encryptSettingsValue(trimmed) : null;
    }

    if (typeof updates.mailFrom === 'string') {
      const trimmed = updates.mailFrom.trim();
      normalized.mailFrom =
        trimmed.length > 0 ? encryptSettingsValue(trimmed) : null;
    }

    if (typeof updates.mailFromName === 'string') {
      const trimmed = updates.mailFromName.trim();
      normalized.mailFromName =
        trimmed.length > 0 ? encryptSettingsValue(trimmed) : null;
    }

    if (typeof updates.smtpPass === 'string') {
      const trimmed = updates.smtpPass.trim();
      normalized.smtpPass =
        trimmed.length > 0 ? encryptSettingsValue(trimmed) : null;
    }

    return normalized;
  }

  private decodeSmtpSettings(settings: AdminSettings) {
    return {
      smtpHost: this.decodeEncryptedString(settings.smtpHost),
      smtpPort: this.decodeEncryptedNumber(settings.smtpPort),
      smtpSecure: this.decodeEncryptedBoolean(settings.smtpSecure),
      smtpUser: this.decodeEncryptedString(settings.smtpUser),
      smtpPass: this.decodeEncryptedString(settings.smtpPass),
      mailFrom: this.decodeEncryptedString(settings.mailFrom),
      mailFromName: this.decodeEncryptedString(settings.mailFromName),
    };
  }

  private decodeEncryptedString(value: string | null): string | null {
    if (value === null) {
      return null;
    }

    return this.decryptOrUseLegacyPlaintext(value);
  }

  private decodeEncryptedNumber(value: string | null): number | null {
    const decoded = this.decodeEncryptedString(value);
    if (decoded === null) {
      return null;
    }

    const parsed = Number(decoded);
    if (!Number.isFinite(parsed)) {
      throw new BadRequestException('Stored SMTP port is invalid.');
    }

    return parsed;
  }

  private decodeEncryptedBoolean(value: string | null): boolean | null {
    const decoded = this.decodeEncryptedString(value);
    if (decoded === null) {
      return null;
    }

    if (decoded === 'true') {
      return true;
    }

    if (decoded === 'false') {
      return false;
    }

    throw new BadRequestException('Stored SMTP secure flag is invalid.');
  }

  private decryptOrUseLegacyPlaintext(value: string): string {
    try {
      return decryptSettingsValue(value);
    } catch {
      // Backward compatibility for rows saved before all SMTP fields were encrypted.
      return value;
    }
  }
}
