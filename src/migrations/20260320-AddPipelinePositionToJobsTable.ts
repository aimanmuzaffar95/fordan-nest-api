import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddPipelinePositionToJobsTable20260320_1700000000007 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('jobs'))) return;

    if (await queryRunner.hasColumn('jobs', 'pipelinePosition')) return;

    await queryRunner.addColumn(
      'jobs',
      new TableColumn({
        name: 'pipelinePosition',
        type: 'int',
        isNullable: false,
        default: '0',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('jobs'))) return;
    if (!(await queryRunner.hasColumn('jobs', 'pipelinePosition'))) return;

    await queryRunner.dropColumn('jobs', 'pipelinePosition');
  }
}
