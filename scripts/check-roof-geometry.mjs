#!/usr/bin/env node
/**
 * Guardrail for `insetPolygon` (`src/solar-design/roof-geometry.util.ts`)
 * against the shared, cross-implementation fixture file at the parent repo
 * root: `docs/specs/roof-geometry-fixtures.json`. The web client
 * (`apps/web/src/lib/solarDesign/design.ts`) runs its own guardrail against
 * the same file — this is the fix for three rounds of this feature being
 * lost to the two sides silently disagreeing (same shape, different
 * buildable area, only noticed when a design that looked fine on the canvas
 * got rejected on save).
 *
 * This only asserts what THIS side can assert on its own: containment,
 * clearance >= setbackM (within the file's tolerance), never-larger-than-
 * source, empty-or-not, and (only for `exact: true` cases) the hand-derived
 * area. Cross-implementation area/region-count agreement (requirement 5 in
 * the fixture file's $comment) has to be reconciled by a human/agent
 * comparing this script's output against the web side's — it is not
 * something one side can check unilaterally.
 *
 * Not a Jest spec (AGENTS.md forbids new ones) — same pattern as
 * check-solar-simulation-reference.mjs. Run:
 *   node scripts/check-roof-geometry.mjs
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(SCRIPTS_DIR, '..');
const REPO_ROOT = join(API_ROOT, '..', '..');
const FIXTURES_PATH = join(
  REPO_ROOT,
  'docs',
  'specs',
  'roof-geometry-fixtures.json',
);
const RUNNER = join(SCRIPTS_DIR, 'roof-geometry-reference-runner.ts');

let fixtures;
try {
  fixtures = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8'));
} catch (err) {
  console.error(`✗ could not read/parse ${FIXTURES_PATH}:`);
  console.error(err.message);
  process.exit(1);
}

let stdout;
try {
  stdout = execFileSync(
    'node',
    [
      join(API_ROOT, 'node_modules', 'ts-node', 'dist', 'bin.js'),
      '--transpile-only',
      RUNNER,
    ],
    {
      cwd: API_ROOT,
      encoding: 'utf8',
      input: JSON.stringify(fixtures.cases),
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
  console.error('✗ roof-geometry reference runner failed to execute:');
  console.error(err.stdout || err.message);
  process.exit(1);
}

const results = JSON.parse(stdout);
const clearanceTol = fixtures.clearanceToleranceM ?? 1e-6;

let failures = 0;
console.log(
  'Case'.padEnd(42),
  'Empty'.padStart(6),
  'Regions'.padStart(8),
  'Area'.padStart(10),
  'Result'.padStart(8),
);
for (const r of results) {
  const problems = [];

  if (r.error) {
    problems.push(`threw unexpectedly: ${r.error}`);
  } else {
    if (r.expectedEmpty !== r.actualEmpty) {
      problems.push(
        `expectedEmpty=${r.expectedEmpty} but got actualEmpty=${r.actualEmpty}`,
      );
    }
    if (
      !r.actualEmpty &&
      typeof r.expectedRegionCount === 'number' &&
      r.expectedRegionCount !== r.regionCount
    ) {
      problems.push(
        `expectedRegionCount=${r.expectedRegionCount}, got ${r.regionCount}`,
      );
    }
    if (!r.containment) {
      problems.push('a region escaped the source polygon');
    }
    if (r.minClearanceM !== null && r.minClearanceM < r.setbackM - clearanceTol) {
      problems.push(
        `min clearance ${r.minClearanceM.toFixed(6)}m < setback ${r.setbackM}m (tol ${clearanceTol})`,
      );
    }
    if (r.totalAreaM2 > r.sourceAreaM2 + clearanceTol) {
      problems.push(
        `total area ${r.totalAreaM2.toFixed(4)} exceeds source area ${r.sourceAreaM2.toFixed(4)}`,
      );
    }
    if (r.exact && typeof r.expectedAreaM2 === 'number') {
      const diff = Math.abs(r.totalAreaM2 - r.expectedAreaM2);
      if (diff > 1e-3) {
        problems.push(
          `exact area ${r.totalAreaM2.toFixed(4)} != expected ${r.expectedAreaM2} (diff ${diff.toFixed(4)})`,
        );
      }
    }
  }

  const ok = problems.length === 0;
  if (!ok) failures += 1;
  console.log(
    r.id.padEnd(42),
    String(r.actualEmpty ?? '-').padStart(6),
    String(r.regionCount ?? '-').padStart(8),
    (typeof r.totalAreaM2 === 'number' ? r.totalAreaM2.toFixed(4) : '-').padStart(10),
    (ok ? 'PASS' : 'FAIL').padStart(8),
  );
  for (const p of problems) console.error(`  ✗ ${p}`);
}

if (failures > 0) {
  console.error(
    `\n✗ ${failures}/${results.length} roof-geometry fixture case(s) failed against docs/specs/roof-geometry-fixtures.json.`,
  );
  console.error(
    '  Reminder: requirement 5 (api/web agreement on totalAreaM2 and regionCount) is not checked by this script alone — compare this output against the web side\'s run for the same file.',
  );
  process.exit(1);
}

console.log(
  `\n✓ all ${results.length} roof-geometry fixture cases pass this side's checks (containment, clearance, never-larger, empty-or-not, exact areas). Compare against the web side's run for cross-implementation agreement.`,
);
