import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

export class CreateEmployeeFormsTable20260325_1700000000009
  implements MigrationInterface
{
  private getDialectDefaults(queryRunner: QueryRunner) {
    const dialect = queryRunner.connection.options.type;
    const uuidDefault =
      dialect === 'postgres' ? 'uuid_generate_v4()' : 'UUID()';
    const boolFalseDefault =
      dialect === 'mysql' || dialect === 'mariadb' ? '0' : 'false';

    return { dialect, uuidDefault, boolFalseDefault };
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const { dialect, uuidDefault, boolFalseDefault } =
      this.getDialectDefaults(queryRunner);

    if (dialect === 'postgres') {
      await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    }

    if (await queryRunner.hasTable('employee_forms')) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        name: 'employee_forms',
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
            isUnique: true,
          },
          { name: 'firstName', type: 'varchar', length: '100', isNullable: false },
          { name: 'surname', type: 'varchar', length: '100', isNullable: false },
          { name: 'dateOfBirth', type: 'varchar', length: '20', isNullable: true },
          { name: 'driversLicenseNo', type: 'varchar', length: '100', isNullable: true },
          { name: 'phoneMobile', type: 'varchar', length: '30', isNullable: false },
          { name: 'phoneHome', type: 'varchar', length: '30', isNullable: true },
          { name: 'email', type: 'varchar', length: '255', isNullable: false },
          { name: 'homeAddress', type: 'varchar', length: '255', isNullable: true },
          { name: 'suburb', type: 'varchar', length: '100', isNullable: true },
          { name: 'state', type: 'varchar', length: '100', isNullable: true },
          { name: 'postcode', type: 'varchar', length: '20', isNullable: true },
          { name: 'accountName', type: 'varchar', length: '255', isNullable: true },
          { name: 'bsb', type: 'varchar', length: '20', isNullable: true },
          { name: 'accountNo', type: 'varchar', length: '50', isNullable: true },
          {
            name: 'hasSuperannuation',
            type: 'boolean',
            isNullable: false,
            default: boolFalseDefault,
          },
          { name: 'superFundName', type: 'varchar', length: '255', isNullable: true },
          { name: 'superMemberNumber', type: 'varchar', length: '255', isNullable: true },
          { name: 'emergencyContactName', type: 'varchar', length: '100', isNullable: true },
          { name: 'emergencyContactRelationship', type: 'varchar', length: '100', isNullable: true },
          { name: 'emergencyContactPhoneMobile', type: 'varchar', length: '30', isNullable: true },
          { name: 'emergencyContactPhoneHome', type: 'varchar', length: '30', isNullable: true },
          { name: 'emergencyContactAddress', type: 'varchar', length: '255', isNullable: true },
          {
            name: 'submittedAt',
            type: 'timestamp',
            isNullable: false,
            default: 'now()',
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

    await queryRunner.createForeignKey(
      'employee_forms',
      new TableForeignKey({
        columnNames: ['userId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('employee_forms');
    const userForeignKey = table?.foreignKeys.find((foreignKey) =>
      foreignKey.columnNames.includes('userId'),
    );

    if (userForeignKey) {
      await queryRunner.dropForeignKey('employee_forms', userForeignKey);
    }

    if (await queryRunner.hasTable('employee_forms')) {
      await queryRunner.dropTable('employee_forms');
    }
  }
}
