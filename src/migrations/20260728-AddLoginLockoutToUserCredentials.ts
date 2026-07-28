import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds login-lockout bookkeeping to `user_credentials`:
 *  - `failedLoginAttempts` — consecutive failures, reset on success.
 *  - `lockedUntil` — when in the future, logins are rejected (brute-force backoff).
 */
export class AddLoginLockoutToUserCredentials20260728_1700000000800 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('user_credentials', 'failedLoginAttempts'))) {
      await queryRunner.addColumn(
        'user_credentials',
        new TableColumn({
          name: 'failedLoginAttempts',
          type: 'int',
          default: 0,
          isNullable: false,
        }),
      );
    }
    if (!(await queryRunner.hasColumn('user_credentials', 'lockedUntil'))) {
      await queryRunner.addColumn(
        'user_credentials',
        new TableColumn({
          name: 'lockedUntil',
          type: 'timestamp',
          isNullable: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('user_credentials', 'lockedUntil')) {
      await queryRunner.dropColumn('user_credentials', 'lockedUntil');
    }
    if (await queryRunner.hasColumn('user_credentials', 'failedLoginAttempts')) {
      await queryRunner.dropColumn('user_credentials', 'failedLoginAttempts');
    }
  }
}
