/**
 * Clear-sky GHI, GHI decomposition (DISC, default; Erbs, override) and
 * plane-of-array transposition (Perez, default; HDKR, override), with a
 * physical incidence-angle modifier (IAM) applied per-component. Pure math,
 * no I/O.
 *
 * Clear-sky model choice: **Haurwitz (1945)**, not Ineichen/Linke-turbidity.
 * Both are allowed by the spec ("e.g. Haurwitz or Ineichen"); Haurwitz needs
 * only solar zenith angle (no aerosol/turbidity table to embed and justify),
 * which keeps this dependency-free and easy to audit, at the cost of being
 * less accurate in high-aerosol/high-altitude sites — an acceptable
 * trade given we already scale the result by an empirical monthly clearness
 * index (see `climate.ts`) that dominates the error budget anyway.
 *
 * ## Accuracy envelope (round-5 measurement, current as of this note)
 * Measured against live PVGIS(with-horizon) annual-energy references across
 * 11 latitude/tilt/azimuth geometries (see `apps/api/scripts/check-solar-
 * simulation-reference.mjs` and the round-3/4/5 P4 reports for the full
 * methodology and per-case numbers), with the shipped model (Perez
 * transposition + physical IAM + DISC decomposition):
 *   - Mean absolute error: 4.61% (vs 5.05% for the Erbs override, vs a
 *     documented ~10% baseline overestimate before IAM/DISC were added).
 *   - 7 of 11 geometries land inside ±5%; worst case is 11.1%.
 *   - Every *realistic* installation geometry in the set (both Sydney
 *     orientations, both Phoenix tilts, London, Singapore, Cape Town, and
 *     flat arrays at the equator and at 60°N) sits between −2.4% and +6.6%.
 *   - The two outliers are both at an unusual 60° tilt: equator-at-60°
 *     (+11.1%, not a real installation — optimum tilt at the equator is
 *     flat) and Oslo-60°N-at-60° (−8.3%, a real configuration and the one
 *     genuine known miss).
 * Root cause of the residual, per the round-4/5 investigation: this is a
 * monthly-representative-day engine using a single GHI decomposition
 * correlation for the whole year. Erbs and DISC each win at a different
 * subset of latitude/tilt combinations for the same underlying reason —
 * neither a single kt-only curve (Erbs) nor a single airmass-aware envelope
 * (DISC) can track how the true clear/cloudy day mix (which an hourly
 * satellite reference sees directly and a monthly-representative-day model
 * cannot) redistributes beam vs. diffuse at every combination of latitude
 * and tilt simultaneously. **If this residual ever needs to close further,
 * the next real step is hourly (or sub-daily) synthesis of the GHI series,
 * not another decomposition-correlation swap** — monthly representative
 * days cannot capture the clear/cloudy day distribution that the nonlinear
 * downstream terms (inverter clipping, cell-temperature-dependent
 * efficiency, IAM's own nonlinearity at high AOI) are sensitive to. Do not
 * repeat this round's approach on the assumption a different correlation
 * will close the gap; it was tried (Erbs → DISC) and it does not.
 */

import {
  IAM_GLAZING_EXTINCTION_COEFFICIENT_PER_M,
  IAM_GLAZING_REFRACTIVE_INDEX,
  IAM_GLAZING_THICKNESS_M,
  MIN_COS_ZENITH,
  SOLAR_CONSTANT_W_M2,
} from './constants';

/** Haurwitz clear-sky GHI, W/m^2, from cos(zenith). Returns 0 when sun is down. */
export const haurwitzClearSkyGhi = (cosZ: number): number => {
  if (cosZ <= 0) return 0;
  return 1098 * cosZ * Math.exp(-0.059 / cosZ);
};

/** Extraterrestrial horizontal irradiance, W/m^2 (Duffie & Beckman eq. 1.4.1). */
export const extraterrestrialHorizontalIrradiance = (
  dayOfYear: number,
  cosZ: number,
): number => {
  if (cosZ <= 0) return 0;
  const eccentricityCorrection =
    1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365);
  return SOLAR_CONSTANT_W_M2 * eccentricityCorrection * cosZ;
};

