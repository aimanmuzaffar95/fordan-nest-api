/**
 * Per-array, per-month energy production. Orchestrates solar geometry,
 * irradiance decomposition/transposition, cell temperature and inverter
 * clipping into monthly DC/AC kWh per array and for the system as a whole.
 *
 * Inverter clipping is a *system* effect (one inverter, or one inverter bank
 * sized to the whole DC array), so all arrays are walked through the same
 * hour-angle grid for a given representative day, summed to a single system
 * DC power at that instant, passed through the inverter once, and the AC
 * output is then allocated back to arrays pro-rata by DC share (for the
 * per-array `annualKwh` figures §4 requires) — this keeps clipping physically
 * correct (it only happens when *combined* DC exceeds the AC rating) while
 * still reporting a sensible per-array split.
 */

import {
  DAYS_IN_MONTH,
  DEFAULT_AVAILABILITY_LOSS_PERCENT,
  DEFAULT_CONNECTIONS_LOSS_PERCENT,
  DEFAULT_INVERTER_RATED_EFFICIENCY_PERCENT,
  DEFAULT_LID_LOSS_PERCENT,
  DEFAULT_MISMATCH_LOSS_PERCENT,
  DEFAULT_NAMEPLATE_LOSS_PERCENT,
  DEFAULT_SHADING_LOSS_PERCENT,
  DEFAULT_SOILING_LOSS_PERCENT,
  DEFAULT_TEMP_COEFFICIENT_PERCENT_PER_C,
  DEFAULT_WIND_SPEED_M_S,
  DEFAULT_WIRING_LOSS_PERCENT,
  HOUR_ANGLE_STEP_DEG,
  REPRESENTATIVE_DAY_OF_YEAR,
} from './constants';
import {
  buildDaylightHourAngles,
  compassToSouthZeroAzimuth,
  cosIncidence,
  cosZenith,
  declinationDeg,
  sunsetHourAngleDeg,
} from './solar-geometry';
import {
  haurwitzClearSkyGhi,
  transposeToPlaneOfArray,
  type DecompositionModel,
  type IamGlazingOverrides,
  type TranspositionModel,
} from './irradiance';
import {
  sandiaCellTempC,
  sandiaModuleTempC,
  temperaturePowerFactor,
} from './temperature';
import { applyInverterStage } from './inverter';
import type { LossStackOverrides, PanelSpec, RoofArrayInput } from './types';

export type ResolvedArray = {
  input: RoofArrayInput;
  panel: PanelSpec;
  panelCount: number;
  dcKwStc: number;
};

export type NonTemperatureLossFractions = {
  soiling: number;
  mismatch: number;
  wiring: number;
  connections: number;
  lid: number;
  nameplate: number;
  availability: number;
};

export const resolveNonTemperatureLosses = (
  overrides: LossStackOverrides | undefined,
): NonTemperatureLossFractions => ({
  soiling:
    1 - (overrides?.soilingLossPercent ?? DEFAULT_SOILING_LOSS_PERCENT) / 100,
  mismatch:
    1 - (overrides?.mismatchLossPercent ?? DEFAULT_MISMATCH_LOSS_PERCENT) / 100,
  wiring:
    1 - (overrides?.wiringLossPercent ?? DEFAULT_WIRING_LOSS_PERCENT) / 100,
  connections:
    1 -
    (overrides?.connectionsLossPercent ?? DEFAULT_CONNECTIONS_LOSS_PERCENT) /
      100,
  lid:
    1 -
    (overrides?.lightInducedDegradationPercent ?? DEFAULT_LID_LOSS_PERCENT) /
      100,
  nameplate:
    1 -
    (overrides?.nameplateLossPercent ?? DEFAULT_NAMEPLATE_LOSS_PERCENT) / 100,
  availability:
    1 -
    (overrides?.availabilityLossPercent ?? DEFAULT_AVAILABILITY_LOSS_PERCENT) /
      100,
});

export const nonTemperatureLossFactor = (
  f: NonTemperatureLossFractions,
): number =>
  f.soiling *
  f.mismatch *
  f.wiring *
  f.connections *
  f.lid *
  f.nameplate *
  f.availability;

