import ClipperLib from 'clipper-lib';
import type { LocalPoint } from './types/roof-design-doc.type';

/**
 * Pure geometry predicates for the Solar Design Studio, shared by this
 * module's validation and (per the spec) reusable by P3 (web canvas) /
 * P4 (simulation) so every piece agrees on the same rules. No I/O, no
 * framework imports — keep it that way.
 *
 * All coordinates are local metres (see §1 of the spec): x = east, y = north
 * from the design's anchor.
 */

const EPSILON = 1e-9;

/** A polygon is "closed" conceptually — first/last point need not repeat. */
export function isValidPolygon(points: LocalPoint[]): boolean {
  if (!Array.isArray(points) || points.length < 3) return false;
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    return false;
  }
  if (polygonArea(points) < EPSILON) return false;
  return !hasSelfIntersection(points);
}

/** Shoelace formula, absolute area in m². */
export function polygonArea(points: LocalPoint[]): number {
  let sum = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export type SelfIntersection = {
  /** Vertex indices of the two crossing edges (edge i is [i, i+1]). */
  edgeAIndex: number;
  edgeBIndex: number;
  edgeA: [LocalPoint, LocalPoint];
  edgeB: [LocalPoint, LocalPoint];
};

/** Returns the first pair of non-adjacent edges of the closed polygon that cross, or null. */
export function findSelfIntersection(
  points: LocalPoint[],
): SelfIntersection | null {
  // Zero-length edges (a consecutive duplicate vertex, however it arose)
  // must never change adjacency: without this, a single phantom edge shifts
  // every later edge's "index distance" from its true neighbours by one,
  // and two edges that are genuinely adjacent (sharing a real vertex, just
  // with a zero-length edge sitting between them) get treated as crossing.
  // Rather than rely on every producer of a polygon to never generate a
  // duplicate point, treat it as a first-class possibility here.
  const n = points.length;
  if (n < 4) return null; // a triangle can never self-intersect
  const isZeroLength = (a: LocalPoint, b: LocalPoint): boolean =>
    Math.hypot(a.x - b.x, a.y - b.y) <= EPSILON;

  // Build, for each edge index, the nearest non-zero-length edge index
  // before and after it, so "adjacent" means "adjacent after collapsing
  // zero-length edges", not merely "index differs by one".
  const nextNonZero = (start: number): number => {
    let k = (start + 1) % n;
    let guard = 0;
    while (isZeroLength(points[k], points[(k + 1) % n]) && guard < n) {
      k = (k + 1) % n;
      guard++;
    }
    return k;
  };
  const prevNonZero = (start: number): number => {
    let k = (start - 1 + n) % n;
    let guard = 0;
    while (isZeroLength(points[k], points[(k + 1) % n]) && guard < n) {
      k = (k - 1 + n) % n;
      guard++;
    }
    return k;
  };

  for (let i = 0; i < n; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    if (isZeroLength(a1, a2)) continue; // no direction, cannot "cross" anything
    for (let j = i + 1; j < n; j++) {
      const b1 = points[j];
      const b2 = points[(j + 1) % n];
      if (isZeroLength(b1, b2)) continue;
      const isAdjacent =
        j === i ||
        (j + 1) % n === i ||
        (i + 1) % n === j ||
        nextNonZero(i) === j ||
        prevNonZero(i) === j;
      if (isAdjacent) continue;
      if (segmentsIntersect(a1, a2, b1, b2)) {
        return {
          edgeAIndex: i,
          edgeBIndex: j,
          edgeA: [a1, a2],
          edgeB: [b1, b2],
        };
      }
    }
  }
  return null;
}

/** True if any two non-adjacent edges of the closed polygon cross. */
export function hasSelfIntersection(points: LocalPoint[]): boolean {
  return findSelfIntersection(points) !== null;
}

function orientation(a: LocalPoint, b: LocalPoint, c: LocalPoint): number {
  const val = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(val) < EPSILON) return 0;
  return val > 0 ? 1 : 2;
}

function onSegment(a: LocalPoint, b: LocalPoint, p: LocalPoint): boolean {
  return (
    Math.min(a.x, b.x) - EPSILON <= p.x &&
    p.x <= Math.max(a.x, b.x) + EPSILON &&
    Math.min(a.y, b.y) - EPSILON <= p.y &&
    p.y <= Math.max(a.y, b.y) + EPSILON
  );
}

export function segmentsIntersect(
  p1: LocalPoint,
  p2: LocalPoint,
  p3: LocalPoint,
  p4: LocalPoint,
): boolean {
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);

  if (o1 !== o2 && o3 !== o4) return true;

  if (o1 === 0 && onSegment(p1, p2, p3)) return true;
  if (o2 === 0 && onSegment(p1, p2, p4)) return true;
  if (o3 === 0 && onSegment(p3, p4, p1)) return true;
  if (o4 === 0 && onSegment(p3, p4, p2)) return true;

  return false;
}

