import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MeterApplication } from './entities/meter-application.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { MeterApplicationsController } from './meter-applications.controller';
import { MeterApplicationsService } from './meter-applications.service';

@Module({
  imports: [TypeOrmModule.forFeature([MeterApplication, TimelineEvent])],
  controllers: [MeterApplicationsController],
  providers: [MeterApplicationsService],
  exports: [MeterApplicationsService],
})
export class MeteringModule {}
