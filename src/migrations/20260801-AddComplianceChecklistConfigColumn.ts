import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddComplianceChecklistConfigColumn20260801_1700000001400
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('admin_settings'))) {
      return;
    }

    if (
      await queryRunner.hasColumn('admin_settings', 'complianceChecklistConfig')
    ) {
      return;
    }

    const dialect = queryRunner.connection.options.type;
    const colType = dialect === 'postgres' ? 'jsonb' : 'json';

    await queryRunner.addColumn(
      'admin_settings',
      new TableColumn({
        name: 'complianceChecklistConfig',
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
      await queryRunner.hasColumn('admin_settings', 'complianceChecklistConfig')
    ) {
      await queryRunner.dropColumn(
        'admin_settings',
        'complianceChecklistConfig',
      );
    }
  }
}
