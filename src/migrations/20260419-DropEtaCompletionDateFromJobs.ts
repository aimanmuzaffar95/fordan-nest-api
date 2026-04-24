import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class DropEtaCompletionDateFromJobs20260419_1700000000022 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasJobsTable = await queryRunner.hasTable('jobs');
    if (!hasJobsTable) {
      return;
    }

    const hasEtaColumn = await queryRunner.hasColumn(
      'jobs',
      'etaCompletionDate',
    );
    if (!hasEtaColumn) {
      return;
    }

    await queryRunner.dropColumn('jobs', 'etaCompletionDate');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasJobsTable = await queryRunner.hasTable('jobs');
    if (!hasJobsTable) {
      return;
    }

    const hasEtaColumn = await queryRunner.hasColumn(
      'jobs',
      'etaCompletionDate',
    );
    if (hasEtaColumn) {
      return;
    }

    await queryRunner.addColumn(
      'jobs',
      new TableColumn({
        name: 'etaCompletionDate',
        type: 'date',
        isNullable: true,
      }),
    );
  }
}
