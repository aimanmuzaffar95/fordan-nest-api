/**
 * P4 — Solar production + financial simulation engine.
 *
 * Every tunable in this file is a named, documented constant. All of them are
 * exposed as *overridable* fields on `SimulationInput` (see `types.ts`) — the
 * numbers below are only the fallback used when the caller does not supply a
 * value (job has no bill on file, no runtime setting configured yet, etc).
 *
 * Sources are noted per-constant. Where no authoritative site-specific data
 * source exists (we have no TMY files and add no new dependency), the
 * constant is a documented, honest approximation and the corresponding input
 * is designed to be swapped for a real feed later without changing callers.
 */

// ---------------------------------------------------------------------------
// Astronomical / physical constants
// ---------------------------------------------------------------------------

/** Solar constant, W/m^2 (NREL / WMO accepted value). */
export const SOLAR_CONSTANT_W_M2 = 1367;

/** Stefan-esque irradiance floor below which we treat the sun as "down". */
export const MIN_COS_ZENITH = 1e-4;

/**
 * Klein & Beckman "average day" of each month — the single calendar day
 * whose declination best represents the month's mean daily extraterrestrial
 * irradiation (Duffie & Beckman, "Solar Engineering of Thermal Processes").
 * Index 0 = January.
 */
export const REPRESENTATIVE_DAY_OF_YEAR: readonly number[] = [
  17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344,
];

export const DAYS_IN_MONTH: readonly number[] = [
  31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
];

/** Hour-angle integration step, degrees (15 deg = 1 solar hour). */
export const HOUR_ANGLE_STEP_DEG = 15;

// ---------------------------------------------------------------------------
// Ground / sky
// ---------------------------------------------------------------------------

/** Default diffuse ground reflectance (albedo) per spec §P4-1, "0.2 default". */
export const DEFAULT_GROUND_ALBEDO = 0.2;

/**
 * Physical incidence-angle-modifier (IAM) glazing constants — round-4 fix.
 * Source: De Soto, W., Klein, S.A., Beckman, W.A. (2006), "Improvement and
 * validation of a model for photovoltaic array performance", Solar Energy
 * 80(1), 78-88; underlying Fresnel/Bouguer transmittance formulation from
 * Duffie & Beckman, "Solar Engineering of Thermal Processes", 4th ed.,
 * §5.3/6.17. These are the same defaults `pvlib.iam.physical` ships with for
 * typical solar-module glass, and are what PVGIS itself applies by default
 * (which is why omitting IAM entirely biased every case high — see the P4
 * round-3 report). Overridable via `input.climate.iamGlazing*`.
 */
export const IAM_GLAZING_REFRACTIVE_INDEX = 1.526;
export const IAM_GLAZING_EXTINCTION_COEFFICIENT_PER_M = 4;
export const IAM_GLAZING_THICKNESS_M = 0.002;

// ---------------------------------------------------------------------------
// Climate proxy (no TMY files available — documented honest approximation)
// ---------------------------------------------------------------------------

/**
 * LAST-RESORT FALLBACK ONLY. Monthly clear-sky attenuation ("clearness
 * index" Kt, ratio of real-world GHI to modelled clear-sky GHI) keyed by
 * absolute-latitude band, Jan..Dec.
 *
 * P4 round-2 correction: this table was previously multiplied straight onto
 * Haurwitz clear-sky GHI as the *primary* irradiance source, which silently
 * halved irradiance a second time (Haurwitz already models the correct
 * cloudless-sky value for the sun angle) — an error of -30% to -50% vs
 * PVGIS ground truth, worst at sunny sites like Phoenix. This table is now
 * used ONLY when no real per-location irradiance is available (irradiance
 * cache miss / PVGIS unreachable, see `../../irradiance`), and the result is
 * flagged `production.climateDataSource = 'fallback-estimate'` plus a
 * customer-safe warning so callers know the figures are provisional. Prefer
 * `deriveClearnessIndexFromMonthlyGhi` fed by real PVGIS/NASA-POWER data.
 * Row order is Jan..Dec for the NORTHERN hemisphere; southern-hemisphere
 * latitudes have the array rotated by 6 months (winter/summer swap) in
 * `getMonthlyClearnessIndex`.
 */
/**
 * Clamp bounds for a derived clearness index (kc = actual GHI / modelled
 * clear-sky GHI), whether it comes from the embedded fallback table or from
 * real observed data (`deriveClearnessIndexFromMonthlyGhi` in `climate.ts`).
 * A floor above 0 avoids division-by-near-zero cascades on pathological
 * inputs; a ceiling just above 1 tolerates measurement/rounding noise in a
 * real monthly-average source without ever treating a month as brighter
 * than clear sky by more than a small margin.
 */
export const CLEARNESS_INDEX_MIN = 0.05;
export const CLEARNESS_INDEX_MAX = 1.1;

