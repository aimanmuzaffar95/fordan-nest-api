/**
 * Committed reference fixtures for the P4 simulation-engine guardrail
 * (`check-solar-simulation-reference.mjs`). `monthlyGhiKwhM2Day` is a
 * one-time PVGIS v5.3 pull (horizontal plane, angle=0/aspect=0) for each
 * site, frozen here so the guardrail never depends on network access or on
 * PVGIS's own dataset being updated out from under us — it is a regression
 * lock on *this engine's own* output for a fixed, real-world irradiance
 * input, not a live re-check against PVGIS (that's `docs/qa` or the
 * scratchpad validation script's job, run manually).
 *
 * `expectedAnnualKwh` is this engine's own reviewed output as of the P4
 * round-5 fix (2026-08-16) — the default GHI decomposition correlation
 * changed from Erbs to DISC (Maxwell 1987; airmass-aware beam/diffuse split,
 * see `irradiance.ts` for citation and the accuracy-envelope note in its
 * module header). DISC replaced Erbs as the default because it is better on
 * every summary measure against live PVGIS references across all 11
 * geometries (mean absolute error 4.61% vs 5.05%, worst case 11.1% vs
 * 12.0%, 7/11 vs 6/11 inside ±5%) — see the P4 round-5 report for the full
 * per-case comparison table and the known remaining weak spot (60°-tilt
 * geometries, notably Oslo 60°N). Perez transposition + physical IAM (round
 * 4) are unchanged this round. `toleranceKwh` is intentionally tight
 * (regression detection, not a ground-truth accuracy gate) — a few kWh of
 * drift from unrelated formatting changes is fine; a double-digit percent
 * swing (the P4 round-1 defect this guardrail exists to catch) is not.
 */
export type ReferenceCase = {
  label: string;
  lat: number;
  lng: number;
  tiltDegrees: number;
  azimuthDegrees: number;
  kwp: number;
  monthlyGhiKwhM2Day: number[];
  expectedAnnualKwh: number;
  toleranceKwh: number;
  /**
   * Round-6: added after the critic proved the guardrail asserted only
   * `annualKwh` and was blind to a sign-flipped degradation constant
   * (`DEFAULT_ANNUAL_DEGRADATION_PERCENT` 0.5 -> -5 still passed 11/11).
   * `performanceRatio`/`lifetimeKwh` are cheap, high-signal additions that
   * would have caught that class of defect immediately (both are directly
   * driven by degradation).
   */
  expectedPerformanceRatio: number;
  tolerancePerformanceRatio: number;
  expectedLifetimeKwh: number;
  toleranceLifetimeKwh: number;
};

/**
 * Round-6: financial-engine fixtures, added after the critic found the
 * `-0 < 0` payback-detection bug (`financial.ts`) — a fully-rebated system
 * (`netCost === 0`) was reported as "never pays back" because JavaScript's
 * negative zero silently broke the crossing-detection loop, and nothing in
 * this guardrail would have caught it (it only ever asserted `annualKwh`).
 * These exercise `paybackYears`/`netCost` directly, including the exact
 * zero-net-cost edge case that was the real defect.
 */
export type FinancialReferenceCase = {
  label: string;
  lat: number;
  lng: number;
  tiltDegrees: number;
  azimuthDegrees: number;
  kwp: number;
  monthlyGhiKwhM2Day: number[];
  financial: {
    grossCost?: number;
    rebateAmount?: number;
    importTariffPerKwh?: number;
    feedInTariffPerKwh?: number;
    dailySupplyCharge?: number;
  };
  expectedNetCost: number;
  expectedPaybackYears: number;
  tolerancePaybackYears: number;
  /**
   * Round-7: `year1Savings`/`roiPercent`/`npv` — optional because the three
   * round-6 fixtures are structurally unable to exercise them (two force
   * `netCost <= 0`, which short-circuits payback to 0 regardless of any
   * savings arithmetic; the third has import=export=feedIn=0, which forces
   * `paybackYears` to "never" regardless of escalation). The critic proved
   * this by flipping `DEFAULT_TARIFF_ESCALATION_PERCENT` 4 -> -80 and
   * `DEFAULT_DISCOUNT_RATE_PERCENT` and showing all three fixtures still
   * passed. The 4th fixture below (positive netCost, nonzero escalating
   * savings) is the one that actually exercises this trio — see its
   * comment for the sign-flip proof.
   */
  expectedYear1Savings?: number;
  toleranceYear1Savings?: number;
  expectedRoiPercent?: number;
  toleranceRoiPercent?: number;
  expectedNpv?: number;
  toleranceNpv?: number;
};

