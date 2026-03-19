import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';
import { JobAuditAction } from '../jobs/enums/job-audit-action.enum';
import {
  JobMeterStatus,
  JobStatus,
  JobSystemType,
} from '../jobs/enums/job.enums';

export class CreateJobsAndAuditLog1760000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'jobs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default:
              queryRunner.connection.options.type === 'postgres'
                ? 'gen_random_uuid()'
                : undefined,
          },
          {
            name: 'customerId',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'managerId',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'systemType',
            type: 'enum',
            enum: Object.values(JobSystemType),
            enumName: 'jobs_system_type_enum',
            isNullable: false,
          },
          {
            name: 'systemSizeKw',
            type: 'numeric',
            precision: 12,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'batterySizeKwh',
            type: 'numeric',
            precision: 12,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'projectPrice',
            type: 'numeric',
            precision: 12,
            scale: 2,
            isNullable: false,
            default: '0',
          },
          {
            name: 'contractSigned',
            type: 'boolean',
            isNullable: false,
            default: false,
          },
          {
            name: 'depositAmount',
            type: 'numeric',
            precision: 12,
            scale: 2,
            isNullable: false,
            default: '0',
          },
          {
            name: 'depositPaid',
            type: 'boolean',
            isNullable: false,
            default: false,
          },
          {
            name: 'depositDate',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'installDate',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'preMeterStatus',
            type: 'enum',
            enum: Object.values(JobMeterStatus),
            enumName: 'jobs_pre_meter_status_enum',
            isNullable: false,
            default: `'${JobMeterStatus.NOT_STARTED}'`,
          },
          {
            name: 'postMeterStatus',
            type: 'enum',
            enum: Object.values(JobMeterStatus),
            enumName: 'jobs_post_meter_status_enum',
            isNullable: false,
            default: `'${JobMeterStatus.NOT_STARTED}'`,
          },
          {
            name: 'jobStatus',
            type: 'enum',
            enum: Object.values(JobStatus),
            enumName: 'jobs_job_status_enum',
            isNullable: false,
            default: `'${JobStatus.LEAD}'`,
          },
          {
            name: 'notes',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'internalComments',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type:
              queryRunner.connection.options.type === 'postgres'
                ? 'timestamp'
                : 'datetime',
            default:
              queryRunner.connection.options.type === 'postgres'
                ? 'now()'
                : 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type:
              queryRunner.connection.options.type === 'postgres'
                ? 'timestamp'
                : 'datetime',
            default:
              queryRunner.connection.options.type === 'postgres'
                ? 'now()'
                : 'CURRENT_TIMESTAMP',
            onUpdate:
              queryRunner.connection.options.type === 'postgres'
                ? undefined
                : 'CURRENT_TIMESTAMP',
          },
          {
            name: 'deletedAt',
            type:
              queryRunner.connection.options.type === 'postgres'
                ? 'timestamp'
                : 'datetime',
            isNullable: true,
          },
        ],
      }),
    );

    await queryRunner.createForeignKey(
      'jobs',
      new TableForeignKey({
        name: 'fk_jobs_customer_id',
        columnNames: ['customerId'],
        referencedTableName: 'customers',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'jobs',
      new TableForeignKey({
        name: 'fk_jobs_manager_id',
        columnNames: ['managerId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );

    await queryRunner.createIndex(
      'jobs',
      new TableIndex({
        name: 'idx_jobs_customer_id',
        columnNames: ['customerId'],
      }),
    );

    await queryRunner.createIndex(
      'jobs',
      new TableIndex({
        name: 'idx_jobs_manager_id',
        columnNames: ['managerId'],
      }),
    );

    await queryRunner.createIndex(
      'jobs',
      new TableIndex({
        name: 'idx_jobs_deleted_at',
        columnNames: ['deletedAt'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'job_installers',
        columns: [
          {
            name: 'jobId',
            type: 'uuid',
            isPrimary: true,
          },
          {
            name: 'userId',
            type: 'uuid',
            isPrimary: true,
          },
        ],
      }),
    );

    await queryRunner.createForeignKey(
      'job_installers',
      new TableForeignKey({
        name: 'fk_job_installers_job_id',
        columnNames: ['jobId'],
        referencedTableName: 'jobs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'job_installers',
      new TableForeignKey({
        name: 'fk_job_installers_user_id',
        columnNames: ['userId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );

    await queryRunner.createIndex(
      'job_installers',
      new TableIndex({
        name: 'idx_job_installers_user_id',
        columnNames: ['userId'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'job_audit_logs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default:
              queryRunner.connection.options.type === 'postgres'
                ? 'gen_random_uuid()'
                : undefined,
          },
          {
            name: 'jobId',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'performedById',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'action',
            type: 'enum',
            enum: Object.values(JobAuditAction),
            enumName: 'job_audit_logs_action_enum',
            isNullable: false,
          },
          {
            name: 'field',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'oldValue',
            type: 'json',
            isNullable: true,
          },
          {
            name: 'newValue',
            type: 'json',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'json',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type:
              queryRunner.connection.options.type === 'postgres'
                ? 'timestamp'
                : 'datetime',
            default:
              queryRunner.connection.options.type === 'postgres'
                ? 'now()'
                : 'CURRENT_TIMESTAMP',
          },
        ],
      }),
    );

    await queryRunner.createForeignKey(
      'job_audit_logs',
      new TableForeignKey({
        name: 'fk_job_audit_logs_job_id',
        columnNames: ['jobId'],
        referencedTableName: 'jobs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'job_audit_logs',
      new TableForeignKey({
        name: 'fk_job_audit_logs_performed_by_id',
        columnNames: ['performedById'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createIndex(
      'job_audit_logs',
      new TableIndex({
        name: 'idx_job_audit_logs_job_id_created_at',
        columnNames: ['jobId', 'createdAt'],
      }),
    );

    await queryRunner.createIndex(
      'job_audit_logs',
      new TableIndex({
        name: 'idx_job_audit_logs_action',
        columnNames: ['action'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('job_audit_logs', 'idx_job_audit_logs_action');
    await queryRunner.dropIndex(
      'job_audit_logs',
      'idx_job_audit_logs_job_id_created_at',
    );
    await queryRunner.dropForeignKey(
      'job_audit_logs',
      'fk_job_audit_logs_performed_by_id',
    );
    await queryRunner.dropForeignKey(
      'job_audit_logs',
      'fk_job_audit_logs_job_id',
    );
    await queryRunner.dropTable('job_audit_logs');

    await queryRunner.dropIndex('job_installers', 'idx_job_installers_user_id');
    await queryRunner.dropForeignKey(
      'job_installers',
      'fk_job_installers_user_id',
    );
    await queryRunner.dropForeignKey(
      'job_installers',
      'fk_job_installers_job_id',
    );
    await queryRunner.dropTable('job_installers');

    await queryRunner.dropIndex('jobs', 'idx_jobs_deleted_at');
    await queryRunner.dropIndex('jobs', 'idx_jobs_manager_id');
    await queryRunner.dropIndex('jobs', 'idx_jobs_customer_id');
    await queryRunner.dropForeignKey('jobs', 'fk_jobs_manager_id');
    await queryRunner.dropForeignKey('jobs', 'fk_jobs_customer_id');
    await queryRunner.dropTable('jobs');
  }
}
