import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Durable send queue (mail_outbox). POST /mail/send enqueues here and attempts
 * one immediate delivery; a background worker retries transient failures with
 * exponential backoff so mail survives flaky shared-host SMTP and app closure.
 */
export class CreateMailOutbox20260801_1700000001700 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const isMysql = ['mysql', 'mariadb'].includes(
      queryRunner.connection.options.type,
    );

    if (await queryRunner.hasTable('mail_outbox')) return;
    await queryRunner.createTable(
      new Table({
        name: 'mail_outbox',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'mailboxId', type: 'uuid' },
          { name: 'userId', type: 'uuid' },
          { name: 'toJson', type: 'json' },
          { name: 'ccJson', type: 'json', isNullable: true },
          { name: 'subject', type: 'text' },
          { name: 'bodyHtml', type: isMysql ? 'longtext' : 'text' },
          { name: 'appendSignature', type: 'boolean', default: true },
          { name: 'inReplyToUid', type: 'int', isNullable: true },
          {
            name: 'status',
            type: 'varchar',
            length: '16',
            default: "'queued'",
          },
          { name: 'attempts', type: 'int', default: 0 },
          { name: 'maxAttempts', type: 'int', default: 6 },
          {
            name: 'lastError',
            type: 'varchar',
            length: '500',
            isNullable: true,
          },
          { name: 'nextAttemptAt', type: 'timestamp', isNullable: true },
          { name: 'sentAt', type: 'timestamp', isNullable: true },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
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
      'mail_outbox',
      new TableIndex({
        name: 'idx_mail_outbox_mailbox',
        columnNames: ['mailboxId'],
      }),
    );
    await queryRunner.createIndex(
      'mail_outbox',
      new TableIndex({
        name: 'idx_mail_outbox_status_next',
        columnNames: ['status', 'nextAttemptAt'],
      }),
    );
    await queryRunner.createIndex(
      'mail_outbox',
      new TableIndex({
        name: 'idx_mail_outbox_user',
        columnNames: ['userId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('mail_outbox')) {
      await queryRunner.dropTable('mail_outbox');
    }
  }
}
