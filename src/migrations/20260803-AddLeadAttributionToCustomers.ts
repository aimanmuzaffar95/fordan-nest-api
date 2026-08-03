import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';
import {
  resolveUuidColumn,
  type UuidColumnSpec,
} from '../common/migration-uuid.util';

type LeadMetaBlob = {
  formSlug?: unknown;
  utmSource?: unknown;
  utmMedium?: unknown;
  utmCampaign?: unknown;
  pageReferrer?: unknown;
  selfReportedSource?: unknown;
};

/**
 * PRD v2 Phase 0 — first-class lead attribution on `customers`.
 *
 * `up` also backfills from the `__FORDAN_LEAD_META__{...}` JSON line the
 * public lead form used to write into a job note. The note is left alone: it
 * remains the human-readable record, and leaving it means this migration can
 * be re-run or rolled back without losing anything.
 */
export class AddLeadAttributionToCustomers20260803_1700000001700 implements MigrationInterface {
  /** Built per dialect: `leadOwnerUserId` must match the id convention on disk. */
  private columnsFor(uuidCol: UuidColumnSpec): Array<{
    name: string;
    type: string;
    length?: string;
    charset?: string;
    collation?: string;
  }> {
    return [
      { name: 'leadSource', type: 'varchar', length: '60' },
      { name: 'leadMedium', type: 'varchar', length: '60' },
      { name: 'leadCampaign', type: 'varchar', length: '120' },
      { name: 'leadFormSlug', type: 'varchar', length: '60' },
      { name: 'leadPageReferrer', type: 'text' },
      { name: 'leadSelfReportedSource', type: 'varchar', length: '120' },
      { name: 'leadOwnerUserId', ...uuidCol },
    ];
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('customers'))) return;

    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const uuidCol = await resolveUuidColumn(queryRunner);

    for (const col of this.columnsFor(uuidCol)) {
      if (await queryRunner.hasColumn('customers', col.name)) continue;
      await queryRunner.addColumn(
        'customers',
        new TableColumn({
          name: col.name,
          type: col.type,
          ...(col.length ? { length: col.length } : {}),
          ...(col.charset ? { charset: col.charset } : {}),
          ...(col.collation ? { collation: col.collation } : {}),
          isNullable: true,
        }),
      );
    }

    if (!(await queryRunner.hasColumn('customers', 'leadCapturedAt'))) {
      await queryRunner.addColumn(
        'customers',
        new TableColumn({
          name: 'leadCapturedAt',
          type: isPostgres ? 'timestamp' : 'datetime',
          isNullable: true,
        }),
      );
    }

    if (!(await queryRunner.hasColumn('customers', 'leadOwnershipHistory'))) {
      await queryRunner.addColumn(
        'customers',
        new TableColumn({
          name: 'leadOwnershipHistory',
          type: isPostgres ? 'jsonb' : 'json',
          isNullable: true,
        }),
      );
    }

    await this.backfill(queryRunner);
  }

  /**
   * Seed the new columns from existing data. Only fills nulls, so re-running
   * never clobbers values an operator has since corrected by hand.
   */
  private async backfill(queryRunner: QueryRunner): Promise<void> {
    const q = (sql: string) =>
      queryRunner.query(
        queryRunner.connection.options.type === 'postgres'
          ? sql
          : sql.replace(/"/g, '`'),
      );

    // 1. Everyone gets a capture timestamp from the row they already had.
    await q(
      `UPDATE customers SET "leadCapturedAt" = "createdAt" WHERE "leadCapturedAt" IS NULL`,
    );

    // 2. Parse the public-form meta blob out of job notes. Runs BEFORE the
    //    acquisitionSource fallback below, because the tracked `utm_source` is
    //    more specific than the coarse acquisition bucket and every write here
    //    is a COALESCE that only fills nulls.
    //
    //    Done in JS rather than SQL: the blob is an embedded JSON line inside
    //    free text and the two dialects share no way to pull it out.
    if (await queryRunner.hasTable('notes')) {
      await this.backfillFromNotes(queryRunner, q);
    }

    // 3. Anything still without a source falls back to the coarse bucket.
    await q(
      `UPDATE customers SET "leadSource" = "acquisitionSource" WHERE "leadSource" IS NULL AND "acquisitionSource" IS NOT NULL`,
    );
  }

  private async backfillFromNotes(
    queryRunner: QueryRunner,
    q: (sql: string) => Promise<unknown>,
  ): Promise<void> {
    const rows = (await q(
      `SELECT j."customerId" AS "customerId", n."body" AS "body"
         FROM notes n
         JOIN jobs j ON j."id" = n."jobId"
        WHERE n."body" LIKE '%__FORDAN_LEAD_META__%'`,
    )) as Array<{ customerId: string; body: string }>;

    const seen = new Set<string>();
    for (const row of rows) {
      if (!row?.customerId || seen.has(row.customerId)) continue;
      const meta = this.parseMeta(row.body);
      if (!meta) continue;
      seen.add(row.customerId);

      const str = (v: unknown, max: number): string | null => {
        if (typeof v !== 'string') return null;
        const trimmed = v.trim();
        return trimmed === '' ? null : trimmed.slice(0, max);
      };

      const values = {
        leadSource: str(meta.utmSource, 60),
        leadMedium: str(meta.utmMedium, 60),
        leadCampaign: str(meta.utmCampaign, 120),
        leadFormSlug: str(meta.formSlug, 60),
        leadPageReferrer: str(meta.pageReferrer, 500),
        leadSelfReportedSource: str(meta.selfReportedSource, 120),
      };

      const entries = Object.entries(values).filter(([, v]) => v !== null);
      if (entries.length === 0) continue;

      const isPostgres = queryRunner.connection.options.type === 'postgres';
      const quote = (name: string) =>
        isPostgres ? `"${name}"` : `\`${name}\``;
      const assignments = entries
        .map(([name], i) => {
          const param = isPostgres ? `$${i + 1}` : '?';
          // COALESCE keeps any value already set (idempotent re-runs).
          return `${quote(name)} = COALESCE(${quote(name)}, ${param})`;
        })
        .join(', ');
      const idParam = isPostgres ? `$${entries.length + 1}` : '?';

      await queryRunner.query(
        `UPDATE ${quote('customers')} SET ${assignments} WHERE ${quote('id')} = ${idParam}`,
        [...entries.map(([, v]) => v), row.customerId],
      );
    }
  }

  private parseMeta(body: string): LeadMetaBlob | null {
    const marker = '__FORDAN_LEAD_META__';
    const start = body.indexOf(marker);
    if (start === -1) return null;
    const line = body
      .slice(start + marker.length)
      .split('\n')[0]
      ?.trim();
    if (!line) return null;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      return parsed as LeadMetaBlob;
    } catch {
      return null;
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('customers'))) return;
    const names = [
      ...this.columnsFor({ type: 'uuid' }).map((c) => c.name),
      'leadCapturedAt',
      'leadOwnershipHistory',
    ];
    for (const name of names) {
      if (await queryRunner.hasColumn('customers', name)) {
        await queryRunner.dropColumn('customers', name);
      }
    }
  }
}
