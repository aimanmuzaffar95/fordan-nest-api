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

export type AdminSettingsPayload = {
  overridePreMeter: boolean;
  calendarScopeEnforced: boolean;
  invoiceOverdueDays: number;
  preMeterPendingDays: number;
  installWarningDays: number;
  postMeterDeadlineDays: number;
  maxJobsPerTeamPerDay: number;
};

@Injectable()
export class RuntimeSettingsService {
  constructor(
    @InjectRepository(AdminSettings)
    private readonly settingsRepo: Repository<AdminSettings>,
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
    Object.assign(settings, updates, {
      updatedByUserId,
    });

    const changedFields = Object.keys(updates).sort();
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

    return this.toPayload(saved);
  }

  async getCalendarScopeEnforced(): Promise<boolean> {
    const settings = await this.getOrCreateSettingsEntity();
    return settings.calendarScopeEnforced;
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
      maxJobsPerTeamPerDay: 2,
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
      maxJobsPerTeamPerDay: settings.maxJobsPerTeamPerDay,
    };
  }
}
