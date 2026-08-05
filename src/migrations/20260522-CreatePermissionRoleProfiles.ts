import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreatePermissionRoleProfiles20260522_1700000000900 implements MigrationInterface {
  private getDefaults(queryRunner: QueryRunner) {
    const dialect = queryRunner.connection.options.type;
    return {
      dialect,
      uuidDefault: dialect === 'postgres' ? 'uuid_generate_v4()' : 'UUID()',
      boolFalseDefault:
        dialect === 'mysql' || dialect === 'mariadb' ? '0' : 'false',
      boolTrueDefault:
        dialect === 'mysql' || dialect === 'mariadb' ? '1' : 'true',
    };
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const { dialect, uuidDefault, boolFalseDefault, boolTrueDefault } =
      this.getDefaults(queryRunner);

    if (dialect === 'postgres') {
      await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    }

    if (!(await queryRunner.hasTable('permission_role_profiles'))) {
      await queryRunner.createTable(
        new Table({
          name: 'permission_role_profiles',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isNullable: false,
              default: uuidDefault,
            },
            {
              name: 'kind',
              type: 'varchar',
              length: '20',
              isNullable: false,
            },
            {
              name: 'builtinRole',
              type: 'varchar',
              length: '20',
              isNullable: true,
            },
            { name: 'staffRoleId', type: 'uuid', isNullable: true },
            {
              name: 'name',
              type: 'varchar',
              length: '120',
              isNullable: false,
            },
            {
              name: 'immutable',
              type: 'boolean',
              isNullable: false,
              default: boolFalseDefault,
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
    }

    if (!(await queryRunner.hasTable('permission_role_grants'))) {
      await queryRunner.createTable(
        new Table({
          name: 'permission_role_grants',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isNullable: false,
              default: uuidDefault,
            },
            { name: 'profileId', type: 'uuid', isNullable: false },
            {
              name: 'permissionKey',
              type: 'varchar',
              length: '120',
              isNullable: false,
            },
            {
              name: 'enabled',
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
    }

    if (!(await queryRunner.hasTable('permission_role_scopes'))) {
      await queryRunner.createTable(
        new Table({
          name: 'permission_role_scopes',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isNullable: false,
              default: uuidDefault,
            },
            { name: 'profileId', type: 'uuid', isNullable: false },
            {
              name: 'resource',
              type: 'varchar',
              length: '40',
              isNullable: false,
            },
            {
              name: 'scope',
              type: 'varchar',
              length: '40',
              isNullable: false,
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
    }

    await this.createIndexIfMissing(
      queryRunner,
      'permission_role_profiles',
      'IDX_permission_role_profiles_builtinRole',
      ['builtinRole'],
      true,
    );
    await this.createIndexIfMissing(
      queryRunner,
      'permission_role_profiles',
      'IDX_permission_role_profiles_staffRoleId',
      ['staffRoleId'],
      true,
    );
    await this.createIndexIfMissing(
      queryRunner,
      'permission_role_grants',
      'IDX_permission_role_grants_profile_permission',
      ['profileId', 'permissionKey'],
      true,
    );
    await this.createIndexIfMissing(
      queryRunner,
      'permission_role_scopes',
      'IDX_permission_role_scopes_profile_resource',
      ['profileId', 'resource'],
      true,
    );

    await this.createForeignKeyIfMissing(
      queryRunner,
      'permission_role_profiles',
      'staffRoleId',
      new TableForeignKey({
        columnNames: ['staffRoleId'],
        referencedTableName: 'staff_roles',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await this.createForeignKeyIfMissing(
      queryRunner,
      'permission_role_grants',
      'profileId',
      new TableForeignKey({
        columnNames: ['profileId'],
        referencedTableName: 'permission_role_profiles',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await this.createForeignKeyIfMissing(
      queryRunner,
      'permission_role_scopes',
      'profileId',
      new TableForeignKey({
        columnNames: ['profileId'],
        referencedTableName: 'permission_role_profiles',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('permission_role_scopes', true);
    await queryRunner.dropTable('permission_role_grants', true);
    await queryRunner.dropTable('permission_role_profiles', true);
  }

  private async createIndexIfMissing(
    queryRunner: QueryRunner,
    tableName: string,
    indexName: string,
    columnNames: string[],
    isUnique: boolean,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    if (table?.indices.some((idx) => idx.name === indexName)) return;
    await queryRunner.createIndex(
      tableName,
      new TableIndex({
        name: indexName,
        columnNames,
        isUnique,
      }),
    );
  }

  private async createForeignKeyIfMissing(
    queryRunner: QueryRunner,
    tableName: string,
    columnName: string,
    foreignKey: TableForeignKey,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    if (table?.foreignKeys.some((fk) => fk.columnNames.includes(columnName))) {
      return;
    }
    await queryRunner.createForeignKey(tableName, foreignKey);
  }
}
