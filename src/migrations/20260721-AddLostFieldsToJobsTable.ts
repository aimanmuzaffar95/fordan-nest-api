import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds nullable lost-deal columns to `jobs` (QA finding WEB-05):
 * - `lostAt` — timestamp; non-null marks the job as lost (no new stage value).
 * - `lostReason` — reason captured when marking the deal lost.
 * - `lostByUserId` — user who marked the deal lost.
 * Purely additive; existing rows stay untouched (all columns default NULL).
 */
export class AddLostFieldsToJobsTable20260721_1700000000800 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('jobs', 'lostAt'))) {
      await queryRunner.addColumn(
        'jobs',
        new TableColumn({
          name: 'lostAt',
          type: 'timestamp',
          isNullable: true,
        }),
      );
    }

    if (!(await queryRunner.hasColumn('jobs', 'lostReason'))) {
      await queryRunner.addColumn(
        'jobs',
        new TableColumn({
          name: 'lostReason',
          type: 'varchar',
          length: '500',
          isNullable: true,
        }),
      );
    }

    if (!(await queryRunner.hasColumn('jobs', 'lostByUserId'))) {
      await queryRunner.addColumn(
        'jobs',
        new TableColumn({
          name: 'lostByUserId',
          type: 'uuid',
          isNullable: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('jobs', 'lostByUserId')) {
      await queryRunner.dropColumn('jobs', 'lostByUserId');
    }

    if (await queryRunner.hasColumn('jobs', 'lostReason')) {
      await queryRunner.dropColumn('jobs', 'lostReason');
    }

    if (await queryRunner.hasColumn('jobs', 'lostAt')) {
      await queryRunner.dropColumn('jobs', 'lostAt');
    }
  }
}
