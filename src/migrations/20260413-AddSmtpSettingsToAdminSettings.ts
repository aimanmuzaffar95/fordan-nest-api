import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddSmtpSettingsToAdminSettings20260413_1700000000901 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('admin_settings');
    if (!hasTable) return;

    await this.addColumnIfMissing(
      queryRunner,
      new TableColumn({
        name: 'smtpHost',
        type: 'text',
        isNullable: true,
      }),
    );
    await this.addColumnIfMissing(
      queryRunner,
      new TableColumn({
        name: 'smtpPort',
        type: 'text',
        isNullable: true,
      }),
    );
    await this.addColumnIfMissing(
      queryRunner,
      new TableColumn({
        name: 'smtpSecure',
        type: 'text',
        isNullable: true,
      }),
    );
    await this.addColumnIfMissing(
      queryRunner,
      new TableColumn({
        name: 'smtpUser',
        type: 'text',
        isNullable: true,
      }),
    );
    await this.addColumnIfMissing(
      queryRunner,
      new TableColumn({
        name: 'smtpPass',
        type: 'text',
        isNullable: true,
      }),
    );
    await this.addColumnIfMissing(
      queryRunner,
      new TableColumn({
        name: 'mailFrom',
        type: 'text',
        isNullable: true,
      }),
    );
    await this.addColumnIfMissing(
      queryRunner,
      new TableColumn({
        name: 'mailFromName',
        type: 'text',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('admin_settings');
    if (!hasTable) return;

    if (await queryRunner.hasColumn('admin_settings', 'mailFromName')) {
      await queryRunner.dropColumn('admin_settings', 'mailFromName');
    }
    if (await queryRunner.hasColumn('admin_settings', 'mailFrom')) {
      await queryRunner.dropColumn('admin_settings', 'mailFrom');
    }
    if (await queryRunner.hasColumn('admin_settings', 'smtpPass')) {
      await queryRunner.dropColumn('admin_settings', 'smtpPass');
    }
    if (await queryRunner.hasColumn('admin_settings', 'smtpUser')) {
      await queryRunner.dropColumn('admin_settings', 'smtpUser');
    }
    if (await queryRunner.hasColumn('admin_settings', 'smtpSecure')) {
      await queryRunner.dropColumn('admin_settings', 'smtpSecure');
    }
    if (await queryRunner.hasColumn('admin_settings', 'smtpPort')) {
      await queryRunner.dropColumn('admin_settings', 'smtpPort');
    }
    if (await queryRunner.hasColumn('admin_settings', 'smtpHost')) {
      await queryRunner.dropColumn('admin_settings', 'smtpHost');
    }
  }

  private async addColumnIfMissing(
    queryRunner: QueryRunner,
    column: TableColumn,
  ): Promise<void> {
    const hasColumn = await queryRunner.hasColumn(
      'admin_settings',
      column.name,
    );
    if (!hasColumn) {
      await queryRunner.addColumn('admin_settings', column);
    }
  }
}
