import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableIndex,
} from 'typeorm';

/**
 * Local synced mail store (mail_messages) + sync-state columns on
 * linked_mailboxes. Read endpoints now serve from the DB; a background sync
 * refreshes it — the shared mail host no longer sees one IMAP connection per
 * page view.
 */
export class CreateMailMessagesAndSyncColumns20260801_1700000001600 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const isMysql = ['mysql', 'mariadb'].includes(
      queryRunner.connection.options.type,
    );

    if (!(await queryRunner.hasColumn('linked_mailboxes', 'lastSyncedAt'))) {
      await queryRunner.addColumn(
        'linked_mailboxes',
        new TableColumn({
          name: 'lastSyncedAt',
          type: 'timestamp',
          isNullable: true,
        }),
      );
    }
    if (!(await queryRunner.hasColumn('linked_mailboxes', 'lastSyncError'))) {
      await queryRunner.addColumn(
        'linked_mailboxes',
        new TableColumn({
          name: 'lastSyncError',
          type: 'varchar',
          length: '500',
          isNullable: true,
        }),
      );
    }
    if (!(await queryRunner.hasColumn('linked_mailboxes', 'foldersJson'))) {
      await queryRunner.addColumn(
        'linked_mailboxes',
        new TableColumn({
          name: 'foldersJson',
          type: 'json',
          isNullable: true,
        }),
      );
    }

    if (await queryRunner.hasTable('mail_messages')) return;
    await queryRunner.createTable(
      new Table({
        name: 'mail_messages',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'mailboxId', type: 'uuid' },
          { name: 'folder', type: 'varchar', length: '128' },
          { name: 'uid', type: 'int' },
          { name: 'subject', type: 'text' },
          { name: 'fromName', type: 'varchar', length: '255', default: "''" },
          {
            name: 'fromAddress',
            type: 'varchar',
            length: '320',
            default: "''",
          },
          { name: 'toJson', type: 'json', isNullable: true },
          { name: 'ccJson', type: 'json', isNullable: true },
          { name: 'date', type: 'timestamp', isNullable: true },
          { name: 'seen', type: 'boolean', default: false },
          { name: 'hasAttachments', type: 'boolean', default: false },
          { name: 'snippet', type: 'varchar', length: '500', default: "''" },
          {
            name: 'bodyHtml',
            type: isMysql ? 'longtext' : 'text',
            isNullable: true,
          },
          { name: 'bodyText', type: 'text', isNullable: true },
          { name: 'attachmentsJson', type: 'json', isNullable: true },
          { name: 'syncedAt', type: 'timestamp' },
        ],
        uniques: [
          {
            name: 'UQ_mail_msg_box_folder_uid',
            columnNames: ['mailboxId', 'folder', 'uid'],
          },
        ],
        foreignKeys: [
          {
            columnNames: ['mailboxId'],
            referencedTableName: 'linked_mailboxes',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );
    await queryRunner.createIndex(
      'mail_messages',
      new TableIndex({
        name: 'idx_mail_msg_box_folder_date',
        columnNames: ['mailboxId', 'folder', 'date'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('mail_messages')) {
      await queryRunner.dropTable('mail_messages');
    }
    for (const col of ['foldersJson', 'lastSyncError', 'lastSyncedAt']) {
      if (await queryRunner.hasColumn('linked_mailboxes', col)) {
        await queryRunner.dropColumn('linked_mailboxes', col);
      }
    }
  }
}