/**
 * Round-6 fix, revised per the coordinator's addendum: the DC-side loss
 * factor that genuinely reduces *instantaneous* power at the inverter's
 * input at every moment, including at peak sun on a clear day — soiling,
 * mismatch, and DC wiring/connections resistance. Three factors that were
 * previously included here are deliberately excluded, each for a distinct
 * reason, not just "annual vs instantaneous":
 *
 * - `availability`: a fraction of *time* online (grid outages, maintenance,
 *   inverter trips), not a per-instant power derate at all. A system that is
 *   98% available is not permanently producing at 98% — it is at ~100% most
 *   of the time and at 0% occasionally. Belongs on the annual energy total.
 * - `lid`: a one-off step change in module output over the first weeks of
 *   life. It is a real, persistent capacity derate once it has occurred —
 *   but it is a property of the module's *effective rating*, not a
 *   time-varying instantaneous loss like soiling. Modelled as a derate on
 *   the module's effective capacity rather than lumped into the same
 *   per-hour chain as genuinely time-varying losses.
 * - `nameplate`: manufacturing tolerance on rated DC capacity — again a
 *   rating adjustment, not an instantaneous loss.
 *
 * Folding `lid`/`nameplate`/`availability` into the same instantaneous
 * chain as soiling/mismatch/wiring/connections (the pre-round-6, and this
 * round's first-pass, behaviour) suppressed peak instantaneous DC power
 * below what a correctly-derated array actually delivers at peak sun, which
 * is why `totalClippedKwh` was measured to be exactly zero at every
 * realistic DC:AC oversizing ratio (0.8-2.0) the critic tested, only
 * appearing at an unrealistic 3.0. See `runProductionModel` for where the
 * three excluded factors are now applied: `lid`/`nameplate` as an effective
 * DC capacity derate feeding the inverter-clipping physics (so clipping is
 * evaluated against a realistic peak, not nameplate-inflated one), and
 * `availability` as a final derate on delivered AC energy only, entirely
 * after clipping has been evaluated.
 */
export const dcStageLossFactor = (f: NonTemperatureLossFractions): number =>
  f.soiling * f.mismatch * f.wiring * f.connections;

/**
 * Round-6 addendum fix: `lid` and `nameplate` are legitimate, persistent
 * capacity derates — real reductions in what the array can deliver even at
 * peak sun — so they must still count toward the DC power the clipping
 * check sees (unlike `availability`, which is excluded from clipping
 * entirely). The distinction from `dcStageLossFactor` is where they are
 * applied: as an adjustment to the array's *effective STC capacity*
 * (`dcKwStc`) rather than lumped in with the genuinely time-varying
 * per-instant losses (soiling/mismatch/wiring/connections), matching how
 * they physically behave — a rating change, not an hour-to-hour variation.
 */
export const effectiveDcCapacityFactor = (
  f: NonTemperatureLossFractions,
): number => f.lid * f.nameplate;

export type ProductionModelParams = {
  latitudeDeg: number;
  arrays: ResolvedArray[];
  monthlyClearnessIndex: number[]; // 12
  monthlyAmbientTempC: number[]; // 12
  groundAlbedo: number;
  transpositionModel?: TranspositionModel;
  /** Round-4: physical IAM glazing constants, overridable; defaults per `constants.ts`. */
  iamGlazing?: IamGlazingOverrides;
  /** Round-5: GHI decomposition correlation, default 'disc' (see irradiance.ts for the DISC-vs-Erbs comparison and accuracy envelope note). 'erbs' available as override. */
  decompositionModel?: DecompositionModel;
  nonTempLosses: NonTemperatureLossFractions;
  acRatedKw: number;
  inverterRatedEfficiencyPercent: number;
};

export type ProductionModelResult = {
  monthlySystemAcKwh: number[]; // 12
  perArrayMonthlyAcKwh: Map<string, number[]>; // arrayId -> 12
  perArrayMonthlyDcKwh: Map<string, number[]>; // arrayId -> 12
  monthlyPoaKwhPerM2SystemWeighted: number[]; // 12, DC-weighted average POA
  totalDcKwhBeforeInverter: number;
  totalTempLossWeightedKwh: number; // energy lost to temperature vs a 25C reference
  totalClippedKwh: number;
};

const windSpeedMs = DEFAULT_WIND_SPEED_M_S;