export const REFERENCE_CASES: ReferenceCase[] = [
  {
    label: 'Sydney, equator-facing (20°/0°)',
    lat: -33.8688,
    lng: 151.2093,
    tiltDegrees: 20,
    azimuthDegrees: 0,
    kwp: 10,
    monthlyGhiKwhM2Day: [
      6.45, 5.76, 4.72, 3.84, 3.05, 2.37, 2.8, 3.73, 4.93, 5.8, 6.38, 6.78,
    ],
    expectedAnnualKwh: 14944,
    toleranceKwh: 150,
    expectedPerformanceRatio: 0.7833,
    tolerancePerformanceRatio: 0.01,
    expectedLifetimeKwh: 344970,
    toleranceLifetimeKwh: 3450,
  },
  {
    label: 'Sydney, away from equator (20°/180°)',
    lat: -33.8688,
    lng: 151.2093,
    tiltDegrees: 20,
    azimuthDegrees: 180,
    kwp: 10,
    monthlyGhiKwhM2Day: [
      6.45, 5.76, 4.72, 3.84, 3.05, 2.37, 2.8, 3.73, 4.93, 5.8, 6.38, 6.78,
    ],
    expectedAnnualKwh: 10810,
    toleranceKwh: 110,
    expectedPerformanceRatio: 0.7606,
    tolerancePerformanceRatio: 0.01,
    expectedLifetimeKwh: 249552,
    toleranceLifetimeKwh: 2496,
  },
  {
    label: 'Phoenix (25°/180°)',
    lat: 33.4484,
    lng: -112.074,
    tiltDegrees: 25,
    azimuthDegrees: 180,
    kwp: 10,
    monthlyGhiKwhM2Day: [
      3.49, 4.56, 5.98, 7.47, 8.2, 8.41, 7.43, 6.86, 6.08, 5.05, 3.85, 3.1,
    ],
    expectedAnnualKwh: 19271,
    toleranceKwh: 192,
    expectedPerformanceRatio: 0.7761,
    tolerancePerformanceRatio: 0.01,
    expectedLifetimeKwh: 444871,
    toleranceLifetimeKwh: 4449,
  },
  {
    label: 'Phoenix, optimum tilt (33°/180°)',
    lat: 33.4484,
    lng: -112.074,
    tiltDegrees: 33,
    azimuthDegrees: 180,
    kwp: 10,
    monthlyGhiKwhM2Day: [
      3.49, 4.56, 5.98, 7.47, 8.2, 8.41, 7.43, 6.86, 6.08, 5.05, 3.85, 3.1,
    ],
    expectedAnnualKwh: 19496,
    toleranceKwh: 194,
    expectedPerformanceRatio: 0.7775,
    tolerancePerformanceRatio: 0.01,
    expectedLifetimeKwh: 450055,
    toleranceLifetimeKwh: 4501,
  },
  {
    label: 'London (35°/180°)',
    lat: 51.5074,
    lng: -0.1278,
    tiltDegrees: 35,
    azimuthDegrees: 180,
    kwp: 10,
    monthlyGhiKwhM2Day: [
      0.81, 1.43, 2.56, 4.12, 4.73, 5.29, 5.14, 4.24, 3.21, 1.85, 1.04, 0.67,
    ],
    expectedAnnualKwh: 9690,
    toleranceKwh: 95,
    expectedPerformanceRatio: 0.7959,
    tolerancePerformanceRatio: 0.01,
    expectedLifetimeKwh: 223682,
    toleranceLifetimeKwh: 2237,
  },
  {
    label: 'Singapore (10°/180°)',
    lat: 1.3521,
    lng: 103.8198,
    tiltDegrees: 10,
    azimuthDegrees: 180,
    kwp: 10,
    monthlyGhiKwhM2Day: [
      4.81, 5.56, 5.59, 5.32, 4.89, 4.62, 4.81, 5.08, 5.22, 5.06, 4.35, 4.21,
    ],
    expectedAnnualKwh: 13702,
    toleranceKwh: 140,
    expectedPerformanceRatio: 0.763,
    tolerancePerformanceRatio: 0.01,
    expectedLifetimeKwh: 316305,
    toleranceLifetimeKwh: 3163,
  },
  {
    label: 'Cape Town (34°/0°)',
    lat: -33.9249,
    lng: 18.4241,
    tiltDegrees: 34,
    azimuthDegrees: 0,
    kwp: 10,
    monthlyGhiKwhM2Day: [
      8.26, 7.52, 5.89, 4.36, 2.9, 2.36, 2.67, 3.45, 4.74, 6.4, 7.51, 8.31,
    ],
    expectedAnnualKwh: 16831,
    toleranceKwh: 168,
    expectedPerformanceRatio: 0.7778,
    tolerancePerformanceRatio: 0.01,
    expectedLifetimeKwh: 388551,
    toleranceLifetimeKwh: 3886,
  },
  {
    label: 'Equator, flat (0°/0°)',
    lat: -0.02,
    lng: 109.33,
    tiltDegrees: 0,
    azimuthDegrees: 0,
    kwp: 10,
    monthlyGhiKwhM2Day: [
      4.59, 5.02, 5.06, 4.88, 4.7, 4.68, 4.94, 5.19, 5.13, 4.74, 4.24, 4.16,
    ],
    expectedAnnualKwh: 13256,
    toleranceKwh: 135,
    expectedPerformanceRatio: 0.7604,
    tolerancePerformanceRatio: 0.01,
    expectedLifetimeKwh: 306019,
    toleranceLifetimeKwh: 3060,
  },
  {
    label: 'Equator, 60° tilt (60°/180°)',
    lat: -0.02,
    lng: 109.33,
    tiltDegrees: 60,
    azimuthDegrees: 180,
    kwp: 10,
    monthlyGhiKwhM2Day: [
      4.59, 5.02, 5.06, 4.88, 4.7, 4.68, 4.94, 5.19, 5.13, 4.74, 4.24, 4.16,
    ],
    expectedAnnualKwh: 8807,
    toleranceKwh: 87,
    expectedPerformanceRatio: 0.7617,
    tolerancePerformanceRatio: 0.01,
    expectedLifetimeKwh: 203300,
    toleranceLifetimeKwh: 2033,
  },
  {
    label: 'Oslo 60°N, 60° tilt (60°/180°)',
    lat: 59.9139,
    lng: 10.7522,
    tiltDegrees: 60,
    azimuthDegrees: 180,
    kwp: 10,
    monthlyGhiKwhM2Day: [
      0.26, 0.88, 2.26, 3.82, 4.91, 5.61, 5.13, 3.96, 2.57, 1.18, 0.38, 0.15,
    ],
    expectedAnnualKwh: 8544,
    toleranceKwh: 82,
    expectedPerformanceRatio: 0.7956,
    tolerancePerformanceRatio: 0.01,
    expectedLifetimeKwh: 197230,
    toleranceLifetimeKwh: 1972,
  },
  {
    label: 'Oslo 60°N, flat (0°/0°)',
    lat: 59.9139,
    lng: 10.7522,
    tiltDegrees: 0,
    azimuthDegrees: 0,
    kwp: 10,
    monthlyGhiKwhM2Day: [
      0.26, 0.88, 2.26, 3.82, 4.91, 5.61, 5.13, 3.96, 2.57, 1.18, 0.38, 0.15,
    ],
    expectedAnnualKwh: 7276,
    toleranceKwh: 75,
    expectedPerformanceRatio: 0.7664,
    tolerancePerformanceRatio: 0.01,
    expectedLifetimeKwh: 167973,
    toleranceLifetimeKwh: 1680,
  },
];

