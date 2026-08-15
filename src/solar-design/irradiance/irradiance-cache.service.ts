import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IrradianceCache } from './irradiance-cache.entity';
import { fetchPvgisMonthlyGhi } from './pvgis-client';

/**
 * Grid resolution for the cache key, decimal degrees. 4dp ≈ 11m — far finer
 * than irradiance climatology actually varies, but cheap: it means every
 * roof gets its own row rather than sharing across a wide area, which is
 * fine since rows are tiny and cached indefinitely (no TTL — irradiance
 * climatology for a fixed location does not change on any timescale this
 * product cares about).
 */
const CACHE_GRID_DECIMALS = 4;

const roundToGrid = (value: number): number =>
  Math.round(value * 10 ** CACHE_GRID_DECIMALS) / 10 ** CACHE_GRID_DECIMALS;

export type CachedIrradiance = {
  monthlyGhiKwhM2Day: number[];
  source: string;
};

/**
 * Persisted, server-side cache of real per-location irradiance (P4
 * round-2 fix). `getCached` is a plain indexed DB read — safe to call from
 * `SolarSimulationService.simulate()` on the debounced-drag hot path, since
 * it never makes a network call itself. `warmCache` does the PVGIS network
 * fetch and is meant to be called out-of-band (fire-and-forget on first
 * simulate for a job, or eagerly on job/roof-design creation) so the
 * *next* simulate() call for that location reads real data.
 */
@Injectable()
export class IrradianceCacheService {
  private readonly logger = new Logger(IrradianceCacheService.name);
  /** De-dupes concurrent warm requests for the same cell within one process. */
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    @InjectRepository(IrradianceCache)
    private readonly repo: Repository<IrradianceCache>,
  ) {}

  private key(
    lat: number,
    lng: number,
  ): { latRounded: number; lngRounded: number; cacheKey: string } {
    const latRounded = roundToGrid(lat);
    const lngRounded = roundToGrid(lng);
    return { latRounded, lngRounded, cacheKey: `${latRounded},${lngRounded}` };
  }

  /**
   * Reads only from the persisted cache — no network I/O, safe for the hot
   * path. Returns `null` on a cache miss (caller falls back to the
   * documented latitude-band estimate and should call `warmCache` so the
   * next call succeeds).
   */
  async getCached(lat: number, lng: number): Promise<CachedIrradiance | null> {
    const { latRounded, lngRounded } = this.key(lat, lng);
    const row = await this.repo.findOne({ where: { latRounded, lngRounded } });
    if (!row) return null;
    return { monthlyGhiKwhM2Day: row.monthlyGhiKwhM2Day, source: row.source };
  }

  /**
   * Fetches real irradiance from PVGIS and persists it, if not already
   * cached. Safe to call fire-and-forget (`void this.irradianceCache.warmCache(...)`)
   * — swallows and logs errors rather than throwing, since callers on the
   * request path should never be blocked or failed by a background warm.
   */
  async warmCache(lat: number, lng: number): Promise<void> {
    const { latRounded, lngRounded, cacheKey } = this.key(lat, lng);

    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;

    const task = (async () => {
      try {
        const existingRow = await this.repo.findOne({
          where: { latRounded, lngRounded },
        });
        if (existingRow) return;

        const fetched = await fetchPvgisMonthlyGhi(latRounded, lngRounded);
        if (!fetched) {
          this.logger.warn(
            `PVGIS irradiance fetch failed or returned no coverage for (${latRounded}, ${lngRounded}); will retry on next simulate() call.`,
          );
          return;
        }

        await this.repo
          .createQueryBuilder()
          .insert()
          .into(IrradianceCache)
          .values({
            latRounded,
            lngRounded,
            monthlyGhiKwhM2Day: fetched.monthlyGhiKwhM2Day,
            source: fetched.source,
          })
          .orIgnore()
          .execute();
      } catch (err) {
        this.logger.warn(
          `Irradiance cache warm failed for (${latRounded}, ${lngRounded}): ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        this.inFlight.delete(cacheKey);
      }
    })();

    this.inFlight.set(cacheKey, task);
    return task;
  }

  /**
   * Round-6 fix (P3, critic finding): `warmCache` never overwrites an
   * existing row (`orIgnore()`), so a validated-but-wrong row — a bad PVGIS
   * response that nonetheless "succeeded", a bug in `fetchPvgisMonthlyGhi`,
   * a data-provider correction — was cached forever with zero operational
   * recourse; only a manual DB `DELETE` could recover it. `refresh` is the
   * documented recovery path: force a fresh PVGIS fetch and replace the row
   * regardless of what is currently cached. Not wired to an HTTP endpoint in
   * this round (that would need its own guard/role review, out of scope
   * here) — call it from a one-off script/REPL against the target
   * environment, e.g.:
   *   npx ts-node -e "... irradianceCacheService.refresh(lat, lng) ..."
   * or invoke it from a future admin-only controller endpoint once one
   * exists. Documented here so "how do I fix a poisoned row" has a real
   * answer beyond "go delete it in the database directly".
   */
  async refresh(lat: number, lng: number): Promise<CachedIrradiance | null> {
    const { latRounded, lngRounded, cacheKey } = this.key(lat, lng);

    const existing = this.inFlight.get(cacheKey);
    if (existing) await existing;

    const fetched = await fetchPvgisMonthlyGhi(latRounded, lngRounded);
    if (!fetched) {
      this.logger.warn(
        `Irradiance cache refresh: PVGIS fetch failed or returned no coverage for (${latRounded}, ${lngRounded}); existing row (if any) left untouched.`,
      );
      return this.getCached(latRounded, lngRounded);
    }

    await this.repo
      .createQueryBuilder()
      .insert()
      .into(IrradianceCache)
      .values({
        latRounded,
        lngRounded,
        monthlyGhiKwhM2Day: fetched.monthlyGhiKwhM2Day,
        source: fetched.source,
      })
      .orUpdate(['monthlyGhiKwhM2Day', 'source'], ['latRounded', 'lngRounded'])
      .execute();

    this.logger.log(
      `Irradiance cache refreshed for (${latRounded}, ${lngRounded}).`,
    );
    return {
      monthlyGhiKwhM2Day: fetched.monthlyGhiKwhM2Day,
      source: fetched.source,
    };
  }
}
