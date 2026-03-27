import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class AttendanceAndAvailability2026032814000000010 implements MigrationInterface {
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

    const jobsTable = await queryRunner.getTable('jobs');
    if (jobsTable && !jobsTable.findColumnByName('jobSiteLatitude')) {
      await queryRunner.addColumn(
        'jobs',
        new TableColumn({
          name: 'jobSiteLatitude',
          type: 'decimal',
          precision: 10,
          scale: 7,
          isNullable: true,
        }),
      );
    }
    if (jobsTable && !jobsTable.findColumnByName('jobSiteLongitude')) {
      await queryRunner.addColumn(
        'jobs',
        new TableColumn({
          name: 'jobSiteLongitude',
          type: 'decimal',
          precision: 10,
          scale: 7,
          isNullable: true,
        }),
      );
    }

    const adminTable = await queryRunner.getTable('admin_settings');
    if (adminTable && !adminTable.findColumnByName('attendanceGeofenceMode')) {
      await queryRunner.addColumn(
        'admin_settings',
        new TableColumn({
          name: 'attendanceGeofenceMode',
          type: 'varchar',
          length: '20',
          isNullable: false,
          default: "'audit_only'",
        }),
      );
    }
    if (
      adminTable &&
      !adminTable.findColumnByName('attendanceGeofenceRadiusMeters')
    ) {
      await queryRunner.addColumn(
        'admin_settings',
        new TableColumn({
          name: 'attendanceGeofenceRadiusMeters',
          type: 'int',
          isNullable: false,
          default: '150',
        }),
      );
    }
    if (
      adminTable &&
      !adminTable.findColumnByName('attendanceMaxGpsAccuracyMeters')
    ) {
      await queryRunner.addColumn(
        'admin_settings',
        new TableColumn({
          name: 'attendanceMaxGpsAccuracyMeters',
          type: 'int',
          isNullable: false,
          default: '100',
        }),
      );
    }

    if (!(await queryRunner.hasTable('attendance_sessions'))) {
      await queryRunner.createTable(
        new Table({
          name: 'attendance_sessions',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isNullable: false,
              default: uuidDefault,
            },
            { name: 'userId', type: 'uuid', isNullable: false },
            { name: 'jobId', type: 'uuid', isNullable: true },
            { name: 'assignmentId', type: 'uuid', isNullable: true },
            {
              name: 'clockInAt',
              type: 'timestamp',
              isNullable: false,
              default:
                dialect === 'mysql' || dialect === 'mariadb'
                  ? 'CURRENT_TIMESTAMP'
                  : 'now()',
            },
            { name: 'clockOutAt', type: 'timestamp', isNullable: true },
            {
              name: 'clockInLatitude',
              type: 'decimal',
              precision: 10,
              scale: 7,
              isNullable: true,
            },
            {
              name: 'clockInLongitude',
              type: 'decimal',
              precision: 10,
              scale: 7,
              isNullable: true,
            },
            {
              name: 'clockInAccuracyMeters',
              type: 'decimal',
              precision: 10,
              scale: 2,
              isNullable: true,
            },
            { name: 'clockInCapturedAt', type: 'timestamp', isNullable: true },
            {
              name: 'clockOutLatitude',
              type: 'decimal',
              precision: 10,
              scale: 7,
              isNullable: true,
            },
            {
              name: 'clockOutLongitude',
              type: 'decimal',
              precision: 10,
              scale: 7,
              isNullable: true,
            },
            {
              name: 'clockOutAccuracyMeters',
              type: 'decimal',
              precision: 10,
              scale: 2,
              isNullable: true,
            },
            { name: 'clockOutCapturedAt', type: 'timestamp', isNullable: true },
            {
              name: 'distanceFromSiteMetersIn',
              type: 'decimal',
              precision: 10,
              scale: 2,
              isNullable: true,
            },
            {
              name: 'distanceFromSiteMetersOut',
              type: 'decimal',
              precision: 10,
              scale: 2,
              isNullable: true,
            },
            {
              name: 'geofenceFlaggedIn',
              type: 'boolean',
              isNullable: false,
              default: 'false',
            },
            {
              name: 'geofenceFlaggedOut',
              type: 'boolean',
              isNullable: false,
              default: 'false',
            },
            {
              name: 'offSiteAcknowledgedReasonIn',
              type: 'text',
              isNullable: true,
            },
            {
              name: 'offSiteAcknowledgedReasonOut',
              type: 'text',
              isNullable: true,
            },
            { name: 'correctionNote', type: 'text', isNullable: true },
            { name: 'correctedAt', type: 'timestamp', isNullable: true },
            { name: 'correctedByUserId', type: 'uuid', isNullable: true },
            {
              name: 'createdAt',
              type: 'timestamp',
              isNullable: false,
              default:
                dialect === 'mysql' || dialect === 'mariadb'
                  ? 'CURRENT_TIMESTAMP'
                  : 'now()',
            },
            {
              name: 'updatedAt',
              type: 'timestamp',
              isNullable: false,
              default:
                dialect === 'mysql' || dialect === 'mariadb'
                  ? 'CURRENT_TIMESTAMP'
                  : 'now()',
            },
          ],
          foreignKeys: [
            new TableForeignKey({
              columnNames: ['userId'],
              referencedTableName: 'users',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            }),
            new TableForeignKey({
              columnNames: ['jobId'],
              referencedTableName: 'jobs',
              referencedColumnNames: ['id'],
              onDelete: 'SET NULL',
            }),
            new TableForeignKey({
              columnNames: ['assignmentId'],
              referencedTableName: 'assignments',
              referencedColumnNames: ['id'],
              onDelete: 'SET NULL',
            }),
            new TableForeignKey({
              columnNames: ['correctedByUserId'],
              referencedTableName: 'users',
              referencedColumnNames: ['id'],
              onDelete: 'SET NULL',
            }),
          ],
          indices: [
            new TableIndex({
              name: 'IDX_attendance_sessions_user_clock_in',
              columnNames: ['userId', 'clockInAt'],
            }),
          ],
        }),
      );
    }

    if (!(await queryRunner.hasTable('staff_availability'))) {
      await queryRunner.createTable(
        new Table({
          name: 'staff_availability',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isNullable: false,
              default: uuidDefault,
            },
            { name: 'userId', type: 'uuid', isNullable: false },
            {
              name: 'startsAt',
              type: 'timestamp',
              isNullable: false,
            },
            {
              name: 'endsAt',
              type: 'timestamp',
              isNullable: false,
            },
            { name: 'recurrenceRule', type: 'text', isNullable: true },
            { name: 'notes', type: 'text', isNullable: true },
            {
              name: 'source',
              type: 'varchar',
              length: '20',
              isNullable: false,
              default: "'mobile'",
            },
            {
              name: 'createdAt',
              type: 'timestamp',
              isNullable: false,
              default:
                dialect === 'mysql' || dialect === 'mariadb'
                  ? 'CURRENT_TIMESTAMP'
                  : 'now()',
            },
            {
              name: 'updatedAt',
              type: 'timestamp',
              isNullable: false,
              default:
                dialect === 'mysql' || dialect === 'mariadb'
                  ? 'CURRENT_TIMESTAMP'
                  : 'now()',
            },
          ],
          foreignKeys: [
            new TableForeignKey({
              columnNames: ['userId'],
              referencedTableName: 'users',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            }),
          ],
          indices: [
            new TableIndex({
              name: 'IDX_staff_availability_user_starts',
              columnNames: ['userId', 'startsAt'],
            }),
          ],
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('staff_availability')) {
      await queryRunner.dropTable('staff_availability');
    }
    if (await queryRunner.hasTable('attendance_sessions')) {
      await queryRunner.dropTable('attendance_sessions');
    }

    const dropCol = async (tableName: string, columnName: string) => {
      const table = await queryRunner.getTable(tableName);
      if (table?.findColumnByName(columnName)) {
        await queryRunner.dropColumn(tableName, columnName);
      }
    };

    await dropCol('admin_settings', 'attendanceMaxGpsAccuracyMeters');
    await dropCol('admin_settings', 'attendanceGeofenceRadiusMeters');
    await dropCol('admin_settings', 'attendanceGeofenceMode');

    await dropCol('jobs', 'jobSiteLongitude');
    await dropCol('jobs', 'jobSiteLatitude');
  }
}
