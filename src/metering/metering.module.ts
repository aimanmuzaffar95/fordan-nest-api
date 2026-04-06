import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MeterApplication } from './entities/meter-application.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { JobsModule } from '../jobs/jobs.module';
import { FilesModule } from '../files/files.module';
import { MeterApplicationsController } from './meter-applications.controller';
import { MeterApplicationsService } from './meter-applications.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MeterApplication, TimelineEvent]),
    JobsModule,
    FilesModule,
  ],
  controllers: [MeterApplicationsController],
  providers: [MeterApplicationsService],
  exports: [MeterApplicationsService],
})
export class MeteringModule {}
