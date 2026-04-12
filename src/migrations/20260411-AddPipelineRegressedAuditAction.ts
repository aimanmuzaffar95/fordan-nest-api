import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `pipeline_regressed` value to the job_audit_logs action enum.
 *
 * Postgres: ALTER TYPE … ADD VALUE is idempotent via IF NOT EXISTS.
 * MySQL/MariaDB: the ENUM column is redefined to include the new value.
 */
export class AddPipelineRegressedAuditAction20260411_1775865600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const dialect = queryRunner.connection.options.type;

    if (dialect === 'postgres') {
      await queryRunner.query(
        `ALTER TYPE "job_audit_logs_action_enum" ADD VALUE IF NOT EXISTS 'pipeline_regressed'`,
      );
    } else {
      // MySQL / MariaDB — redefine the column with the full enum list.
      await queryRunner.query(`
        ALTER TABLE \`job_audit_logs\`
        MODIFY COLUMN \`action\` ENUM(
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
          'pipeline_regressed'
        ) NOT NULL
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const dialect = queryRunner.connection.options.type;

    if (dialect === 'postgres') {
      // Postgres does not support removing enum values directly.
      // The safest rollback recreates the type without the new value,
      // but only if no rows use it.
      await queryRunner.query(`
        DELETE FROM "job_audit_logs" WHERE "action" = 'pipeline_regressed'
      `);
      await queryRunner.query(
        `ALTER TYPE "job_audit_logs_action_enum" RENAME TO "job_audit_logs_action_enum_old"`,
      );
      await queryRunner.query(`
        CREATE TYPE "job_audit_logs_action_enum" AS ENUM(
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
          'install_date_changed'
        )
      `);
      await queryRunner.query(`
        ALTER TABLE "job_audit_logs"
          ALTER COLUMN "action" TYPE "job_audit_logs_action_enum"
          USING "action"::text::"job_audit_logs_action_enum"
      `);
      await queryRunner.query(`DROP TYPE "job_audit_logs_action_enum_old"`);
    } else {
      await queryRunner.query(`
        ALTER TABLE \`job_audit_logs\`
        MODIFY COLUMN \`action\` ENUM(
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
          'install_date_changed'
        ) NOT NULL
      `);
    }
  }
}