/**
 * Erbs correlation: instantaneous clearness index kt -> diffuse fraction kd.
 * (Erbs, Klein & Duffie 1982.)
 */
export const erbsDiffuseFraction = (kt: number): number => {
  const k = Math.max(0, Math.min(1, kt));
  if (k <= 0.22) return 1 - 0.09 * k;
  if (k <= 0.8) {
    return (
      0.9511 - 0.1604 * k + 4.388 * k ** 2 - 16.638 * k ** 3 + 12.336 * k ** 4
    );
  }
  return 0.165;
};

export type IamGlazingOverrides = {
  refractiveIndex?: number;
  extinctionCoefficientPerM?: number;
  thicknessM?: number;
};

/** Cap on relative airmass used by the DISC correlation (matches `pvlib.irradiance.disc`'s default `max_airmass=12`, avoiding a blow-up at grazing sun elevation). */
export const DISC_MAX_AIRMASS = 12;

/**
 * DISC (Direct Insolation Simulation Code) GHI -> DNI decomposition.
 * Source: Maxwell, E.L. (1987), "A Quasi-Physical Model for Converting
 * Hourly Global Horizontal to Direct Normal Insolation", SERI/TR-215-3087,
 * Solar Energy Research Institute. Same formulation/coefficients as
 * `pvlib.irradiance.disc`. Unlike Erbs — a single clearness-index-to-diffuse
 * -fraction curve fit with no airmass term — DISC estimates DNI directly as
 * a clear-sky beam-transmittance envelope (`knc`, a quartic polynomial in
 * airmass) minus a clearness-and-airmass-dependent correction (`deltaKn`),
 * so it tracks beam attenuation with airmass explicitly rather than
 * assuming one fixed kt-only curve applies at every sun elevation. That
 * airmass dependence is exactly what Erbs lacks, and is the round-5
 * hypothesis for the high-latitude/high-tilt residual (round-4 report):
 * London/Oslo sit at high airmass even at local solar noon.
 */
export const discDni = (
  kt: number,
  cosZ: number,
  extraterrestrialNormal: number,
): number => {
  if (cosZ <= MIN_COS_ZENITH || extraterrestrialNormal <= 0) return 0;
  const ktC = Math.max(0, Math.min(1, kt));
  const airmass = Math.min(
    DISC_MAX_AIRMASS,
    1 / Math.max(cosZ, MIN_COS_ZENITH),
  );

  const isLow = ktC <= 0.6;
  const kt2 = ktC * ktC;
  const kt3 = kt2 * ktC;
  const a = isLow
    ? 0.512 - 1.56 * ktC + 2.286 * kt2 - 2.222 * kt3
    : -5.743 + 21.77 * ktC - 27.49 * kt2 + 11.56 * kt3;
  const b = isLow
    ? 0.37 + 0.962 * ktC
    : 41.4 - 118.5 * ktC + 66.05 * kt2 + 31.9 * kt3;
  const c = isLow
    ? -0.28 + 0.932 * ktC - 2.048 * kt2
    : -47.01 + 184.2 * ktC - 222.0 * kt2 + 73.81 * kt3;

  const deltaKn = a + b * Math.exp(c * airmass);
  const knc =
    0.866 -
    0.122 * airmass +
    0.0121 * airmass ** 2 -
    0.000653 * airmass ** 3 +
    0.000014 * airmass ** 4;
  const kn = Math.max(0, knc - deltaKn);

  return Math.max(0, kn * extraterrestrialNormal);
};

/**
 * Which GHI -> beam/diffuse decomposition correlation to use. Default is
 * 'disc' (round-5 decision: better on every summary measure against live
 * PVGIS references across all 11 reference geometries — 7/11 inside ±5% vs
 * Erbs's 6/11, mean absolute error 4.61% vs 5.05%, worst case 11.1% vs
 * 12.0%). 'erbs' is retained as an explicit override/comparison path, not
 * because it is believed more accurate overall.
 */
export type DecompositionModel = 'erbs' | 'disc';

