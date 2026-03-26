import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class RemoveEquipmentCatalogNameColumns20260326_1900000000010 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.dropNameColumn(queryRunner, 'solar_panels');
    await this.dropNameColumn(queryRunner, 'inverters');
    await this.dropNameColumn(queryRunner, 'batteries');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.restoreNameColumn(queryRunner, 'solar_panels');
    await this.restoreNameColumn(queryRunner, 'inverters');
    await this.restoreNameColumn(queryRunner, 'batteries');
  }

  private async dropNameColumn(
    queryRunner: QueryRunner,
    tableName: string,
  ): Promise<void> {
    if (
      (await queryRunner.hasTable(tableName)) &&
      (await queryRunner.hasColumn(tableName, 'name'))
    ) {
      await queryRunner.dropColumn(tableName, 'name');
    }
  }

  private async restoreNameColumn(
    queryRunner: QueryRunner,
    tableName: string,
  ): Promise<void> {
    if (
      !(await queryRunner.hasTable(tableName)) ||
      (await queryRunner.hasColumn(tableName, 'name'))
    ) {
      return;
    }

    await queryRunner.addColumn(
      tableName,
      new TableColumn({
        name: 'name',
        type: 'varchar',
        length: '150',
        isNullable: false,
        default: "''",
      }),
    );

    const dialect = queryRunner.connection.options.type;

    if (dialect === 'mysql' || dialect === 'mariadb') {
      await queryRunner.query(
        `UPDATE ${tableName} SET name = TRIM(CONCAT(COALESCE(brand, ''), ' ', COALESCE(model, '')))`,
      );
      return;
    }

    await queryRunner.query(
      `UPDATE ${tableName} SET name = TRIM(COALESCE(brand, '') || ' ' || COALESCE(model, ''))`,
    );
  }
}
