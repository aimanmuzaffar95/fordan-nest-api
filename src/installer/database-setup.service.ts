import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import crypto from 'node:crypto';

export type PublicDatabaseState = {
  databaseReachable: boolean;
  error?: string;
  /** From DATABASE_SYNCHRONIZE — when true, TypeORM may create schema without migrations */
  databaseSynchronize: boolean;
  dialect: string;
  migrationsTableExists: boolean;
  executedMigrationCount: number;
  /** Last few migration names applied (newest last) */
  executedMigrationNamesSample: string[];
  usersTableExists: boolean;
  /** True when synchronize is off and core tables are missing → run migrations */
  needsMigration: boolean;
  /** Public read endpoint enabled (env) */
  publicDatabaseStateEnabled: boolean;
  /** POST / migrations allowed when token is configured */
  setupTokenConfigured: boolean;
};

@Injectable()
export class DatabaseSetupService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  isPublicDatabaseStateEnabled(): boolean {
    return (
      (process.env.INSTALLER_PUBLIC_DATABASE_STATE ?? '')
        .trim()
        .toLowerCase() === 'true'
    );
  }

  isSetupTokenConfigured(): boolean {
    const t = (process.env.INSTALLER_SETUP_TOKEN ?? '').trim();
    return t.length >= 16;
  }

  assertSetupToken(headerToken: string | undefined): void {
    const expected = (process.env.INSTALLER_SETUP_TOKEN ?? '').trim();
    if (expected.length < 16) {
      throw new ServiceUnavailableException(
        'INSTALLER_SETUP_TOKEN is not configured (min 16 chars).',
      );
    }
    const provided = (headerToken ?? '').trim();
    if (provided.length !== expected.length) {
      throw new UnauthorizedException('Invalid setup token.');
    }
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid setup token.');
    }
  }

  private firstQueryRow<T extends Record<string, unknown>>(
    rows: unknown,
  ): T | undefined {
    if (!Array.isArray(rows) || rows.length === 0) return undefined;
    const r: unknown = rows[0];
    if (r !== null && typeof r === 'object') return r as T;
    return undefined;
  }

  private envBool(v: string | undefined, fallback: boolean): boolean {
    if (v === undefined) return fallback;
    const s = v.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
    return fallback;
  }

  private async tableExists(tableName: string): Promise<boolean> {
    const type = this.dataSource.options.type;
    if (type === 'postgres') {
      const rows: unknown = await this.dataSource.query(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1
        ) AS ex`,
        [tableName],
      );
      const row = this.firstQueryRow<{ ex: boolean }>(rows);
      return Boolean(row?.ex);
    }
    if (type === 'mysql' || type === 'mariadb') {
      const rows: unknown = await this.dataSource.query(
        `SELECT COUNT(*) AS c FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = ?`,
        [tableName],
      );
      const row = this.firstQueryRow<{ c: number | string }>(rows);
      return Number(row?.c ?? 0) > 0;
    }
    return false;
  }

  async getPublicDatabaseState(): Promise<PublicDatabaseState> {
    const databaseSynchronize = this.envBool(
      process.env.DATABASE_SYNCHRONIZE,
      false,
    );
    const dialect = String(this.dataSource.options.type ?? 'unknown');

    const base: PublicDatabaseState = {
      databaseReachable: false,
      databaseSynchronize,
      dialect,
      migrationsTableExists: false,
      executedMigrationCount: 0,
      executedMigrationNamesSample: [],
      usersTableExists: false,
      needsMigration: false,
      publicDatabaseStateEnabled: this.isPublicDatabaseStateEnabled(),
      setupTokenConfigured: this.isSetupTokenConfigured(),
    };

    try {
      await this.dataSource.query(
        dialect === 'postgres' ? 'SELECT 1' : 'SELECT 1 AS ok',
      );
      base.databaseReachable = true;
    } catch (e) {
      base.error =
        e instanceof Error ? e.message : 'Database connection failed';
      return base;
    }

    try {
      base.migrationsTableExists = await this.tableExists('migrations');
      if (base.migrationsTableExists) {
        const rowsUnknown: unknown = await this.dataSource.query(
          'SELECT name FROM migrations ORDER BY id ASC',
        );
        const rows = Array.isArray(rowsUnknown)
          ? rowsUnknown.filter(
              (r): r is { name: unknown } =>
                r !== null &&
                typeof r === 'object' &&
                'name' in (r as Record<string, unknown>),
            )
          : [];
        base.executedMigrationCount = rows.length;
        base.executedMigrationNamesSample = rows
          .slice(-8)
          .map((r) => String(r.name));
      }
    } catch {
      base.migrationsTableExists = false;
    }

    try {
      base.usersTableExists = await this.tableExists('users');
    } catch {
      base.usersTableExists = false;
    }

    if (!databaseSynchronize) {
      base.needsMigration = !base.usersTableExists;
    } else {
      base.needsMigration = false;
    }

    return base;
  }
}
