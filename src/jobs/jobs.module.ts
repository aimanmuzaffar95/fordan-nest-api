import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesModule } from '../files/files.module';
import { CustomerJobsController } from './customer-jobs.controller';
import { JobAuditLogsService } from './job-audit-logs.service';
import { JobAuditLog } from './entities/job-audit-log.entity';
import { JobInternalComment } from './entities/job-internal-comment.entity';
import { JobProposalSelection } from './entities/job-proposal-selection.entity';
import { Job } from './entities/job.entity';
import { Assignment } from '../assignments/entities/assignment.entity';
import { Battery } from '../batteries/entities/battery.entity';
import { MeterApplication } from '../metering/entities/meter-application.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Inverter } from '../inverters/entities/inverter.entity';
import { SolarPanel } from '../solar-panels/entities/solar-panel.entity';
import { Team } from '../teams/entities/team.entity';
import { User } from '../users/entities/user.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { Note } from '../notes/entities/note.entity';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { Invoice } from '../invoices/entities/invoice.entity';
import { LeadCaptureInsightsService } from '../reports/lead-capture-insights.service';
import { AdminDashboardController } from '../reports/admin-dashboard.controller';
import { AdminDashboardReportsService } from '../reports/admin-dashboard.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'development-secret',
    }),
    FilesModule,
    TypeOrmModule.forFeature([
      Job,
      JobAuditLog,
      JobInternalComment,
      JobProposalSelection,
      MeterApplication,
      Assignment,
      Customer,
      Team,
      TimelineEvent,
      User,
      Note,
      Invoice,
      SolarPanel,
      Inverter,
      Battery,
    ]),
  ],
  controllers: [
    JobsController,
    CustomerJobsController,
    AdminDashboardController,
  ],
  providers: [
    JobsService,
    JobAuditLogsService,
    LeadCaptureInsightsService,
    AdminDashboardReportsService,
  ],
  exports: [JobsService, JobAuditLogsService],
})
export class JobsModule {}
