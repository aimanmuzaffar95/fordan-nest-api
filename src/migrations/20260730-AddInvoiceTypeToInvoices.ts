import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds `invoiceType` to `invoices` (deposit / final / custom) so the type
 * chosen on the generate page persists instead of falling back to 'custom'.
 */
export class AddInvoiceTypeToInvoices20260730_1700000001100 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('invoices', 'invoiceType'))) {
      await queryRunner.addColumn(
        'invoices',
        new TableColumn({
          name: 'invoiceType',
          type: 'varchar',
          length: '20',
          default: "'custom'",
          isNullable: false,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('invoices', 'invoiceType')) {
      await queryRunner.dropColumn('invoices', 'invoiceType');
    }
  }
}
