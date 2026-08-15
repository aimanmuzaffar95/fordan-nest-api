#!/usr/bin/env node
/**
 * Guardrail for the P4 solar production/financial simulation engine
 * (`src/solar-design/simulation/`). Fails loudly if the engine's output
 * drifts from a small set of committed reference figures
 * (`solar-simulation-reference-cases.ts`) — the same pattern as
 * `check-entity-migrations.mjs`, not a Jest spec (AGENTS.md forbids new
 * ones). Also asserts the 100ms-per-case perf budget the debounced-drag UX
 * depends on.
 *
 * This exists because the P4 round-1 defect (irradiance double-counted via
 * a fabricated clearness table, -33% mean error vs PVGIS ground truth)
 * shipped with zero automated coverage anywhere under `solar-design/`. Run:
 *   node scripts/check-solar-simulation-reference.mjs
 *
 * ## What this guardrail does and does not catch (round-6, measured — not
 * asserted; see the P4 round-6 report for the full methodology)
 * This is a coarse, 11-geometry-plus-3-financial-fixture regression check,
 * not an exhaustive physics test. Measured `DEFAULT_GROUND_ALBEDO`
 * perturbations from the 0.2 default: 0.35 -> 2/14 fail, 0.5 -> 6/14 fail,
 * 0.7 -> 8/14 fail, 0.9 (unphysical, fresh-snow-extreme) -> 8/14 fail. It
 * reliably catches gross regressions (double-counted irradiance, a sign
 * flip, a swapped model) but a subtle, plausible-magnitude error (e.g. a
 * transcription typo shifting one Perez coefficient in a bin this fixture
 * set barely exercises) can pass untouched — confirmed directly: a 10x
 * corruption of the Perez `f11` coefficient in an under-exercised bin, a 2x
 * corruption of a mid-bin `f12`, and a 25%-high IAM refractive index all
 * passed 11/11 (now 14/14) unchanged. Broadening the fixture set to exercise
 * more of the Perez epsilon-bin distribution is the fix for that gap and is
 * tracked as follow-up work, not done in this pass. Do not describe this
 * guardrail as "catches any physics change" — it does not; it catches drift
 * in the specific reference outputs it was given.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(SCRIPTS_DIR, 'solar-simulation-reference-runner.ts');
const PERF_BUDGET_MS = 100;

let stdout;
try {
  stdout = execFileSync(
    'node',
    [
      join(SCRIPTS_DIR, '..', 'node_modules', 'ts-node', 'dist', 'bin.js'),
      '--transpile-only',
      RUNNER,
    ],
    {
      cwd: join(SCRIPTS_DIR, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        TS_NODE_COMPILER_OPTIONS: JSON.stringify({
          module: 'commonjs',
          moduleResolution: 'node',
          resolvePackageJsonExports: false,
        }),
      },
    },
  );
} catch (err) {
  console.error('✗ solar-simulation reference runner failed to execute:');
  console.error(err.stdout || err.message);
  process.exit(1);
}

const lines = stdout.trim().split('\n').filter(Boolean);
if (lines.length === 0) {
  console.error('✗ solar-simulation reference runner produced no output');
  process.exit(1);
}

let failures = 0;
let productionLines = 0;
let financialLines = 0;
console.log(
  'Site'.padEnd(38),
  'Actual'.padStart(8),
  'Expected'.padStart(10),
  'Tol'.padStart(6),
  'ms'.padStart(6),
  'Result'.padStart(8),
);
for (const line of lines) {
  const r = JSON.parse(line);

  // Round-6: financial-engine fixtures are printed as a distinct JSON shape
  // (`financialLabel`, not `label`) by the runner — handle them separately
  // so a $0-net-cost "never pays back" regression (the actual P4 round-6
  // defect) is caught even though it has nothing to do with annualKwh.
  if (r.financialLabel !== undefined) {
    financialLines += 1;
    const netCostDiff = Math.abs(r.netCost - r.expectedNetCost);
    const paybackDiff = Math.abs(r.paybackYears - r.expectedPaybackYears);
    const withinNetCost = netCostDiff <= 0.01;
    const withinPayback = paybackDiff <= r.tolerancePaybackYears;

    // Round-7: year1Savings/roiPercent/npv — optional per-fixture, added
    // after the critic proved the round-6 trio was structurally blind to
    // `DEFAULT_TARIFF_ESCALATION_PERCENT`/`DEFAULT_DISCOUNT_RATE_PERCENT`
    // regressions (flipping escalation 4 -> -80 left all three passing,
    // since two force netCost<=0 and the third forces zero savings). Only
    // checked when the fixture supplies an expected value.
    const hasYear1Savings = r.expectedYear1Savings !== undefined;
    const year1SavingsDiff = hasYear1Savings
      ? Math.abs(r.year1Savings - r.expectedYear1Savings)
      : 0;
    const withinYear1Savings = !hasYear1Savings || year1SavingsDiff <= r.toleranceYear1Savings;

    const hasRoi = r.expectedRoiPercent !== undefined;
    const roiDiff = hasRoi ? Math.abs(r.roiPercent - r.expectedRoiPercent) : 0;
    const withinRoi = !hasRoi || roiDiff <= r.toleranceRoiPercent;

    const hasNpv = r.expectedNpv !== undefined;
    const npvDiff = hasNpv ? Math.abs(r.npv - r.expectedNpv) : 0;
    const withinNpv = !hasNpv || npvDiff <= r.toleranceNpv;

    const ok =
      withinNetCost &&
      withinPayback &&
      withinYear1Savings &&
      withinRoi &&
      withinNpv;
    if (!ok) failures += 1;
    console.log(
      r.financialLabel.padEnd(38),
      r.paybackYears.toFixed(2).padStart(8),
      r.expectedPaybackYears.toFixed(2).padStart(10),
      `±${r.tolerancePaybackYears}`.padStart(6),
      '-'.padStart(6),
      (ok ? 'PASS' : 'FAIL').padStart(8),
    );
    if (!withinNetCost) {
      console.error(
        `  ✗ netCost ${r.netCost.toFixed(2)} != expected ${r.expectedNetCost.toFixed(2)}`,
      );
    }
    if (!withinPayback) {
      console.error(
        `  ✗ paybackYears drifted ${paybackDiff.toFixed(2)} yr from reference (tolerance ±${r.tolerancePaybackYears} yr)`,
      );
    }
    if (hasYear1Savings && !withinYear1Savings) {
      console.error(
        `  ✗ year1Savings ${r.year1Savings.toFixed(2)} != expected ${r.expectedYear1Savings.toFixed(2)} (tolerance ±${r.toleranceYear1Savings})`,
      );
    }
    if (hasRoi && !withinRoi) {
      console.error(
        `  ✗ roiPercent ${r.roiPercent.toFixed(2)} != expected ${r.expectedRoiPercent.toFixed(2)} (tolerance ±${r.toleranceRoiPercent})`,
      );
    }
    if (hasNpv && !withinNpv) {
      console.error(
        `  ✗ npv ${r.npv.toFixed(2)} != expected ${r.expectedNpv.toFixed(2)} (tolerance ±${r.toleranceNpv})`,
      );
    }
    continue;
  }

  productionLines += 1;
  const diff = Math.abs(r.annualKwh - r.expectedAnnualKwh);
  const withinTolerance = diff <= r.toleranceKwh;
  const withinPerfBudget = r.ms <= PERF_BUDGET_MS;

  // Round-6: performanceRatio/lifetimeKwh — added after the critic proved
  // annualKwh-only assertion was blind to a sign-flipped degradation
  // constant (0.5% -> -5%/yr still passed 11/11 on annualKwh alone).
  const prDiff = Math.abs(r.performanceRatio - r.expectedPerformanceRatio);
  const withinPr = prDiff <= r.tolerancePerformanceRatio;
  const lkDiff = Math.abs(r.lifetimeKwh - r.expectedLifetimeKwh);
  const withinLifetimeKwh = lkDiff <= r.toleranceLifetimeKwh;

  const ok = withinTolerance && withinPerfBudget && withinPr && withinLifetimeKwh;
  if (!ok) failures += 1;

  console.log(
    r.label.padEnd(38),
    r.annualKwh.toFixed(0).padStart(8),
    r.expectedAnnualKwh.toFixed(0).padStart(10),
    `±${r.toleranceKwh}`.padStart(6),
    r.ms.toFixed(1).padStart(6),
    (ok ? 'PASS' : 'FAIL').padStart(8),
  );
  if (!withinTolerance) {
    console.error(
      `  ✗ annualKwh drifted ${diff.toFixed(0)} kWh from reference (tolerance ±${r.toleranceKwh} kWh)`,
    );
  }
  if (!withinPerfBudget) {
    console.error(
      `  ✗ took ${r.ms.toFixed(1)}ms, over the ${PERF_BUDGET_MS}ms debounced-drag budget`,
    );
  }
  if (!withinPr) {
    console.error(
      `  ✗ performanceRatio ${r.performanceRatio.toFixed(4)} drifted ${prDiff.toFixed(4)} from reference ${r.expectedPerformanceRatio.toFixed(4)} (tolerance ±${r.tolerancePerformanceRatio})`,
    );
  }
  if (!withinLifetimeKwh) {
    console.error(
      `  ✗ lifetimeKwh drifted ${lkDiff.toFixed(0)} kWh from reference (tolerance ±${r.toleranceLifetimeKwh} kWh)`,
    );
  }
}

if (failures > 0) {
  console.error(
    `\n✗ ${failures}/${lines.length} solar-simulation reference case(s) failed. If this is an intentional model change, update solar-simulation-reference-cases.ts deliberately — do not bump the tolerance to make a real regression pass.`,
  );
  process.exit(1);
}

console.log(
  `\n✓ all ${productionLines} production + ${financialLines} financial solar-simulation reference cases within tolerance and perf budget`,
);