/**
 * Dispatches to the selected GHI decomposition correlation and returns the
 * resulting horizontal diffuse/beam split. Kept as a single seam so the
 * decomposition choice is isolated from the transposition model (Perez/HDKR)
 * and from IAM — round-5 constraint: do not stack changes.
 */
export const decomposeGhi = (
  ghi: number,
  kt: number,
  cosZ: number,
  extraterrestrialNormal: number,
  model: DecompositionModel = 'disc',
): { dhi: number; beamHorizontal: number } => {
  if (model === 'disc') {
    const dni = discDni(kt, cosZ, extraterrestrialNormal);
    const beamHorizontal = Math.max(0, Math.min(ghi, dni * cosZ));
    const dhi = Math.max(0, ghi - beamHorizontal);
    return { dhi, beamHorizontal };
  }
  const kd = erbsDiffuseFraction(kt);
  const dhi = kd * ghi;
  const beamHorizontal = Math.max(0, ghi - dhi);
  return { dhi, beamHorizontal };
};

export type HdkrInputs = {
  ghi: number; // horizontal global, W/m^2
  dayOfYear: number;
  cosZenith: number;
  cosIncidence: number;
  tiltDeg: number;
  groundAlbedo: number;
  /** Round-4: physical IAM glazing constants, overridable; defaults per `constants.ts`. */
  iamGlazing?: IamGlazingOverrides;
  /** Round-5: GHI decomposition correlation, default 'disc'; 'erbs' available as override. */
  decompositionModel?: DecompositionModel;
};

export type HdkrResult = {
  dhi: number;
  beamHorizontal: number;
  /** Raw plane-of-array irradiance, pre-IAM — this is what heats the module
   * (fed to the temperature model) and what performance-ratio reference
   * yield is measured against. */
  poa: number;
  /** Post-IAM effective irradiance — this is what actually generates DC
   * power; always <= `poa`. See `iamPhysical` below. */
  effectivePoa: number;
};

/** Which anisotropic sky-diffuse transposition model to use. Default: 'perez'. */
export type TranspositionModel = 'perez' | 'hdkr';

/**
 * Physical incidence-angle modifier (IAM): Fresnel reflection (via Snell's
 * law) plus Bouguer/Lambert glazing absorption, normalized so IAM(0deg)=1
 * and IAM falls toward 0 as incidence approaches grazing (90deg). This is
 * the fraction of irradiance that actually reaches the cell after glazing
 * reflection+absorption losses — a real, physical loss term PVGIS applies
 * by default that this engine omitted through round 3 (see round-3 report;
 * omitting it biased every case high, worst at high incidence angle).
 * Source: De Soto et al. (2006), Solar Energy 80(1), 78-88 (`constants.ts`
 * has the full citation and default n/K/L); same model as `pvlib.iam.physical`.
 */
export const iamPhysical = (
  cosIncidence: number,
  glazing?: IamGlazingOverrides,
): number => {
  const n = glazing?.refractiveIndex ?? IAM_GLAZING_REFRACTIVE_INDEX;
  const k =
    glazing?.extinctionCoefficientPerM ??
    IAM_GLAZING_EXTINCTION_COEFFICIENT_PER_M;
  const l = glazing?.thicknessM ?? IAM_GLAZING_THICKNESS_M;

  const cosT1 = Math.max(-1, Math.min(1, cosIncidence));
  if (cosT1 <= 0) return 0; // sun behind the plane

  // Normal-incidence reference (theta1=theta2=0); normalizes IAM(0)=1 and
  // avoids a 0/0 singularity in the general Fresnel formula below.
  const reflectance0 = ((n - 1) / (n + 1)) ** 2;
  const tau0 = (1 - reflectance0) * Math.exp(-k * l);

  const theta1 = Math.acos(cosT1);
  if (theta1 < 1e-6) return 1;

  const theta2 = Math.asin(Math.sin(theta1) / n);
  const tauR =
    1 -
    0.5 *
      (Math.sin(theta2 - theta1) ** 2 / Math.sin(theta2 + theta1) ** 2 +
        Math.tan(theta2 - theta1) ** 2 / Math.tan(theta2 + theta1) ** 2);
  const tauA = Math.exp((-k * l) / Math.cos(theta2));

  return Math.max(0, Math.min(1, (tauR * tauA) / tau0));
};

