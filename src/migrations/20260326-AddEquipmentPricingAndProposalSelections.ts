import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class AddEquipmentPricingAndProposalSelections20260326_1700000000012
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.addDefaultUnitPrice(queryRunner, 'solar_panels');
    await this.addDefaultUnitPrice(queryRunner, 'inverters');
    await this.addDefaultUnitPrice(queryRunner, 'batteries');

    if (await queryRunner.hasTable('job_proposal_selections')) {
      return;
    }

    const dialect = queryRunner.connection.options.type;
    const uuidDefault =
      dialect === 'postgres' ? 'uuid_generate_v4()' : 'UUID()';

    if (dialect === 'postgres') {
      await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
      await queryRunner.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_type WHERE typname = 'job_proposal_selections_equipmenttype_enum'
          ) THEN
            CREATE TYPE "job_proposal_selections_equipmenttype_enum" AS ENUM ('panel', 'inverter', 'battery');
          END IF;
        END $$;
      `);
    }

    await queryRunner.createTable(
      new Table({
        name: 'job_proposal_selections',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isNullable: false,
            default: uuidDefault,
          },
          {
            name: 'jobId',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'equipmentType',
            type:
              dialect === 'postgres'
                ? 'job_proposal_selections_equipmenttype_enum'
                : 'enum',
            enum:
              dialect === 'postgres'
                ? undefined
                : ['panel', 'inverter', 'battery'],
            isNullable: false,
          },
          {
            name: 'equipmentId',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'equipmentNameSnapshot',
            type: 'varchar',
            length: '200',
            isNullable: false,
          },
          {
            name: 'equipmentSubtitleSnapshot',
            type: 'varchar',
            length: '200',
            isNullable: false,
          },
          {
            name: 'defaultUnitPriceSnapshot',
            type: 'numeric',
            precision: 12,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'proposalUnitPrice',
            type: 'numeric',
            precision: 12,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'quantity',
            type: 'int',
            isNullable: false,
          },
          {
            name: 'sortOrder',
            type: 'int',
            default: 0,
            isNullable: false,
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
      }),
    );

    await queryRunner.createForeignKey(
      'job_proposal_selections',
      new TableForeignKey({
        columnNames: ['jobId'],
        referencedTableName: 'jobs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'job_proposal_selections',
      new TableIndex({
        name: 'IDX_job_proposal_selections_job_sort',
        columnNames: ['jobId', 'sortOrder'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('job_proposal_selections')) {
      await queryRunner.dropTable('job_proposal_selections');
    }

    await this.dropDefaultUnitPrice(queryRunner, 'batteries');
    await this.dropDefaultUnitPrice(queryRunner, 'inverters');
    await this.dropDefaultUnitPrice(queryRunner, 'solar_panels');

    if (queryRunner.connection.options.type === 'postgres') {
      await queryRunner.query(
        'DROP TYPE IF EXISTS "job_proposal_selections_equipmenttype_enum"',
      );
    }
  }

  private async addDefaultUnitPrice(
    queryRunner: QueryRunner,
    tableName: string,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    if (!table) return;
    if (table.findColumnByName('defaultUnitPrice')) return;

    await queryRunner.addColumn(
      tableName,
      new TableColumn({
        name: 'defaultUnitPrice',
        type: 'numeric',
        precision: 12,
        scale: 2,
        default: 0,
        isNullable: false,
      }),
    );
  }

  private async dropDefaultUnitPrice(
    queryRunner: QueryRunner,
    tableName: string,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    if (!table?.findColumnByName('defaultUnitPrice')) return;
    await queryRunner.dropColumn(tableName, 'defaultUnitPrice');
  }
}
