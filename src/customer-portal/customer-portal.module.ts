import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { Project } from '../projects/entities/project.entity';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { ComplaintsModule } from '../complaints/complaints.module';
import { JobsModule } from '../jobs/jobs.module';
import { FilesModule } from '../files/files.module';
import { SolarDesignModule } from '../solar-design/solar-design.module';
import { User } from '../users/entities/user.entity';
import { AttendanceRecord } from '../attendance/entities/attendance-record.entity';
import { Assignment } from '../assignments/entities/assignment.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { ProposalVersion } from '../proposals/entities/proposal-version.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { PortalAccessToken } from './entities/portal-access-token.entity';
import {
  CustomerPortalAdminController,
  CustomerPortalPublicController,
} from './customer-portal.controller';
import { CustomerPortalService } from './customer-portal.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PortalAccessToken,
      Job,
      Customer,
      Project,
      TimelineEvent,
      Invoice,
      ProposalVersion,
      User,
      AttendanceRecord,
      Assignment,
    ]),
    RuntimeSettingsModule,
    ComplaintsModule,
    JobsModule,
    FilesModule,
    SolarDesignModule,
  ],
  controllers: [CustomerPortalAdminController, CustomerPortalPublicController],
  providers: [CustomerPortalService],
  exports: [CustomerPortalService],
})
export class CustomerPortalModule {}
