import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateCustomersTable20260319_1700000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('customers')) return;

    const dialect = queryRunner.connection.options.type;
    const uuidDefault =
      dialect === 'postgres' ? 'uuid_generate_v4()' : 'UUID()';

    if (dialect === 'postgres') {
      await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    }

    await queryRunner.createTable(
      new Table({
        name: 'customers',
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
          { name: 'address', type: 'varchar', length: '255', isNullable: true },
          { name: 'phone', type: 'varchar', length: '30' },
          {
            name: 'email',
            type: 'varchar',
            length: '255',
            isNullable: false,
            isUnique: true,
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('customers'))) return;
    await queryRunner.dropTable('customers');
  }
}
