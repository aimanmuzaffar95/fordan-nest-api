import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserCredential } from '../auth/entities/user-credential.entity';
import { Customer } from '../customers/entities/customer.entity';
import { JobAuditLog } from '../jobs/entities/job-audit-log.entity';
import { Job } from '../jobs/entities/job.entity';

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
  entities: [User, UserCredential, Customer, Job, JobAuditLog],
  migrations: ['dist/migrations/*.js'],
  synchronize: SYNCHRONIZE,
  migrationsRun: false,
});
