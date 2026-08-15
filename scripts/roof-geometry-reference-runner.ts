/**
 * Companion runner for `check-roof-geometry.mjs` — invoked via `ts-node
 * --transpile-only` so the guardrail can exercise the real `insetPolygon`
 * implementation without a full Nest build. Reads the fixture cases array
 * (from `docs/specs/roof-geometry-fixtures.json`) as JSON on stdin, prints a
 * JSON array of per-case results to stdout.
 */
import { readFileSync } from 'node:fs';
import {
  insetPolygon,
  InsetPolygonError,
  polygonArea,
  pointInPolygon,
} from '../src/solar-design/roof-geometry.util';
import type { LocalPoint } from '../src/solar-design/types/roof-design-doc.type';

type FixtureCase = {
  id: string;
  polygon: [number, number][];
  setbackM: number;
  expectedEmpty: boolean;
  expectedRegionCount?: number | null;
  expectedAreaM2?: number | null;
  exact?: boolean;
};

function readStdin(): string {
  return readFileSync(0, 'utf8');
}

function distanceToSegment(
  p: LocalPoint,
  a: LocalPoint,
  b: LocalPoint,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: a.x + dx * t, y: a.y + dy * t };
  return Math.hypot(p.x - proj.x, p.y - proj.y);
}

function distanceToBoundary(p: LocalPoint, polygon: LocalPoint[]): number {
  let min = Infinity;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    min = Math.min(min, distanceToSegment(p, polygon[i], polygon[(i + 1) % n]));
  }
  return min;
}

const cases = JSON.parse(readStdin()) as FixtureCase[];

const results = cases.map((c) => {
  const source: LocalPoint[] = c.polygon.map(([x, y]) => ({ x, y }));
  const sourceAreaM2 = polygonArea(source);

  try {
    const regions =
      c.setbackM > 0 ? insetPolygon(source, c.setbackM) : [source];
    const totalAreaM2 = regions.reduce((s, r) => s + polygonArea(r), 0);

    let containment = true;
    let minClearanceM = Infinity;
    for (const region of regions) {
      const n = region.length;
      for (let i = 0; i < n; i++) {
        const v = region[i];
        const mid = {
          x: (v.x + region[(i + 1) % n].x) / 2,
          y: (v.y + region[(i + 1) % n].y) / 2,
        };
        for (const p of [v, mid]) {
          if (
            !pointInPolygon(p, source) &&
            distanceToBoundary(p, source) > 1e-6
          ) {
            containment = false;
          }
          minClearanceM = Math.min(
            minClearanceM,
            distanceToBoundary(p, source),
          );
        }
      }
    }

    return {
      id: c.id,
      setbackM: c.setbackM,
      expectedEmpty: c.expectedEmpty,
      expectedRegionCount: c.expectedRegionCount ?? null,
      expectedAreaM2: c.expectedAreaM2 ?? null,
      exact: c.exact ?? false,
      actualEmpty: false,
      regionCount: regions.length,
      totalAreaM2,
      sourceAreaM2,
      containment,
      minClearanceM: Number.isFinite(minClearanceM) ? minClearanceM : null,
      error: null,
    };
  } catch (err) {
    if (err instanceof InsetPolygonError) {
      return {
        id: c.id,
        setbackM: c.setbackM,
        expectedEmpty: c.expectedEmpty,
        expectedRegionCount: c.expectedRegionCount ?? null,
        expectedAreaM2: c.expectedAreaM2 ?? null,
        exact: c.exact ?? false,
        actualEmpty: true,
        regionCount: 0,
        totalAreaM2: 0,
        sourceAreaM2,
        containment: true,
        minClearanceM: null,
        error: null,
      };
    }
    return {
      id: c.id,
      setbackM: c.setbackM,
      expectedEmpty: c.expectedEmpty,
      expectedRegionCount: c.expectedRegionCount ?? null,
      expectedAreaM2: c.expectedAreaM2 ?? null,
      exact: c.exact ?? false,
      actualEmpty: null,
      regionCount: null,
      totalAreaM2: null,
      sourceAreaM2,
      containment: null,
      minClearanceM: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
});

console.log(JSON.stringify(results));
