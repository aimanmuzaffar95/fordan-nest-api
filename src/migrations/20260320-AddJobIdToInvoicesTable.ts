import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableForeignKey,
} from 'typeorm';

export class AddJobIdToInvoicesTable20260320_1700000000005 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('invoices');
    const hasJobId = Boolean(table?.findColumnByName('jobId'));
    if (hasJobId) return;

    await queryRunner.addColumn(
      'invoices',
      new TableColumn({
        name: 'jobId',
        type: 'uuid',
        isNullable: true,
      }),
    );

    await queryRunner.createForeignKey(
      'invoices',
      new TableForeignKey({
        name: 'FK_invoices_jobId_jobs',
        columnNames: ['jobId'],
        referencedTableName: 'jobs',
        referencedColumnNames: ['id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('invoices');
    const hasJobId = Boolean(table?.findColumnByName('jobId'));
    if (!hasJobId) return;

    const fk = table?.foreignKeys.find((f) => f.columnNames.includes('jobId'));
    if (fk) {
      await queryRunner.dropForeignKey('invoices', fk);
    }
    await queryRunner.dropColumn('invoices', 'jobId');
  }
}
