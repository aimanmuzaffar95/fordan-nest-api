import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * The StaffAvailability (`staff_availability`) and DeviceRegistration
 * (`device_registrations`) entities never had migrations, so installer
 * availability and push-device registration 500'd on every migrations-based
 * deployment (staging/production run with DATABASE_SYNCHRONIZE=false).
 * Mirrors src/availability/entities/staff-availability.entity.ts and
 * src/devices/entities/device-registration.entity.ts.
 */
export class CreateStaffAvailabilityAndDeviceRegistrations20260716_1700000000500 implements MigrationInterface {
  private dialectDefaults(queryRunner: QueryRunner) {
    const dialect = queryRunner.connection.options.type;
    return {
      dialect,
      uuidDefault: dialect === 'postgres' ? 'uuid_generate_v4()' : 'UUID()',
      timestampType: dialect === 'postgres' ? 'timestamp' : 'datetime',
    };
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const { dialect, uuidDefault, timestampType } =
      this.dialectDefaults(queryRunner);

    if (dialect === 'postgres') {
      await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    }

    if (!(await queryRunner.hasTable('staff_availability'))) {
      await queryRunner.createTable(
        new Table({
          name: 'staff_availability',
          columns: [
            { name: 'id', type: 'uuid', isPrimary: true, default: uuidDefault },
            { name: 'userId', type: 'uuid', isNullable: false },
            { name: 'startsAt', type: timestampType, isNullable: false },
            { name: 'endsAt', type: timestampType, isNullable: false },
            { name: 'notes', type: 'text', isNullable: true },
            {
              name: 'recurrenceRule',
              type: 'varchar',
              length: '128',
              isNullable: true,
            },
            {
              name: 'source',
              type: 'varchar',
              length: '32',
              default: "'mobile'",
            },
            {
              name: 'createdAt',
              type: timestampType,
              default: 'CURRENT_TIMESTAMP',
            },
          ],
        }),
      );
      await queryRunner.createIndex(
        'staff_availability',
        new TableIndex({
          name: 'idx_staff_availability_user_starts',
          columnNames: ['userId', 'startsAt'],
        }),
      );
    }

    if (!(await queryRunner.hasTable('device_registrations'))) {
      await queryRunner.createTable(
        new Table({
          name: 'device_registrations',
          columns: [
            { name: 'id', type: 'uuid', isPrimary: true, default: uuidDefault },
            { name: 'userId', type: 'uuid', isNullable: false },
            {
              name: 'platform',
              type: 'varchar',
              length: '16',
              isNullable: false,
            },
            {
              name: 'pushToken',
              type: 'varchar',
              length: '512',
              isNullable: false,
            },
            {
              name: 'createdAt',
              type: timestampType,
              default: 'CURRENT_TIMESTAMP',
            },
            {
              name: 'updatedAt',
              type: timestampType,
              default: 'CURRENT_TIMESTAMP',
            },
          ],
        }),
      );
      await queryRunner.createIndex(
        'device_registrations',
        new TableIndex({
          name: 'idx_device_reg_user_platform',
          columnNames: ['userId', 'platform'],
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('device_registrations')) {
      await queryRunner.dropTable('device_registrations');
    }
    if (await queryRunner.hasTable('staff_availability')) {
      await queryRunner.dropTable('staff_availability');
    }
  }
}
