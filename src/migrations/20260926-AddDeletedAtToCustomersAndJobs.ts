import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';
import { resolveTimestampColumnType } from '../common/timestamp-column-type.util';

/**
 * Soft delete for customers and jobs: nullable `deletedAt` (TypeORM
 * @DeleteDateColumn). No backfill — every existing row stays visible.
 *
 * cPanel/MariaDB: apply scripts/sql/2026-09-soft-delete-mariadb.sql instead.
 */
export class AddDeletedAtToCustomersAndJobs20260926_1700000006100 implements MigrationInterface {
  private readonly tables = ['customers', 'jobs'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tables) {
      if (!(await queryRunner.hasTable(table))) continue;
      if (await queryRunner.hasColumn(table, 'deletedAt')) continue;
      await queryRunner.addColumn(
        table,
        new TableColumn({
          name: 'deletedAt',
          type: resolveTimestampColumnType(),
          isNullable: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tables) {
      if (!(await queryRunner.hasTable(table))) continue;
      if (!(await queryRunner.hasColumn(table, 'deletedAt'))) continue;
      await queryRunner.dropColumn(table, 'deletedAt');
    }
  }
}
