import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';
import { resolveUuidColumn } from '../common/migration-uuid.util';

/**
 * Solar Design Studio (P1, `docs/specs/solar-design-studio.md`):
 *
 * - `roof_designs` — one row per job holding the live (unsent) design
 *   document (`doc`, json/jsonb) plus a link to the last rendered PNG. A
 *   `ProposalVersion` freezes a copy into `systemSnapshot.roofDesign` at send
 *   time, so this row may keep changing without mutating a sent proposal.
 * - `solar_panels.widthMm` / `heightMm` — numeric physical panel dimensions
 *   for panel-placement geometry; the existing free-text `dimensions` column
 *   is untouched and stays for display.
 */
export class CreateRoofDesignsAndPanelDimensions20260815_1700000002800 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const uuidCol = await resolveUuidColumn(queryRunner);
    const uuidDefault = isPostgres ? { default: 'uuid_generate_v4()' } : {};
    const ts = isPostgres ? 'timestamp' : 'datetime';
    const json = isPostgres ? 'jsonb' : 'json';

    if (!(await queryRunner.hasTable('roof_designs'))) {
      await queryRunner.createTable(
        new Table({
          name: 'roof_designs',
          columns: [
            {
              name: 'id',
              ...uuidCol,
              isPrimary: true,
              generationStrategy: 'uuid',
              ...uuidDefault,
            },
            { name: 'jobId', ...uuidCol },
            { name: 'doc', type: json },
            { name: 'renderFileId', ...uuidCol, isNullable: true },
            { name: 'updatedByUserId', ...uuidCol, isNullable: true },
            { name: 'createdAt', type: ts, default: 'now()' },
            { name: 'updatedAt', type: ts, default: 'now()' },
          ],
          foreignKeys: [
            {
              columnNames: ['jobId'],
              referencedTableName: 'jobs',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            },
            {
              columnNames: ['renderFileId'],
              referencedTableName: 'files',
              referencedColumnNames: ['id'],
              onDelete: 'SET NULL',
            },
          ],
        }),
      );

      await queryRunner.createIndex(
        'roof_designs',
        new TableIndex({
          name: 'uq_roof_designs_job',
          columnNames: ['jobId'],
          isUnique: true,
        }),
      );
    }

    const hasWidth = await queryRunner.hasColumn('solar_panels', 'widthMm');
    if (!hasWidth) {
      await queryRunner.query(
        isPostgres
          ? `ALTER TABLE "solar_panels" ADD COLUMN "widthMm" numeric(8,1) NULL`
          : `ALTER TABLE \`solar_panels\` ADD COLUMN \`widthMm\` DECIMAL(8,1) NULL`,
      );
    }

    const hasHeight = await queryRunner.hasColumn('solar_panels', 'heightMm');
    if (!hasHeight) {
      await queryRunner.query(
        isPostgres
          ? `ALTER TABLE "solar_panels" ADD COLUMN "heightMm" numeric(8,1) NULL`
          : `ALTER TABLE \`solar_panels\` ADD COLUMN \`heightMm\` DECIMAL(8,1) NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';

    if (await queryRunner.hasTable('roof_designs')) {
      await queryRunner.dropTable('roof_designs');
    }
    if (await queryRunner.hasColumn('solar_panels', 'heightMm')) {
      await queryRunner.query(
        isPostgres
          ? `ALTER TABLE "solar_panels" DROP COLUMN "heightMm"`
          : `ALTER TABLE \`solar_panels\` DROP COLUMN \`heightMm\``,
      );
    }
    if (await queryRunner.hasColumn('solar_panels', 'widthMm')) {
      await queryRunner.query(
        isPostgres
          ? `ALTER TABLE "solar_panels" DROP COLUMN "widthMm"`
          : `ALTER TABLE \`solar_panels\` DROP COLUMN \`widthMm\``,
      );
    }
  }
}
