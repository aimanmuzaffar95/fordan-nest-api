import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UserCredential } from './auth/entities/user-credential.entity';
import { CustomersModule } from './customers/customers.module';
import { Customer } from './customers/entities/customer.entity';
import { User } from './users/entities/user.entity';
import { InstallerModule } from './installer/installer.module';
import { JobAuditLog } from './jobs/entities/job-audit-log.entity';
import { JobsModule } from './jobs/jobs.module';
import { Job } from './jobs/entities/job.entity';
import { Invoice } from './invoices/entities/invoice.entity';
import { InvoiceItem } from './invoices/entities/invoice-item.entity';
import { InvoicePayment } from './invoices/entities/invoice-payment.entity';
import { InvoicesModule } from './invoices/invoices.module';
import { StaffRole } from './staff/entities/staff-role.entity';
import { StaffModule } from './staff/staff.module';

import { Team } from './teams/entities/team.entity';
import { Assignment } from './assignments/entities/assignment.entity';
import { MeterApplication } from './metering/entities/meter-application.entity';
import { Alert } from './alerts/entities/alert.entity';
import { File as FileEntity } from './files/entities/file.entity';
import { Note } from './notes/entities/note.entity';
import { TimelineEvent } from './timeline/entities/timeline-event.entity';
import { TeamsModule } from './teams/teams.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { ScheduleModule } from './schedule/schedule.module';
import { MeteringModule } from './metering/metering.module';
import { RuntimeSettingsModule } from './runtime-settings/runtime-settings.module';
import { PublicLeadsModule } from './public-leads/public-leads.module';
import { MailModule } from './mail/mail.module';
import { ThrottlerModule } from '@nestjs/throttler';

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
const SYNCHRONIZE = envBool(process.env.DATABASE_SYNCHRONIZE, true);

const publicLeadThrottleTtl = Number(
  process.env.PUBLIC_LEAD_THROTTLE_TTL_MS ?? '60000',
);
const publicLeadThrottleLimit = Number(
  process.env.PUBLIC_LEAD_THROTTLE_LIMIT ?? '12',
);

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
        Job,
        JobAuditLog,
        Invoice,
        InvoiceItem,
        InvoicePayment,
        StaffRole,
        Team,
        Assignment,
        MeterApplication,
        Alert,
        FileEntity,
        Note,
        TimelineEvent,
      ],
      synchronize: SYNCHRONIZE,
    }),
    AuthModule,
    CustomersModule,
    InstallerModule,
    InvoicesModule,
    JobsModule,
    StaffModule,
    TeamsModule,
    AssignmentsModule,
    ScheduleModule,
    MeteringModule,
    RuntimeSettingsModule,
    MailModule,
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: publicLeadThrottleTtl,
          limit: publicLeadThrottleLimit,
        },
      ],
    }),
    PublicLeadsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
