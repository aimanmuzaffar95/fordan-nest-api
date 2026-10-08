import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Staff training modules: training_modules, training_questions,
 * training_attempts (Postgres). Additive and guarded.
 *
 * cPanel/MariaDB: apply scripts/sql/2026-10-training-mariadb.sql instead.
 */
export class Training20261008_1700000006500 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    const id = {
      name: 'id',
      type: 'uuid',
      isPrimary: true,
      default: 'gen_random_uuid()',
    };
    const ts = (name: string) => ({
      name,
      type: 'timestamp',
      default: 'now()',
    });

    if (!(await q.hasTable('training_modules'))) {
      await q.createTable(
        new Table({
          name: 'training_modules',
          columns: [
            id,
            { name: 'title', type: 'varchar', length: '200' },
            { name: 'description', type: 'text', isNullable: true },
            { name: 'videoUrl', type: 'varchar', length: '1000' },
            {
              name: 'policy',
              type: 'varchar',
              length: '10',
              default: "'soft'",
            },
            { name: 'passMarkPercent', type: 'int', default: 80 },
            { name: 'roles', type: 'json' },
            { name: 'active', type: 'boolean', default: true },
            { name: 'sortOrder', type: 'int', default: 0 },
            { name: 'createdByUserId', type: 'uuid', isNullable: true },
            ts('createdAt'),
            ts('updatedAt'),
          ],
          foreignKeys: [
            {
              columnNames: ['createdByUserId'],
              referencedTableName: 'users',
              referencedColumnNames: ['id'],
              onDelete: 'SET NULL',
            },
          ],
        }),
      );
    }

    if (!(await q.hasTable('training_questions'))) {
      await q.createTable(
        new Table({
          name: 'training_questions',
          columns: [
            id,
            { name: 'moduleId', type: 'uuid' },
            { name: 'prompt', type: 'text' },
            { name: 'options', type: 'json' },
            { name: 'correctIndex', type: 'int' },
            { name: 'sortOrder', type: 'int', default: 0 },
          ],
          foreignKeys: [
            {
              columnNames: ['moduleId'],
              referencedTableName: 'training_modules',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            },
          ],
        }),
      );
      await q.createIndex(
        'training_questions',
        new TableIndex({
          name: 'idx_training_questions_module',
          columnNames: ['moduleId', 'sortOrder'],
        }),
      );
    }

    if (!(await q.hasTable('training_attempts'))) {
      await q.createTable(
        new Table({
          name: 'training_attempts',
          columns: [
            id,
            { name: 'moduleId', type: 'uuid' },
            { name: 'userId', type: 'uuid' },
            { name: 'answers', type: 'json' },
            { name: 'scorePercent', type: 'int' },
            { name: 'passed', type: 'boolean' },
            ts('createdAt'),
          ],
          foreignKeys: [
            {
              columnNames: ['moduleId'],
              referencedTableName: 'training_modules',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            },
            {
              columnNames: ['userId'],
              referencedTableName: 'users',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            },
          ],
        }),
      );
      await q.createIndex(
        'training_attempts',
        new TableIndex({
          name: 'idx_training_attempts_user_module',
          columnNames: ['userId', 'moduleId'],
        }),
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of [
      'training_attempts',
      'training_questions',
      'training_modules',
    ]) {
      if (await q.hasTable(t)) await q.dropTable(t);
    }
  }
}
