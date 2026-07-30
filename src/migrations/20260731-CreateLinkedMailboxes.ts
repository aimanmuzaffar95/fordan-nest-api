import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Creates `linked_mailboxes` — one real cPanel-hosted mailbox per CRM user,
 * linked by an admin so that user can read/send email live over IMAP/SMTP.
 * Password stored encrypted (SETTINGS_ENCRYPTION_KEY AES-GCM). Mirrors
 * src/mail/linked-mailbox.entity.ts. MariaDB prod applies equivalent SQL
 * manually at deploy.
 */
export class CreateLinkedMailboxes20260731_1700000001300 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const dialect = queryRunner.connection.options.type;
    const uuidDefault = dialect === 'postgres' ? 'uuid_generate_v4()' : 'UUID()';
    const ts = dialect === 'postgres' ? 'timestamptz' : 'datetime';
    if (dialect === 'postgres') {
      await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    }

    if (await queryRunner.hasTable('linked_mailboxes')) return;

    await queryRunner.createTable(
      new Table({
        name: 'linked_mailboxes',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: uuidDefault },
          { name: 'userId', type: 'uuid', isNullable: false },
          {
            name: 'emailAddress',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'username',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          { name: 'passwordEncrypted', type: 'text', isNullable: false },
          {
            name: 'imapHost',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          { name: 'imapPort', type: 'int', default: 993 },
          { name: 'imapSecure', type: 'boolean', default: true },
          {
            name: 'smtpHost',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          { name: 'smtpPort', type: 'int', default: 465 },
          { name: 'smtpSecure', type: 'boolean', default: true },
          { name: 'signatureHtml', type: 'text', isNullable: true },
          { name: 'active', type: 'boolean', default: true },
          { name: 'createdAt', type: ts, default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: ts, default: 'CURRENT_TIMESTAMP' },
        ],
      }),
    );

    await queryRunner.createIndex(
      'linked_mailboxes',
      new TableIndex({
        name: 'idx_linked_mailboxes_user',
        columnNames: ['userId'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('linked_mailboxes')) {
      await queryRunner.dropTable('linked_mailboxes');
    }
  }
}
