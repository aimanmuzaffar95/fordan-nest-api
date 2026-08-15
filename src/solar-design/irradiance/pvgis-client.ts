/**
 * Client for PVGIS v5.3 `PVcalc` (JRC, EU Commission) — free, keyless,
 * unauthenticated. Substituted for `developer.nrel.gov` (unreachable from
 * this environment) per the P4 round-2 fix; both are the same class of
 * source (satellite-derived, multi-year-averaged irradiance), and PVGIS is
 * explicitly named as acceptable by the spec ("PVGIS v5.3 ... the same
 * class of source"). NASA POWER is the documented offline-style fallback
 * (see `irradiance-cache.service.ts`) for when PVGIS itself is unreachable.
 *
 * We request `angle=0&aspect=0` (a flat, north-agnostic plane) so the
 * response's `H(i)_d` is horizontal GHI, not irradiance on some assumed
 * tilt — the engine does its own HDKR transposition per-array, so it needs
 * the horizontal input, not a pre-tilted one.
 */

const PVGIS_BASE_URL = 'https://re.jrc.ec.europa.eu/api/v5_3/PVcalc';
const PVGIS_TIMEOUT_MS = 10000;

export type PvgisMonthlyGhi = {
  /** 12 values, Jan..Dec, kWh/m^2/day, horizontal plane. */
  monthlyGhiKwhM2Day: number[];
  source: 'pvgis';
};

type PvgisResponse = {
  outputs?: {
    monthly?: {
      fixed?: Array<{ month: number; ['H(i)_d']?: number }>;
    };
  };
};

/**
 * Fetches real monthly-average-daily horizontal GHI for (lat, lng) from
 * PVGIS. Returns `null` (never throws) on any failure — timeout, non-2xx,
 * malformed body, or a location PVGIS has no coverage for (it only covers
 * roughly 60°S-60°N latitude for the ERA5/SARAH2 dataset) — so callers can
 * apply the documented offline fallback rather than surfacing a raw error
 * on a background cache-warm call.
 */
export const fetchPvgisMonthlyGhi = async (
  lat: number,
  lng: number,
): Promise<PvgisMonthlyGhi | null> => {
  const url = new URL(PVGIS_BASE_URL);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('peakpower', '1');
  url.searchParams.set('loss', '14');
  url.searchParams.set('angle', '0');
  url.searchParams.set('aspect', '0');
  url.searchParams.set('pvcalculation', '1');
  url.searchParams.set('outputformat', 'json');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PVGIS_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const body = (await response.json()) as PvgisResponse;
    const rows = body.outputs?.monthly?.fixed;
    if (!rows || rows.length !== 12) return null;

    const byMonth = new Map(rows.map((r) => [r.month, r['H(i)_d']]));
    const monthlyGhiKwhM2Day: number[] = [];
    for (let m = 1; m <= 12; m += 1) {
      const value = byMonth.get(m);
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      monthlyGhiKwhM2Day.push(value);
    }

    return { monthlyGhiKwhM2Day, source: 'pvgis' };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};
