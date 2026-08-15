/**
 * Climate proxy: monthly clearness index (cloudiness attenuation) and
 * monthly ambient temperature, both derived only from latitude since we have
 * no TMY files and add no new dependency. See the honesty note on
 * `CLEARNESS_INDEX_BY_LATITUDE_BAND` in `constants.ts`. Both are designed as
 * an overridable seam (`SimulationInput.climate.*`) for a real weather feed.
 */

import {
  AMBIENT_TEMP_AMPLITUDE_PER_DEG_LAT_C,
  AMBIENT_TEMP_ANNUAL_MEAN_AT_EQUATOR_C,
  AMBIENT_TEMP_MEAN_LAPSE_PER_DEG_LAT_C,
  CLEARNESS_INDEX_BY_LATITUDE_BAND,
  CLEARNESS_INDEX_MAX,
  CLEARNESS_INDEX_MIN,
  HOUR_ANGLE_STEP_DEG,
  REPRESENTATIVE_DAY_OF_YEAR,
} from './constants';
import { haurwitzClearSkyGhi } from './irradiance';
import {
  buildDaylightHourAngles,
  cosZenith,
  declinationDeg,
  sunsetHourAngleDeg,
} from './solar-geometry';

const rotateToSouthernHemisphere = (monthly: readonly number[]): number[] => {
  // Shift by 6 months so "January" values become the Southern winter, etc.
  return [...monthly.slice(6), ...monthly.slice(0, 6)];
};

/**
 * Round-6 fix: each band's midpoint latitude is treated as the latitude its
 * `monthly` curve is "measured at"; `getMonthlyClearnessIndex` linearly
 * interpolates between the two nearest band midpoints rather than stepping
 * at the raw `maxAbsLatitude` boundaries. The critic measured cliff edges of
 * up to +18.4%/-21.2% in annual output for a 0.2° latitude shift across a
 * boundary under the old step-function lookup — two neighbouring houses
 * either side of, e.g., 45°N, would otherwise get wildly different
 * provisional quotes.
 */
const BAND_MIDPOINT_LATITUDES: readonly number[] =
  CLEARNESS_INDEX_BY_LATITUDE_BAND.map((band, i) => {
    const prevMax =
      i === 0 ? 0 : CLEARNESS_INDEX_BY_LATITUDE_BAND[i - 1].maxAbsLatitude;
    return (prevMax + band.maxAbsLatitude) / 2;
  });

const lerpMonthly = (
  a: readonly number[],
  b: readonly number[],
  t: number,
): number[] => a.map((v, i) => v + (b[i] - v) * t);

/** 12 values, Jan..Dec, in [0,1]. */
export const getMonthlyClearnessIndex = (latitudeDeg: number): number[] => {
  const absLat = Math.abs(latitudeDeg);
  const bands = CLEARNESS_INDEX_BY_LATITUDE_BAND;

  let monthly: number[];
  if (absLat <= BAND_MIDPOINT_LATITUDES[0]) {
    monthly = [...bands[0].monthly];
  } else if (
    absLat >= BAND_MIDPOINT_LATITUDES[BAND_MIDPOINT_LATITUDES.length - 1]
  ) {
    monthly = [...bands[bands.length - 1].monthly];
  } else {
    let lo = 0;
    while (
      lo < BAND_MIDPOINT_LATITUDES.length - 2 &&
      absLat > BAND_MIDPOINT_LATITUDES[lo + 1]
    ) {
      lo += 1;
    }
    const hi = lo + 1;
    const loLat = BAND_MIDPOINT_LATITUDES[lo];
    const hiLat = BAND_MIDPOINT_LATITUDES[hi];
    const t = hiLat > loLat ? (absLat - loLat) / (hiLat - loLat) : 0;
    monthly = lerpMonthly(bands[lo].monthly, bands[hi].monthly, t);
  }

  return latitudeDeg < 0 ? rotateToSouthernHemisphere(monthly) : monthly;
};

/**
 * Modelled clear-sky daily GHI total, kWh/m^2, for the representative day of
 * `month` at `latitudeDeg` — the integral of Haurwitz clear-sky GHI over the
 * same daylight hour-angle grid `pv-production.ts` walks (so this is exactly
 * "what the model itself thinks a cloudless day at this site produces").
 */