/**
 * Effective (single-equivalent) incidence angle for isotropic sky-diffuse
 * and ground-reflected irradiance on a tilted surface — IAM is inherently a
 * function of one beam angle, but diffuse/ground irradiance arrives from a
 * whole hemisphere, so a single representative angle (function of tilt
 * alone) is substituted for each.
 * Source: Brandemuehl, M.J., Beckman, W.A. (1980), "Transmission of diffuse
 * radiation through CPC and flat-plate collector glazings", Solar Energy
 * 24(5), 511-513 — the same correlation the De Soto PV model, PVsyst and
 * pvlib use for this purpose.
 */
export const effectiveSkyDiffuseIncidenceAngleDeg = (
  tiltDeg: number,
): number => {
  const b = Math.max(0, Math.min(90, tiltDeg));
  return 59.7 - 0.1388 * b + 0.001497 * b ** 2;
};

export const effectiveGroundDiffuseIncidenceAngleDeg = (
  tiltDeg: number,
): number => {
  const b = Math.max(0, Math.min(90, tiltDeg));
  return 90 - 0.5788 * b + 0.002693 * b ** 2;
};

/**
 * Applies IAM separately to the beam, sky-diffuse and ground-reflected POA
 * components (each with its own appropriate incidence angle), not as one
 * blanket multiplier on total POA — beam uses the actual instantaneous AOI;
 * sky- and ground-diffuse use Brandemuehl & Beckman's tilt-dependent
 * effective angles (see `effectiveSkyDiffuseIncidenceAngleDeg` /
 * `effectiveGroundDiffuseIncidenceAngleDeg` above).
 */
const applyIam = (
  beamComponent: number,
  skyDiffuseComponent: number,
  groundComponent: number,
  cosTheta: number,
  tiltDeg: number,
  glazing?: IamGlazingOverrides,
): number => {
  const iamBeam = iamPhysical(cosTheta, glazing);
  const iamSky = iamPhysical(
    Math.cos((effectiveSkyDiffuseIncidenceAngleDeg(tiltDeg) * Math.PI) / 180),
    glazing,
  );
  const iamGround = iamPhysical(
    Math.cos(
      (effectiveGroundDiffuseIncidenceAngleDeg(tiltDeg) * Math.PI) / 180,
    ),
    glazing,
  );
  return (
    Math.max(0, beamComponent) * iamBeam +
    Math.max(0, skyDiffuseComponent) * iamSky +
    Math.max(0, groundComponent) * iamGround
  );
};

/**
 * Hay-Davies-Klucher-Reindl anisotropic transposition to plane-of-array
 * irradiance. Round 2 default was HDKR to avoid embedding a bin coefficient
 * table; round 3 (see `transposePerez` below) adds full Perez as the default
 * path once sign-off was given to embed the *published* Perez coefficients
 * (as opposed to the round-1 mistake of fabricating unsourced numbers).
 * HDKR is retained as a fallback/comparison path behind `TranspositionModel`.
 */
