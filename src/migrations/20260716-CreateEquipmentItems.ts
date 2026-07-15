import { MigrationInterface, QueryRunner, Table } from 'typeorm';

/**
 * The EquipmentItem entity (`equipment_items`) never had a migration, so the
 * generic Equipment Items feature 500'd on every migrations-based deployment
 * (staging/production run with DATABASE_SYNCHRONIZE=false). Mirrors
 * src/equipment/entities/equipment-item.entity.ts.
 */
export class CreateEquipmentItems20260716_1700000000400 implements MigrationInterface {
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

    if (!(await queryRunner.hasTable('equipment_items'))) {
      await queryRunner.createTable(
        new Table({
          name: 'equipment_items',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              default: uuidDefault,
            },
            {
              name: 'name',
              type: 'varchar',
              length: '200',
              isNullable: false,
            },
            {
              name: 'category',
              type: 'varchar',
              length: '64',
              isNullable: false,
            },
            { name: 'sku', type: 'varchar', length: '64', isNullable: false },
            { name: 'stock', type: 'int', default: 0 },
            {
              name: 'unit',
              type: 'varchar',
              length: '32',
              default: "'unit'",
            },
            { name: 'lowStockThreshold', type: 'int', default: 5 },
            {
              name: 'createdAt',
              type: dialect === 'postgres' ? 'timestamptz' : 'datetime',
              default: 'CURRENT_TIMESTAMP',
            },
            {
              name: 'updatedAt',
              type: dialect === 'postgres' ? 'timestamptz' : 'datetime',
              default: 'CURRENT_TIMESTAMP',
            },
          ],
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('equipment_items')) {
      await queryRunner.dropTable('equipment_items');
    }
  }
}
