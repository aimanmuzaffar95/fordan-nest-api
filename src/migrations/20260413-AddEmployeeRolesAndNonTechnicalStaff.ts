import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class AddEmployeeRolesAndNonTechnicalStaff20260413_1700000000900 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create employee_roles table.
    // `gen_random_uuid()` and `"`-quoted identifiers are Postgres-only;
    // MariaDB needs `UUID()` and backticks.
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    await queryRunner.query(
      isPostgres
        ? `CREATE TABLE IF NOT EXISTS employee_roles (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             name varchar(100) NOT NULL UNIQUE,
             description varchar(500) NOT NULL,
             "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
             "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
           )`
        : `CREATE TABLE IF NOT EXISTS \`employee_roles\` (
             \`id\` uuid NOT NULL PRIMARY KEY DEFAULT UUID(),
             \`name\` varchar(100) NOT NULL UNIQUE,
             \`description\` varchar(500) NOT NULL,
             \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
             \`updatedAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                 ON UPDATE CURRENT_TIMESTAMP
           ) ENGINE=InnoDB`,
    );

    // 2. Add employeeRoleId column to users table
    const hasEmployeeRoleId = await queryRunner.hasColumn(
      'users',
      'employeeRoleId',
    );
    if (!hasEmployeeRoleId) {
      await queryRunner.addColumn(
        'users',
        new TableColumn({
          name: 'employeeRoleId',
          type: 'uuid',
          isNullable: true,
        }),
      );
    }

    // 3. Add foreign key constraint
    const usersTable = await queryRunner.getTable('users');
    const hasForeignKey = usersTable?.foreignKeys.some((fk) =>
      fk.columnNames.includes('employeeRoleId'),
    );
    if (!hasForeignKey) {
      await queryRunner.createForeignKey(
        'users',
        new TableForeignKey({
          columnNames: ['employeeRoleId'],
          referencedColumnNames: ['id'],
          referencedTableName: 'employee_roles',
          onDelete: 'SET NULL',
        }),
      );
    }

    // 4. Add index
    const hasIndex = usersTable?.indices.some(
      (idx) => idx.name === 'IDX_users_employeeRoleId',
    );
    if (!hasIndex) {
      await queryRunner.createIndex(
        'users',
        new TableIndex({
          name: 'IDX_users_employeeRoleId',
          columnNames: ['employeeRoleId'],
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop index
    const usersTable = await queryRunner.getTable('users');
    if (usersTable) {
      const index = usersTable.indices.find(
        (idx) => idx.name === 'IDX_users_employeeRoleId',
      );
      if (index) {
        await queryRunner.dropIndex('users', index);
      }
    }

    // Drop foreign key
    if (usersTable) {
      const fk = usersTable.foreignKeys.find((f) =>
        f.columnNames.includes('employeeRoleId'),
      );
      if (fk) {
        await queryRunner.dropForeignKey('users', fk);
      }
    }

    // Drop column
    const hasEmployeeRoleId = await queryRunner.hasColumn(
      'users',
      'employeeRoleId',
    );
    if (hasEmployeeRoleId) {
      await queryRunner.dropColumn('users', 'employeeRoleId');
    }

    // Drop table
    await queryRunner.dropTable('employee_roles');
  }
}
