import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddEsignColumnsToAdminSettings20260412_2200000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('admin_settings'))) {
      return;
    }

    if (
      !(await queryRunner.hasColumn('admin_settings', 'esignPublicBaseUrl'))
    ) {
      await queryRunner.addColumn(
        'admin_settings',
        new TableColumn({
          name: 'esignPublicBaseUrl',
          type: 'varchar',
          length: '512',
          isNullable: true,
        }),
      );
    }

    if (!(await queryRunner.hasColumn('admin_settings', 'esignTokenTtlDays'))) {
      await queryRunner.addColumn(
        'admin_settings',
        new TableColumn({
          name: 'esignTokenTtlDays',
          type: 'int',
          isNullable: false,
          default: 14,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('admin_settings'))) {
      return;
    }

    if (await queryRunner.hasColumn('admin_settings', 'esignTokenTtlDays')) {
      await queryRunner.dropColumn('admin_settings', 'esignTokenTtlDays');
    }

    if (await queryRunner.hasColumn('admin_settings', 'esignPublicBaseUrl')) {
      await queryRunner.dropColumn('admin_settings', 'esignPublicBaseUrl');
    }
  }
}
