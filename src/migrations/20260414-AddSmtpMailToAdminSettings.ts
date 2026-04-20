import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddSmtpMailToAdminSettings1776168000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('admin_settings'))) {
      return;
    }

    const add = async (name: string, column: TableColumn): Promise<void> => {
      if (!(await queryRunner.hasColumn('admin_settings', name))) {
        await queryRunner.addColumn('admin_settings', column);
      }
    };

    await add(
      'smtpHost',
      new TableColumn({
        name: 'smtpHost',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );

    await add(
      'smtpPort',
      new TableColumn({
        name: 'smtpPort',
        type: 'int',
        isNullable: true,
      }),
    );

    await add(
      'smtpUser',
      new TableColumn({
        name: 'smtpUser',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );

    await add(
      'smtpPass',
      new TableColumn({
        name: 'smtpPass',
        type: 'varchar',
        length: '512',
        isNullable: true,
      }),
    );

    await add(
      'smtpSecure',
      new TableColumn({
        name: 'smtpSecure',
        type: 'boolean',
        isNullable: true,
      }),
    );

    await add(
      'mailFrom',
      new TableColumn({
        name: 'mailFrom',
        type: 'varchar',
        length: '320',
        isNullable: true,
      }),
    );

    await add(
      'mailFromName',
      new TableColumn({
        name: 'mailFromName',
        type: 'varchar',
        length: '200',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('admin_settings'))) {
      return;
    }

    for (const col of [
      'mailFromName',
      'mailFrom',
      'smtpSecure',
      'smtpPass',
      'smtpUser',
      'smtpPort',
      'smtpHost',
    ]) {
      if (await queryRunner.hasColumn('admin_settings', col)) {
        await queryRunner.dropColumn('admin_settings', col);
      }
    }
  }
}
