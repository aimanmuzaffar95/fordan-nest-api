import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminSettings } from './admin-settings.entity';
import { SettingsAuditLog } from './settings-audit-log.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { FilesModule } from '../files/files.module';
import { RuntimeSettingsService } from './runtime-settings.service';
import { RuntimeSettingsController } from './runtime-settings.controller';
import { PublicCrmAppearanceController } from './public-crm-appearance.controller';
import { PublicCrmBrandingController } from './public-crm-branding.controller';
import { DocumentNumberingService } from '../document-numbering/document-numbering.service';
import { SystemAuditModule } from '../system-audit/system-audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AdminSettings, SettingsAuditLog, User]),
    NotificationsModule,
    FilesModule,
    SystemAuditModule,
  ],
  providers: [RuntimeSettingsService, DocumentNumberingService],
  controllers: [
    RuntimeSettingsController,
    PublicCrmAppearanceController,
    PublicCrmBrandingController,
  ],
  exports: [RuntimeSettingsService, DocumentNumberingService],
})
export class RuntimeSettingsModule {}
