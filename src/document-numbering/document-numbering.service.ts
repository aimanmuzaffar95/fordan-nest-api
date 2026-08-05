import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  AdminSettings,
  ADMIN_SETTINGS_SINGLETON_ID,
} from '../runtime-settings/admin-settings.entity';
import { mergeDocumentNumberingSettings } from './document-numbering.merge';
import {
  normalizeDocumentNumberingSettings,
  validateDocumentNumberingSettings,
} from './document-numbering.validate';

@Injectable()
export class DocumentNumberingService {
  constructor(private readonly dataSource: DataSource) {}

  /** sqljs/sqlite (in-memory tests) don't support row locks; they're also
   *  single-connection, so the transaction alone is sufficient there. */
  private get lockOptions() {
    const driver = this.dataSource.options.type;
    return driver === 'sqljs' || driver === 'sqlite'
      ? {}
      : { lock: { mode: 'pessimistic_write' as const } };
  }

  async allocateNextOrderNumber(): Promise<string> {
    return this.dataSource.transaction(async (manager) => {
      const settings = await manager.findOne(AdminSettings, {
        where: { id: ADMIN_SETTINGS_SINGLETON_ID },
        ...this.lockOptions,
      });
      if (!settings) {
        throw new BadRequestException('Global settings row is missing');
      }

      const current = mergeDocumentNumberingSettings(
        settings.documentNumberingSettings,
      );
      const normalized = normalizeDocumentNumberingSettings(current);
      validateDocumentNumberingSettings(normalized);

      // The counter lives in settings and knows nothing about the rows already
      // in `jobs`. When the settings JSON is absent or reset it falls back to
      // the default 1001, and if orders already exist at those numbers every
      // insert dies on the unique index — a hard 500 on "save job", advancing
      // one number per attempt and colliding again. Reconcile against reality
      // before handing a number out.
      const highestUsed = await this.highestUsedNumber(
        manager,
        'jobs',
        'orderNumber',
        normalized.orderPrefix,
      );
      const nextNumber = Math.max(normalized.orderNextNumber, highestUsed + 1);

      const next = `${normalized.orderPrefix}${nextNumber}`;
      settings.documentNumberingSettings = {
        ...normalized,
        orderNextNumber: nextNumber + 1,
      };
      await manager.save(settings);
      return next;
    });
  }

  /**
   * Highest numeric suffix already used for `prefix` in `table.column`, or 0.
   *
   * Reads the matching values and maxes them in JS rather than casting in SQL,
   * because the cast syntax differs between Postgres and MariaDB. These tables
   * are small (thousands of rows at most) and this runs once per allocation
   * inside an already-locked transaction.
   */
  private async highestUsedNumber(
    manager: EntityManager,
    table: string,
    column: string,
    prefix: string,
  ): Promise<number> {
    const quote = (id: string) =>
      manager.connection.driver.escape
        ? manager.connection.driver.escape(id)
        : id;

    const rows: Array<Record<string, string | null>> = await manager.query(
      `SELECT ${quote(column)} AS value FROM ${quote(table)} WHERE ${quote(column)} LIKE ?`.replace(
        '?',
        manager.connection.options.type === 'postgres' ? '$1' : '?',
      ),
      [`${prefix}%`],
    );

    let highest = 0;
    for (const row of rows) {
      const value = row.value;
      if (typeof value !== 'string') continue;
      const parsed = Number.parseInt(value.slice(prefix.length), 10);
      if (Number.isFinite(parsed) && parsed > highest) highest = parsed;
    }
    return highest;
  }

  async allocateNextInvoiceNumber(): Promise<string> {
    return this.dataSource.transaction(async (manager) => {
      const settings = await manager.findOne(AdminSettings, {
        where: { id: ADMIN_SETTINGS_SINGLETON_ID },
        ...this.lockOptions,
      });
      if (!settings) {
        throw new BadRequestException('Global settings row is missing');
      }

      const current = mergeDocumentNumberingSettings(
        settings.documentNumberingSettings,
      );
      const normalized = normalizeDocumentNumberingSettings(current);
      validateDocumentNumberingSettings(normalized);

      // Same reconciliation as orders — invoice numbers carry the same unique
      // index and the same "counter reset while rows already exist" failure.
      const highestUsed = await this.highestUsedNumber(
        manager,
        'invoices',
        'invoiceNumber',
        normalized.invoicePrefix,
      );
      const nextNumber = Math.max(
        normalized.invoiceNextNumber,
        highestUsed + 1,
      );

      const next = `${normalized.invoicePrefix}${nextNumber}`;
      settings.documentNumberingSettings = {
        ...normalized,
        invoiceNextNumber: nextNumber + 1,
      };
      await manager.save(settings);
      return next;
    });
  }
}
