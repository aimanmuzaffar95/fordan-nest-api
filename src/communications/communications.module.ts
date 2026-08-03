import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { CommunicationLog } from './entities/communication-log.entity';
import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CommunicationLog, Customer, Job, TimelineEvent]),
    RuntimeSettingsModule,
  ],
  controllers: [CommunicationsController],
  providers: [CommunicationsService],
  exports: [CommunicationsService],
})
export class CommunicationsModule {}
