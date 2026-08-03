import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';
import { resolveUuidColumn } from '../common/migration-uuid.util';

/**
 * PRD v2 Phase 0 — the Task + SLA engine's backing table.
 *
 * Status/priority/source are plain varchars rather than DB enums: the stage
 * templates that feed them are admin-configurable, and adding an enum value on
 * prod MariaDB means a table rebuild we don't want to schedule for a taxonomy
 * that is still settling. The entity enforces the value set.
 */
export class CreateTasks20260803_1700000001600 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('tasks')) return;

    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const uuidCol = await resolveUuidColumn(queryRunner);
    const timestampType = isPostgres ? 'timestamp' : 'datetime';

    await queryRunner.createTable(
      new Table({
        name: 'tasks',
        columns: [
          {
            name: 'id',
            ...uuidCol,
            isPrimary: true,
            generationStrategy: 'uuid',
            ...(isPostgres ? { default: 'uuid_generate_v4()' } : {}),
          },
          { name: 'jobId', ...uuidCol, isNullable: true },
          { name: 'title', type: 'varchar', length: '160' },
          { name: 'description', type: 'text', isNullable: true },
          { name: 'status', type: 'varchar', length: '20', default: "'open'" },
          {
            name: 'priority',
            type: 'varchar',
            length: '20',
            default: "'normal'",
          },
          {
            name: 'source',
            type: 'varchar',
            length: '20',
            default: "'manual'",
          },
          { name: 'stage', type: 'varchar', length: '50', isNullable: true },
          {
            name: 'templateId',
            type: 'varchar',
            length: '64',
            isNullable: true,
          },
          {
            name: 'assigneeUserId',
            ...uuidCol,
            isNullable: true,
          },
          {
            name: 'createdByUserId',
            ...uuidCol,
            isNullable: true,
          },
          { name: 'dueAt', type: timestampType, isNullable: true },
          { name: 'slaDueAt', type: timestampType, isNullable: true },
          { name: 'slaBreachedAt', type: timestampType, isNullable: true },
          { name: 'escalationLevel', type: 'int', default: 0 },
          { name: 'escalatedAt', type: timestampType, isNullable: true },
          { name: 'completedAt', type: timestampType, isNullable: true },
          {
            name: 'completedByUserId',
            ...uuidCol,
            isNullable: true,
          },
          { name: 'createdAt', type: timestampType, default: 'now()' },
          { name: 'updatedAt', type: timestampType, default: 'now()' },
        ],
        foreignKeys: [
          {
            columnNames: ['jobId'],
            referencedTableName: 'jobs',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            columnNames: ['assigneeUserId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
          {
            columnNames: ['createdByUserId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
          {
            columnNames: ['completedByUserId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
        ],
      }),
    );

    await queryRunner.createIndex(
      'tasks',
      new TableIndex({ name: 'idx_tasks_job_id', columnNames: ['jobId'] }),
    );
    await queryRunner.createIndex(
      'tasks',
      new TableIndex({
        name: 'idx_tasks_assignee_status',
        columnNames: ['assigneeUserId', 'status'],
      }),
    );
    // Serves the SLA sweep (status + slaDueAt) and the due-soon list cut.
    await queryRunner.createIndex(
      'tasks',
      new TableIndex({
        name: 'idx_tasks_status_due',
        columnNames: ['status', 'dueAt'],
      }),
    );
    // Idempotent stage-template materialisation looks up this triple.
    await queryRunner.createIndex(
      'tasks',
      new TableIndex({
        name: 'idx_tasks_job_stage_template',
        columnNames: ['jobId', 'stage', 'templateId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('tasks')) {
      await queryRunner.dropTable('tasks');
    }
  }
}
