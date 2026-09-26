import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { DevicesModule } from '../devices/devices.module';
import { Notification } from './entities/notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, User]), DevicesModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
