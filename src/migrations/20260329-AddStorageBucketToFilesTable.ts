import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddStorageBucketToFilesTable20260329_1700000000019
  implements MigrationInterface
{
  name = 'AddStorageBucketToFilesTable20260329_1700000000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasFilesTable = await queryRunner.hasTable('files');
    if (!hasFilesTable) {
      return;
    }

    const hasStorageBucketColumn = await queryRunner.hasColumn(
      'files',
      'storageBucket',
    );
    if (hasStorageBucketColumn) {
      return;
    }

    await queryRunner.addColumn(
      'files',
      new TableColumn({
        name: 'storageBucket',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasFilesTable = await queryRunner.hasTable('files');
    if (!hasFilesTable) {
      return;
    }

    const hasStorageBucketColumn = await queryRunner.hasColumn(
      'files',
      'storageBucket',
    );
    if (!hasStorageBucketColumn) {
      return;
    }

    await queryRunner.dropColumn('files', 'storageBucket');
  }
}
