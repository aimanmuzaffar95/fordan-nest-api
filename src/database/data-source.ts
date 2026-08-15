import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserCredential } from '../auth/entities/user-credential.entity';
import { Customer } from '../customers/entities/customer.entity';
import { CustomerAuditLog } from '../customers/entities/customer-audit-log.entity';
import { CustomerNote } from '../customers/entities/customer-note.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceActivity } from '../invoices/entities/invoice-activity.entity';
import { InvoiceItem } from '../invoices/entities/invoice-item.entity';
import { InvoicePayment } from '../invoices/entities/invoice-payment.entity';
import { Job } from '../jobs/entities/job.entity';
import { JobAuditLog } from '../jobs/entities/job-audit-log.entity';
import { JobInternalComment } from '../jobs/entities/job-internal-comment.entity';
import { JobProposalSelection } from '../jobs/entities/job-proposal-selection.entity';
import { JobSignatureRequest } from '../jobs/entities/job-signature-request.entity';
import { StaffRole } from '../staff/entities/staff-role.entity';
import { EmployeeRole } from '../staff/entities/employee-role.entity';
import { Assignment } from '../assignments/entities/assignment.entity';
import { MeterApplication } from '../metering/entities/meter-application.entity';
import { Alert } from '../alerts/entities/alert.entity';
import { File as FileEntity } from '../files/entities/file.entity';
import { Note } from '../notes/entities/note.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { EmployeeForm } from '../employee-forms/entities/employee-form.entity';
import { SolarPanel } from '../solar-panels/entities/solar-panel.entity';
import { Inverter } from '../inverters/entities/inverter.entity';
import { Battery } from '../batteries/entities/battery.entity';
import { AdminSettings } from '../runtime-settings/admin-settings.entity';
import { SettingsAuditLog } from '../runtime-settings/settings-audit-log.entity';
import { ComplianceFormTemplate } from '../compliance/entities/compliance-form-template.entity';
import { JobComplianceSubmission } from '../compliance/entities/job-compliance-submission.entity';
import { EmailTracking } from '../email/email-tracking.entity';
import { PermissionRoleGrant } from '../permissions/entities/permission-role-grant.entity';
import { PermissionRoleProfile } from '../permissions/entities/permission-role-profile.entity';
import { PermissionRoleScope } from '../permissions/entities/permission-role-scope.entity';
import { Task } from '../tasks/entities/task.entity';
import { Territory } from '../territories/entities/territory.entity';
import { TerritoryMember } from '../territories/entities/territory-member.entity';
import { LeadRoutingEvent } from '../territories/entities/lead-routing-event.entity';
import { CustomerMergeLog } from '../households/entities/customer-merge-log.entity';
import { SiteSurvey } from '../surveys/entities/site-survey.entity';
import { ProposalVersion } from '../proposals/entities/proposal-version.entity';
import { RoofDesign } from '../solar-design/entities/roof-design.entity';
import { FinancingApplication } from '../financing/entities/financing-application.entity';
import { Project } from '../projects/entities/project.entity';
import { Permit } from '../projects/entities/permit.entity';
import { ProjectMilestone } from '../projects/entities/project-milestone.entity';
import { ProjectNote } from '../projects/entities/project-note.entity';
import {
  InstallDefect,
  InstallVisit,
} from '../projects/entities/install-visit.entity';
import { CommissionEvent } from '../commission/entities/commission-event.entity';
import { PortalAccessToken } from '../customer-portal/entities/portal-access-token.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';

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

const DIALECT = getDialect();
const DB_HOST = process.env.DATABASE_HOST ?? process.env.DB_HOST ?? 'localhost';
const DB_PORT = Number(
  process.env.DATABASE_PORT ??
    process.env.DB_PORT ??
    (DIALECT === 'postgres' ? 5432 : 3306),
);
const DB_USER =
  process.env.DATABASE_USER ?? process.env.DB_USERNAME ?? 'postgres';
const DB_PASSWORD =
  process.env.DATABASE_PASSWORD ?? process.env.DB_PASSWORD ?? 'postgres';
const DB_NAME =
  process.env.DATABASE_NAME ?? process.env.DB_DATABASE ?? 'nestdb';
const DB_SOCKET_PATH = process.env.DATABASE_SOCKET_PATH?.trim() || undefined;
const SYNCHRONIZE = envBool(process.env.DATABASE_SYNCHRONIZE, false);

const argv = process.argv.join(' ').toLowerCase();
// TypeORM CLI (migration:run/generate/revert) runs under `typeorm-ts-node-*`,
// so TS migration files can be loaded safely. Other runtime entrypoints
// (e.g. seed scripts) should not import TS migrations at Node runtime.
const isMigrationCli =
  argv.includes('migration:run') ||
  argv.includes('migration:show') ||
  argv.includes('migration:generate') ||
  argv.includes('migration:revert');

export const AppDataSource = new DataSource({
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
    JobAuditLog,
    JobInternalComment,
    JobProposalSelection,
    JobSignatureRequest,
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
    ComplianceFormTemplate,
    JobComplianceSubmission,
    PermissionRoleProfile,
    PermissionRoleGrant,
    PermissionRoleScope,
    Task,
    Territory,
    TerritoryMember,
    LeadRoutingEvent,
    CustomerMergeLog,
    SiteSurvey,
    ProposalVersion,
    RoofDesign,
    FinancingApplication,
    Project,
    Permit,
    ProjectMilestone,
    ProjectNote,
    CustomerNote,
    InstallVisit,
    InstallDefect,
    CommissionEvent,
    PortalAccessToken,
    CommunicationLog,
  ],
  migrations: isMigrationCli
    ? ['src/migrations/*.ts']
    : ['dist/migrations/*.js'],
  synchronize: SYNCHRONIZE,
  migrationsRun: false,
});
