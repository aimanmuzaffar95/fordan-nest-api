import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Alert } from './entities/alert.entity';
import { AlertsService } from './alerts.service';
import { AlertsController } from './alerts.controller';
import { Job } from '../jobs/entities/job.entity';
import { MeterApplication } from '../metering/entities/meter-application.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { AdminSettings } from '../runtime-settings/admin-settings.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    NotificationsModule,
    TypeOrmModule.forFeature([
      Alert,
      Job,
      MeterApplication,
      Invoice,
      AdminSettings,
      User,
    ]),
  ],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
