import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UserCredential } from './auth/entities/user-credential.entity';
import { CustomersModule } from './customers/customers.module';
import { Customer } from './customers/entities/customer.entity';
import { CustomerAuditLog } from './customers/entities/customer-audit-log.entity';
import { User } from './users/entities/user.entity';
import { InstallerModule } from './installer/installer.module';
import { JobAuditLog } from './jobs/entities/job-audit-log.entity';
import { JobInternalComment } from './jobs/entities/job-internal-comment.entity';
import { JobProposalSelection } from './jobs/entities/job-proposal-selection.entity';
import { JobsModule } from './jobs/jobs.module';
import { Job } from './jobs/entities/job.entity';
import { JobSignatureRequest } from './jobs/entities/job-signature-request.entity';
import { Invoice } from './invoices/entities/invoice.entity';
import { InvoiceActivity } from './invoices/entities/invoice-activity.entity';
import { InvoiceItem } from './invoices/entities/invoice-item.entity';
import { InvoicePayment } from './invoices/entities/invoice-payment.entity';
import { InvoicesModule } from './invoices/invoices.module';
import { StaffRole } from './staff/entities/staff-role.entity';
import { EmployeeRole } from './staff/entities/employee-role.entity';
import { StaffModule } from './staff/staff.module';

import { Assignment } from './assignments/entities/assignment.entity';
import { MeterApplication } from './metering/entities/meter-application.entity';
import { Alert } from './alerts/entities/alert.entity';
import { File as FileEntity } from './files/entities/file.entity';
import { Note } from './notes/entities/note.entity';
import { TimelineEvent } from './timeline/entities/timeline-event.entity';
import { AssignmentsModule } from './assignments/assignments.module';
import { ScheduleModule } from './schedule/schedule.module';
import { MeteringModule } from './metering/metering.module';
import { RuntimeSettingsModule } from './runtime-settings/runtime-settings.module';
import { McpAccessModule } from './mcp-access/mcp-access.module';
import { McpAccessKey } from './mcp-access/entities/mcp-access-key.entity';
import { PublicLeadsModule } from './public-leads/public-leads.module';
import { EmailModule } from './email/email.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { EmployeeFormsModule } from './employee-forms/employee-forms.module';
import { EmployeeForm } from './employee-forms/entities/employee-form.entity';
import { SolarPanelsModule } from './solar-panels/solar-panels.module';
import { SolarPanel } from './solar-panels/entities/solar-panel.entity';
import { InvertersModule } from './inverters/inverters.module';
import { Inverter } from './inverters/entities/inverter.entity';
import { BatteriesModule } from './batteries/batteries.module';
import { Battery } from './batteries/entities/battery.entity';
import { AdminSettings } from './runtime-settings/admin-settings.entity';
import { SettingsAuditLog } from './runtime-settings/settings-audit-log.entity';
import { ComplianceModule } from './compliance/compliance.module';
import { ComplianceFormTemplate } from './compliance/entities/compliance-form-template.entity';
import { JobComplianceSubmission } from './compliance/entities/job-compliance-submission.entity';
import { JobCecItemTick } from './compliance/entities/job-cec-item-tick.entity';
import { AlertsModule } from './alerts/alerts.module';
import { Notification } from './notifications/entities/notification.entity';
import { NotificationsModule } from './notifications/notifications.module';
import { EmailTracking } from './email/email-tracking.entity';
import { OrganizationProfile } from './organization-profile/organization-profile.entity';
import { SystemAuditLog } from './system-audit/entities/system-audit-log.entity';
import { OrganizationProfileModule } from './organization-profile/organization-profile.module';
import { PermissionRoleGrant } from './permissions/entities/permission-role-grant.entity';
import { PermissionRoleProfile } from './permissions/entities/permission-role-profile.entity';
import { PermissionRoleScope } from './permissions/entities/permission-role-scope.entity';
import { PermissionsModule } from './permissions/permissions.module';
import { AttendanceModule } from './attendance/attendance.module';
import { AttendanceRecord } from './attendance/entities/attendance-record.entity';
import { AvailabilityModule } from './availability/availability.module';
import { StaffAvailability } from './availability/entities/staff-availability.entity';
import { MobileModule } from './mobile/mobile.module';
import { EquipmentModule } from './equipment/equipment.module';
import { EquipmentItem } from './equipment/entities/equipment-item.entity';
import { DevicesModule } from './devices/devices.module';
import { DeviceRegistration } from './devices/entities/device-registration.entity';
import { DocumentsModule } from './documents/documents.module';
import { JobGeneratedDocument } from './documents/entities/job-generated-document.entity';
import { JobDocumentSignRequest } from './documents/entities/job-document-sign-request.entity';
import { MailModule } from './mail/mail.module';
import { LinkedMailbox } from './mail/linked-mailbox.entity';
import { MailMessage } from './mail/mail-message.entity';
import { loadEnvFile } from './common/load-env.util';
import { getSettingsEncryptionKey } from './common/crypto.util';

loadEnvFile();

const envBool = (v: string | undefined, fallback = false): boolean => {
  if (v === undefined) return fallback;
  const s = v.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  return fallback;
};