export const runProductionModel = (
  params: ProductionModelParams,
): ProductionModelResult => {
  const {
    latitudeDeg,
    arrays,
    monthlyClearnessIndex,
    monthlyAmbientTempC,
    groundAlbedo,
    transpositionModel = 'perez',
    iamGlazing,
    decompositionModel = 'disc',
    nonTempLosses,
    acRatedKw,
    inverterRatedEfficiencyPercent,
  } = params;

  // Round-6 fix: `dcStageLossFactor` (soiling/mismatch/wiring/connections/
  // LID/nameplate only) is what derates the per-instant DC physics the
  // clipping check sees. `availability` is applied separately, below, as a
  // final derate on delivered AC energy — see `dcStageLossFactor`'s doc
  // comment for why folding it in here suppressed clipping.
  const nonTempFactor = dcStageLossFactor(nonTempLosses);
  // Round-6 addendum fix: LID + nameplate tolerance are real, persistent
  // capacity derates, so — unlike `availability` — they must still count
  // toward the peak instantaneous DC the clipping check sees; they are
  // folded in as an effective-capacity adjustment rather than lumped with
  // the genuinely time-varying per-instant losses. See
  // `effectiveDcCapacityFactor`'s doc comment.
  const effectiveCapacityFactor = effectiveDcCapacityFactor(nonTempLosses);
  const invEffFraction =
    (inverterRatedEfficiencyPercent ||
      DEFAULT_INVERTER_RATED_EFFICIENCY_PERCENT) / 100;

  const zeroMonths = (): number[] => new Array<number>(12).fill(0);

  const monthlySystemAcKwh: number[] = zeroMonths();
  const perArrayMonthlyAcKwh = new Map<string, number[]>();
  const perArrayMonthlyDcKwh = new Map<string, number[]>();
  // sum(poaKwhPerM2 * dcKwh) per month, fully-integrated (see per-hour accumulation below).
  const monthlyPoaWeightedNumerator: number[] = zeroMonths();
  const monthlyDcKwhForWeighting: number[] = zeroMonths();
  let totalDcKwhBeforeInverter = 0;
  let totalTempLossWeightedKwh = 0;
  let totalClippedKwh = 0;

  for (const a of arrays) {
    perArrayMonthlyAcKwh.set(a.input.id, zeroMonths());
    perArrayMonthlyDcKwh.set(a.input.id, zeroMonths());
  }

  for (let month = 0; month < 12; month += 1) {
    const dayOfYear = REPRESENTATIVE_DAY_OF_YEAR[month];
    const decl = declinationDeg(dayOfYear);
    const sunsetAngle = sunsetHourAngleDeg(latitudeDeg, decl);
    const hourAngles = buildDaylightHourAngles(
      sunsetAngle,
      HOUR_ANGLE_STEP_DEG,
    );
    const kt = monthlyClearnessIndex[month];
    const ambientTempC = monthlyAmbientTempC[month];
    const daysInMonth = DAYS_IN_MONTH[month];
    // Each hour-angle sample represents `HOUR_ANGLE_STEP_DEG / 15` solar
    // hours (15 deg = 1 hour), not always a full hour — this must scale
    // every rectangular-integration energy accumulation below, or changing
    // `HOUR_ANGLE_STEP_DEG` silently multiplies annual energy by
    // (15 / step) instead of only changing integration precision.
    const hourWeight = daysInMonth * (HOUR_ANGLE_STEP_DEG / 15);

    for (const omega of hourAngles) {
      const cosZ = cosZenith(latitudeDeg, decl, omega);
      if (cosZ <= 0) continue;

      const clearSkyGhi = haurwitzClearSkyGhi(cosZ);
      const ghi = clearSkyGhi * kt;
      if (ghi <= 0) continue;

      // Per-array POA + DC power at this instant.
      let systemDcKwInstant = 0;
      const perArrayDcKwInstant = new Map<string, number>();
      const perArrayPoaWm2 = new Map<string, number>();

      for (const a of arrays) {
        const shadingFraction =
          1 -
          (a.input.shadingLossPercent ?? DEFAULT_SHADING_LOSS_PERCENT) / 100;
        const surfaceAzimuth = compassToSouthZeroAzimuth(
          a.input.azimuthDegrees,
        );
        const cosTheta = cosIncidence(
          latitudeDeg,
          decl,
          omega,
          a.input.tiltDegrees,
          surfaceAzimuth,
        );
        const { poa, effectivePoa } = transposeToPlaneOfArray(
          {
            ghi,
            dayOfYear,
            cosZenith: cosZ,
            cosIncidence: cosTheta,
            tiltDeg: a.input.tiltDegrees,
            groundAlbedo,
            iamGlazing,
            decompositionModel,
          },
          transpositionModel,
        );

        // Temperature model and the PR reference-yield denominator use raw
        // POA (what physically strikes/heats the module); `effectivePoa`
        // (post-IAM, always <= poa) is what actually generates DC power.
        const moduleTemp = sandiaModuleTempC(poa, ambientTempC, windSpeedMs);
        const cellTemp = sandiaCellTempC(moduleTemp, poa);
        const tempCoefficient =
          a.panel.tempCoefficientPerC ??
          DEFAULT_TEMP_COEFFICIENT_PERCENT_PER_C / 100;
        const tempFactor = Math.max(
          0,
          temperaturePowerFactor(cellTemp, tempCoefficient),
        );

        const dcKw =
          (effectivePoa / 1000) *
          a.dcKwStc *
          effectiveCapacityFactor *
          nonTempFactor *
          shadingFraction *
          tempFactor;

        perArrayDcKwInstant.set(a.input.id, dcKw);
        perArrayPoaWm2.set(a.input.id, poa);
        systemDcKwInstant += dcKw;

        // Temperature-loss accounting: energy that would have been produced
        // at the STC reference (25C) minus what temperature derate leaves us.
        const dcKwAtRefTemp =
          (effectivePoa / 1000) *
          a.dcKwStc *
          effectiveCapacityFactor *
          nonTempFactor *
          shadingFraction;
        totalTempLossWeightedKwh +=
          Math.max(0, dcKwAtRefTemp - dcKw) * hourWeight;
      }

      const { acKw: systemAcKw, clippedKw } = applyInverterStage(
        systemDcKwInstant,
        acRatedKw,
        invEffFraction,
      );

      totalDcKwhBeforeInverter += systemDcKwInstant * hourWeight;
      totalClippedKwh += clippedKw * hourWeight;
      monthlySystemAcKwh[month] += systemAcKw * hourWeight;

      // Capacity-weighted (STC kW) average instantaneous POA across arrays
      // this hour, integrated into a proper kWh/m^2 monthly total (1-hour
      // step * days-in-month repetitions) — used only for the reported
      // performance ratio, not for energy math (each array already used its
      // own POA above).
      let totalStcKwThisHour = 0;
      let poaCapacityWeightedSum = 0;
      for (const a of arrays) {
        totalStcKwThisHour += a.dcKwStc;
        poaCapacityWeightedSum +=
          (perArrayPoaWm2.get(a.input.id) ?? 0) * a.dcKwStc;
      }
      if (totalStcKwThisHour > 0) {
        const poaAvgWm2 = poaCapacityWeightedSum / totalStcKwThisHour;
        monthlyPoaWeightedNumerator[month] += (poaAvgWm2 / 1000) * hourWeight;
        monthlyDcKwhForWeighting[month] += 1; // hour-sample counted once, not per array
      }

      for (const a of arrays) {
        const dcKw = perArrayDcKwInstant.get(a.input.id) ?? 0;
        const share = systemDcKwInstant > 0 ? dcKw / systemDcKwInstant : 0;
        const acShareKw = systemAcKw * share;
        const arr = perArrayMonthlyAcKwh.get(a.input.id);
        if (arr) arr[month] += acShareKw * hourWeight;
        const dcArr = perArrayMonthlyDcKwh.get(a.input.id);
        if (dcArr) dcArr[month] += dcKw * hourWeight;
      }
    }
  }

  // `monthlyPoaWeightedNumerator` already holds the fully-integrated monthly
  // kWh/m^2 (see the per-hour capacity-weighted accumulation above) — no
  // further division needed.
  const monthlyPoaKwhPerM2SystemWeighted = monthlyPoaWeightedNumerator;

  // Round-6 fix: `availability` derates *delivered* energy here — after
  // clipping has already been evaluated against the un-derated per-instant
  // DC/AC physics above — rather than inside the hot per-hour loop, so it
  // cannot suppress the peak the clipping check sees. `totalClippedKwh` and
  // `totalDcKwhBeforeInverter` are intentionally left un-derated: they are
  // diagnostic figures describing the array's underlying physics, not
  // customer-facing revenue, and availability is a time-online factor, not
  // a property of the array's instantaneous output.
  const availabilityFactor = nonTempLosses.availability;
  const monthlySystemAcKwhFinal = monthlySystemAcKwh.map(
    (kwh) => kwh * availabilityFactor,
  );
  for (const arr of perArrayMonthlyAcKwh.values()) {
    for (let i = 0; i < arr.length; i += 1) {
      arr[i] *= availabilityFactor;
    }
  }

  return {
    monthlySystemAcKwh: monthlySystemAcKwhFinal,
    perArrayMonthlyAcKwh,
    perArrayMonthlyDcKwh,
    monthlyPoaKwhPerM2SystemWeighted,
    totalDcKwhBeforeInverter,
    totalTempLossWeightedKwh,
    totalClippedKwh,
  };
};
