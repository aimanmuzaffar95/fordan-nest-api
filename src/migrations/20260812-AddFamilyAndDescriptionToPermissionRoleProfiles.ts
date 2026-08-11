import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds `family` and `description` to `permission_role_profiles`.
 *
 * `family` ('installer' | 'office') replaces the old hard rule that every
 * `kind = 'staff_role'` profile is installer-family
 * (`PermissionsService#isInstallerFamily` previously ignored this and
 * returned `true` unconditionally for that kind) — that made it impossible
 * to ever author a custom role that touches invoicing or any manager-family
 * capability, a structural ceiling rather than a real rule. Existing
 * `staff_role`-kind rows are backfilled to `'installer'` so their behavior
 * is unchanged; new admin-authored roles can choose `'office'` instead.
 * Builtin rows don't need the column populated — their family is derived
 * directly from `builtinRole` in code.
 *
 * `description` is a free-text field for admin-authored roles (role
 * authoring, §12.1) — `text`, not `varchar`, to stay dialect-safe per the
 * project's MariaDB inline-row-size rule.
 */
export class AddFamilyAndDescriptionToPermissionRoleProfiles20260812_1700000002600
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasFamily = await queryRunner.hasColumn(
      'permission_role_profiles',
      'family',
    );
    if (!hasFamily) {
      await queryRunner.addColumn(
        'permission_role_profiles',
        new TableColumn({
          name: 'family',
          type: 'varchar',
          length: '20',
          isNullable: true,
        }),
      );
      // Backfill: every pre-existing staff_role-kind row was installer-only
      // by the old hardcoded rule — preserve that as their explicit family
      // so behavior is unchanged for anything created before this migration.
      await queryRunner.query(
        `UPDATE permission_role_profiles SET family = 'installer' WHERE kind = 'staff_role'`,
      );
    }

    const hasDescription = await queryRunner.hasColumn(
      'permission_role_profiles',
      'description',
    );
    if (!hasDescription) {
      await queryRunner.addColumn(
        'permission_role_profiles',
        new TableColumn({
          name: 'description',
          type: 'text',
          isNullable: true,
        }),
      );
    }
  }

  public async down(): Promise<void> {
    // Additive-only migration; intentionally no destructive down().
  }
}
