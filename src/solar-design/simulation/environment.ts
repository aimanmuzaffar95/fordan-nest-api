/**
 * Environmental-equivalence figures. Factors are documented, generic
 * defaults (see `constants.ts`), not site-specific.
 */

import {
  AVERAGE_CAR_EMISSIONS_TONNES_PER_YEAR,
  DEFAULT_GRID_EMISSIONS_FACTOR_KG_PER_KWH,
  TREE_CO2_ABSORPTION_KG_PER_YEAR,
} from './constants';

export type EnvironmentResult = {
  co2AvoidedTonnesPerYear: number;
  co2AvoidedTonnes25y: number;
  treesEquivalent: number;
  carsEquivalent: number;
};

export const computeEnvironment = (
  annualKwh: number,
  lifetimeKwh: number,
  gridEmissionsFactorKgPerKwh?: number,
): EnvironmentResult => {
  const factor =
    gridEmissionsFactorKgPerKwh ?? DEFAULT_GRID_EMISSIONS_FACTOR_KG_PER_KWH;
  const co2AvoidedTonnesPerYear = (annualKwh * factor) / 1000;
  const co2AvoidedTonnes25y = (lifetimeKwh * factor) / 1000;

  return {
    co2AvoidedTonnesPerYear,
    co2AvoidedTonnes25y,
    treesEquivalent:
      (co2AvoidedTonnesPerYear * 1000) / TREE_CO2_ABSORPTION_KG_PER_YEAR,
    carsEquivalent:
      co2AvoidedTonnesPerYear / AVERAGE_CAR_EMISSIONS_TONNES_PER_YEAR,
  };
};
