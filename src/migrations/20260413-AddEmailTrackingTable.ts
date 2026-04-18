import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddEmailTrackingTable2026041315000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'email_tracking',
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
          { name: 'subject', type: 'varchar', length: '255', isNullable: false },
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

    await queryRunner.createIndex(
      'email_tracking',
      new TableIndex({
        name: 'IDX_email_tracking_messageId_unique',
        columnNames: ['messageId'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('email_tracking', true);
  }
}

