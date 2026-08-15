/**
 * Shared types for the P4 simulation engine. These mirror the contract in
 * `docs/specs/solar-design-studio.md` §2 and §4. They are declared locally
 * (rather than imported from P1's entity/DTO files) so this package stays a
 * standalone, dependency-free unit that P1 can wire up or reconcile without
 * either side blocking the other. Field names/shapes match the spec exactly
 * so reconciliation should be a type-alias, not a rewrite.
 */

export type Point = { x: number; y: number };

export type PanelPlacement = {
  id: string;
  cx: number;
  cy: number;
  rotationDegrees: number;
  enabled: boolean;
};

export type RoofArrayInput = {
  id: string;
  name: string;
  polygon: Point[];
  tiltDegrees: number;
  azimuthDegrees: number;
  panelModelId: string;
  panelOrientation: 'portrait' | 'landscape';
  rowSpacingM: number;
  columnSpacingM: number;
  setbackM: number;
  shadingLossPercent: number;
  panels: PanelPlacement[];
};

export type ObstructionInput = {
  id: string;
  kind: 'vent' | 'skylight' | 'chimney' | 'tree' | 'other';
  polygon: Point[];
  heightM?: number | null;
};

export type RoofDesignDocInput = {
  version: 1;
  anchor: { lat: number; lng: number };
  arrays: RoofArrayInput[];
  obstructions: ObstructionInput[];
};

/** Minimal panel spec the engine needs — resolved by the caller from `SolarPanel`. */
export type PanelSpec = {
  id: string;
  wattage: number;
  /** deg C^-1 fraction (e.g. -0.0035), not percent. Overrides constants default. */
  tempCoefficientPerC?: number | null;
  noctC?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
};

/** Minimal inverter spec the engine needs — resolved by the caller from `Inverter`. */
export type InverterSpec = {
  id: string;
  acKw: number;
  /** Rated/Euro efficiency, percent (0-100). */
  ratedEfficiencyPercent?: number | null;
};

export type LossStackOverrides = {
  soilingLossPercent?: number;
  mismatchLossPercent?: number;
  wiringLossPercent?: number;
  connectionsLossPercent?: number;
  lightInducedDegradationPercent?: number;
  nameplateLossPercent?: number;
  availabilityLossPercent?: number;
};

export type ClimateOverrides = {
  /**
   * 12 values, Jan..Dec, each in [0,1]. Highest-priority override — supplied
   * verbatim to the engine, bypassing both the real-irradiance derivation
   * and the fallback table. Rarely used directly; prefer `monthlyGhiKwhM2Day`.
   */
  monthlyClearnessIndex?: number[];
  /**
   * 12 values, Jan..Dec, real monthly-average-daily GHI in kWh/m^2/day
   * (e.g. PVGIS `H(i)_d` at angle=0/aspect=0, or NASA POWER
   * `ALLSKY_SFC_SW_DWN`). When present (and `monthlyClearnessIndex` is not),
   * the engine derives a real per-location clearness index from this via
   * `deriveClearnessIndexFromMonthlyGhi` instead of using the coarse
   * latitude-band fallback table. This is the normal/preferred path.
   */
  monthlyGhiKwhM2Day?: number[];
  /** 12 values, Jan..Dec, deg C. Overrides the built-in latitude-derived estimate. */
  monthlyAmbientTempC?: number[];
  groundAlbedo?: number;
  /**
   * Sky-diffuse transposition model. Defaults to 'perez' (Perez et al. 1990,
   * the same model PVGIS/PVWatts use — see `irradiance.ts` for the cited
   * coefficient table). 'hdkr' is retained as an explicit fallback/comparison
   * path, not because it is believed more accurate.
   */
  transpositionModel?: 'perez' | 'hdkr';
  /**
   * Round-4: physical incidence-angle-modifier (IAM) glazing constants
   * (refractive index, extinction coefficient, thickness). Defaults to
   * typical solar-module glass per `constants.ts` (De Soto et al. 2006);
   * override only for a documented non-standard glazing.
   */
  iamGlazingRefractiveIndex?: number;
  iamGlazingExtinctionCoefficientPerM?: number;
  iamGlazingThicknessM?: number;
  /**
   * Round-5: GHI -> beam/diffuse decomposition correlation. Defaults to
   * 'disc' (Maxwell 1987) — see `irradiance.ts` module header for the
   * accuracy envelope and citations. Override to 'erbs' for the legacy
   * correlation.
   */
  decompositionModel?: 'erbs' | 'disc';
};

