import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';
import { resolveUuidColumn } from '../common/migration-uuid.util';

/**
 * `complaints` + `complaint_events` — the Zendesk-lifecycle complaint/ticket
 * module (status: new/open/pending/on_hold/solved/closed; priority:
 * low/normal/high/urgent) with an append-only timeline table for the
 * HubSpot-style History feed (created/reply/note/status_change/
 * assignment_change).
 *
 * Status/priority/event-type columns are plain `varchar`, not a native
 * enum/CHECK constraint — matches `permission_role_grants.permissionKey`'s
 * precedent in this codebase: TypeORM enforces the enum at the application
 * layer via the entity's `enum` option, and a plain varchar avoids the
 * cross-dialect native-enum DDL differences (Postgres `CREATE TYPE` vs
 * MySQL/MariaDB inline `ENUM(...)`) entirely.
 *
 * `assigneeFromUserId`/`assigneeToUserId` on `complaint_events` intentionally
 * have no FK constraint, mirroring the entity (plain `@Column`, not a
 * `@ManyToOne` relation) — they are a point-in-time audit snapshot, not a
 * live relation, so a deleted user must not block reading old history.
 */
export class CreateComplaints20260812_1700000002700 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const isLongTextDialect = ['mysql', 'mariadb'].includes(
      queryRunner.connection.options.type,
    );
    const uuidCol = await resolveUuidColumn(queryRunner);
    const uuidDefault = isPostgres ? { default: 'uuid_generate_v4()' } : {};
    const ts = isPostgres ? 'timestamp' : 'datetime';
    const longText = isLongTextDialect ? 'longtext' : 'text';

    if (!(await queryRunner.hasTable('complaints'))) {
      await queryRunner.createTable(
        new Table({
          name: 'complaints',
          columns: [
            {
              name: 'id',
              ...uuidCol,
              isPrimary: true,
              generationStrategy: 'uuid',
              ...uuidDefault,
            },
            { name: 'subject', type: 'varchar', length: '200' },
            {
              name: 'status',
              type: 'varchar',
              length: '20',
              default: "'new'",
            },
            {
              name: 'priority',
              type: 'varchar',
              length: '10',
              default: "'normal'",
            },
            { name: 'customerId', ...uuidCol, isNullable: true },
            { name: 'jobId', ...uuidCol, isNullable: true },
            { name: 'assigneeUserId', ...uuidCol, isNullable: true },
            { name: 'createdByUserId', ...uuidCol, isNullable: true },
            { name: 'solvedAt', type: ts, isNullable: true },
            { name: 'closedAt', type: ts, isNullable: true },
            { name: 'createdAt', type: ts, default: 'now()' },
            { name: 'updatedAt', type: ts, default: 'now()' },
          ],
          foreignKeys: [
            {
              columnNames: ['customerId'],
              referencedTableName: 'customers',
              referencedColumnNames: ['id'],
              onDelete: 'SET NULL',
            },
            {
              columnNames: ['jobId'],
              referencedTableName: 'jobs',
              referencedColumnNames: ['id'],
              onDelete: 'SET NULL',
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
          ],
        }),
      );

      await queryRunner.createIndex(
        'complaints',
        new TableIndex({
          name: 'idx_complaints_status',
          columnNames: ['status'],
        }),
      );
      await queryRunner.createIndex(
        'complaints',
        new TableIndex({
          name: 'idx_complaints_assignee_status',
          columnNames: ['assigneeUserId', 'status'],
        }),
      );
      await queryRunner.createIndex(
        'complaints',
        new TableIndex({
          name: 'idx_complaints_customer',
          columnNames: ['customerId'],
        }),
      );
      await queryRunner.createIndex(
        'complaints',
        new TableIndex({
          name: 'idx_complaints_job',
          columnNames: ['jobId'],
        }),
      );
    }

    if (!(await queryRunner.hasTable('complaint_events'))) {
      await queryRunner.createTable(
        new Table({
          name: 'complaint_events',
          columns: [
            {
              name: 'id',
              ...uuidCol,
              isPrimary: true,
              generationStrategy: 'uuid',
              ...uuidDefault,
            },
            { name: 'complaintId', ...uuidCol },
            { name: 'type', type: 'varchar', length: '30' },
            { name: 'body', type: longText, isNullable: true },
            {
              name: 'statusFrom',
              type: 'varchar',
              length: '20',
              isNullable: true,
            },
            {
              name: 'statusTo',
              type: 'varchar',
              length: '20',
              isNullable: true,
            },
            {
              name: 'priorityTo',
              type: 'varchar',
              length: '10',
              isNullable: true,
            },
            { name: 'assigneeFromUserId', ...uuidCol, isNullable: true },
            { name: 'assigneeToUserId', ...uuidCol, isNullable: true },
            { name: 'actorUserId', ...uuidCol, isNullable: true },
            { name: 'createdAt', type: ts, default: 'now()' },
          ],
          foreignKeys: [
            {
              columnNames: ['complaintId'],
              referencedTableName: 'complaints',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            },
            {
              columnNames: ['actorUserId'],
              referencedTableName: 'users',
              referencedColumnNames: ['id'],
              onDelete: 'SET NULL',
            },
          ],
        }),
      );

      await queryRunner.createIndex(
        'complaint_events',
        new TableIndex({
          name: 'idx_complaint_events_complaint',
          columnNames: ['complaintId', 'createdAt'],
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('complaint_events')) {
      await queryRunner.dropTable('complaint_events');
    }
    if (await queryRunner.hasTable('complaints')) {
      await queryRunner.dropTable('complaints');
    }
  }
}
