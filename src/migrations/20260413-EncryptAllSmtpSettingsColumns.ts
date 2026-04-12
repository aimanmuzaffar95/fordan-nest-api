import { MigrationInterface, QueryRunner } from 'typeorm';

export class EncryptAllSmtpSettingsColumns1776051600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('admin_settings');
    if (!hasTable) return;

    const dialect = queryRunner.connection.options.type;

    if (dialect === 'postgres') {
      await queryRunner.query(
        'ALTER TABLE "admin_settings" ALTER COLUMN "smtpHost" TYPE text USING "smtpHost"::text',
      );
      await queryRunner.query(
        'ALTER TABLE "admin_settings" ALTER COLUMN "smtpPort" TYPE text USING "smtpPort"::text',
      );
      await queryRunner.query(
        'ALTER TABLE "admin_settings" ALTER COLUMN "smtpSecure" TYPE text USING "smtpSecure"::text',
      );
      await queryRunner.query(
        'ALTER TABLE "admin_settings" ALTER COLUMN "smtpUser" TYPE text USING "smtpUser"::text',
      );
      await queryRunner.query(
        'ALTER TABLE "admin_settings" ALTER COLUMN "mailFrom" TYPE text USING "mailFrom"::text',
      );
      await queryRunner.query(
        'ALTER TABLE "admin_settings" ALTER COLUMN "mailFromName" TYPE text USING "mailFromName"::text',
      );
      return;
    }

    await queryRunner.query(
      'ALTER TABLE `admin_settings` MODIFY COLUMN `smtpHost` text NULL',
    );
    await queryRunner.query(
      'ALTER TABLE `admin_settings` MODIFY COLUMN `smtpPort` text NULL',
    );
    await queryRunner.query(
      'ALTER TABLE `admin_settings` MODIFY COLUMN `smtpSecure` text NULL',
    );
    await queryRunner.query(
      'ALTER TABLE `admin_settings` MODIFY COLUMN `smtpUser` text NULL',
    );
    await queryRunner.query(
      'ALTER TABLE `admin_settings` MODIFY COLUMN `mailFrom` text NULL',
    );
    await queryRunner.query(
      'ALTER TABLE `admin_settings` MODIFY COLUMN `mailFromName` text NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('admin_settings');
    if (!hasTable) return;

    const dialect = queryRunner.connection.options.type;

    if (dialect === 'postgres') {
      await queryRunner.query(
        'ALTER TABLE "admin_settings" ALTER COLUMN "smtpHost" TYPE varchar(255) USING "smtpHost"::varchar',
      );
      await queryRunner.query(
        'ALTER TABLE "admin_settings" ALTER COLUMN "smtpPort" TYPE int USING NULLIF("smtpPort", \'\')::int',
      );
      await queryRunner.query(
        'ALTER TABLE "admin_settings" ALTER COLUMN "smtpSecure" TYPE boolean USING NULLIF("smtpSecure", \'\')::boolean',
      );
      await queryRunner.query(
        'ALTER TABLE "admin_settings" ALTER COLUMN "smtpUser" TYPE varchar(255) USING "smtpUser"::varchar',
      );
      await queryRunner.query(
        'ALTER TABLE "admin_settings" ALTER COLUMN "mailFrom" TYPE varchar(255) USING "mailFrom"::varchar',
      );
      await queryRunner.query(
        'ALTER TABLE "admin_settings" ALTER COLUMN "mailFromName" TYPE varchar(255) USING "mailFromName"::varchar',
      );
      return;
    }

    await queryRunner.query(
      'ALTER TABLE `admin_settings` MODIFY COLUMN `smtpHost` varchar(255) NULL',
    );
    await queryRunner.query(
      'ALTER TABLE `admin_settings` MODIFY COLUMN `smtpPort` int NULL',
    );
    await queryRunner.query(
      'ALTER TABLE `admin_settings` MODIFY COLUMN `smtpSecure` boolean NULL',
    );
    await queryRunner.query(
      'ALTER TABLE `admin_settings` MODIFY COLUMN `smtpUser` varchar(255) NULL',
    );
    await queryRunner.query(
      'ALTER TABLE `admin_settings` MODIFY COLUMN `mailFrom` varchar(255) NULL',
    );
    await queryRunner.query(
      'ALTER TABLE `admin_settings` MODIFY COLUMN `mailFromName` varchar(255) NULL',
    );
  }
}
