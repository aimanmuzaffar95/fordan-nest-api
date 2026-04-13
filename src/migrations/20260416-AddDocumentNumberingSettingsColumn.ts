import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddDocumentNumberingSettingsColumn2026041614300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('admin_settings'))) {
      return;
    }

    if (
      await queryRunner.hasColumn('admin_settings', 'documentNumberingSettings')
    ) {
      return;
    }

    const dialect = queryRunner.connection.options.type;
    const colType = dialect === 'postgres' ? 'jsonb' : 'json';

    await queryRunner.addColumn(
      'admin_settings',
      new TableColumn({
        name: 'documentNumberingSettings',
        type: colType,
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('admin_settings'))) {
      return;
    }

    if (
      await queryRunner.hasColumn('admin_settings', 'documentNumberingSettings')
    ) {
      await queryRunner.dropColumn(
        'admin_settings',
        'documentNumberingSettings',
      );
    }
  }
}