export type ConsumptionInput = {
  annualKwh?: number;
  monthlyKwh?: number[];
  source?: 'bill' | 'interval' | 'estimate';
};

export type FinancialInput = {
  grossCost?: number;
  rebateAmount?: number;
  importTariffPerKwh?: number;
  feedInTariffPerKwh?: number;
  dailySupplyCharge?: number;
  escalationRatePercent?: number;
  discountRatePercent?: number;
  /** Customer-reported current monthly bill; overrides the computed "before" bill when present. */
  monthlyBillBefore?: number;
};

export type BatteryInput = {
  capacityKwh: number;
  roundTripEfficiencyPercent?: number;
  usableFraction?: number;
};

export type SimulationInput = {
  doc: RoofDesignDocInput;
  panels: PanelSpec[]; // catalog entries referenced by arrays' panelModelId
  inverter?: InverterSpec | null;
  losses?: LossStackOverrides;
  climate?: ClimateOverrides;
  consumption?: ConsumptionInput;
  financial?: FinancialInput;
  battery?: BatteryInput | null;
  degradation?: {
    firstYearPercent?: number;
    annualPercent?: number;
  };
  gridEmissionsFactorKgPerKwh?: number;
};

export type ArraySystemResult = {
  id: string;
  panelCount: number;
  dcKw: number;
  tiltDegrees: number;
  azimuthDegrees: number;
  annualKwh: number;
  specificYieldKwhPerKwp: number;
};

export type SimulationResult = {
  system: {
    panelCount: number;
    dcKw: number;
    acKw: number;
    arrays: ArraySystemResult[];
  };
  production: {
    annualKwh: number;
    monthlyKwh: number[];
    specificYieldKwhPerKwp: number;
    performanceRatio: number;
    firstYearDegradationPercent: number;
    lifetimeKwh: number;
    /**
     * Whether irradiance came from a real per-location source (PVGIS/NASA
     * POWER, cached) or the coarse latitude-band fallback table. Additive
     * field — callers should surface `'fallback-estimate'` to the customer
     * as "provisional, based on regional averages" rather than presenting it
     * as a measured figure.
     */
    climateDataSource: 'real' | 'fallback-estimate' | 'override';
    climateDataSourceLabel: string;
    lossStack: {
      soilingPercent: number;
      shadingPercentWeightedAvg: number;
      mismatchPercent: number;
      wiringPercent: number;
      connectionsPercent: number;
      lightInducedDegradationPercent: number;
      nameplatePercent: number;
      availabilityPercent: number;
      temperaturePercent: number;
      inverterPercent: number;
    };
  };
  consumption: {
    annualKwh: number;
    source: 'bill' | 'interval' | 'estimate';
    monthlyKwh: number[];
  };
  offset: {
    selfConsumptionKwh: number;
    exportKwh: number;
    importKwh: number;
    offsetPercent: number;
    selfSufficiencyPercent: number;
  };
  financial: {
    grossCost: number;
    rebateAmount: number;
    netCost: number;
    year1Savings: number;
    monthlyBillBefore: number;
    monthlyBillAfter: number;
    paybackYears: number;
    roiPercent: number;
    npv: number;
    irrPercent: number;
    cashflow: Array<{ year: number; savings: number; cumulative: number }>;
    /**
     * Whether the tariff rates behind these figures came from the
     * customer's captured bill (`customer`) or the engine's documented
     * defaults (`fallback-estimate` — see `financial.ts`'s module header
     * for exactly what those defaults are). Additive field, mirroring
     * `production.climateDataSource`; callers should surface
     * `'fallback-estimate'` as "based on standard rates, not your bill"
     * rather than presenting the figures as bill-accurate.
     */
    tariffSource: 'customer' | 'fallback-estimate';
  };
  environment: {
    co2AvoidedTonnesPerYear: number;
    co2AvoidedTonnes25y: number;
    treesEquivalent: number;
    carsEquivalent: number;
  };
  warnings: DesignWarning[];
};

export type DesignWarning = {
  id: string;
  tone: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  arrayId?: string | null;
};
