import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddBillingSettingsColumn20260416_1700000000902 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('admin_settings'))) {
      return;
    }

    if (await queryRunner.hasColumn('admin_settings', 'billingSettings')) {
      return;
    }

    const dialect = queryRunner.connection.options.type;
    const colType = dialect === 'postgres' ? 'jsonb' : 'json';

    await queryRunner.addColumn(
      'admin_settings',
      new TableColumn({
        name: 'billingSettings',
        type: colType,
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('admin_settings'))) {
      return;
    }

    if (await queryRunner.hasColumn('admin_settings', 'billingSettings')) {
      await queryRunner.dropColumn('admin_settings', 'billingSettings');
    }
  }
}
