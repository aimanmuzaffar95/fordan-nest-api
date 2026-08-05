/**
 * Rewrites 16 migration names that were recorded under an off-convention class
 * name, so an existing database recognises them after the rename.
 *
 * TypeORM orders migrations by the trailing number in the class name, and this
 * project had three formats in use: a 13-digit epoch (~1.8e12), a 19-digit
 * `YYYYMMDDHH…` (~2.0e18) and the 21-digit `YYYYMMDD_17…` convention (~2.0e20).
 * The magnitudes differ so wildly that run order bore almost no relation to
 * authoring order — `ComplianceForms` ran 9th, long before `CreateJobsTable`
 * (19th) created the table its foreign keys reference, so `migration:run`
 * against an empty database aborted on both Postgres and MariaDB. Worse, three
 * guarded `ALTER customers` migrations sorted first, no-opped because the table
 * did not exist yet, and were still recorded as applied — leaving a fresh
 * database permanently missing `secondaryPhone`, `lat`, `lng` and
 * `acquisitionSource` while the bookkeeping claimed otherwise.
 *
 * This cannot be a migration itself: TypeORM reads the executed-migration list
 * once, before running anything, so a rename performed *during* the run comes
 * too late and all 16 re-run. It has to happen first, which is why
 * `npm run migration:run` chains it ahead of the TypeORM CLI.
 *
 * Safe to run repeatedly, and on a fresh database it matches nothing.
 */
import { AppDataSource } from './data-source';

/** old recorded name -> new class name */
export const LEGACY_MIGRATION_RENAMES: ReadonlyArray<
  readonly [string, string]
> = [
  [
    'AddSecondaryPhoneToCustomers1775950000000',
    'AddSecondaryPhoneToCustomers20260412_1700000000900',
  ],
  [
    'AddLatLngToCustomers1775960000000',
    'AddLatLngToCustomers20260412_1700000000901',
  ],
  [
    'AddAcquisitionSourceToCustomers1775962000000',
    'AddAcquisitionSourceToCustomers20260412_1700000000902',
  ],
  [
    'AddEmployeeRolesAndNonTechnicalStaff1776000000000',
    'AddEmployeeRolesAndNonTechnicalStaff20260413_1700000000900',
  ],
  [
    'AddSmtpSettingsToAdminSettings1776048000000',
    'AddSmtpSettingsToAdminSettings20260413_1700000000901',
  ],
  [
    'EncryptAllSmtpSettingsColumns1776051600000',
    'EncryptAllSmtpSettingsColumns20260413_1700000000902',
  ],
  [
    'ComplianceForms2026041312000000000',
    'ComplianceForms20260413_1700000000903',
  ],
  [
    'AddEmailTrackingTable2026041315000000000',
    'AddEmailTrackingTable20260413_1700000000904',
  ],
  [
    'AddSmtpMailToAdminSettings2026041412000000000',
    'AddSmtpMailToAdminSettings20260414_1700000000900',
  ],
  [
    'AddCustomerMessagingTemplatesColumn2026041512000000000',
    'AddCustomerMessagingTemplatesColumn20260415_1700000000900',
  ],
  [
    'AddCrmAppearanceSettingsColumn2026041612000000000',
    'AddCrmAppearanceSettingsColumn20260416_1700000000900',
  ],
  [
    'AddCompanyProfileSettingsColumn2026041613000000000',
    'AddCompanyProfileSettingsColumn20260416_1700000000901',
  ],
  [
    'AddBillingSettingsColumn2026041614000000000',
    'AddBillingSettingsColumn20260416_1700000000902',
  ],
  [
    'AddDocumentNumberingSettingsColumn2026041614300000000',
    'AddDocumentNumberingSettingsColumn20260416_1700000000903',
  ],
  [
    'AddSettingsAuditLogTable2026041615000000000',
    'AddSettingsAuditLogTable20260416_1700000000904',
  ],
  [
    'CreatePermissionRoleProfiles1779400000000',
    'CreatePermissionRoleProfiles20260522_1700000000900',
  ],
];

export async function renumberLegacyMigrations(): Promise<number> {
  const ds = AppDataSource.isInitialized
    ? AppDataSource
    : await AppDataSource.initialize();

  const isPostgres = ds.options.type === 'postgres';
  const table = isPostgres ? '"migrations"' : '`migrations`';
  const col = isPostgres ? '"name"' : '`name`';

  const exists: unknown[] = await ds.query(
    isPostgres
      ? `SELECT to_regclass('public.migrations') AS t`
      : `SHOW TABLES LIKE 'migrations'`,
  );
  const hasTable = isPostgres
    ? (exists[0] as { t: string | null } | undefined)?.t != null
    : exists.length > 0;
  if (!hasTable) return 0;

  let renamed = 0;
  for (const [oldName, newName] of LEGACY_MIGRATION_RENAMES) {
    const result = (await ds.query(
      isPostgres
        ? `UPDATE ${table} SET ${col} = $1 WHERE ${col} = $2`
        : `UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`,
      [newName, oldName],
    )) as unknown;
    // Postgres returns [rows, count]; mysql2 returns an OkPacket.
    const affected = Array.isArray(result)
      ? Number(result[1] ?? 0)
      : Number((result as { affectedRows?: number })?.affectedRows ?? 0);
    renamed += affected;
  }
  return renamed;
}

if (require.main === module) {
  renumberLegacyMigrations()
    .then(async (n) => {
      if (n > 0) {
        console.log(`Renumbered ${n} legacy migration name(s).`);
      }
      if (AppDataSource.isInitialized) await AppDataSource.destroy();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Failed to renumber legacy migration names:', err);
      if (AppDataSource.isInitialized) await AppDataSource.destroy();
      process.exit(1);
    });
}
