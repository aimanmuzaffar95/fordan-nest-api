import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateJobGeneratedDocuments20260609_1700000000300 implements MigrationInterface {
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

    if (!(await queryRunner.hasTable('job_generated_documents'))) {
      await queryRunner.createTable(
        new Table({
          name: 'job_generated_documents',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              default: uuidDefault,
            },
            { name: 'jobId', type: 'uuid', isNullable: false },
            {
              name: 'templateId',
              type: 'varchar',
              length: '64',
              isNullable: false,
            },
            {
              name: 'status',
              type: 'varchar',
              length: '32',
              isNullable: false,
            },
            { name: 'fileId', type: 'uuid', isNullable: true },
            {
              name: 'fields',
              type: dialect === 'postgres' ? 'jsonb' : 'json',
              isNullable: true,
            },
            { name: 'createdByUserId', type: 'uuid', isNullable: true },
            {
              name: 'createdAt',
              type: dialect === 'postgres' ? 'timestamptz' : 'datetime',
              default: 'CURRENT_TIMESTAMP',
            },
            {
              name: 'updatedAt',
              type: dialect === 'postgres' ? 'timestamptz' : 'datetime',
              default: 'CURRENT_TIMESTAMP',
            },
          ],
        }),
      );

      await queryRunner.createIndex(
        'job_generated_documents',
        new TableIndex({
          name: 'IDX_job_generated_documents_job_created',
          columnNames: ['jobId', 'createdAt'],
        }),
      );

      await queryRunner.createForeignKey(
        'job_generated_documents',
        new TableForeignKey({
          name: 'FK_job_generated_documents_job',
          columnNames: ['jobId'],
          referencedTableName: 'jobs',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );
    }

    if (!(await queryRunner.hasTable('job_document_sign_requests'))) {
      await queryRunner.createTable(
        new Table({
          name: 'job_document_sign_requests',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              default: uuidDefault,
            },
            { name: 'jobId', type: 'uuid', isNullable: false },
            { name: 'documentId', type: 'uuid', isNullable: false },
            {
              name: 'mode',
              type: 'varchar',
              length: '16',
              isNullable: false,
            },
            {
              name: 'recipientEmail',
              type: 'varchar',
              length: '255',
              isNullable: true,
            },
            {
              name: 'status',
              type: 'varchar',
              length: '32',
              isNullable: false,
            },
            { name: 'createdByUserId', type: 'uuid', isNullable: true },
            {
              name: 'createdAt',
              type: dialect === 'postgres' ? 'timestamptz' : 'datetime',
              default: 'CURRENT_TIMESTAMP',
            },
            {
              name: 'updatedAt',
              type: dialect === 'postgres' ? 'timestamptz' : 'datetime',
              default: 'CURRENT_TIMESTAMP',
            },
          ],
        }),
      );

      await queryRunner.createIndex(
        'job_document_sign_requests',
        new TableIndex({
          name: 'IDX_job_document_sign_requests_job_document',
          columnNames: ['jobId', 'documentId'],
        }),
      );

      await queryRunner.createForeignKey(
        'job_document_sign_requests',
        new TableForeignKey({
          name: 'FK_job_document_sign_requests_job',
          columnNames: ['jobId'],
          referencedTableName: 'jobs',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );

      await queryRunner.createForeignKey(
        'job_document_sign_requests',
        new TableForeignKey({
          name: 'FK_job_document_sign_requests_document',
          columnNames: ['documentId'],
          referencedTableName: 'job_generated_documents',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('job_document_sign_requests')) {
      await queryRunner.dropTable('job_document_sign_requests');
    }
    if (await queryRunner.hasTable('job_generated_documents')) {
      await queryRunner.dropTable('job_generated_documents');
    }
  }
}
