import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

/** Matches `JobAuditAction` / `job_audit_logs_action_enum` in `job-audit-log.entity.ts`. */
const JOB_AUDIT_ACTIONS = [
  'job_created',
  'job_soft_deleted',
  'job_restored',
  'job_status_changed',
  'pre_meter_status_changed',
  'post_meter_status_changed',
  'manager_assignment_changed',
  'installer_assigned',
  'installer_removed',
  'contract_signed_changed',
  'deposit_paid_changed',
  'install_date_changed',
] as const;

const JOB_AUDIT_ACTIONS_SQL = JOB_AUDIT_ACTIONS.map((v) => `'${v}'`).join(', ');

export class CreateJobAuditLogsTable20260328_1700000000160 implements MigrationInterface {
  private getDialectDefaults(queryRunner: QueryRunner) {
    const dialect = queryRunner.connection.options.type;
    const uuidDefault =
      dialect === 'postgres' ? 'uuid_generate_v4()' : 'UUID()';

    return { dialect, uuidDefault };
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const { dialect, uuidDefault } = this.getDialectDefaults(queryRunner);

    if (await queryRunner.hasTable('job_audit_logs')) {
      return;
    }

    if (dialect === 'postgres') {
      await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
      await queryRunner.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_type WHERE typname = 'job_audit_logs_action_enum'
          ) THEN
            CREATE TYPE "job_audit_logs_action_enum" AS ENUM (${JOB_AUDIT_ACTIONS_SQL});
          END IF;
        END $$;
      `);
    }

    await queryRunner.createTable(
      new Table({
        name: 'job_audit_logs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isNullable: false,
            default: uuidDefault,
          },
          { name: 'jobId', type: 'uuid', isNullable: false },
          { name: 'performedById', type: 'uuid', isNullable: true },
          {
            name: 'action',
            type:
              dialect === 'postgres' ? 'job_audit_logs_action_enum' : 'varchar',
            length: dialect === 'postgres' ? undefined : '64',
            isNullable: false,
          },
          { name: 'field', type: 'varchar', length: '100', isNullable: true },
          { name: 'oldValue', type: 'json', isNullable: true },
          { name: 'newValue', type: 'json', isNullable: true },
          { name: 'metadata', type: 'json', isNullable: true },
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
            columnNames: ['performedById'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          }),
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const dialect = queryRunner.connection.options.type;

    if (await queryRunner.hasTable('job_audit_logs')) {
      await queryRunner.dropTable('job_audit_logs');
    }

    if (dialect === 'postgres') {
      await queryRunner.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM pg_type WHERE typname = 'job_audit_logs_action_enum'
          ) THEN
            DROP TYPE "job_audit_logs_action_enum";
          END IF;
        END $$;
      `);
    }
  }
}
