import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Outbound attachment support: mail_outbox gains attachmentsJson storing the
 * submitted attachments (base64) so they survive retries. json on Postgres,
 * longtext under MySQL/MariaDB (matching how bodyHtml is typed per dialect).
 *
 * MariaDB equivalent:
 *   ALTER TABLE mail_outbox ADD COLUMN attachmentsJson LONGTEXT NULL;
 */
export class AddOutboxAttachments20260802_1700000001710 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const isMysql = ['mysql', 'mariadb'].includes(
      queryRunner.connection.options.type,
    );

    if (!(await queryRunner.hasColumn('mail_outbox', 'attachmentsJson'))) {
      await queryRunner.addColumn(
        'mail_outbox',
        new TableColumn({
          name: 'attachmentsJson',
          type: isMysql ? 'longtext' : 'json',
          isNullable: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('mail_outbox', 'attachmentsJson')) {
      await queryRunner.dropColumn('mail_outbox', 'attachmentsJson');
    }
  }
}