export const FINANCIAL_REFERENCE_CASES: FinancialReferenceCase[] = [
  {
    // The exact defect class: grossCost === rebateAmount -> netCost === 0
    // via floating-point subtraction of two equal positives, which produces
    // `+0`, but the old `-netCost` unary-negation code turned that into
    // `-0` and silently broke payback detection ("never pays back" instead
    // of the correct "already paid back, 0 years").
    label: 'Fully rebated system (netCost = 0)',
    lat: 33.4484,
    lng: -112.074,
    tiltDegrees: 25,
    azimuthDegrees: 180,
    kwp: 10,
    monthlyGhiKwhM2Day: [
      3.49, 4.56, 5.98, 7.47, 8.2, 8.41, 7.43, 6.86, 6.08, 5.05, 3.85, 3.1,
    ],
    financial: { grossCost: 15000, rebateAmount: 15000 },
    expectedNetCost: 0,
    expectedPaybackYears: 0,
    tolerancePaybackYears: 0.01,
  },
  {
    // Over-rebated: rebateAmount > grossCost. netCost is clamped to 0 in
    // `financial.ts` (`Math.max(0, grossCost - rebateAmount)`), so this
    // should behave identically to the exact-zero case above, not go
    // negative or throw.
    label: 'Over-rebated system (rebate exceeds cost)',
    lat: 33.4484,
    lng: -112.074,
    tiltDegrees: 25,
    azimuthDegrees: 180,
    kwp: 6,
    monthlyGhiKwhM2Day: [
      3.49, 4.56, 5.98, 7.47, 8.2, 8.41, 7.43, 6.86, 6.08, 5.05, 3.85, 3.1,
    ],
    financial: { grossCost: 9000, rebateAmount: 12000 },
    expectedNetCost: 0,
    expectedPaybackYears: 0,
    tolerancePaybackYears: 0.01,
  },
  {
    // Zero savings, positive netCost: import tariff equals feed-in tariff
    // and the array is sized so annual export roughly offsets import,
    // driving year1Savings to ~0. This must genuinely report "never pays
    // back" (paybackYears === LIFETIME_YEARS + 1) — the fix must not make
    // every case report instant payback, only the netCost<=0 one.
    label: 'Positive netCost, ~zero year-1 savings',
    lat: 51.5074,
    lng: -0.1278,
    tiltDegrees: 35,
    azimuthDegrees: 180,
    kwp: 3,
    monthlyGhiKwhM2Day: [
      0.81, 1.43, 2.56, 4.12, 4.73, 5.29, 5.14, 4.24, 3.21, 1.85, 1.04, 0.67,
    ],
    financial: {
      grossCost: 9000,
      rebateAmount: 0,
      importTariffPerKwh: 0,
      feedInTariffPerKwh: 0,
      dailySupplyCharge: 0,
    },
    expectedNetCost: 9000,
    expectedPaybackYears: 26,
    tolerancePaybackYears: 0.01,
  },
  {
    // Round-7 fixture: positive netCost, default (nonzero, escalating)
    // tariffs and a positive year-1 savings figure — the shape every real
    // proposal actually has, and the one the round-6 trio structurally
    // could not exercise. Values below are this engine's own reviewed
    // output (Phoenix 25/180, kwp=10, grossCost=15000, rebateAmount=3000,
    // all other financial inputs at their documented defaults).
    //
    // Sign-flip proof (round-7): with `DEFAULT_TARIFF_ESCALATION_PERCENT`
    // temporarily changed from 4 to -80, `year1Savings` is unaffected
    // (unaffected by definition — it's the year-1 figure), but `roiPercent`
    // collapses from ~474% to ~-86% and `npv` collapses from ~$19,788 to
    // ~-$8,975 — both fail loudly against the tolerances below. Reverting
    // restores the pass. With `DEFAULT_DISCOUNT_RATE_PERCENT` changed from
    // 6 to 60, `npv` collapses to ~$3,000 — also fails; `year1Savings` and
    // `roiPercent` are correctly unaffected (discount rate only feeds NPV).
    label:
      'Positive netCost, escalating savings (protects escalation + discount rate)',
    lat: 33.4484,
    lng: -112.074,
    tiltDegrees: 25,
    azimuthDegrees: 180,
    kwp: 10,
    monthlyGhiKwhM2Day: [
      3.49, 4.56, 5.98, 7.47, 8.2, 8.41, 7.43, 6.86, 6.08, 5.05, 3.85, 3.1,
    ],
    financial: { grossCost: 15000, rebateAmount: 3000 },
    expectedNetCost: 12000,
    expectedPaybackYears: 6.18,
    tolerancePaybackYears: 0.05,
    expectedYear1Savings: 1808.34,
    toleranceYear1Savings: 18,
    expectedRoiPercent: 473.69,
    toleranceRoiPercent: 5,
    expectedNpv: 19788.02,
    toleranceNpv: 200,
  },
];
