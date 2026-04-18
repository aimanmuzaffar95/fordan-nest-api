import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminSettings } from './admin-settings.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { SystemAuditModule } from '../system-audit/system-audit.module';
import { RuntimeSettingsService } from './runtime-settings.service';
import { RuntimeSettingsController } from './runtime-settings.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([AdminSettings, User]),
    NotificationsModule,
    SystemAuditModule,
  ],
  providers: [RuntimeSettingsService],
  controllers: [RuntimeSettingsController],
  exports: [RuntimeSettingsService],
})
export class RuntimeSettingsModule {}
