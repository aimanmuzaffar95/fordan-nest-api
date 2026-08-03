import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Job } from '../jobs/entities/job.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { FinancingApplication } from './entities/financing-application.entity';
import { FinancingController } from './financing.controller';
import { FinancingService } from './financing.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FinancingApplication, Job]),
    NotificationsModule,
    RuntimeSettingsModule,
  ],
  controllers: [FinancingController],
  providers: [FinancingService],
  exports: [FinancingService],
})
export class FinancingModule {}
