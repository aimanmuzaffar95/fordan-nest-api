import { MigrationInterface, QueryRunner, Table } from 'typeorm';

/**
 * Manual CEC checklist tick state per job. Items are config-defined string ids
 * (admin_settings.complianceChecklistConfig), so no FK on itemId.
 */
export class CreateJobCecItemTicks20260801_1700000001500 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('job_cec_item_ticks')) return;
    await queryRunner.createTable(
      new Table({
        name: 'job_cec_item_ticks',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'jobId', type: 'uuid' },
          { name: 'itemId', type: 'varchar', length: '64' },
          { name: 'done', type: 'boolean', default: false },
          { name: 'doneAt', type: 'timestamp', isNullable: true },
          { name: 'doneByUserId', type: 'uuid', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
          { name: 'updatedAt', type: 'timestamp', default: 'now()' },
        ],
        uniques: [
          {
            name: 'UQ_job_cec_tick_job_item',
            columnNames: ['jobId', 'itemId'],
          },
        ],
        foreignKeys: [
          {
            columnNames: ['jobId'],
            referencedTableName: 'jobs',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            columnNames: ['doneByUserId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('job_cec_item_ticks')) {
      await queryRunner.dropTable('job_cec_item_ticks');
    }
  }
}
