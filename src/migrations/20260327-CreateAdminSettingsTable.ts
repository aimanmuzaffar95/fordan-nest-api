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

    await queryRunner.manager
      .createQueryBuilder()
      .insert()
      .into('admin_settings')
      .values({
        id: 'global',
        overridePreMeter: false,
        calendarScopeEnforced: true,
        invoiceOverdueDays: 14,
        preMeterPendingDays: 7,
        installWarningDays: 3,
        postMeterDeadlineDays: 2,
        maxJobsPerTeamPerDay: 2,
      })
      .execute();
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('admin_settings')) {
      await queryRunner.dropTable('admin_settings');
    }
  }
}
