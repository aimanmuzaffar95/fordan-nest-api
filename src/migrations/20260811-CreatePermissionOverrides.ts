import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';
import { resolveUuidColumn } from '../common/migration-uuid.util';

/**
 * `permission_overrides` — per-user permission grants/revocations layered on
 * top of the role profile (`permission_role_grants`), matching ServiceTitan's
 * "individual permissions" model (per-user overrides above the role
 * baseline). See `PermissionOverride` entity for the reconciliation rule.
 *
 * `permissionKey` is `varchar(120)` (not an enum/check constraint) to match
 * `permission_role_grants.permissionKey` — adding catalog keys never needs a
 * migration.
 */
export class CreatePermissionOverrides20260811_1700000002500
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('permission_overrides')) return;

    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const uuidCol = await resolveUuidColumn(queryRunner);
    const uuidDefault = isPostgres ? { default: 'uuid_generate_v4()' } : {};
    const ts = isPostgres ? 'timestamp' : 'datetime';

    await queryRunner.createTable(
      new Table({
        name: 'permission_overrides',
        columns: [
          {
            name: 'id',
            ...uuidCol,
            isPrimary: true,
            generationStrategy: 'uuid',
            ...uuidDefault,
          },
          { name: 'userId', ...uuidCol },
          { name: 'permissionKey', type: 'varchar', length: '120' },
          {
            name: 'enabled',
            type: isPostgres ? 'boolean' : 'tinyint',
          },
          { name: 'grantedByUserId', ...uuidCol, isNullable: true },
          { name: 'createdAt', type: ts, default: 'now()' },
          { name: 'updatedAt', type: ts, default: 'now()' },
        ],
        foreignKeys: [
          {
            columnNames: ['userId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            columnNames: ['grantedByUserId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
        ],
      }),
    );

    await queryRunner.createIndex(
      'permission_overrides',
      new TableIndex({
        name: 'idx_permission_overrides_user',
        columnNames: ['userId'],
      }),
    );
    await queryRunner.createIndex(
      'permission_overrides',
      new TableIndex({
        name: 'uq_permission_overrides_user_key',
        columnNames: ['userId', 'permissionKey'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('permission_overrides')) {
      await queryRunner.dropTable('permission_overrides');
    }
  }
}
