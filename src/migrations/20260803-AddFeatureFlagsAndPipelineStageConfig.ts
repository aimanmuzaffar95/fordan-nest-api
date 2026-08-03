import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * PRD v2 Phase 0 — settings-backed feature flags + configurable pipeline
 * stage templates. Both are additive nullable JSON columns; code merges
 * stored JSON with defaults, so existing rows behave exactly as before.
 */
export class AddFeatureFlagsAndPipelineStageConfig20260803_1700000001500 implements MigrationInterface {
  private readonly columns = ['featureFlags', 'pipelineStageConfig'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('admin_settings'))) {
      return;
    }

    const dialect = queryRunner.connection.options.type;
    const colType = dialect === 'postgres' ? 'jsonb' : 'json';

    for (const name of this.columns) {
      if (await queryRunner.hasColumn('admin_settings', name)) {
        continue;
      }
      await queryRunner.addColumn(
        'admin_settings',
        new TableColumn({ name, type: colType, isNullable: true }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('admin_settings'))) {
      return;
    }
    for (const name of this.columns) {
      if (await queryRunner.hasColumn('admin_settings', name)) {
        await queryRunner.dropColumn('admin_settings', name);
      }
    }
  }
}
