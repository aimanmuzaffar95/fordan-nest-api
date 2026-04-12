import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

export class CreateCustomerAuditLogsTable20260412_1700000000320 implements MigrationInterface {
  private getDialectDefaults(queryRunner: QueryRunner) {
    const dialect = queryRunner.connection.options.type;
    const uuidDefault =
      dialect === 'postgres' ? 'uuid_generate_v4()' : 'UUID()';

    return { dialect, uuidDefault };
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const { dialect, uuidDefault } = this.getDialectDefaults(queryRunner);

    if (await queryRunner.hasTable('customer_audit_logs')) {
      return;
    }

    if (dialect === 'postgres') {
      await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    }

    await queryRunner.createTable(
      new Table({
        name: 'customer_audit_logs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isNullable: false,
            default: uuidDefault,
          },
          { name: 'customerId', type: 'uuid', isNullable: false },
          { name: 'performedByUserId', type: 'uuid', isNullable: true },
          {
            name: 'eventType',
            type: 'varchar',
            length: '100',
            isNullable: false,
          },
          { name: 'payload', type: 'json', isNullable: true },
          {
            name: 'createdAt',
            type: 'timestamp',
            isNullable: false,
            default:
              dialect === 'mysql' || dialect === 'mariadb'
                ? 'CURRENT_TIMESTAMP'
                : 'now()',
          },
        ],
        foreignKeys: [
          new TableForeignKey({
            columnNames: ['customerId'],
            referencedTableName: 'customers',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          }),
          new TableForeignKey({
            columnNames: ['performedByUserId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          }),
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('customer_audit_logs')) {
      await queryRunner.dropTable('customer_audit_logs');
    }
  }
}
