import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddCompanyProfileSettingsColumn20260416_1700000000901 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('admin_settings'))) {
      return;
    }

    if (
      await queryRunner.hasColumn('admin_settings', 'companyProfileSettings')
    ) {
      return;
    }

    const dialect = queryRunner.connection.options.type;
    const colType = dialect === 'postgres' ? 'jsonb' : 'json';

    await queryRunner.addColumn(
      'admin_settings',
      new TableColumn({
        name: 'companyProfileSettings',
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
      await queryRunner.hasColumn('admin_settings', 'companyProfileSettings')
    ) {
      await queryRunner.dropColumn('admin_settings', 'companyProfileSettings');
    }
  }
}
