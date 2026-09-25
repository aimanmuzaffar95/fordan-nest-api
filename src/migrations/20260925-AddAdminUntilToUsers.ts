import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';
import { resolveTimestampColumnType } from '../common/timestamp-column-type.util';

/**
 * Temporary admin access for managers: `users.adminUntil`. While the value is
 * in the future the manager is treated as ADMIN (see
 * users/temporary-admin.util.ts). Nullable, no default, no backfill.
 *
 * cPanel/MariaDB: apply scripts/sql/2026-09-temp-admin-mariadb.sql instead.
 */
export class AddAdminUntilToUsers20260925_1700000006000 implements MigrationInterface {
  private readonly column = new TableColumn({
    name: 'adminUntil',
    type: resolveTimestampColumnType(),
    isNullable: true,
  });

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('users'))) return;
    if (await queryRunner.hasColumn('users', this.column.name)) return;
    await queryRunner.addColumn('users', this.column);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('users'))) return;
    if (!(await queryRunner.hasColumn('users', this.column.name))) return;
    await queryRunner.dropColumn('users', this.column.name);
  }
}
