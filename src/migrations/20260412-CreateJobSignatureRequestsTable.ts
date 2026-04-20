import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateJobSignatureRequestsTable20260412_2200000000001 implements MigrationInterface {
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

    if (await queryRunner.hasTable('job_signature_requests')) {
      return;
    }

    const tsDefault =
      dialect === 'mysql' || dialect === 'mariadb'
        ? 'CURRENT_TIMESTAMP'
        : 'now()';
    const tsOnUpdate =
      dialect === 'mysql' || dialect === 'mariadb'
        ? 'CURRENT_TIMESTAMP'
        : undefined;

    await queryRunner.createTable(
      new Table({
        name: 'job_signature_requests',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isNullable: false,
            default: uuidDefault,
          },
          { name: 'jobId', type: 'uuid', isNullable: false },
          { name: 'status', type: 'varchar', length: '20', isNullable: false },
          {
            name: 'tokenHash',
            type: 'varchar',
            length: '64',
            isNullable: false,
          },
          {
            name: 'referenceCode',
            type: 'varchar',
            length: '24',
            isNullable: false,
            isUnique: true,
          },
          { name: 'expiresAt', type: 'timestamp', isNullable: false },
          { name: 'sentAt', type: 'timestamp', isNullable: true },
          { name: 'viewedAt', type: 'timestamp', isNullable: true },
          { name: 'signedAt', type: 'timestamp', isNullable: true },
          {
            name: 'signerEmail',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'signerName',
            type: 'varchar',
            length: '200',
            isNullable: true,
          },
          { name: 'signedFileId', type: 'uuid', isNullable: true },
          { name: 'auditPayload', type: 'json', isNullable: true },
          // E-sign verification & snapshot fields (kept here so fresh DBs bootstrap cleanly even if
          // later migrations that add these fields are reordered or skipped).
          {
            name: 'emailVerifyTokenHash',
            type: 'varchar',
            length: '64',
            isNullable: true,
          },
          { name: 'emailVerifySentAt', type: 'timestamp', isNullable: true },
          { name: 'emailVerifiedAt', type: 'timestamp', isNullable: true },
          { name: 'verifiedAt', type: 'timestamp', isNullable: true },
          {
            name: 'proposalSnapshot',
            type:
              dialect === 'postgres'
                ? 'jsonb'
                : dialect === 'mysql' || dialect === 'mariadb'
                  ? 'json'
                  : 'json',
            isNullable: true,
          },
          { name: 'createdByUserId', type: 'uuid', isNullable: true },
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
            columnNames: ['createdByUserId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          }),
        ],
        indices: [
          new TableIndex({
            name: 'IDX_job_signature_requests_tokenHash',
            columnNames: ['tokenHash'],
            isUnique: true,
          }),
          new TableIndex({
            name: 'IDX_job_signature_requests_jobId_status',
            columnNames: ['jobId', 'status'],
          }),
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('job_signature_requests')) {
      await queryRunner.dropTable('job_signature_requests');
    }
  }
}
