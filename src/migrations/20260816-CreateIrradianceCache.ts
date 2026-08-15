import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';
import { resolveUuidColumn } from '../common/migration-uuid.util';

/**
 * P4 round-2 fix (solar production engine): persisted, indefinite cache of
 * real per-location irradiance (PVGIS, keyed on rounded lat/lng) so
 * `SolarSimulationService.simulate()` never makes a network call on the
 * debounced-drag hot path. See `docs/specs/solar-design-studio.md` §4 and
 * `apps/api/src/solar-design/irradiance/`.
 */
export class CreateIrradianceCache20260816_1700000002900 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const uuidCol = await resolveUuidColumn(queryRunner);
    const uuidDefault = isPostgres ? { default: 'uuid_generate_v4()' } : {};
    const ts = isPostgres ? 'timestamp' : 'datetime';
    const json = isPostgres ? 'jsonb' : 'json';
    const numeric = isPostgres ? 'numeric' : 'decimal';

    if (await queryRunner.hasTable('irradiance_cache')) return;

    await queryRunner.createTable(
      new Table({
        name: 'irradiance_cache',
        columns: [
          {
            name: 'id',
            ...uuidCol,
            isPrimary: true,
            generationStrategy: 'uuid',
            ...uuidDefault,
          },
          { name: 'latRounded', type: numeric, precision: 8, scale: 4 },
          { name: 'lngRounded', type: numeric, precision: 8, scale: 4 },
          { name: 'monthlyGhiKwhM2Day', type: json },
          {
            name: 'source',
            type: 'varchar',
            length: '30',
            default: `'pvgis'`,
          },
          { name: 'createdAt', type: ts, default: 'now()' },
          { name: 'updatedAt', type: ts, default: 'now()' },
        ],
      }),
    );

    await queryRunner.createIndex(
      'irradiance_cache',
      new TableIndex({
        name: 'uq_irradiance_cache_lat_lng',
        columnNames: ['latRounded', 'lngRounded'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('irradiance_cache')) {
      await queryRunner.dropTable('irradiance_cache');
    }
  }
}
