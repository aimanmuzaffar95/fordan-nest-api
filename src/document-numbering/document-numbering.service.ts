import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
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

      const next = `${normalized.orderPrefix}${normalized.orderNextNumber}`;
      settings.documentNumberingSettings = {
        ...normalized,
        orderNextNumber: normalized.orderNextNumber + 1,
      };
      await manager.save(settings);
      return next;
    });
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

      const next = `${normalized.invoicePrefix}${normalized.invoiceNextNumber}`;
      settings.documentNumberingSettings = {
        ...normalized,
        invoiceNextNumber: normalized.invoiceNextNumber + 1,
      };
      await manager.save(settings);
      return next;
    });
  }
}