export const transposeHdkr = (inputs: HdkrInputs): HdkrResult => {
  const {
    ghi,
    dayOfYear,
    cosZenith: cosZ,
    cosIncidence: cosTheta,
    tiltDeg,
    groundAlbedo,
    iamGlazing,
    decompositionModel,
  } = inputs;

  if (ghi <= 0 || cosZ <= MIN_COS_ZENITH) {
    return { dhi: 0, beamHorizontal: 0, poa: 0, effectivePoa: 0 };
  }

  const extraterrestrial = extraterrestrialHorizontalIrradiance(
    dayOfYear,
    cosZ,
  );
  const kt =
    extraterrestrial > 0 ? Math.max(0, Math.min(1, ghi / extraterrestrial)) : 0;
  const extraterrestrialNormalForDecomp =
    SOLAR_CONSTANT_ECCENTRICITY(dayOfYear);
  const { dhi, beamHorizontal } = decomposeGhi(
    ghi,
    kt,
    cosZ,
    extraterrestrialNormalForDecomp,
    decompositionModel,
  );

  // Anisotropy index: fraction of diffuse treated as circumsolar (travels
  // with the beam) vs isotropic sky dome.
  const anisotropyIndex =
    extraterrestrial > 0 ? beamHorizontal / extraterrestrial : 0;

  // Horizon-brightening modulation factor.
  const horizonBrightening = Math.sqrt(
    Math.max(0, beamHorizontal / Math.max(ghi, 1e-6)),
  );

  const tiltRad = (tiltDeg * Math.PI) / 180;
  const rb = Math.max(0, cosTheta / Math.max(cosZ, MIN_COS_ZENITH));

  const beamComponent = beamHorizontal * rb;
  const diffuseComponent =
    dhi *
    (anisotropyIndex * rb +
      (1 - anisotropyIndex) *
        ((1 + Math.cos(tiltRad)) / 2) *
        (1 + horizonBrightening * Math.sin(tiltRad / 2) ** 3));
  const groundComponent = ghi * groundAlbedo * ((1 - Math.cos(tiltRad)) / 2);

  const poa = Math.max(0, beamComponent + diffuseComponent + groundComponent);
  const effectivePoa = applyIam(
    beamComponent,
    diffuseComponent,
    groundComponent,
    cosTheta,
    tiltDeg,
    iamGlazing,
  );

  return { dhi, beamHorizontal, poa, effectivePoa };
};

/**
 * Perez et al. (1990) anisotropic sky-diffuse transposition coefficients.
 * Source: Perez, R., Ineichen, P., Seals, R., Michalsky, J., Stewart, R.
 * (1990), "Modeling daylight availability and irradiance components from
 * direct and global irradiance", Solar Energy 44(5), 271-289 — the same
 * published table used by PVLIB (`pvlib.irradiance.perez`), PVWatts and
 * PVGIS. Values are the literature originals, unrounded/untouched (not
 * hand-tuned), grouped by the standard 8 sky-clearness (epsilon) bins.
 * `epsilonUpperBound` is the *upper* (exclusive) edge of each bin; the last
 * bin is unbounded above.
 */
const PEREZ_COEFFICIENTS: ReadonlyArray<{
  epsilonUpperBound: number;
  f11: number;
  f12: number;
  f13: number;
  f21: number;
  f22: number;
  f23: number;
}> = [
  {
    epsilonUpperBound: 1.065,
    f11: -0.008,
    f12: 0.588,
    f13: -0.062,
    f21: -0.06,
    f22: 0.072,
    f23: -0.022,
  },
  {
    epsilonUpperBound: 1.23,
    f11: 0.13,
    f12: 0.683,
    f13: -0.151,
    f21: -0.019,
    f22: 0.066,
    f23: -0.029,
  },
  {
    epsilonUpperBound: 1.5,
    f11: 0.33,
    f12: 0.487,
    f13: -0.221,
    f21: 0.055,
    f22: -0.064,
    f23: -0.026,
  },
  {
    epsilonUpperBound: 1.95,
    f11: 0.568,
    f12: 0.187,
    f13: -0.295,
    f21: 0.109,
    f22: -0.152,
    f23: -0.014,
  },
  {
    epsilonUpperBound: 2.8,
    f11: 0.873,
    f12: -0.392,
    f13: -0.362,
    f21: 0.226,
    f22: -0.462,
    f23: 0.001,
  },
  {
    epsilonUpperBound: 4.5,
    f11: 1.132,
    f12: -1.237,
    f13: -0.412,
    f21: 0.288,
    f22: -0.823,
    f23: 0.056,
  },
  {
    epsilonUpperBound: 6.2,
    f11: 1.06,
    f12: -1.6,
    f13: -0.359,
    f21: 0.264,
    f22: -1.127,
    f23: 0.131,
  },
  {
    epsilonUpperBound: Infinity,
    f11: 0.678,
    f12: -0.327,
    f13: -0.25,
    f21: 0.156,
    f22: -1.377,
    f23: 0.251,
  },
];

/** Perez (1990) sky-clearness-bin coefficient constant, radians^-3, per the source paper. */
const PEREZ_KAPPA = 1.041;

