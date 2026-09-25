import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/** files.customerVisible — staff opt a job file into the customer portal. */
export class AddCustomerVisibleToFiles20260926_1700000006300 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('files'))) return;
    if (await queryRunner.hasColumn('files', 'customerVisible')) return;
    await queryRunner.addColumn(
      'files',
      new TableColumn({
        name: 'customerVisible',
        type: 'boolean',
        isNullable: false,
        default: false,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('files', 'customerVisible')) {
      await queryRunner.dropColumn('files', 'customerVisible');
    }
  }
}
