/**
 * Cell temperature (Sandia module-temperature model, King/Boyson/Kratochvil
 * SAND2004-3535, open-rack glass/cell/polymer-sheet coefficients) and the
 * resulting temperature power derate. `noctC` is accepted per-panel but only
 * used as documentation of the module family — the Sandia a/b/deltaT
 * coefficients (open-rack defaults) drive the actual temperature computed,
 * because they additionally account for wind speed, which a flat NOCT
 * calculation cannot.
 */

import {
  SANDIA_DELTA_T_C,
  SANDIA_TEMP_MODEL_A,
  SANDIA_TEMP_MODEL_B,
  STC_CELL_TEMP_C,
  STC_IRRADIANCE_W_M2,
} from './constants';

/** Module back-surface temperature, deg C. */
export const sandiaModuleTempC = (
  poaIrradianceWM2: number,
  ambientTempC: number,
  windSpeedMS: number,
): number => {
  if (poaIrradianceWM2 <= 0) return ambientTempC;
  return (
    poaIrradianceWM2 *
      Math.exp(SANDIA_TEMP_MODEL_A + SANDIA_TEMP_MODEL_B * windSpeedMS) +
    ambientTempC
  );
};

/** Cell temperature, deg C, from module temperature + irradiance-scaled delta. */
export const sandiaCellTempC = (
  moduleTempC: number,
  poaIrradianceWM2: number,
): number =>
  moduleTempC + (poaIrradianceWM2 / STC_IRRADIANCE_W_M2) * SANDIA_DELTA_T_C;

/**
 * Multiplicative power factor from temperature (1.0 at STC 25 deg C).
 * `tempCoefficientPerC` is a negative fraction per degree C, e.g. -0.0035.
 */
export const temperaturePowerFactor = (
  cellTempC: number,
  tempCoefficientPerC: number,
): number => 1 + tempCoefficientPerC * (cellTempC - STC_CELL_TEMP_C);