const modelledClearSkyDailyGhiKwhM2 = (
  latitudeDeg: number,
  monthIndex: number,
): number => {
  const dayOfYear = REPRESENTATIVE_DAY_OF_YEAR[monthIndex];
  const decl = declinationDeg(dayOfYear);
  const sunsetAngle = sunsetHourAngleDeg(latitudeDeg, decl);
  const hourAngles = buildDaylightHourAngles(sunsetAngle, HOUR_ANGLE_STEP_DEG);
  const hourStepHours = HOUR_ANGLE_STEP_DEG / 15;
  let whM2 = 0;
  for (const omega of hourAngles) {
    const cosZ = cosZenith(latitudeDeg, decl, omega);
    if (cosZ <= 0) continue;
    whM2 += haurwitzClearSkyGhi(cosZ) * hourStepHours;
  }
  return whM2 / 1000;
};

/**
 * Derives a real, per-location monthly clearness index (kc = actual GHI /
 * modelled-clear-sky GHI) from a real observed monthly-average-daily-GHI
 * series (e.g. PVGIS `H(i)_d` at angle=0, or NASA POWER `ALLSKY_SFC_SW_DWN`).
 *
 * This is the fix for the P4 round-2 defect: `CLEARNESS_INDEX_BY_LATITUDE_BAND`
 * is a coarse *guess* at this same ratio and, being calibrated too low
 * (topping out at 0.63), was silently halving irradiance a second time on
 * top of the already-physically-correct Haurwitz clear-sky curve. Feeding a
 * REAL monthly GHI total through this same "kc = actual / modelled-clear-sky"
 * definition keeps the rest of the hourly-synthesis pipeline (HDKR
 * transposition, Sandia temp, inverter clipping) completely unchanged — only
 * the input calibration changes, per the critic's fix.
 *
 * Clamped to [CLEARNESS_INDEX_MIN, CLEARNESS_INDEX_MAX] to absorb
 * measurement noise/rounding in the source data without ever letting
 * a single bad month reverse-turn the sun into a light source brighter than
 * clear sky (kc > ~1.1 only really happens transiently via cloud-edge
 * enhancement, which the monthly-average smooths out anyway).
 */
export const deriveClearnessIndexFromMonthlyGhi = (
  latitudeDeg: number,
  monthlyGhiKwhM2Day: readonly number[],
): number[] => {
  const months: number[] = [];
  for (let m = 0; m < 12; m += 1) {
    const modelled = modelledClearSkyDailyGhiKwhM2(latitudeDeg, m);
    const actual = monthlyGhiKwhM2Day[m] ?? 0;
    const kc = modelled > 0 ? actual / modelled : 0;
    months.push(
      Math.max(CLEARNESS_INDEX_MIN, Math.min(CLEARNESS_INDEX_MAX, kc)),
    );
  }
  return months;
};

/**
 * 12 values, Jan..Dec, deg C. Sinusoidal seasonal model: warmer/flatter near
 * the equator, colder/more seasonal towards the poles; phase flips for the
 * Southern hemisphere (July becomes the cold month).
 */
export const getMonthlyAmbientTempC = (latitudeDeg: number): number[] => {
  const absLat = Math.abs(latitudeDeg);
  const mean =
    AMBIENT_TEMP_ANNUAL_MEAN_AT_EQUATOR_C -
    AMBIENT_TEMP_MEAN_LAPSE_PER_DEG_LAT_C * absLat;
  const amplitude = AMBIENT_TEMP_AMPLITUDE_PER_DEG_LAT_C * absLat;
  const isSouthern = latitudeDeg < 0;

  const months: number[] = [];
  for (let m = 0; m < 12; m += 1) {
    // Peak warmth at Jul (index 6) for the North, Jan (index 0) for the South.
    const phaseMonth = isSouthern ? 0 : 6;
    const angle = (2 * Math.PI * (m - phaseMonth)) / 12;
    months.push(mean + amplitude * Math.cos(angle));
  }
  return months;
};
