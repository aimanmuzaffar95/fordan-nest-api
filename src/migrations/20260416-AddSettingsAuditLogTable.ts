import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class AddSettingsAuditLogTable1776351600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const has = await queryRunner.hasTable('settings_audit_log');
    if (has) return;

    const dialect = queryRunner.connection.options.type;
    const idType = dialect === 'postgres' ? 'uuid' : 'varchar';
    const idDefault = dialect === 'postgres' ? 'uuid_generate_v4()' : undefined;

    await queryRunner.createTable(
      new Table({
        name: 'settings_audit_log',
        columns: [
          {
            name: 'id',
            type: idType,
            isPrimary: true,
            ...(idDefault ? { default: idDefault } : {}),
          },
          { name: 'actorUserId', type: 'uuid', isNullable: true },
          { name: 'action', type: 'varchar', length: '80' },
          {
            name: 'changedFields',
            type: dialect === 'postgres' ? 'jsonb' : 'json',
          },
          {
            name: 'patch',
            type: dialect === 'postgres' ? 'jsonb' : 'json',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: dialect === 'postgres' ? 'timestamp' : 'datetime',
            default: dialect === 'postgres' ? 'now()' : 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'settings_audit_log',
      new TableIndex({
        name: 'IDX_settings_audit_log_createdAt',
        columnNames: ['createdAt'],
      }),
    );
    await queryRunner.createIndex(
      'settings_audit_log',
      new TableIndex({
        name: 'IDX_settings_audit_log_actorUserId',
        columnNames: ['actorUserId'],
      }),
    );

    await queryRunner.createForeignKey(
      'settings_audit_log',
      new TableForeignKey({
        columnNames: ['actorUserId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('settings_audit_log'))) return;
    await queryRunner.dropTable('settings_audit_log');
  }
}