/** Ray-casting point-in-polygon (includes points exactly on an edge). */
export function pointInPolygon(
  point: LocalPoint,
  polygon: LocalPoint[],
): boolean {
  if (isPointOnPolygonBoundary(point, polygon)) return true;
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function isPointOnPolygonBoundary(
  point: LocalPoint,
  polygon: LocalPoint[],
): boolean {
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    if (onSegment(a, b, point) && orientation(a, b, point) === 0) return true;
  }
  return false;
}

/**
 * Thrown by `insetPolygon` when the requested setback cannot be honoured
 * (the offset degenerates, self-intersects, grows instead of shrinking, or
 * escapes the original polygon). Callers must treat this as a hard
 * validation failure — never silently substitute the un-inset polygon,
 * which would re-open the exact "panel overhangs the roof edge" hole this
 * function exists to close.
 */
export class InsetPolygonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsetPolygonError';
  }
}

/**
 * Fixed-point scale used to hand coordinates (local metres, fractional) to
 * `clipper-lib`, which requires integer coordinates for robust, exact
 * arithmetic. 1e6 gives micron resolution — comfortably below anything a
 * roof plane's vertices or a setback value would ever need, tight enough
 * that the residual quantisation error (bounded by `SETBACK_TOLERANCE_M`
 * below) never gets anywhere near a real defect, while keeping every
 * plausible roof coordinate (well over 1,000 km) inside the float64-safe
 * integer range.
 */
const CLIPPER_SCALE = 1_000_000;

/**
 * Tolerance for the runtime safety net (`assertSetbackHonoured`), in
 * metres — deliberately looser than the module's general `EPSILON`
 * (1e-9, used for exact-geometry predicates like self-intersection) because
 * `clipper-lib` rounds every coordinate to the nearest `1 / CLIPPER_SCALE`
 * metre on the way in and out; that quantisation alone can move a vertex by
 * up to ~0.5/CLIPPER_SCALE m, i.e. ~7e-7 m worst case per coordinate pair.
 * 1e-5 m (10 microns) is over an order of magnitude looser than that
 * rounding floor, so it only ever fires for a genuine construction defect
 * (the bugs this net was built to catch were off by whole metres), never
 * for legitimate fixed-point rounding.
 */
const SETBACK_TOLERANCE_M = 1e-5;

/**
 * Inward inset (negative offset) of a polygon by `distance` metres, via
 * `clipper-lib`'s polygon offsetting (a Vatti-derivative implementation of
 * the same approach production offsetting libraries use).
 *
 * This replaces two earlier hand-rolled approaches, in order:
 *
 * 1. Per-edge-offset + adjacent-pair-intersection: no defence against
 *    *non-adjacent* offset edges crossing past each other, which could
 *    silently produce a plausible-looking polygon sitting *inside* the
 *    excluded margin — worse than refusing.
 * 2. Convex decomposition (split at reflex vertices into convex pieces, erode
 *    each against only its own real edges, substituting a locally-computed
 *    miter point for vertices whose real neighbouring edges both fell on
 *    other pieces): this correctly avoided the "naive global half-plane
 *    clip collapses any concave shape's kernel to empty" trap, but a reflex
 *    vertex's miter point is only guaranteed to honour *its own two*
 *    adjacent edges' setback — nothing in that construction checks it
 *    against a *third*, non-adjacent original edge that happens to pass
 *    nearby (found on a "staple" shape: a reflex corner's correctly-mitered
 *    point for its own two edges sat only 1.4 m from an unrelated third wall
 *    at a 1.6 m setback). Patching that piecewise (slab-bounded clipping
 *    against every other edge, only where "close enough") is exactly the
 *    kind of bespoke case-by-case geometry that produced the first two
 *    bugs, so rather than add a fourth hand-rolled special case this now
 *    uses a maintained, widely-used offsetting implementation instead.
 *
 * Multiple output regions are expected and supported (a "U" shape's arms can
 * legitimately separate from its base at some setbacks). Every surviving
 * point is verified — independent of `clipper-lib`'s own guarantees, per
 * `assertSetbackHonoured` below — to be genuinely at least `distance` from
 * the nearest *original* edge (finite segment, not infinite line) and
 * contained in the original polygon; this is a runtime safety net that
 * fails loudly rather than ever hand back a plausible-but-wrong buildable
 * area, regardless of which construction produced it.
 *
 * Throws `InsetPolygonError` when every region collapses (no buildable area
 * survives at all) — callers must reject the design ("no room for panels at
 * this setback") rather than fall back to the original, un-inset polygon.
 */
