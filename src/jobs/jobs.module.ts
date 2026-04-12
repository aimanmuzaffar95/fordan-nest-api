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
import { JobSignatureRequest } from './entities/job-signature-request.entity';
import { Assignment } from '../assignments/entities/assignment.entity';
import { Battery } from '../batteries/entities/battery.entity';
import { MeterApplication } from '../metering/entities/meter-application.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Inverter } from '../inverters/entities/inverter.entity';
import { SolarPanel } from '../solar-panels/entities/solar-panel.entity';
import { User } from '../users/entities/user.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { Note } from '../notes/entities/note.entity';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoicePayment } from '../invoices/entities/invoice-payment.entity';
import { LeadCaptureInsightsService } from '../reports/lead-capture-insights.service';
import { AdminDashboardController } from '../reports/admin-dashboard.controller';
import { AdminDashboardReportsService } from '../reports/admin-dashboard.service';
import { ReportsController } from '../reports/reports.controller';
import { JobQuotationPdfService } from './job-quotation-pdf.service';
import { JobQuotationService } from './job-quotation.service';
import { JobSignaturePdfMergeService } from './job-signature-pdf-merge.service';
import { JobSignatureService } from './job-signature.service';
import { PublicSignatureController } from './public-signature.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'development-secret',
    }),
    FilesModule,
    EmailModule,
    NotificationsModule,
    TypeOrmModule.forFeature([
      Job,
      JobSignatureRequest,
      JobAuditLog,
      JobInternalComment,
      JobProposalSelection,
      MeterApplication,
      Assignment,
      Customer,
      TimelineEvent,
      User,
      Note,
      Invoice,
      InvoicePayment,
      SolarPanel,
      Inverter,
      Battery,
    ]),
  ],
  controllers: [
    JobsController,
    PublicSignatureController,
    CustomerJobsController,
    AdminDashboardController,
    ReportsController,
  ],
  providers: [
    JobsService,
    JobQuotationPdfService,
    JobQuotationService,
    JobSignaturePdfMergeService,
    JobSignatureService,
    JobAuditLogsService,
    LeadCaptureInsightsService,
    AdminDashboardReportsService,
  ],
  exports: [JobsService, JobAuditLogsService],
})
export class JobsModule {}
