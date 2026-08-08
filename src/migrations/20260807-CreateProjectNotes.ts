import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';
import { resolveUuidColumn } from '../common/migration-uuid.util';

/**
 * `project_notes` — a dedicated, append-only timeline-notes store for the web
 * project-detail "leave a note" composer.
 *
 * Replaces a defective pattern where notes were appended as marker-delimited
 * lines into `projects.notes` via `PATCH /projects/:id`:
 *  - accumulated column length eventually rejected every further note (400)
 *  - concurrent authors lost each other's notes on read-modify-write
 *  - the author name was unverified client text, not the authenticated user
 *
 * `projects.notes` is untouched — it keeps its existing meaning and its
 * existing writer. This is a new, separate table.
 */
export class CreateProjectNotes20260807_1700000002100 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('project_notes')) return;

    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const isMysql = ['mysql', 'mariadb'].includes(
      queryRunner.connection.options.type,
    );
    const uuidCol = await resolveUuidColumn(queryRunner);
    const uuidDefault = isPostgres ? { default: 'uuid_generate_v4()' } : {};
    const ts = isPostgres ? 'timestamp' : 'datetime';

    await queryRunner.createTable(
      new Table({
        name: 'project_notes',
        columns: [
          {
            name: 'id',
            ...uuidCol,
            isPrimary: true,
            generationStrategy: 'uuid',
            ...uuidDefault,
          },
          { name: 'projectId', ...uuidCol },
          { name: 'body', type: isMysql ? 'longtext' : 'text' },
          { name: 'createdByUserId', ...uuidCol, isNullable: true },
          { name: 'createdAt', type: ts, default: 'now()' },
        ],
        foreignKeys: [
          {
            columnNames: ['projectId'],
            referencedTableName: 'projects',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            columnNames: ['createdByUserId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
        ],
      }),
    );

    await queryRunner.createIndex(
      'project_notes',
      new TableIndex({
        name: 'idx_project_notes_project',
        columnNames: ['projectId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('project_notes')) {
      await queryRunner.dropTable('project_notes');
    }
  }
}
