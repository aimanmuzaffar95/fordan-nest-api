import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

export class CreateOrganizationProfileAndSystemAuditLogs20260418_1700000000200 implements MigrationInterface {
  private getDialectDefaults(queryRunner: QueryRunner) {
    const dialect = queryRunner.connection.options.type;
    const uuidDefault =
      dialect === 'postgres' ? 'uuid_generate_v4()' : 'UUID()';
    const boolTrueDefault =
      dialect === 'mysql' || dialect === 'mariadb' ? '1' : 'true';
    return { dialect, uuidDefault, boolTrueDefault };
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const { dialect, uuidDefault, boolTrueDefault } =
      this.getDialectDefaults(queryRunner);

    if (dialect === 'postgres') {
      await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    }

    if (!(await queryRunner.hasTable('organization_profile'))) {
      await queryRunner.createTable(
        new Table({
          name: 'organization_profile',
          columns: [
            {
              name: 'id',
              type: 'varchar',
              length: '32',
              isPrimary: true,
              isNullable: false,
            },
            {
              name: 'legalName',
              type: 'varchar',
              length: '255',
              isNullable: true,
            },
            {
              name: 'tradingName',
              type: 'varchar',
              length: '255',
              isNullable: true,
            },
            {
              name: 'registeredAddressLine1',
              type: 'varchar',
              length: '255',
              isNullable: true,
            },
            {
              name: 'registeredAddressLine2',
              type: 'varchar',
              length: '255',
              isNullable: true,
            },
            { name: 'city', type: 'varchar', length: '120', isNullable: true },
            { name: 'state', type: 'varchar', length: '80', isNullable: true },
            {
              name: 'postalCode',
              type: 'varchar',
              length: '30',
              isNullable: true,
            },
            {
              name: 'country',
              type: 'varchar',
              length: '80',
              isNullable: true,
            },
            {
              name: 'billingSameAsRegistered',
              type: 'boolean',
              isNullable: false,
              default: boolTrueDefault,
            },
            {
              name: 'billingAddressLine1',
              type: 'varchar',
              length: '255',
              isNullable: true,
            },
            {
              name: 'billingAddressLine2',
              type: 'varchar',
              length: '255',
              isNullable: true,
            },
            {
              name: 'billingCity',
              type: 'varchar',
              length: '120',
              isNullable: true,
            },
            {
              name: 'billingState',
              type: 'varchar',
              length: '80',
              isNullable: true,
            },
            {
              name: 'billingPostalCode',
              type: 'varchar',
              length: '30',
              isNullable: true,
            },
            {
              name: 'billingCountry',
              type: 'varchar',
              length: '80',
              isNullable: true,
            },
            {
              name: 'taxIdPrimary',
              type: 'varchar',
              length: '80',
              isNullable: true,
            },
            {
              name: 'taxIdSecondary',
              type: 'varchar',
              length: '80',
              isNullable: true,
            },
            {
              name: 'defaultCurrency',
              type: 'varchar',
              length: '8',
              isNullable: false,
              default: "'AUD'",
            },
            {
              name: 'defaultTimezone',
              type: 'varchar',
              length: '80',
              isNullable: false,
              default: "'Australia/Sydney'",
            },
            {
              name: 'documentsContactName',
              type: 'varchar',
              length: '160',
              isNullable: true,
            },
            {
              name: 'documentsContactEmail',
              type: 'varchar',
              length: '255',
              isNullable: true,
            },
            {
              name: 'documentsContactPhone',
              type: 'varchar',
              length: '40',
              isNullable: true,
            },
            { name: 'updatedByUserId', type: 'uuid', isNullable: true },
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
        .into('organization_profile')
        .values({
          id: 'global',
          billingSameAsRegistered: true,
          defaultCurrency: 'AUD',
          defaultTimezone: 'Australia/Sydney',
        })
        .execute();
    }

    if (!(await queryRunner.hasTable('system_audit_logs'))) {
      await queryRunner.createTable(
        new Table({
          name: 'system_audit_logs',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isNullable: false,
              default: uuidDefault,
            },
            {
              name: 'createdAt',
              type: 'timestamp',
              isNullable: false,
              default: 'now()',
            },
            { name: 'actorUserId', type: 'uuid', isNullable: true },
            {
              name: 'action',
              type: 'varchar',
              length: '96',
              isNullable: false,
            },
            {
              name: 'resourceType',
              type: 'varchar',
              length: '64',
              isNullable: true,
            },
            {
              name: 'resourceId',
              type: 'varchar',
              length: '64',
              isNullable: true,
            },
            { name: 'metadata', type: 'json', isNullable: true },
          ],
          foreignKeys: [
            new TableForeignKey({
              columnNames: ['actorUserId'],
              referencedTableName: 'users',
              referencedColumnNames: ['id'],
              onDelete: 'SET NULL',
            }),
          ],
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('system_audit_logs')) {
      await queryRunner.dropTable('system_audit_logs');
    }
    if (await queryRunner.hasTable('organization_profile')) {
      await queryRunner.dropTable('organization_profile');
    }
  }
}
