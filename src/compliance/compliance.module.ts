import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Assignment } from '../assignments/entities/assignment.entity';
import { Job } from '../jobs/entities/job.entity';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { ComplianceService } from './compliance.service';
import { ComplianceTemplatesController } from './compliance-templates.controller';
import { JobComplianceController } from './job-compliance.controller';
import { ComplianceFormTemplate } from './entities/compliance-form-template.entity';
import { JobComplianceSubmission } from './entities/job-compliance-submission.entity';
import { JobCecItemTick } from './entities/job-cec-item-tick.entity';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      ComplianceFormTemplate,
      JobComplianceSubmission,
      JobCecItemTick,
      Job,
      Assignment,
      TimelineEvent,
    ]),
    RuntimeSettingsModule,
  ],
  controllers: [ComplianceTemplatesController, JobComplianceController],
  providers: [ComplianceService, RolesGuard],
  exports: [ComplianceService],
})
export class ComplianceModule {}
