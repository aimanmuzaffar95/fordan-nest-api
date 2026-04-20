import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddEsignVerificationColumnsToJobSignatureRequests1776729600000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('job_signature_requests'))) {
      return;
    }

    const dialect = queryRunner.connection.options.type;

    const add = async (name: string, column: TableColumn) => {
      if (!(await queryRunner.hasColumn('job_signature_requests', name))) {
        await queryRunner.addColumn('job_signature_requests', column);
      }
    };

    await add(
      'emailVerifyTokenHash',
      new TableColumn({
        name: 'emailVerifyTokenHash',
        type: 'varchar',
        length: '64',
        isNullable: true,
      }),
    );

    await add(
      'emailVerifySentAt',
      new TableColumn({
        name: 'emailVerifySentAt',
        type: 'timestamp',
        isNullable: true,
      }),
    );

    await add(
      'emailVerifiedAt',
      new TableColumn({
        name: 'emailVerifiedAt',
        type: 'timestamp',
        isNullable: true,
      }),
    );

    await add(
      'verifiedAt',
      new TableColumn({
        name: 'verifiedAt',
        type: 'timestamp',
        isNullable: true,
      }),
    );

    await add(
      'proposalSnapshot',
      new TableColumn({
        name: 'proposalSnapshot',
        type: dialect === 'postgres' ? 'jsonb' : 'json',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('job_signature_requests'))) {
      return;
    }

    for (const col of [
      'proposalSnapshot',
      'verifiedAt',
      'emailVerifiedAt',
      'emailVerifySentAt',
      'emailVerifyTokenHash',
    ]) {
      if (await queryRunner.hasColumn('job_signature_requests', col)) {
        await queryRunner.dropColumn('job_signature_requests', col);
      }
    }
  }
}

