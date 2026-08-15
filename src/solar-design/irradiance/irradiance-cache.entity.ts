import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type ValueTransformer,
} from 'typeorm';

/** Postgres/MariaDB `numeric` columns come back as strings — coerce to a JS number for lookup math. */
const numericTransformer: ValueTransformer = {
  to: (value: number) => value,
  from: (value: string) => Number(value),
};

/**
 * One row per (lat, lng) grid cell — a persisted cache of real per-location
 * monthly irradiance, fetched server-side from PVGIS (or NASA POWER as a
 * documented fallback source) so `SolarSimulationService.simulate()` never
 * makes a network call on the hot debounced-drag path (P4 round-2 fix).
 *
 * Keyed on lat/lng rounded to `IRRADIANCE_CACHE_GRID_DECIMALS` (see
 * `irradiance-cache.service.ts`) — roughly a ~1km grid — so nearby roofs on
 * the same job/street share a row indefinitely (irradiance climatology does
 * not meaningfully change site-to-site at that resolution, and never
 * changes over the lifetime of a cache row, so there is no TTL/expiry).
 */
@Entity('irradiance_cache')
@Index('uq_irradiance_cache_lat_lng', ['latRounded', 'lngRounded'], {
  unique: true,
})
export class IrradianceCache {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'numeric',
    precision: 8,
    scale: 4,
    transformer: numericTransformer,
  })
  latRounded: number;

  @Column({
    type: 'numeric',
    precision: 8,
    scale: 4,
    transformer: numericTransformer,
  })
  lngRounded: number;

  /** 12 values, Jan..Dec, kWh/m^2/day — horizontal-plane monthly average. */
  @Column({ type: 'json' })
  monthlyGhiKwhM2Day: number[];

  /** Where this row's data came from — surfaced for support/debugging, never shown raw to customers. */
  @Column({ type: 'varchar', length: 30, default: 'pvgis' })
  source: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
