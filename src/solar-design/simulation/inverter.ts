/**
 * Inverter part-load efficiency + real DC clipping.
 *
 * eff(p) = ratedEff - k_fixed/p - k_linear*p, p = DC loading fraction
 * (instantaneous DC kW / inverter AC-rated kW), clamped to [0, ratedEff].
 * k_fixed models tare/stand-by losses (dominant at low load), k_linear
 * models resistive/switching losses (dominant at high load) — the standard
 * shape of a grid-tie string inverter's efficiency curve. Clipping falls
 * naturally out of `acOutputKw = min(dcKw * eff(p), acRatedKw)`: once DC
 * power exceeds what the inverter can convert and pass at its rated AC
 * output, the excess is lost, not merely flagged.
 */

import {
  INVERTER_EFF_K_FIXED,
  INVERTER_EFF_K_LINEAR,
  INVERTER_MIN_LOAD_FRACTION,
} from './constants';

export const inverterEfficiency = (
  loadFraction: number,
  ratedEfficiencyFraction: number,
): number => {
  if (loadFraction < INVERTER_MIN_LOAD_FRACTION) return 0;
  const eff =
    ratedEfficiencyFraction -
    INVERTER_EFF_K_FIXED / loadFraction -
    INVERTER_EFF_K_LINEAR * loadFraction;
  return Math.max(0, Math.min(ratedEfficiencyFraction, eff));
};

export type InverterStageResult = {
  acKw: number;
  clippedKw: number;
};

/** Applies part-load efficiency and hard AC-capacity clipping to a DC input. */
export const applyInverterStage = (
  dcKw: number,
  acRatedKw: number,
  ratedEfficiencyFraction: number,
): InverterStageResult => {
  if (dcKw <= 0 || acRatedKw <= 0) return { acKw: 0, clippedKw: 0 };
  const loadFraction = dcKw / acRatedKw;
  const eff = inverterEfficiency(loadFraction, ratedEfficiencyFraction);
  const uncappedAc = dcKw * eff;
  const acKw = Math.min(uncappedAc, acRatedKw);
  const clippedKw = Math.max(0, uncappedAc - acKw);
  return { acKw, clippedKw };
};
