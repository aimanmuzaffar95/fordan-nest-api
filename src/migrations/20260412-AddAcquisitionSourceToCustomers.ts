import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddAcquisitionSourceToCustomers20260412_1700000000902 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('customers');
    if (!hasTable) return;

    const hasAcquisitionSource = await queryRunner.hasColumn(
      'customers',
      'acquisitionSource',
    );
    if (!hasAcquisitionSource) {
      await queryRunner.addColumn(
        'customers',
        new TableColumn({
          name: 'acquisitionSource',
          type: 'varchar',
          length: '40',
          isNullable: true,
        }),
      );
    }

    const hasAcquisitionSourceOther = await queryRunner.hasColumn(
      'customers',
      'acquisitionSourceOther',
    );
    if (!hasAcquisitionSourceOther) {
      await queryRunner.addColumn(
        'customers',
        new TableColumn({
          name: 'acquisitionSourceOther',
          type: 'varchar',
          length: '100',
          isNullable: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('customers');
    if (!hasTable) return;

    const hasAcquisitionSourceOther = await queryRunner.hasColumn(
      'customers',
      'acquisitionSourceOther',
    );
    if (hasAcquisitionSourceOther) {
      await queryRunner.dropColumn('customers', 'acquisitionSourceOther');
    }

    const hasAcquisitionSource = await queryRunner.hasColumn(
      'customers',
      'acquisitionSource',
    );
    if (hasAcquisitionSource) {
      await queryRunner.dropColumn('customers', 'acquisitionSource');
    }
  }
}
