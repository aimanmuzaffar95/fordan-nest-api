import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateAttendanceRecordsTable20260414_1700000000021 implements MigrationInterface {
  private getDialectDefaults(queryRunner: QueryRunner) {
    const dialect = queryRunner.connection.options.type;
    const uuidDefault =
      dialect === 'postgres' ? 'uuid_generate_v4()' : 'UUID()';

    return { dialect, uuidDefault };
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const { dialect, uuidDefault } = this.getDialectDefaults(queryRunner);

    if (await queryRunner.hasTable('attendance_records')) {
      return;
    }

    if (dialect === 'postgres') {
      await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    }

    await queryRunner.createTable(
      new Table({
        name: 'attendance_records',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isNullable: false,
            default: uuidDefault,
          },
          { name: 'jobId', type: 'uuid', isNullable: false },
          { name: 'staffId', type: 'uuid', isNullable: false },
          { name: 'clockInAt', type: 'timestamp', isNullable: false },
          {
            name: 'clockInLat',
            type: 'decimal',
            precision: 10,
            scale: 7,
            isNullable: true,
          },
          {
            name: 'clockInLng',
            type: 'decimal',
            precision: 10,
            scale: 7,
            isNullable: true,
          },
          { name: 'clockInAccuracyM', type: 'int', isNullable: true },
          { name: 'clockOutAt', type: 'timestamp', isNullable: true },
          {
            name: 'clockOutLat',
            type: 'decimal',
            precision: 10,
            scale: 7,
            isNullable: true,
          },
          {
            name: 'clockOutLng',
            type: 'decimal',
            precision: 10,
            scale: 7,
            isNullable: true,
          },
          { name: 'clockOutAccuracyM', type: 'int', isNullable: true },
          {
            name: 'locationStatus',
            type: 'varchar',
            length: '20',
            isNullable: false,
          },
          { name: 'photoUrl', type: 'text', isNullable: true },
          { name: 'correctedBy', type: 'uuid', isNullable: true },
          { name: 'correctionNote', type: 'text', isNullable: true },
          { name: 'correctedAt', type: 'timestamp', isNullable: true },
          {
            name: 'createdAt',
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
            columnNames: ['jobId'],
            referencedTableName: 'jobs',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          }),
          new TableForeignKey({
            columnNames: ['staffId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          }),
          new TableForeignKey({
            columnNames: ['correctedBy'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          }),
        ],
      }),
    );

    await queryRunner.createIndex(
      'attendance_records',
      new TableIndex({
        name: 'idx_attendance_job_id',
        columnNames: ['jobId'],
      }),
    );

    await queryRunner.createIndex(
      'attendance_records',
      new TableIndex({
        name: 'idx_attendance_staff_id',
        columnNames: ['staffId'],
      }),
    );

    await queryRunner.createIndex(
      'attendance_records',
      new TableIndex({
        name: 'idx_attendance_open',
        columnNames: ['staffId', 'clockOutAt'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('attendance_records'))) {
      return;
    }

    await queryRunner.dropTable('attendance_records');
  }
}
