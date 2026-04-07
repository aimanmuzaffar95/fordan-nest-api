import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddQuickLeadDefaultsToAdminSettings20260407_1800000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('admin_settings'))) {
      return;
    }

    if (
      !(await queryRunner.hasColumn(
        'admin_settings',
        'quickLeadDefaultSystemSizeKw',
      ))
    ) {
      await queryRunner.addColumn(
        'admin_settings',
        new TableColumn({
          name: 'quickLeadDefaultSystemSizeKw',
          type: 'numeric',
          precision: 10,
          scale: 2,
          isNullable: false,
          default: 6.6,
        }),
      );
    }

    if (
      !(await queryRunner.hasColumn(
        'admin_settings',
        'quickLeadDefaultBatterySizeKwh',
      ))
    ) {
      await queryRunner.addColumn(
        'admin_settings',
        new TableColumn({
          name: 'quickLeadDefaultBatterySizeKwh',
          type: 'numeric',
          precision: 10,
          scale: 2,
          isNullable: false,
          default: 10,
        }),
      );
    }

    if (
      !(await queryRunner.hasColumn(
        'admin_settings',
        'quickLeadDefaultProjectPrice',
      ))
    ) {
      await queryRunner.addColumn(
        'admin_settings',
        new TableColumn({
          name: 'quickLeadDefaultProjectPrice',
          type: 'numeric',
          precision: 12,
          scale: 2,
          isNullable: false,
          default: 0,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('admin_settings'))) {
      return;
    }

    if (
      await queryRunner.hasColumn(
        'admin_settings',
        'quickLeadDefaultProjectPrice',
      )
    ) {
      await queryRunner.dropColumn(
        'admin_settings',
        'quickLeadDefaultProjectPrice',
      );
    }

    if (
      await queryRunner.hasColumn(
        'admin_settings',
        'quickLeadDefaultBatterySizeKwh',
      )
    ) {
      await queryRunner.dropColumn(
        'admin_settings',
        'quickLeadDefaultBatterySizeKwh',
      );
    }

    if (
      await queryRunner.hasColumn(
        'admin_settings',
        'quickLeadDefaultSystemSizeKw',
      )
    ) {
      await queryRunner.dropColumn(
        'admin_settings',
        'quickLeadDefaultSystemSizeKw',
      );
    }
  }
}
