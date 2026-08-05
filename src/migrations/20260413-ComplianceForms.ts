import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
  TableUnique,
} from 'typeorm';

export class ComplianceForms20260413_1700000000903 implements MigrationInterface {
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

    const tsDefault =
      dialect === 'mysql' || dialect === 'mariadb'
        ? 'CURRENT_TIMESTAMP'
        : 'now()';
    const tsOnUpdate =
      dialect === 'mysql' || dialect === 'mariadb'
        ? 'CURRENT_TIMESTAMP'
        : undefined;

    if (await queryRunner.hasTable('admin_settings')) {
      const hasCol = await queryRunner.hasColumn(
        'admin_settings',
        'complianceRequireSignature',
      );
      if (!hasCol) {
        await queryRunner.query(
          `ALTER TABLE "admin_settings" ADD "complianceRequireSignature" boolean NOT NULL DEFAULT true`,
        );
      }
    }

    if (!(await queryRunner.hasTable('compliance_form_templates'))) {
      await queryRunner.createTable(
        new Table({
          name: 'compliance_form_templates',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isNullable: false,
              default: uuidDefault,
            },
            { name: 'name', type: 'varchar', length: '200', isNullable: false },
            { name: 'description', type: 'text', isNullable: true },
            { name: 'fields', type: 'json', isNullable: false },
            {
              name: 'active',
              type: 'boolean',
              default: true,
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
              default: tsDefault,
            },
            {
              name: 'updatedAt',
              type: 'timestamp',
              isNullable: false,
              default: tsDefault,
              onUpdate: tsOnUpdate,
            },
          ],
        }),
      );
    }

    if (!(await queryRunner.hasTable('job_compliance_submissions'))) {
      await queryRunner.createTable(
        new Table({
          name: 'job_compliance_submissions',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isNullable: false,
              default: uuidDefault,
            },
            { name: 'jobId', type: 'uuid', isNullable: false },
            { name: 'templateId', type: 'uuid', isNullable: false },
            { name: 'answers', type: 'json', isNullable: false },
            { name: 'signaturePngBase64', type: 'text', isNullable: true },
            {
              name: 'completedAt',
              type: 'timestamp',
              isNullable: false,
              default: tsDefault,
            },
            { name: 'completedByUserId', type: 'uuid', isNullable: true },
            {
              name: 'createdAt',
              type: 'timestamp',
              isNullable: false,
              default: tsDefault,
            },
            {
              name: 'updatedAt',
              type: 'timestamp',
              isNullable: false,
              default: tsDefault,
              onUpdate: tsOnUpdate,
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
              columnNames: ['templateId'],
              referencedTableName: 'compliance_form_templates',
              referencedColumnNames: ['id'],
              onDelete: 'RESTRICT',
            }),
            new TableForeignKey({
              columnNames: ['completedByUserId'],
              referencedTableName: 'users',
              referencedColumnNames: ['id'],
              onDelete: 'SET NULL',
            }),
          ],
          uniques: [
            new TableUnique({
              name: 'UQ_job_compliance_job_template',
              columnNames: ['jobId', 'templateId'],
            }),
          ],
          indices: [
            new TableIndex({
              name: 'IDX_job_compliance_submissions_jobId',
              columnNames: ['jobId'],
            }),
          ],
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('job_compliance_submissions')) {
      await queryRunner.dropTable('job_compliance_submissions');
    }
    if (await queryRunner.hasTable('compliance_form_templates')) {
      await queryRunner.dropTable('compliance_form_templates');
    }
    if (await queryRunner.hasTable('admin_settings')) {
      const hasCol = await queryRunner.hasColumn(
        'admin_settings',
        'complianceRequireSignature',
      );
      if (hasCol) {
        await queryRunner.dropColumn(
          'admin_settings',
          'complianceRequireSignature',
        );
      }
    }
  }
}
