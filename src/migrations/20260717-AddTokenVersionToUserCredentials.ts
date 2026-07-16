import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds `user_credentials.tokenVersion` — bumped on every password change/reset
 * so access tokens minted beforehand fail verification. Default 0 keeps all
 * existing tokens valid until their next password change.
 */
export class AddTokenVersionToUserCredentials20260717_1700000000600 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('user_credentials', 'tokenVersion'))) {
      await queryRunner.addColumn(
        'user_credentials',
        new TableColumn({
          name: 'tokenVersion',
          type: 'int',
          default: 0,
          isNullable: false,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('user_credentials', 'tokenVersion')) {
      await queryRunner.dropColumn('user_credentials', 'tokenVersion');
    }
  }
}
