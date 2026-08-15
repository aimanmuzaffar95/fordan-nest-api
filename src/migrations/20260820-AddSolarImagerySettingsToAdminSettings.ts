import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Runtime override for the roof designer's satellite imagery provider,
 * mirroring `smtpPass`'s encrypted-at-rest pattern
 * (`SETTINGS_ENCRYPTION_KEY` AES-GCM via `common/crypto.util.ts`). Lets an
 * admin switch free (Esri) vs. paid (Google/Mapbox) imagery from the
 * Settings UI without editing server env vars / restarting the app.
 * `solarImageryProvider` null = fall back to `SOLAR_IMAGERY_PROVIDER`; the
 * per-provider key columns fall back to `SOLAR_IMAGERY_GOOGLE_KEY` /
 * `SOLAR_IMAGERY_MAPBOX_TOKEN` the same way. See `solar-imagery.service.ts`.
 *
 * text (not varchar) for the encrypted columns: `admin_settings`' combined
 * inline varchar width already sits at MariaDB's 8126-byte row cap (see the
 * `esignPublicBaseUrl` comment on the entity) — adding wide varchars here
 * would repeat the prod table-rebuild failure that text avoids.
 */
export class AddSolarImagerySettingsToAdminSettings20260820_1700000002500 implements MigrationInterface {
  private readonly table = 'admin_settings';
  private readonly columns: TableColumn[] = [
    new TableColumn({
      name: 'solarImageryProvider',
      type: 'varchar',
      length: '20',
      isNullable: true,
    }),
    new TableColumn({
      name: 'solarImageryGoogleKeyEncrypted',
      type: 'text',
      isNullable: true,
    }),
    new TableColumn({
      name: 'solarImageryMapboxTokenEncrypted',
      type: 'text',
      isNullable: true,
    }),
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(this.table))) return;

    for (const column of this.columns) {
      if (await queryRunner.hasColumn(this.table, column.name)) continue;
      await queryRunner.addColumn(this.table, column);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(this.table))) return;

    for (const column of this.columns) {
      if (!(await queryRunner.hasColumn(this.table, column.name))) continue;
      await queryRunner.dropColumn(this.table, column.name);
    }
  }
}
