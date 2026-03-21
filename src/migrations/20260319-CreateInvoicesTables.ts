import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

export class CreateInvoicesTables20260319_1700000000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('invoices')) return;

    const dialect = queryRunner.connection.options.type;
    const uuidDefault =
      dialect === 'postgres' ? 'uuid_generate_v4()' : 'UUID()';

    if (dialect === 'postgres') {
      await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    }

    await queryRunner.createTable(
      new Table({
        name: 'invoices',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isNullable: false,
            default: uuidDefault,
          },
          {
            name: 'invoiceNumber',
            type: 'varchar',
            length: '50',
            isUnique: true,
          },
          { name: 'customerId', type: 'uuid', isNullable: false },
          { name: 'currency', type: 'varchar', length: '10', default: "'USD'" },
          { name: 'issueDate', type: 'date', isNullable: false },
          { name: 'dueDate', type: 'date', isNullable: false },
          {
            name: 'status',
            type: 'varchar',
            length: '20',
            isNullable: false,
            default: "'DRAFT'",
          },
          {
            name: 'subtotal',
            type: 'numeric',
            precision: 12,
            scale: 2,
            isNullable: false,
            default: '0',
          },
          {
            name: 'taxTotal',
            type: 'numeric',
            precision: 12,
            scale: 2,
            isNullable: false,
            default: '0',
          },
          {
            name: 'total',
            type: 'numeric',
            precision: 12,
            scale: 2,
            isNullable: false,
            default: '0',
          },
          {
            name: 'amountPaid',
            type: 'numeric',
            precision: 12,
            scale: 2,
            isNullable: false,
            default: '0',
          },
          { name: 'notes', type: 'text', isNullable: true },
          { name: 'terms', type: 'text', isNullable: true },
          { name: 'sentAt', type: 'timestamp', isNullable: true },
          { name: 'cancelledAt', type: 'timestamp', isNullable: true },
          { name: 'cancelReason', type: 'text', isNullable: true },
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
            referencedTableName: 'customers',
            referencedColumnNames: ['id'],
          }),
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'invoice_items',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isNullable: false,
            default: uuidDefault,
          },
          { name: 'invoiceId', type: 'uuid', isNullable: false },
          { name: 'description', type: 'varchar', length: '255' },
          { name: 'quantity', type: 'numeric', precision: 12, scale: 2 },
          { name: 'unitPrice', type: 'numeric', precision: 12, scale: 2 },
          {
            name: 'taxRate',
            type: 'numeric',
            precision: 5,
            scale: 4,
            isNullable: false,
            default: '0',
          },
          { name: 'lineSubtotal', type: 'numeric', precision: 12, scale: 2 },
          { name: 'lineTax', type: 'numeric', precision: 12, scale: 2 },
          { name: 'lineTotal', type: 'numeric', precision: 12, scale: 2 },
          { name: 'position', type: 'int', isNullable: false, default: '0' },
        ],
        foreignKeys: [
          new TableForeignKey({
            columnNames: ['invoiceId'],
            referencedTableName: 'invoices',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          }),
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'invoice_payments',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isNullable: false,
            default: uuidDefault,
          },
          { name: 'invoiceId', type: 'uuid', isNullable: false },
          {
            name: 'amount',
            type: 'numeric',
            precision: 12,
            scale: 2,
            isNullable: false,
          },
          { name: 'paymentDate', type: 'date', isNullable: false },
          { name: 'method', type: 'varchar', length: '30', isNullable: false },
          {
            name: 'reference',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          { name: 'notes', type: 'text', isNullable: true },
          {
            name: 'createdAt',
            type: 'timestamp',
            isNullable: false,
            default: 'now()',
          },
        ],
        foreignKeys: [
          new TableForeignKey({
            columnNames: ['invoiceId'],
            referencedTableName: 'invoices',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          }),
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('invoice_payments')) {
      await queryRunner.dropTable('invoice_payments');
    }
    if (await queryRunner.hasTable('invoice_items')) {
      await queryRunner.dropTable('invoice_items');
    }
    if (await queryRunner.hasTable('invoices')) {
      await queryRunner.dropTable('invoices');
    }
  }
}
