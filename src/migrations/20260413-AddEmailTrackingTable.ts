import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddEmailTrackingTable2026041315000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = 'email_tracking';
    const indexName = 'IDX_email_tracking_messageId_unique';

    if (!(await queryRunner.hasTable(tableName))) {
      await queryRunner.createTable(
        new Table({
          name: tableName,
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              isGenerated: true,
              generationStrategy: 'uuid',
            },
            { name: 'messageId', type: 'uuid', isNullable: false },
            { name: 'to', type: 'varchar', length: '512', isNullable: false },
            {
              name: 'subject',
              type: 'varchar',
              length: '255',
              isNullable: false,
            },
            { name: 'sentAt', type: 'timestamp', isNullable: true },
            { name: 'firstOpenedAt', type: 'timestamp', isNullable: true },
            { name: 'lastOpenedAt', type: 'timestamp', isNullable: true },
            { name: 'openCount', type: 'int', default: 0, isNullable: false },
            { name: 'createdAt', type: 'timestamp', default: 'now()' },
            { name: 'updatedAt', type: 'timestamp', default: 'now()' },
          ],
        }),
        true,
      );
    }

    // Make idempotent: some environments may have the table/index already
    // (e.g. a partial migration run or manual bootstrap).
    const table = await queryRunner.getTable(tableName);
    const hasIndex = Boolean(table?.indices?.some((i) => i.name === indexName));
    if (!hasIndex) {
      await queryRunner.createIndex(
        tableName,
        new TableIndex({
          name: indexName,
          columnNames: ['messageId'],
          isUnique: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('email_tracking', true);
  }
}

