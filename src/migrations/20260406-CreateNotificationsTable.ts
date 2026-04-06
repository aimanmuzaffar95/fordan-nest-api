import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateNotificationsTable20260406_2100000000000 implements MigrationInterface {
  private getDialectDefaults(queryRunner: QueryRunner) {
    const dialect = queryRunner.connection.options.type;
    const uuidDefault =
      dialect === 'postgres' ? 'uuid_generate_v4()' : 'UUID()';

    return { dialect, uuidDefault };
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const { dialect, uuidDefault } = this.getDialectDefaults(queryRunner);

    if (await queryRunner.hasTable('notifications')) {
      return;
    }

    if (dialect === 'postgres') {
      await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    }

    await queryRunner.createTable(
      new Table({
        name: 'notifications',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isNullable: false,
            default: uuidDefault,
          },
          {
            name: 'userId',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'type',
            type: 'varchar',
            length: '80',
            isNullable: false,
          },
          {
            name: 'title',
            type: 'varchar',
            length: '200',
            isNullable: false,
          },
          {
            name: 'body',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'json',
            isNullable: true,
          },
          {
            name: 'readAt',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            isNullable: false,
            default:
              dialect === 'mysql' || dialect === 'mariadb'
                ? 'CURRENT_TIMESTAMP'
                : 'now()',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            isNullable: false,
            default:
              dialect === 'mysql' || dialect === 'mariadb'
                ? 'CURRENT_TIMESTAMP'
                : 'now()',
            onUpdate:
              dialect === 'mysql' || dialect === 'mariadb'
                ? 'CURRENT_TIMESTAMP'
                : undefined,
          },
        ],
        foreignKeys: [
          new TableForeignKey({
            columnNames: ['userId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          }),
        ],
        indices: [
          new TableIndex({
            name: 'IDX_notifications_user_createdAt',
            columnNames: ['userId', 'createdAt'],
          }),
          new TableIndex({
            name: 'IDX_notifications_user_readAt',
            columnNames: ['userId', 'readAt'],
          }),
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('notifications')) {
      await queryRunner.dropTable('notifications');
    }
  }
}