export function insetPolygon(
  points: LocalPoint[],
  distance: number,
): LocalPoint[][] {
  if (distance <= 0) return [points];

  const subject = points.map((p) => ({
    X: Math.round(p.x * CLIPPER_SCALE),
    Y: Math.round(p.y * CLIPPER_SCALE),
  }));

  const offset = new ClipperLib.ClipperOffset();
  offset.AddPaths(
    [subject],
    ClipperLib.JoinType.jtMiter,
    ClipperLib.EndType.etClosedPolygon,
  );
  const solution: ClipperLib.Paths = [];
  offset.Execute(solution, -distance * CLIPPER_SCALE);

  const regions: LocalPoint[][] = solution.map((path) =>
    path.map((pt) => ({ x: pt.X / CLIPPER_SCALE, y: pt.Y / CLIPPER_SCALE })),
  );
  const survivors = regions.filter((r) => r.length >= 3 && isValidPolygon(r));

  if (survivors.length === 0) {
    throw new InsetPolygonError(
      'The setback leaves no valid buildable area for this roof plane.',
    );
  }

  // Runtime safety net, independent of how the regions were constructed:
  // every vertex and edge midpoint of every surviving region must sit at
  // least `distance` from the *original* boundary (measured against the
  // real edges as finite segments, not their infinite extensions) and must
  // not fall outside the original polygon. If construction ever produces a
  // region that fails this — a bug, an unanticipated shape, floating point
  // edge case — fail loudly rather than hand back a plausible-looking but
  // wrong buildable area (that is precisely the class of defect this
  // function exists to rule out).
  for (const region of survivors) {
    assertSetbackHonoured(region, points, distance);
  }
  return survivors;
}

/** Shortest distance from `p` to the finite segment `a`-`b`. */
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

function distanceToPolygonBoundary(
  p: LocalPoint,
  polygon: LocalPoint[],
): number {
  const n = polygon.length;
  let min = Infinity;
  for (let i = 0; i < n; i++) {
    min = Math.min(min, distanceToSegment(p, polygon[i], polygon[(i + 1) % n]));
  }
  return min;
}

function assertSetbackHonoured(
  region: LocalPoint[],
  original: LocalPoint[],
  distance: number,
): void {
  const n = region.length;
  for (let i = 0; i < n; i++) {
    const v = region[i];
    const mid = {
      x: (v.x + region[(i + 1) % n].x) / 2,
      y: (v.y + region[(i + 1) % n].y) / 2,
    };
    for (const p of [v, mid]) {
      if (!pointInPolygon(p, original)) {
        const d = distanceToPolygonBoundary(p, original);
        if (d > SETBACK_TOLERANCE_M) {
          throw new InsetPolygonError(
            'The computed setback boundary escapes the original roof plane — refusing to use it as the buildable area.',
          );
        }
      }
      if (
        distanceToPolygonBoundary(p, original) <
        distance - SETBACK_TOLERANCE_M
      ) {
        throw new InsetPolygonError(
          'The computed setback boundary comes closer to the roof edge than the requested setback — refusing to use it as the buildable area.',
        );
      }
    }
  }
}

/** Axis-aligned-in-local-frame rectangle for a panel centred at (cx, cy). */
export function panelRectangle(
  cx: number,
  cy: number,
  widthM: number,
  heightM: number,
  rotationDegrees: number,
): LocalPoint[] {
  const hw = widthM / 2;
  const hh = heightM / 2;
  const rad = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners: LocalPoint[] = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
  return corners.map((c) => ({
    x: cx + c.x * cos - c.y * sin,
    y: cy + c.x * sin + c.y * cos,
  }));
}

/** True if every corner of `inner` lies inside (or on the boundary of) `outer`. */
export function polygonFullyInside(
  inner: LocalPoint[],
  outer: LocalPoint[],
): boolean {
  return inner.every((p) => pointInPolygon(p, outer));
}

/**
 * True when `inner` is fully contained within a *single* one of `outers`.
 * Used for the (possibly multi-region) result of `insetPolygon` on concave
 * roof planes: a panel that straddles the artificial split line between two
 * decomposed regions is rejected even though the true, non-convex erosion
 * might have accepted it — the conservative direction, consistent with the
 * rest of this module's error-toward-excluding-too-much behaviour.
 */
export function polygonFullyInsideAny(
  inner: LocalPoint[],
  outers: LocalPoint[][],
): boolean {
  return outers.some((outer) => polygonFullyInside(inner, outer));
}

/**
 * Separating Axis Theorem for two convex polygons — sufficient for panel
 * rectangles and simple obstruction/array polygons. Returns true if the
 * shapes overlap (touching edges do not count as overlap).
 */
export function polygonsOverlap(a: LocalPoint[], b: LocalPoint[]): boolean {
  return !hasSeparatingAxis(a, b) && !hasSeparatingAxis(b, a);
}

function hasSeparatingAxis(a: LocalPoint[], b: LocalPoint[]): boolean {
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const p1 = a[i];
    const p2 = a[(i + 1) % n];
    const axis = { x: -(p2.y - p1.y), y: p2.x - p1.x };
    const len = Math.hypot(axis.x, axis.y) || 1;
    const nx = axis.x / len;
    const ny = axis.y / len;

    const projA = a.map((p) => p.x * nx + p.y * ny);
    const projB = b.map((p) => p.x * nx + p.y * ny);
    const minA = Math.min(...projA);
    const maxA = Math.max(...projA);
    const minB = Math.min(...projB);
    const maxB = Math.max(...projB);

    if (maxA <= minB + EPSILON || maxB <= minA + EPSILON) {
      return true; // gap found on this axis — shapes cannot overlap
    }
  }
  return false;
}
