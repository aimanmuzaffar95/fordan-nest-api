import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddMustChangePasswordToUserCredentials20260329_1700000000018 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('user_credentials'))) return;
    if (await queryRunner.hasColumn('user_credentials', 'mustChangePassword')) {
      return;
    }

    const dialect = queryRunner.connection.options.type;
    const boolFalseDefault =
      dialect === 'mysql' || dialect === 'mariadb' ? '0' : 'false';

    await queryRunner.addColumn(
      'user_credentials',
      new TableColumn({
        name: 'mustChangePassword',
        type: 'boolean',
        isNullable: false,
        default: boolFalseDefault,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('user_credentials'))) return;
    if (
      !(await queryRunner.hasColumn('user_credentials', 'mustChangePassword'))
    ) {
      return;
    }

    await queryRunner.dropColumn('user_credentials', 'mustChangePassword');
  }
}
