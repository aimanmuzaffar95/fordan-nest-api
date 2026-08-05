import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddCustomerMessagingTemplatesColumn20260415_1700000000900 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('admin_settings'))) {
      return;
    }

    if (
      await queryRunner.hasColumn(
        'admin_settings',
        'customerMessagingTemplates',
      )
    ) {
      return;
    }

    const dialect = queryRunner.connection.options.type;
    const colType = dialect === 'postgres' ? 'jsonb' : 'json';

    await queryRunner.addColumn(
      'admin_settings',
      new TableColumn({
        name: 'customerMessagingTemplates',
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
      await queryRunner.hasColumn(
        'admin_settings',
        'customerMessagingTemplates',
      )
    ) {
      await queryRunner.dropColumn(
        'admin_settings',
        'customerMessagingTemplates',
      );
    }
  }
}
