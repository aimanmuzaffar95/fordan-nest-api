/**
 * Companion runner for `check-solar-simulation-reference.mjs` — invoked via
 * `ts-node --transpile-only` (same mechanism `npm run migration:*` already
 * uses) so the guardrail can exercise the real TypeScript engine without a
 * full Nest build. Prints one JSON line per reference case to stdout.
 */
import {
  runSimulation,
  type SimulationInput,
} from '../src/solar-design/simulation';
import { REFERENCE_CASES } from './solar-simulation-reference-cases';

function makeArray(
  id: string,
  tiltDegrees: number,
  azimuthDegrees: number,
  panelCount: number,
) {
  const cols = Math.ceil(Math.sqrt(panelCount));
  const rows = Math.ceil(panelCount / cols);
  const panelW = 1.1;
  const panelH = 1.8;
  const polygon = [
    { x: 0, y: 0 },
    { x: cols * panelW + 2, y: 0 },
    { x: cols * panelW + 2, y: rows * panelH + 2 },
    { x: 0, y: rows * panelH + 2 },
  ];
  const panels: Array<{
    id: string;
    cx: number;
    cy: number;
    rotationDegrees: number;
    enabled: boolean;
  }> = [];
  let n = 0;
  for (let r = 0; r < rows && n < panelCount; r += 1) {
    for (let c = 0; c < cols && n < panelCount; c += 1, n += 1) {
      panels.push({
        id: `${id}-p${n}`,
        cx: 1 + c * panelW + panelW / 2,
        cy: 1 + r * panelH + panelH / 2,
        rotationDegrees: 0,
        enabled: true,
      });
    }
  }
  return {
    id,
    name: id,
    polygon,
    tiltDegrees,
    azimuthDegrees,
    panelModelId: 'panel-400',
    panelOrientation: 'landscape' as const,
    rowSpacingM: 0.1,
    columnSpacingM: 0.1,
    setbackM: 0,
    shadingLossPercent: 0,
    panels,
  };
}

// Warm up the JS engine/module graph before timing. The 100ms budget models
// the debounced-drag hot path (`simulate()` called repeatedly against an
// already-loaded process), not cold process/module-load time, which the
// very first call in any fresh process pays once regardless of engine code.
runSimulation({
  doc: {
    version: 1,
    anchor: { lat: REFERENCE_CASES[0].lat, lng: REFERENCE_CASES[0].lng },
    arrays: [
      makeArray(
        'warmup',
        REFERENCE_CASES[0].tiltDegrees,
        REFERENCE_CASES[0].azimuthDegrees,
        Math.round((REFERENCE_CASES[0].kwp * 1000) / 400),
      ),
    ],
    obstructions: [],
  },
  panels: [{ id: 'panel-400', wattage: 400, widthMm: 1100, heightMm: 1800 }],
  inverter: {
    id: 'inv1',
    acKw: REFERENCE_CASES[0].kwp / 1.15,
    ratedEfficiencyPercent: 97.5,
  },
  climate: { monthlyGhiKwhM2Day: REFERENCE_CASES[0].monthlyGhiKwhM2Day },
});

for (const c of REFERENCE_CASES) {
  const panelCount = Math.round((c.kwp * 1000) / 400);
  const input: SimulationInput = {
    doc: {
      version: 1,
      anchor: { lat: c.lat, lng: c.lng },
      arrays: [makeArray('a1', c.tiltDegrees, c.azimuthDegrees, panelCount)],
      obstructions: [],
    },
    panels: [{ id: 'panel-400', wattage: 400, widthMm: 1100, heightMm: 1800 }],
    inverter: {
      id: 'inv1',
      acKw: c.kwp / 1.15,
      ratedEfficiencyPercent: 97.5,
    },
    climate: { monthlyGhiKwhM2Day: c.monthlyGhiKwhM2Day },
  };
  const t0 = performance.now();
  const result = runSimulation(input);
  const t1 = performance.now();
  console.log(
    JSON.stringify({
      label: c.label,
      annualKwh: result.production.annualKwh,
      performanceRatio: result.production.performanceRatio,
      lifetimeKwh: result.production.lifetimeKwh,
      ms: t1 - t0,
      expectedAnnualKwh: c.expectedAnnualKwh,
      toleranceKwh: c.toleranceKwh,
      expectedPerformanceRatio: c.expectedPerformanceRatio,
      tolerancePerformanceRatio: c.tolerancePerformanceRatio,
      expectedLifetimeKwh: c.expectedLifetimeKwh,
      toleranceLifetimeKwh: c.toleranceLifetimeKwh,
    }),
  );
}

// Round-6: financial-engine fixtures. The P4 round-1..5 guardrail asserted
// only `annualKwh` — the critic proved this was blind to a real bug
// (`-0 < 0` silently breaking payback detection for a fully-rebated
// system) by showing `DEFAULT_ANNUAL_DEGRADATION_PERCENT` could be flipped
// from 0.5 to -5 (panels producing *more* power every year) and still pass
// 11/11. These fixtures exercise `paybackYears`/`roiPercent`/`npv`
// directly, including the zero-net-cost and negative-savings edge cases
// that were the actual defect class.
import { FINANCIAL_REFERENCE_CASES } from './solar-simulation-reference-cases';

for (const c of FINANCIAL_REFERENCE_CASES) {
  const panelCount = Math.round((c.kwp * 1000) / 400);
  const input: SimulationInput = {
    doc: {
      version: 1,
      anchor: { lat: c.lat, lng: c.lng },
      arrays: [makeArray('a1', c.tiltDegrees, c.azimuthDegrees, panelCount)],
      obstructions: [],
    },
    panels: [{ id: 'panel-400', wattage: 400, widthMm: 1100, heightMm: 1800 }],
    inverter: {
      id: 'inv1',
      acKw: c.kwp / 1.15,
      ratedEfficiencyPercent: 97.5,
    },
    climate: { monthlyGhiKwhM2Day: c.monthlyGhiKwhM2Day },
    financial: c.financial,
  };
  const result = runSimulation(input);
  console.log(
    JSON.stringify({
      financialLabel: c.label,
      netCost: result.financial.netCost,
      paybackYears: result.financial.paybackYears,
      roiPercent: result.financial.roiPercent,
      npv: result.financial.npv,
      year1Savings: result.financial.year1Savings,
      expectedNetCost: c.expectedNetCost,
      expectedPaybackYears: c.expectedPaybackYears,
      tolerancePaybackYears: c.tolerancePaybackYears,
      expectedYear1Savings: c.expectedYear1Savings,
      toleranceYear1Savings: c.toleranceYear1Savings,
      expectedRoiPercent: c.expectedRoiPercent,
      toleranceRoiPercent: c.toleranceRoiPercent,
      expectedNpv: c.expectedNpv,
      toleranceNpv: c.toleranceNpv,
    }),
  );
}
