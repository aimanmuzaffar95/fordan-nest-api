import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Job } from '../jobs/entities/job.entity';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { SiteSurvey } from './entities/site-survey.entity';
import { SurveysController } from './surveys.controller';
import { SurveysService } from './surveys.service';

@Module({
  imports: [TypeOrmModule.forFeature([SiteSurvey, Job]), RuntimeSettingsModule],
  controllers: [SurveysController],
  providers: [SurveysService],
  exports: [SurveysService],
})
export class SurveysModule {}
