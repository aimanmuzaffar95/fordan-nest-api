import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';
import { resolveUuidColumn } from '../common/migration-uuid.util';

/**
 * `customer_notes` — dispatcher-facing free-text notes on a customer record
 * ("gate code is 925", "beware of dog"), separate from the job-scoped `Note`
 * entity (`notes` table, unmodified here) since those describe one job visit
 * and customer notes apply to every job for that customer.
 *
 * Mirrors `project_notes` (see `20260807-CreateProjectNotes.ts`): append-only
 * rows, author always the authenticated principal, no accumulated-length
 * column and no read-modify-write race. Adds a `pinned` boolean so a
 * dispatcher-critical note (e.g. "gate code changed") can be surfaced first
 * without a follow-up migration.
 */
export class CreateCustomerNotes20260807_1700000002200
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('customer_notes')) return;

    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const isMysql = ['mysql', 'mariadb'].includes(
      queryRunner.connection.options.type,
    );
    const uuidCol = await resolveUuidColumn(queryRunner);
    const uuidDefault = isPostgres ? { default: 'uuid_generate_v4()' } : {};
    const ts = isPostgres ? 'timestamp' : 'datetime';

    await queryRunner.createTable(
      new Table({
        name: 'customer_notes',
        columns: [
          {
            name: 'id',
            ...uuidCol,
            isPrimary: true,
            generationStrategy: 'uuid',
            ...uuidDefault,
          },
          { name: 'customerId', ...uuidCol },
          { name: 'body', type: isMysql ? 'longtext' : 'text' },
          {
            name: 'pinned',
            type: isPostgres ? 'boolean' : 'tinyint',
            default: isPostgres ? 'false' : 0,
          },
          { name: 'createdByUserId', ...uuidCol, isNullable: true },
          { name: 'createdAt', type: ts, default: 'now()' },
        ],
        foreignKeys: [
          {
            columnNames: ['customerId'],
            referencedTableName: 'customers',
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
      'customer_notes',
      new TableIndex({
        name: 'idx_customer_notes_customer',
        columnNames: ['customerId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('customer_notes')) {
      await queryRunner.dropTable('customer_notes');
    }
  }
}
