import { MigrationInterface, QueryRunner, Table } from 'typeorm';
import { InverterStockStatus } from '../inverters/entities/inverter-stock-status.enum';
import { BatteryStockStatus } from '../batteries/entities/battery-stock-status.enum';

export class CreateInvertersAndBatteriesTables20260326_1800000000009 implements MigrationInterface {
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

    if (!(await queryRunner.hasTable('inverters'))) {
      await queryRunner.createTable(
        new Table({
          name: 'inverters',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isNullable: false,
              default: uuidDefault,
            },
            { name: 'name', type: 'varchar', length: '150', isNullable: false },
            {
              name: 'brand',
              type: 'varchar',
              length: '100',
              isNullable: false,
            },
            {
              name: 'model',
              type: 'varchar',
              length: '100',
              isNullable: false,
            },
            {
              name: 'capacityKw',
              type: 'numeric',
              precision: 10,
              scale: 2,
              isNullable: false,
            },
            {
              name: 'stockStatus',
              type: 'varchar',
              length: '30',
              default: `'${InverterStockStatus.AVAILABLE}'`,
              isNullable: false,
            },
            {
              name: 'inverterType',
              type: 'varchar',
              length: '50',
              isNullable: true,
            },
            {
              name: 'phases',
              type: 'varchar',
              length: '30',
              isNullable: true,
            },
            {
              name: 'efficiency',
              type: 'numeric',
              precision: 5,
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
              name: 'UQ_inverters_brand_model',
              columnNames: ['brand', 'model'],
            },
          ],
        }),
      );
    }

    if (!(await queryRunner.hasTable('batteries'))) {
      await queryRunner.createTable(
        new Table({
          name: 'batteries',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isNullable: false,
              default: uuidDefault,
            },
            { name: 'name', type: 'varchar', length: '150', isNullable: false },
            {
              name: 'brand',
              type: 'varchar',
              length: '100',
              isNullable: false,
            },
            {
              name: 'model',
              type: 'varchar',
              length: '100',
              isNullable: false,
            },
            {
              name: 'capacityKwh',
              type: 'numeric',
              precision: 10,
              scale: 2,
              isNullable: false,
            },
            {
              name: 'stockStatus',
              type: 'varchar',
              length: '30',
              default: `'${BatteryStockStatus.AVAILABLE}'`,
              isNullable: false,
            },
            {
              name: 'voltage',
              type: 'numeric',
              precision: 10,
              scale: 2,
              isNullable: true,
            },
            {
              name: 'chemistry',
              type: 'varchar',
              length: '50',
              isNullable: true,
            },
            { name: 'cycleLife', type: 'int', isNullable: true },
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
              name: 'UQ_batteries_brand_model',
              columnNames: ['brand', 'model'],
            },
          ],
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('batteries')) {
      await queryRunner.dropTable('batteries');
    }

    if (await queryRunner.hasTable('inverters')) {
      await queryRunner.dropTable('inverters');
    }
  }
}
