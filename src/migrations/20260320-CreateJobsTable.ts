import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

export class CreateJobsTable20260320_1700000000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('jobs')) return;

    const dialect = queryRunner.connection.options.type;
    const uuidDefault =
      dialect === 'postgres' ? 'uuid_generate_v4()' : 'UUID()';
    const boolDefault =
      dialect === 'mysql' || dialect === 'mariadb' ? '0' : 'false';

    if (dialect === 'postgres') {
      // Required for uuid_generate_v4().
      await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    }

    await queryRunner.createTable(
      new Table({
        name: 'jobs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isNullable: false,
            default: uuidDefault,
          },
          {
            name: 'customerId',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'systemType',
            type: 'varchar',
            length: '10',
            isNullable: false,
          },
          {
            name: 'jobStatus',
            type: 'varchar',
            length: '32',
            isNullable: false,
            default: "'lead'",
          },
          {
            name: 'systemSizeKw',
            type: 'numeric',
            precision: 12,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'batterySizeKwh',
            type: 'numeric',
            precision: 12,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'projectPrice',
            type: 'numeric',
            precision: 12,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'contractSigned',
            type: 'boolean',
            isNullable: false,
            default: boolDefault,
          },
          {
            name: 'depositAmount',
            type: 'numeric',
            precision: 12,
            scale: 2,
            isNullable: false,
            default: '0',
          },
          {
            name: 'depositPaid',
            type: 'boolean',
            isNullable: false,
            default: boolDefault,
          },
          {
            name: 'depositDate',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'installDate',
            type: 'date',
            isNullable: true,
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
        foreignKeys: [
          new TableForeignKey({
            columnNames: ['customerId'],
            referencedColumnNames: ['id'],
            referencedTableName: 'customers',
          }),
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('jobs')) {
      await queryRunner.dropTable('jobs');
    }
  }
}
