import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminSettings } from './admin-settings.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { RuntimeSettingsService } from './runtime-settings.service';
import { RuntimeSettingsController } from './runtime-settings.controller';
import { PublicCrmAppearanceController } from './public-crm-appearance.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([AdminSettings, User]),
    NotificationsModule,
  ],
  providers: [RuntimeSettingsService],
  controllers: [RuntimeSettingsController, PublicCrmAppearanceController],
  exports: [RuntimeSettingsService],
})
export class RuntimeSettingsModule {}
