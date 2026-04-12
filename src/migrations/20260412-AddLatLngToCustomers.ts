import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddLatLngToCustomers1775960000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('customers');
    if (!hasTable) return;

    const hasLat = await queryRunner.hasColumn('customers', 'lat');
    if (!hasLat) {
      await queryRunner.addColumn(
        'customers',
        new TableColumn({
          name: 'lat',
          type: 'decimal',
          precision: 10,
          scale: 7,
          isNullable: true,
        }),
      );
    }

    const hasLng = await queryRunner.hasColumn('customers', 'lng');
    if (!hasLng) {
      await queryRunner.addColumn(
        'customers',
        new TableColumn({
          name: 'lng',
          type: 'decimal',
          precision: 11,
          scale: 7,
          isNullable: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('customers');
    if (!hasTable) return;

    if (await queryRunner.hasColumn('customers', 'lng')) {
      await queryRunner.dropColumn('customers', 'lng');
    }
    if (await queryRunner.hasColumn('customers', 'lat')) {
      await queryRunner.dropColumn('customers', 'lat');
    }
  }
}
