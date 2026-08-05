import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class AddStaffRolesAndStaffProfileFields20260320_1700000000008 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // `uuid_generate_v4()` is a Postgres extension function; MariaDB rejects it
    // in a DEFAULT clause and needs `UUID()`.
    const uuidDefault =
      queryRunner.connection.options.type === 'postgres'
        ? 'uuid_generate_v4()'
        : 'UUID()';

    const hasStaffRolesTable = await queryRunner.hasTable('staff_roles');
    if (!hasStaffRolesTable) {
      await queryRunner.createTable(
        new Table({
          name: 'staff_roles',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isNullable: false,
              default: uuidDefault,
            },
            {
              name: 'name',
              type: 'varchar',
              length: '100',
              isNullable: false,
              isUnique: true,
            },
            {
              name: 'description',
              type: 'varchar',
              length: '500',
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

    const columnsToAdd: TableColumn[] = [];

    if (!(await queryRunner.hasColumn('users', 'address'))) {
      columnsToAdd.push(
        new TableColumn({
          name: 'address',
          type: 'varchar',
          length: '255',
          isNullable: true,
        }),
      );
    }

    if (!(await queryRunner.hasColumn('users', 'identificationNumber'))) {
      columnsToAdd.push(
        new TableColumn({
          name: 'identificationNumber',
          type: 'varchar',
          length: '255',
          isNullable: true,
          isUnique: true,
        }),
      );
    }

    if (!(await queryRunner.hasColumn('users', 'staffRoleId'))) {
      columnsToAdd.push(
        new TableColumn({
          name: 'staffRoleId',
          type: 'uuid',
          isNullable: true,
        }),
      );
    }

    if (!(await queryRunner.hasColumn('users', 'deletedAt'))) {
      columnsToAdd.push(
        new TableColumn({
          name: 'deletedAt',
          type: 'timestamp',
          isNullable: true,
        }),
      );
    }

    if (columnsToAdd.length > 0) {
      await queryRunner.addColumns('users', columnsToAdd);
    }

    const usersTable = await queryRunner.getTable('users');
    const hasStaffRoleForeignKey = usersTable?.foreignKeys.some((foreignKey) =>
      foreignKey.columnNames.includes('staffRoleId'),
    );

    if (!hasStaffRoleForeignKey) {
      await queryRunner.createForeignKey(
        'users',
        new TableForeignKey({
          columnNames: ['staffRoleId'],
          referencedColumnNames: ['id'],
          referencedTableName: 'staff_roles',
          onDelete: 'SET NULL',
        }),
      );
    }

    const usersTableWithIndexes = await queryRunner.getTable('users');
    const hasUsersDeletedRoleIndex = usersTableWithIndexes?.indices.some(
      (index) => index.name === 'IDX_users_deletedAt_role',
    );
    if (!hasUsersDeletedRoleIndex) {
      await queryRunner.createIndex(
        'users',
        new TableIndex({
          name: 'IDX_users_deletedAt_role',
          columnNames: ['deletedAt', 'role'],
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const usersTable = await queryRunner.getTable('users');
    const staffRoleForeignKey = usersTable?.foreignKeys.find((foreignKey) =>
      foreignKey.columnNames.includes('staffRoleId'),
    );

    if (staffRoleForeignKey) {
      await queryRunner.dropForeignKey('users', staffRoleForeignKey);
    }

    const usersDeletedRoleIndex = usersTable?.indices.find(
      (index) => index.name === 'IDX_users_deletedAt_role',
    );

    if (usersDeletedRoleIndex) {
      await queryRunner.dropIndex('users', usersDeletedRoleIndex);
    }

    if (await queryRunner.hasColumn('users', 'deletedAt')) {
      await queryRunner.dropColumn('users', 'deletedAt');
    }
    if (await queryRunner.hasColumn('users', 'staffRoleId')) {
      await queryRunner.dropColumn('users', 'staffRoleId');
    }
    if (await queryRunner.hasColumn('users', 'identificationNumber')) {
      await queryRunner.dropColumn('users', 'identificationNumber');
    }
    if (await queryRunner.hasColumn('users', 'address')) {
      await queryRunner.dropColumn('users', 'address');
    }

    if (await queryRunner.hasTable('staff_roles')) {
      await queryRunner.dropTable('staff_roles');
    }
  }
}
