import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
} from 'typeorm';

export class CreateUsersTables20260319_1700000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const dialect = queryRunner.connection.options.type;
    const uuidDefault =
      dialect === 'postgres' ? 'uuid_generate_v4()' : 'UUID()';
    const boolTrueDefault =
      dialect === 'mysql' || dialect === 'mariadb' ? '1' : 'true';

    if (dialect === 'postgres') {
      await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    }

    if (!(await queryRunner.hasTable('users'))) {
      await queryRunner.createTable(
        new Table({
          name: 'users',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isNullable: false,
              default: uuidDefault,
            },
            { name: 'firstName', type: 'varchar', length: '100' },
            { name: 'lastName', type: 'varchar', length: '100' },
            {
              name: 'emailAddress',
              type: 'varchar',
              length: '255',
              isUnique: true,
            },
            { name: 'phoneNumber', type: 'varchar', length: '30' },
            {
              name: 'role',
              type: 'varchar',
              length: '30',
              isNullable: false,
              default: "'installer'",
            },
            { name: 'teamId', type: 'uuid', isNullable: true },
            {
              name: 'active',
              type: 'boolean',
              isNullable: false,
              default: boolTrueDefault,
            },
            {
              name: 'createdAt',
              type: 'timestamp',
              isNullable: false,
              default: 'now()',
            },
            {
              name: 'updatedAt',
              type: 'timestamp',
              isNullable: false,
              default: 'now()',
            },
          ],
        }),
      );
    } else {
      if (!(await queryRunner.hasColumn('users', 'teamId'))) {
        await queryRunner.addColumn(
          'users',
          new TableColumn({
            name: 'teamId',
            type: 'uuid',
            isNullable: true,
          }),
        );
      }

      if (!(await queryRunner.hasColumn('users', 'active'))) {
        await queryRunner.addColumn(
          'users',
          new TableColumn({
            name: 'active',
            type: 'boolean',
            isNullable: false,
            default: boolTrueDefault,
          }),
        );
      }

      if (!(await queryRunner.hasColumn('users', 'createdAt'))) {
        await queryRunner.addColumn(
          'users',
          new TableColumn({
            name: 'createdAt',
            type: 'timestamp',
            isNullable: false,
            default: 'now()',
          }),
        );
      }

      if (!(await queryRunner.hasColumn('users', 'updatedAt'))) {
        await queryRunner.addColumn(
          'users',
          new TableColumn({
            name: 'updatedAt',
            type: 'timestamp',
            isNullable: false,
            default: 'now()',
          }),
        );
      }
    }

    if (!(await queryRunner.hasTable('user_credentials'))) {
      await queryRunner.createTable(
        new Table({
          name: 'user_credentials',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isNullable: false,
              default: uuidDefault,
            },
            {
              name: 'username',
              type: 'varchar',
              length: '100',
              isUnique: true,
            },
            { name: 'passwordHash', type: 'varchar', length: '255' },
            { name: 'userId', type: 'uuid', isNullable: false },
          ],
          foreignKeys: [
            new TableForeignKey({
              columnNames: ['userId'],
              referencedTableName: 'users',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            }),
          ],
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('user_credentials')) {
      await queryRunner.dropTable('user_credentials');
    }
    if (await queryRunner.hasTable('users')) {
      await queryRunner.dropTable('users');
    }
  }
}
