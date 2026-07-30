import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const TEXT_CONVERSIONS: Record<string, string[]> = {
  admin_settings: ['esignPublicBaseUrl', 'smtpPass'],
  employee_forms: [
    'homeAddress',
    'accountName',
    'superFundName',
    'superMemberNumber',
    'emergencyContactAddress',
  ],
  organization_profile: [
    'registeredAddressLine1',
    'registeredAddressLine2',
    'billingAddressLine1',
    'billingAddressLine2',
    'documentsContactEmail',
  ],
  jobs: ['lostReason'],
};

/**
 * varchar → text for wide free-text columns. On MariaDB these tables' combined
 * inline varchar width exceeded the 8126-byte row cap, so ANY rebuild
 * (including TypeORM synchronize's json column recreation) failed and blocked
 * API startup in prod; text stores off-page. Postgres is unaffected
 * functionally — this keeps schemas aligned across dialects.
 */
export class WidenAdminSettingsTextColumns20260731_1700000001200 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, columns] of Object.entries(TEXT_CONVERSIONS)) {
      for (const name of columns) {
        if (await queryRunner.hasColumn(table, name)) {
          await queryRunner.changeColumn(
            table,
            name,
            new TableColumn({ name, type: 'text', isNullable: true }),
          );
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, columns] of Object.entries(TEXT_CONVERSIONS)) {
      for (const name of columns) {
        if (await queryRunner.hasColumn(table, name)) {
          await queryRunner.changeColumn(
            table,
            name,
            new TableColumn({ name, type: 'varchar', length: '512', isNullable: true }),
          );
        }
      }
    }
  }
}
