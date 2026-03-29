import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddDisplayNameToFilesTable20260329 implements MigrationInterface {
  name = 'AddDisplayNameToFilesTable20260329';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasFilesTable = await queryRunner.hasTable('files');
    if (!hasFilesTable) {
      return;
    }

    const hasDisplayNameColumn = await queryRunner.hasColumn(
      'files',
      'displayName',
    );
    if (hasDisplayNameColumn) {
      return;
    }

    await queryRunner.addColumn(
      'files',
      new TableColumn({
        name: 'displayName',
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

    const hasDisplayNameColumn = await queryRunner.hasColumn(
      'files',
      'displayName',
    );
    if (!hasDisplayNameColumn) {
      return;
    }

    await queryRunner.dropColumn('files', 'displayName');
  }
}
