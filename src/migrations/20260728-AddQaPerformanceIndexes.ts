import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

/**
 * QA performance indexes (BE-INFRA-02/03):
 *  - alerts(jobId), alerts(resolvedAt) — alert lookups/filtering by job and
 *    resolution state.
 *  - equipment_items(category), equipment_items(sku) — catalogue filtering and
 *    SKU lookups. The SKU index is intentionally NON-unique: existing rows may
 *    contain duplicate SKUs, so a unique constraint could fail to apply.
 *
 * Each index is created only when its table exists and the index is not
 * already present, so re-running the migration is safe.
 */
export class AddQaPerformanceIndexes20260728_1700000000900 implements MigrationInterface {
  private readonly indexes: Array<{
    table: string;
    name: string;
    columnNames: string[];
  }> = [
    { table: 'alerts', name: 'idx_alerts_job_id', columnNames: ['jobId'] },
    {
      table: 'alerts',
      name: 'idx_alerts_resolved_at',
      columnNames: ['resolvedAt'],
    },
    {
      table: 'equipment_items',
      name: 'idx_equipment_items_category',
      columnNames: ['category'],
    },
    {
      table: 'equipment_items',
      name: 'idx_equipment_items_sku',
      columnNames: ['sku'],
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { table, name, columnNames } of this.indexes) {
      if (!(await queryRunner.hasTable(table))) {
        continue;
      }
      const existing = await queryRunner.getTable(table);
      if (existing?.indices.some((idx) => idx.name === name)) {
        continue;
      }
      try {
        await queryRunner.createIndex(
          table,
          new TableIndex({ name, columnNames }),
        );
      } catch {
        // Index may already exist (race / prior partial run) — safe to ignore.
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { table, name } of this.indexes) {
      if (!(await queryRunner.hasTable(table))) {
        continue;
      }
      const existing = await queryRunner.getTable(table);
      if (!existing?.indices.some((idx) => idx.name === name)) {
        continue;
      }
      try {
        await queryRunner.dropIndex(table, name);
      } catch {
        // Already dropped — safe to ignore.
      }
    }
  }
}
