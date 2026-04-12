import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddSecondaryPhoneToCustomers1775950000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('customers');
    if (!hasTable) return;

    const hasColumn = await queryRunner.hasColumn('customers', 'secondaryPhone');
    if (hasColumn) return;

    await queryRunner.addColumn(
      'customers',
      new TableColumn({
        name: 'secondaryPhone',
        type: 'varchar',
        length: '30',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('customers');
    if (!hasTable) return;

    const hasColumn = await queryRunner.hasColumn('customers', 'secondaryPhone');
    if (!hasColumn) return;

    await queryRunner.dropColumn('customers', 'secondaryPhone');
  }
}