type DbDialect = 'postgres' | 'mysql' | 'mariadb';
const getDialect = (): DbDialect => {
  const raw =
    process.env.DB_DIALECT ??
    process.env.DATABASE_DIALECT ??
    process.env.TYPEORM_CONNECTION ??
    'postgres';
  const v = raw.trim().toLowerCase();
  if (v === 'mysql') return 'mysql';
  if (v === 'mariadb' || v === 'maria' || v === 'maria-db') return 'mariadb';
  return 'postgres';
};

const getDefaultPort = (dialect: DbDialect): number => {
  if (dialect === 'postgres') return 5432;
  return 3306;
};

const DIALECT = getDialect();
const DB_HOST = process.env.DATABASE_HOST ?? process.env.DB_HOST ?? 'localhost';
const DB_PORT = Number(
  process.env.DATABASE_PORT ?? process.env.DB_PORT ?? getDefaultPort(DIALECT),
);
const DB_USER =
  process.env.DATABASE_USER ?? process.env.DB_USERNAME ?? 'postgres';
const DB_PASSWORD =
  process.env.DATABASE_PASSWORD ?? process.env.DB_PASSWORD ?? 'postgres';
const DB_NAME =
  process.env.DATABASE_NAME ?? process.env.DB_DATABASE ?? 'nestdb';
const DB_SOCKET_PATH = process.env.DATABASE_SOCKET_PATH?.trim() || undefined;
const IS_PRODUCTION =
  (process.env.NODE_ENV ?? 'development').trim().toLowerCase() === 'production';
// Auto schema-sync is a data-loss hazard against a live database; production
// must opt in explicitly and should rely on migrations instead.
const SYNCHRONIZE = envBool(process.env.DATABASE_SYNCHRONIZE, !IS_PRODUCTION);
const MIGRATIONS_RUN = envBool(
  process.env.DATABASE_MIGRATIONS_RUN,
  !SYNCHRONIZE,
);
const MIGRATION_PATHS = __filename.endsWith('.ts')
  ? ['src/migrations/*.ts']
  : ['dist/migrations/*.js'];

const publicLeadThrottleTtl = Number(
  process.env.PUBLIC_LEAD_THROTTLE_TTL_MS ?? '60000',
);
const publicLeadThrottleLimit = Number(
  process.env.PUBLIC_LEAD_THROTTLE_LIMIT ?? '12',
);

getSettingsEncryptionKey();

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: DIALECT,
      host: DB_HOST,
      ...(DB_SOCKET_PATH && (DIALECT === 'mysql' || DIALECT === 'mariadb')
        ? {}
        : { port: DB_PORT }),
      username: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      ssl:
        DIALECT === 'postgres' && envBool(process.env.DATABASE_SSL, false)
          ? {
              rejectUnauthorized: envBool(
                process.env.DATABASE_SSL_REJECT_UNAUTHORIZED,
                true,
              ),
            }
          : undefined,
      ...(DB_SOCKET_PATH && (DIALECT === 'mysql' || DIALECT === 'mariadb')
        ? { extra: { socketPath: DB_SOCKET_PATH } }
        : {}),
      entities: [
        User,
        UserCredential,
        Customer,
        CustomerAuditLog,
        Job,
        JobSignatureRequest,
        JobAuditLog,
        JobInternalComment,
        JobProposalSelection,
        Invoice,
        InvoiceActivity,
        InvoiceItem,
        InvoicePayment,
        StaffRole,
        EmployeeRole,
        Assignment,
        MeterApplication,
        Alert,
        FileEntity,
        Note,
        TimelineEvent,
        EmployeeForm,
        SolarPanel,
        Inverter,
        Battery,
        AdminSettings,
        SettingsAuditLog,
        EmailTracking,
        Notification,
        ComplianceFormTemplate,
        JobComplianceSubmission,
        JobCecItemTick,
        OrganizationProfile,
        SystemAuditLog,
        PermissionRoleProfile,
        PermissionRoleGrant,
        PermissionRoleScope,
        AttendanceRecord,
        StaffAvailability,
        EquipmentItem,
        DeviceRegistration,
        JobGeneratedDocument,
        JobDocumentSignRequest,
        McpAccessKey,
        LinkedMailbox,
        MailMessage,
      ],
      migrations: MIGRATION_PATHS,
      synchronize: SYNCHRONIZE,
      migrationsRun: MIGRATIONS_RUN,
    }),
    AuthModule,
    CustomersModule,
    InstallerModule,
    InvoicesModule,
    JobsModule,
    StaffModule,
    AssignmentsModule,
    ScheduleModule,
    MeteringModule,
    RuntimeSettingsModule,
    McpAccessModule,
    OrganizationProfileModule,
    EmployeeFormsModule,
    SolarPanelsModule,
    InvertersModule,
    BatteriesModule,
    EmailModule,
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: publicLeadThrottleTtl,
          limit: publicLeadThrottleLimit,
        },
      ],
    }),
    PublicLeadsModule,
    AlertsModule,
    NotificationsModule,
    ComplianceModule,
    PermissionsModule,
    AttendanceModule,
    AvailabilityModule,
    MobileModule,
    EquipmentModule,
    DevicesModule,
    DocumentsModule,
    MailModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
