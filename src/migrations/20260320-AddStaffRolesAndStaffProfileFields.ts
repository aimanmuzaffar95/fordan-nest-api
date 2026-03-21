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
    await queryRunner.createTable(
      new Table({
        name: 'staff_roles',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isNullable: false,
            default: 'uuid_generate_v4()',
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

    await queryRunner.addColumns('users', [
      new TableColumn({
        name: 'address',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
      new TableColumn({
        name: 'identificationNumber',
        type: 'varchar',
        length: '255',
        isNullable: true,
        isUnique: true,
      }),
      new TableColumn({
        name: 'staffRoleId',
        type: 'uuid',
        isNullable: true,
      }),
      new TableColumn({
        name: 'deletedAt',
        type: 'timestamp',
        isNullable: true,
      }),
    ]);

    await queryRunner.createForeignKey(
      'users',
      new TableForeignKey({
        columnNames: ['staffRoleId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'staff_roles',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createIndex(
      'users',
      new TableIndex({
        name: 'IDX_users_deletedAt_role',
        columnNames: ['deletedAt', 'role'],
      }),
    );
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

    await queryRunner.dropColumns('users', [
      'deletedAt',
      'staffRoleId',
      'identificationNumber',
      'address',
    ]);

    await queryRunner.dropTable('staff_roles');
  }
}