export const CLEARNESS_INDEX_BY_LATITUDE_BAND: ReadonlyArray<{
  maxAbsLatitude: number;
  monthly: readonly number[];
}> = [
  {
    // Equatorial / tropical: persistent haze + wet-season cloud, low seasonal swing.
    maxAbsLatitude: 15,
    monthly: [
      0.52, 0.53, 0.52, 0.5, 0.48, 0.46, 0.47, 0.49, 0.51, 0.52, 0.51, 0.51,
    ],
  },
  {
    // Subtropical (e.g. most of Australia, southern US, Mediterranean basin edge).
    maxAbsLatitude: 30,
    monthly: [
      0.62, 0.63, 0.61, 0.58, 0.54, 0.51, 0.53, 0.57, 0.6, 0.62, 0.62, 0.61,
    ],
  },
  {
    // Temperate (e.g. southern Australia capitals, southern Europe, central US).
    maxAbsLatitude: 45,
    monthly: [
      0.58, 0.6, 0.58, 0.54, 0.48, 0.44, 0.46, 0.5, 0.55, 0.58, 0.57, 0.56,
    ],
  },
  {
    // Cool temperate / maritime (e.g. UK, New Zealand, Pacific Northwest).
    maxAbsLatitude: 55,
    monthly: [
      0.42, 0.46, 0.47, 0.46, 0.44, 0.42, 0.43, 0.44, 0.44, 0.4, 0.38, 0.38,
    ],
  },
  {
    // High latitude — large seasonal swing, low winter sun.
    maxAbsLatitude: 90,
    monthly: [
      0.35, 0.4, 0.44, 0.46, 0.46, 0.45, 0.45, 0.43, 0.4, 0.35, 0.3, 0.28,
    ],
  },
];

/**
 * Very rough monthly ambient-temperature model: annual mean and seasonal
 * amplitude scaled from absolute latitude (warmer + flatter near the
 * equator, colder + more seasonal towards the poles). This is intentionally
 * simple — it only feeds the cell-temperature derate, and PV temperature
 * loss is a second-order effect next to irradiance. Overridable via
 * `SimulationInput.climate.monthlyAmbientTempC`.
 */
export const AMBIENT_TEMP_ANNUAL_MEAN_AT_EQUATOR_C = 26;
export const AMBIENT_TEMP_MEAN_LAPSE_PER_DEG_LAT_C = 0.25;
export const AMBIENT_TEMP_AMPLITUDE_PER_DEG_LAT_C = 0.35;

// ---------------------------------------------------------------------------
// PV loss stack — mirrors NREL PVWatts v8's own default derate stack so our
// multiplicative loss model lines up with the tool we're benchmarked against.
// (PVWatts default total system losses = 14.08%, from these same factors.)
// All individually overridable via `SimulationInput.losses`.
// ---------------------------------------------------------------------------

export const DEFAULT_SOILING_LOSS_PERCENT = 2;
export const DEFAULT_MISMATCH_LOSS_PERCENT = 2;
export const DEFAULT_WIRING_LOSS_PERCENT = 2;
export const DEFAULT_CONNECTIONS_LOSS_PERCENT = 0.5;
export const DEFAULT_LID_LOSS_PERCENT = 1.5;
export const DEFAULT_NAMEPLATE_LOSS_PERCENT = 1;
export const DEFAULT_AVAILABILITY_LOSS_PERCENT = 3;

/** Fallback per-array shading loss when the design doc omits it. */
export const DEFAULT_SHADING_LOSS_PERCENT = 3;

// ---------------------------------------------------------------------------
// Temperature model (Sandia module-temperature model, open-rack glass/cell/
// polymer-sheet defaults — King, Boyson & Kratochvil, SAND2004-3535) with a
// NOCT-based fallback baked in as the physical meaning of `noctC`.
// ---------------------------------------------------------------------------

/** Sandia "a" coefficient, open-rack glass/cell/polymer sheet. */
export const SANDIA_TEMP_MODEL_A = -3.56;
/** Sandia "b" coefficient (per m/s wind speed), open-rack glass/cell/polymer sheet. */
export const SANDIA_TEMP_MODEL_B = -0.075;
/** Sandia cell-to-module temperature delta at 1000 W/m^2, deg C. */
export const SANDIA_DELTA_T_C = 3;
/** Assumed wind speed, m/s — no wind feed available; documented default. */
export const DEFAULT_WIND_SPEED_M_S = 1;

/** Default power temperature coefficient, %/deg C (typical mono-PERC panel). */
export const DEFAULT_TEMP_COEFFICIENT_PERCENT_PER_C = -0.35;
export const STC_CELL_TEMP_C = 25;
export const STC_IRRADIANCE_W_M2 = 1000;

/** Default NOCT, deg C, used only for documentation/QA cross-check. */
export const DEFAULT_NOCT_C = 45;

