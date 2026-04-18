import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

export class CreateAdminSettingsTable20260327_1700000000014 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('admin_settings')) {
      return;
    }

    await queryRunner.createTable(
      new Table({
        name: 'admin_settings',
        columns: [
          {
            name: 'id',
            type: 'varchar',
            length: '32',
            isPrimary: true,
            isNullable: false,
          },
          {
            name: 'overridePreMeter',
            type: 'boolean',
            isNullable: false,
            default: false,
          },
          {
            name: 'calendarScopeEnforced',
            type: 'boolean',
            isNullable: false,
            default: true,
          },
          {
            name: 'invoiceOverdueDays',
            type: 'int',
            isNullable: false,
            default: 14,
          },
          {
            name: 'preMeterPendingDays',
            type: 'int',
            isNullable: false,
            default: 7,
          },
          {
            name: 'installWarningDays',
            type: 'int',
            isNullable: false,
            default: 3,
          },
          {
            name: 'postMeterDeadlineDays',
            type: 'int',
            isNullable: false,
            default: 2,
          },
          {
            name: 'maxJobsPerTeamPerDay',
            type: 'int',
            isNullable: false,
            default: 2,
          },
          {
            name: 'updatedByUserId',
            type: 'uuid',
            isNullable: true,
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
        foreignKeys: [
          new TableForeignKey({
            columnNames: ['updatedByUserId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          }),
        ],
      }),
    );

    // Seed only the columns introduced by this migration. Using TypeORM's
    // insert builder against the registered entity can pull in fields added by
    // later migrations, which breaks fresh bootstraps.
    await queryRunner.query(
      `
        INSERT INTO "admin_settings" (
          "id",
          "overridePreMeter",
          "calendarScopeEnforced",
          "invoiceOverdueDays",
          "preMeterPendingDays",
          "installWarningDays",
          "postMeterDeadlineDays",
          "maxJobsPerTeamPerDay"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      ['global', false, true, 14, 7, 3, 2, 2],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('admin_settings')) {
      await queryRunner.dropTable('admin_settings');
    }
  }
}
