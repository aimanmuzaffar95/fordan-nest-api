import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

export class CreateJobsTable20260320 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'jobs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isNullable: false,
            default: 'uuid_generate_v4()',
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
            default: 'false',
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
            default: 'false',
          },
          {
            name: 'depositDate',
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
    await queryRunner.dropTable('jobs');
  }
}
