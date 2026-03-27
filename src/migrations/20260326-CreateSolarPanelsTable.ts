import { MigrationInterface, QueryRunner, Table } from 'typeorm';
import { SolarPanelStockStatus } from '../solar-panels/entities/solar-panel-stock-status.enum';

export class CreateSolarPanelsTable20260326_1700000000010 implements MigrationInterface {
  private getDialectDefaults(queryRunner: QueryRunner) {
    const dialect = queryRunner.connection.options.type;
    const uuidDefault =
      dialect === 'postgres' ? 'uuid_generate_v4()' : 'UUID()';

    return { dialect, uuidDefault };
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const { dialect, uuidDefault } = this.getDialectDefaults(queryRunner);

    if (dialect === 'postgres') {
      await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    }

    if (await queryRunner.hasTable('solar_panels')) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        name: 'solar_panels',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isNullable: false,
            default: uuidDefault,
          },
          { name: 'name', type: 'varchar', length: '150', isNullable: false },
          { name: 'brand', type: 'varchar', length: '100', isNullable: false },
          { name: 'model', type: 'varchar', length: '100', isNullable: false },
          {
            name: 'wattage',
            type: 'numeric',
            precision: 10,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'stockStatus',
            type: 'varchar',
            length: '30',
            default: `'${SolarPanelStockStatus.AVAILABLE}'`,
            isNullable: false,
          },
          {
            name: 'efficiency',
            type: 'numeric',
            precision: 5,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'dimensions',
            type: 'varchar',
            length: '120',
            isNullable: true,
          },
          {
            name: 'weightKg',
            type: 'numeric',
            precision: 10,
            scale: 2,
            isNullable: true,
          },
          { name: 'warrantyYears', type: 'int', isNullable: true },
          { name: 'notes', type: 'text', isNullable: true },
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
        uniques: [
          {
            name: 'UQ_solar_panels_brand_model',
            columnNames: ['brand', 'model'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('solar_panels')) {
      await queryRunner.dropTable('solar_panels');
    }
  }
}