export const transposePerez = (inputs: HdkrInputs): HdkrResult => {
  const {
    ghi,
    dayOfYear,
    cosZenith: cosZ,
    cosIncidence: cosTheta,
    tiltDeg,
    groundAlbedo,
    iamGlazing,
    decompositionModel,
  } = inputs;

  if (ghi <= 0 || cosZ <= MIN_COS_ZENITH) {
    return { dhi: 0, beamHorizontal: 0, poa: 0, effectivePoa: 0 };
  }

  const extraterrestrialNormal = SOLAR_CONSTANT_ECCENTRICITY(dayOfYear);
  const extraterrestrial = extraterrestrialNormal * cosZ;
  const kt =
    extraterrestrial > 0 ? Math.max(0, Math.min(1, ghi / extraterrestrial)) : 0;
  const { dhi, beamHorizontal } = decomposeGhi(
    ghi,
    kt,
    cosZ,
    extraterrestrialNormal,
    decompositionModel,
  );
  // Direct normal irradiance (beam projected back onto the sun-normal plane).
  const dni = beamHorizontal / Math.max(cosZ, MIN_COS_ZENITH);

  const zenithRad = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  const airMass = 1 / Math.max(cosZ, MIN_COS_ZENITH);

  // Sky clearness (epsilon): ratio capturing how "blue-sky-diffuse" vs
  // "overcast-diffuse" the diffuse component is, adjusted for zenith angle.
  const epsilon =
    dhi > 0
      ? ((dhi + dni) / dhi + PEREZ_KAPPA * zenithRad ** 3) /
        (1 + PEREZ_KAPPA * zenithRad ** 3)
      : 1;
  // Sky brightness (delta): how "thick"/bright the diffuse dome is.
  const delta = dhi > 0 ? (dhi * airMass) / extraterrestrialNormal : 0;

  const bin =
    PEREZ_COEFFICIENTS.find((b) => epsilon < b.epsilonUpperBound) ??
    PEREZ_COEFFICIENTS[PEREZ_COEFFICIENTS.length - 1];

  const f1 = Math.max(0, bin.f11 + bin.f12 * delta + bin.f13 * zenithRad);
  const f2 = bin.f21 + bin.f22 * delta + bin.f23 * zenithRad;

  const tiltRad = (tiltDeg * Math.PI) / 180;
  const a = Math.max(0, cosTheta);
  const b = Math.max(Math.cos((85 * Math.PI) / 180), cosZ);

  const beamComponent = dni * a;
  const diffuseComponent =
    dhi *
    ((1 - f1) * ((1 + Math.cos(tiltRad)) / 2) +
      f1 * (a / b) +
      f2 * Math.sin(tiltRad));
  const groundComponent = ghi * groundAlbedo * ((1 - Math.cos(tiltRad)) / 2);

  const poa = Math.max(
    0,
    beamComponent + Math.max(0, diffuseComponent) + groundComponent,
  );
  const effectivePoa = applyIam(
    beamComponent,
    diffuseComponent,
    groundComponent,
    cosTheta,
    tiltDeg,
    iamGlazing,
  );

  return { dhi, beamHorizontal, poa, effectivePoa };
};

/** Extraterrestrial normal irradiance (W/m^2), i.e. `SOLAR_CONSTANT_W_M2` corrected for
 * Earth-Sun distance eccentricity — reused from `extraterrestrialHorizontalIrradiance`'s
 * own eccentricity factor by dividing out cosZ=1 (i.e. computed once, independent of sun angle). */
const SOLAR_CONSTANT_ECCENTRICITY = (dayOfYear: number): number =>
  extraterrestrialHorizontalIrradiance(dayOfYear, 1);

/**
 * Dispatches to the selected anisotropic transposition model. Perez is the
 * default (see header comment on `transposePerez` for provenance/citation);
 * HDKR remains available as an explicit fallback/comparison path.
 */
export const transposeToPlaneOfArray = (
  inputs: HdkrInputs,
  model: TranspositionModel = 'perez',
): HdkrResult =>
  model === 'hdkr' ? transposeHdkr(inputs) : transposePerez(inputs);