// ---------------------------------------------------------------------------
// Inverter part-load efficiency model.
// eff(p) = ratedEff - (k_fixed / p) - k_linear * p, clamped to [0, ratedEff],
// p = DC loading fraction = dcKwInstant / acRatedKw. k_fixed dominates at low
// load (tare / stand-by losses), k_linear dominates at high load (resistive /
// switching losses) — a standard shape for grid-tie string inverters.
// ---------------------------------------------------------------------------
export const INVERTER_EFF_K_FIXED = 0.006;
export const INVERTER_EFF_K_LINEAR = 0.012;
export const DEFAULT_INVERTER_RATED_EFFICIENCY_PERCENT = 97.5;
/** Loading fraction below which the inverter is considered off (self-consumption only). */
export const INVERTER_MIN_LOAD_FRACTION = 0.01;

// ---------------------------------------------------------------------------
// Degradation
// ---------------------------------------------------------------------------
export const DEFAULT_FIRST_YEAR_DEGRADATION_PERCENT = 2;
export const DEFAULT_ANNUAL_DEGRADATION_PERCENT = 0.5;
export const LIFETIME_YEARS = 25;

// ---------------------------------------------------------------------------
// Consumption model
// ---------------------------------------------------------------------------

/** Fallback annual household consumption when no bill/interval data exists. */
export const DEFAULT_ANNUAL_CONSUMPTION_KWH = 6500;

/**
 * Canonical residential hourly load *shape* (sums to 1 over 24h), used to
 * spread a monthly consumption total across the same solar-hour grid the
 * production model uses, so self-consumption/export can be estimated without
 * true interval data. Documented, generic duck-curve-ish residential shape:
 * a base load plus morning and evening peaks. Index 0 = hour ending 00:00.
 */
export const DEFAULT_HOURLY_CONSUMPTION_SHAPE: readonly number[] = [
  0.03, 0.025, 0.02, 0.02, 0.02, 0.025, 0.035, 0.045, 0.04, 0.035, 0.032, 0.03,
  0.032, 0.032, 0.032, 0.035, 0.045, 0.065, 0.075, 0.07, 0.06, 0.05, 0.04,
  0.035,
];

// ---------------------------------------------------------------------------
// Battery dispatch
// ---------------------------------------------------------------------------
export const DEFAULT_BATTERY_ROUND_TRIP_EFFICIENCY_PERCENT = 90;
/** Fraction of nameplate battery capacity usable (depth of discharge). */
export const DEFAULT_BATTERY_USABLE_FRACTION = 0.9;

// ---------------------------------------------------------------------------
// Financial defaults — generic, documented assumptions; override from
// runtime settings / the job's tariff once a settings surface exists
// (none does yet in `RuntimeSettingsService`/`BillingSettings` as of this
// piece; `SimulationInput.financial` is the seam for that).
// ---------------------------------------------------------------------------
export const DEFAULT_IMPORT_TARIFF_PER_KWH = 0.3;
export const DEFAULT_FEED_IN_TARIFF_PER_KWH = 0.05;
export const DEFAULT_DAILY_SUPPLY_CHARGE = 1.0;
export const DEFAULT_TARIFF_ESCALATION_PERCENT = 4;
export const DEFAULT_DISCOUNT_RATE_PERCENT = 6;
/** Rough default installed cost, $/W DC, used only when no job pricing is supplied. */
export const DEFAULT_INSTALLED_COST_PER_WATT = 1.1;
export const DEFAULT_REBATE_AMOUNT = 0;

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/** Grid emissions factor, kg CO2e per kWh — generic national-average default. */
export const DEFAULT_GRID_EMISSIONS_FACTOR_KG_PER_KWH = 0.66;
/** Mature tree CO2 absorption, kg/year (commonly cited EPA/arbor-day figure). */
export const TREE_CO2_ABSORPTION_KG_PER_YEAR = 21;
/** Average passenger vehicle annual CO2 emissions, tonnes/year (EPA average). */
export const AVERAGE_CAR_EMISSIONS_TONNES_PER_YEAR = 4.6;

// ---------------------------------------------------------------------------
// Design guardrails / warning thresholds
// ---------------------------------------------------------------------------
/** Fallback DC:AC sizing ratio used only when no inverter is specified yet. */
export const DEFAULT_DC_AC_RATIO_WHEN_NO_INVERTER = 1.15;

/** Fallback panel dimensions, mm, per spec §2 ("Fallback when null"). */
export const FALLBACK_PANEL_WIDTH_MM = 1134;
export const FALLBACK_PANEL_HEIGHT_MM = 1762;

export const MAX_ARRAYS = 4;
export const DC_AC_RATIO_MIN = 0.8;
export const DC_AC_RATIO_MAX = 1.35;
export const SHADING_WARNING_THRESHOLD_PERCENT = 20;
export const OFFSET_WARNING_THRESHOLD_PERCENT = 120;
/** Angular distance (deg) from equator-facing azimuth beyond which we warn. */
export const AWAY_FROM_EQUATOR_THRESHOLD_DEG = 120;
/** Panel-footprint coverage of usable polygon area above which we call the roof "exhausted". */
export const ROOF_AREA_EXHAUSTED_COVERAGE_FRACTION = 0.92;
