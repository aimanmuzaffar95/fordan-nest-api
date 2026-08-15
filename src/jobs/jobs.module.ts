import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { resolveJwtSecret } from '../auth/jwt-secret.util';
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
import { AttendanceRecord } from '../attendance/entities/attendance-record.entity';
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
import { InstallerReportsService } from '../reports/installer-reports.service';
import { ReportsController } from '../reports/reports.controller';
import { JobQuotationPdfService } from './job-quotation-pdf.service';
import { JobQuotationService } from './job-quotation.service';
import { JobSignaturePdfMergeService } from './job-signature-pdf-merge.service';
import { JobSignatureService } from './job-signature.service';
import { PublicSignatureController } from './public-signature.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailModule } from '../email/email.module';
import { RuntimeSettingsModule } from '../runtime-settings/runtime-settings.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { TasksModule } from '../tasks/tasks.module';
import { ProjectsModule } from '../projects/projects.module';
import { RoofDesign } from '../solar-design/entities/roof-design.entity';
import { RoofDesignService } from '../solar-design/roof-design.service';
import { RoofDesignRenderCompositeService } from '../solar-design/roof-design-render-composite.service';
import { SolarTileProxyService } from '../solar-design/solar-tile-proxy.service';
import { SolarImageryService } from '../solar-design/solar-imagery.service';
import { ProposalVersion } from '../proposals/entities/proposal-version.entity';
// Not importing `ProposalsModule` here: SolarDesignModule already imports
// JobsModule and ProposalsModule imports SolarDesignModule, so that would
// close a cycle. Following the existing pattern in this file (RoofDesign
// entity/services are independently re-provided rather than imported via
// SolarDesignModule), ProposalsService is re-provided directly below with
// its own `ProposalVersion`/`TimelineEvent` repositories (already
// registered in this module's `TypeOrmModule.forFeature`).
import { ProposalsService } from '../proposals/proposals.service';
import { RoofProposalPdfService } from './roof-proposal-pdf.service';
import { RoofProposalService } from './roof-proposal.service';
import { JobProposalSendService } from './job-proposal-send.service';

@Module({
  imports: [
    JwtModule.register({
      secret: resolveJwtSecret(),
    }),
    FilesModule,
    EmailModule,
    RuntimeSettingsModule,
    NotificationsModule,
    PermissionsModule,
    TasksModule,
    ProjectsModule,
    TypeOrmModule.forFeature([
      Job,
      JobSignatureRequest,
      JobAuditLog,
      JobInternalComment,
      JobProposalSelection,
      MeterApplication,
      Assignment,
      AttendanceRecord,
      Customer,
      TimelineEvent,
      User,
      Note,
      Invoice,
      InvoicePayment,
      SolarPanel,
      Inverter,
      Battery,
      RoofDesign,
      ProposalVersion,
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
    InstallerReportsService,
    RoofDesignService,
    RoofDesignRenderCompositeService,
    SolarTileProxyService,
    SolarImageryService,
    RoofProposalPdfService,
    RoofProposalService,
    ProposalsService,
    JobProposalSendService,
  ],
  exports: [JobsService, JobAuditLogsService],
})
export class JobsModule {}
