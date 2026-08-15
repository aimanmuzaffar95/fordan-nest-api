import { Injectable } from '@nestjs/common';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { ARRAY_PALETTE } from './array-palette';
import {
  InsetPolygonError,
  insetPolygon,
  panelRectangle,
  polygonFullyInsideAny,
  polygonsOverlap,
} from './roof-geometry.util';
import { SolarTileProxyService } from './solar-tile-proxy.service';
import type {
  LocalPoint,
  Obstruction,
  RoofArray,
  RoofDesignDoc,
} from './types/roof-design-doc.type';

const TILE_SIZE = 256;

/**
 * Web-Mercator metres-per-pixel at a given latitude/zoom (tile size 256).
 * Identical formula to `metresPerPixel` in `apps/web/src/lib/solarDesign/geo.ts`
 * and to spec §1 — see the "projection parity" note on {@link projectLocalMetresToPixel}.
 */
export function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * Projects a point in the design's local-metre frame (§1: x = east, y =
 * north of the anchor) to a pixel offset in this composite image.
 *
 * **Projection parity with the client is load-bearing** — a browser-captured
 * render and this server composite must agree pixel-for-pixel or the same
 * design would draw differently depending on which capture path fired.
 * This mirrors `RoofCanvas.tsx`'s `toPx`:
 *   `toPx = (p) => ({ x: center.x + p.x / mpp, y: center.y - p.y / mpp })`
 * with `center = (width/2, height/2)` and `mpp = metresPerPixel(anchorLat, zoom)`
 * — exactly `geo.ts`'s `metresToPixels` plus the canvas's own centring
 * convention (the design's anchor is drawn at the canvas centre, same as
 * Leaflet centres the locked map view on the anchor in `RoofImagery.tsx`).
 * `composite()` below independently derives the same centring by stitching
 * tiles around the anchor's own Web Mercator world pixel, so the tile
 * imagery and the overlay share one coordinate frame without ever crossing
 * through a second, independently-implemented projection.
 */
function projectLocalMetresToPixel(
  point: LocalPoint,
  anchorLat: number,
  zoom: number,
  widthPx: number,
  heightPx: number,
): { x: number; y: number } {
  const mpp = metresPerPixel(anchorLat, zoom);
  return {
    x: widthPx / 2 + point.x / mpp,
    y: heightPx / 2 - point.y / mpp,
  };
}

/** Web Mercator pixel coordinate of a lat/lng at a given zoom (world pixel space, tileSize=256). */
function latLngToWorldPixel(
  lat: number,
  lng: number,
  zoom: number,
): { x: number; y: number } {
  const worldSize = TILE_SIZE * 2 ** zoom;
  const x = ((lng + 180) / 360) * worldSize;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y =
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize;
  return { x, y };
}

function decodeImage(
  buffer: Buffer,
  contentType: string,
): { data: Uint8Array | Buffer; width: number; height: number } {
  if (contentType.includes('png')) {
    const png = PNG.sync.read(buffer);
    return { data: png.data, width: png.width, height: png.height };
  }
  const decoded = jpeg.decode(buffer, { useTArray: true });
  return { data: decoded.data, width: decoded.width, height: decoded.height };
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [17, 24, 39]; // INK fallback — never crash a proposal send on a bad hex
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** Alpha-blends `rgb` onto the pixel at (x, y) of an RGBA buffer, in place. Out-of-bounds is a no-op. */
function blendPixel(
  buf: Buffer,
  widthPx: number,
  heightPx: number,
  x: number,
  y: number,
  rgb: [number, number, number],
  alpha: number,
): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= widthPx || yi < 0 || yi >= heightPx) return;
  const idx = (yi * widthPx + xi) * 4;
  const a = Math.max(0, Math.min(1, alpha));
  buf[idx] = Math.round(buf[idx] * (1 - a) + rgb[0] * a);
  buf[idx + 1] = Math.round(buf[idx + 1] * (1 - a) + rgb[1] * a);
  buf[idx + 2] = Math.round(buf[idx + 2] * (1 - a) + rgb[2] * a);
  buf[idx + 3] = 255;
}

/**
 * Scanline fill of a (possibly concave, non-self-intersecting) polygon —
 * standard even-odd edge-crossing algorithm, one row at a time. Bounded by
 * the polygon's own bounding box clipped to the canvas, so cost is
 * proportional to the shape's on-screen area, not the full canvas.
 */
function fillPolygon(
  buf: Buffer,
  widthPx: number,
  heightPx: number,
  points: { x: number; y: number }[],
  rgb: [number, number, number],
  alpha: number,
): void {
  if (points.length < 3) return;
  const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y))));
  const maxY = Math.min(
    heightPx - 1,
    Math.ceil(Math.max(...points.map((p) => p.y))),
  );
  const n = points.length;
  for (let y = minY; y <= maxY; y += 1) {
    const scanY = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % n];
      if (a.y === b.y) continue;
      const crosses =
        (a.y <= scanY && b.y > scanY) || (b.y <= scanY && a.y > scanY);
      if (!crosses) continue;
      const t = (scanY - a.y) / (b.y - a.y);
      xs.push(a.x + t * (b.x - a.x));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xStart = Math.max(0, Math.round(xs[i]));
      const xEnd = Math.min(widthPx - 1, Math.round(xs[i + 1]));
      for (let x = xStart; x <= xEnd; x += 1) {
        blendPixel(buf, widthPx, heightPx, x, y, rgb, alpha);
      }
    }
  }
}

/** Draws a `strokeWidthPx`-thick opaque-ish line between two points (used for polygon/panel outlines). */
function strokeLine(
  buf: Buffer,
  widthPx: number,
  heightPx: number,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  rgb: [number, number, number],
  alpha: number,
  strokeWidthPx: number,
): void {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    blendPixel(buf, widthPx, heightPx, p1.x, p1.y, rgb, alpha);
    return;
  }
  const steps = Math.max(1, Math.ceil(len));
  const half = strokeWidthPx / 2;
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const cx = p1.x + dx * t;
    const cy = p1.y + dy * t;
    for (let ox = -half; ox <= half; ox += 1) {
      for (let oy = -half; oy <= half; oy += 1) {
        blendPixel(buf, widthPx, heightPx, cx + ox, cy + oy, rgb, alpha);
      }
    }
  }
}

function strokePolygon(
  buf: Buffer,
  widthPx: number,
  heightPx: number,
  points: { x: number; y: number }[],
  rgb: [number, number, number],
  alpha: number,
  strokeWidthPx: number,
): void {
  for (let i = 0; i < points.length; i += 1) {
    strokeLine(
      buf,
      widthPx,
      heightPx,
      points[i],
      points[(i + 1) % points.length],
      rgb,
      alpha,
      strokeWidthPx,
    );
  }
}

const ARRAY_FILL_ALPHA = 0.28;
const ARRAY_STROKE_ALPHA = 0.9;
const ARRAY_STROKE_WIDTH_PX = 3;
const PANEL_FILL_ALPHA = 0.55;
const PANEL_STROKE_ALPHA = 0.95;
const PANEL_STROKE_WIDTH_PX = 1;
/** Panel outline colour — near-white so panels read distinctly against every array fill colour. */
const PANEL_STROKE_RGB: [number, number, number] = [245, 245, 245];

/** Determines, per array, which enabled panels are geometrically valid — same
 *  predicates `run-simulation.ts` uses for the live-feedback numbers (§4),
 *  so a panel drawn on the render is never one the PDF's numbers already
 *  excluded, or vice versa. Invalid panels are omitted from the render
 *  entirely (see module doc), consistent with them being excluded from
 *  every production/financial figure. */
function validPanelIdsForArray(
  array: RoofArray,
  obstructions: Obstruction[],
  panelSize: { widthM: number; heightM: number },
): Set<string> {
  const enabledPanels = array.panels.filter((p) => p.enabled);
  const valid = new Set<string>();

  let buildableAreas: LocalPoint[][];
  try {
    buildableAreas = insetPolygon(array.polygon, array.setbackM);
  } catch (err) {
    if (err instanceof InsetPolygonError) return valid;
    throw err;
  }

  const rects = enabledPanels.map((placement) => ({
    placement,
    rect: panelRectangle(
      placement.cx,
      placement.cy,
      panelSize.widthM,
      panelSize.heightM,
      placement.rotationDegrees,
    ),
  }));

  const invalid = new Set<string>();
  for (const { placement, rect } of rects) {
    if (!polygonFullyInsideAny(rect, buildableAreas)) {
      invalid.add(placement.id);
      continue;
    }
    for (const obstruction of obstructions) {
      if (polygonsOverlap(rect, obstruction.polygon)) {
        invalid.add(placement.id);
        break;
      }
    }
  }
  for (let i = 0; i < rects.length; i += 1) {
    if (invalid.has(rects[i].placement.id)) continue;
    for (let j = i + 1; j < rects.length; j += 1) {
      if (invalid.has(rects[j].placement.id)) continue;
      if (polygonsOverlap(rects[i].rect, rects[j].rect)) {
        invalid.add(rects[i].placement.id);
        invalid.add(rects[j].placement.id);
      }
    }
  }

  for (const p of enabledPanels) {
    if (!invalid.has(p.id)) valid.add(p.id);
  }
  return valid;
}

/**
 * §6 fallback render path: composites a same-origin PNG of the framed roof
 * by fetching the covering Web Mercator tile grid through
 * `SolarTileProxyService` and stitching it into a single raster, cropped to
 * the requested pixel window centred on `anchor`, then draws the design
 * itself over the tiles — each array's polygon outline (filled at low
 * opacity, per-array colour) and every geometrically-valid enabled panel
 * (true size + rotation). Used when the browser reports
 * `not-ready`/`cors-blocked` for its own canvas capture, so it must never
 * hand back a bare aerial photo above the proposal's per-array table — that
 * is strictly worse than the "render will be added" placeholder it replaces.
 */
@Injectable()
export class RoofDesignRenderCompositeService {
  constructor(private readonly tiles: SolarTileProxyService) {}

  async composite(
    doc: Pick<RoofDesignDoc, 'anchor' | 'arrays' | 'obstructions'>,
    zoom: number,
    widthPx: number,
    heightPx: number,
    panelSizeByModelId: Map<string, { widthM: number; heightM: number }>,
  ): Promise<Buffer> {
    const { anchor } = doc;
    const z = Math.round(zoom);
    const center = latLngToWorldPixel(anchor.lat, anchor.lng, z);
    const originX = center.x - widthPx / 2;
    const originY = center.y - heightPx / 2;

    const firstTileX = Math.floor(originX / TILE_SIZE);
    const firstTileY = Math.floor(originY / TILE_SIZE);
    const lastTileX = Math.floor((originX + widthPx - 1) / TILE_SIZE);
    const lastTileY = Math.floor((originY + heightPx - 1) / TILE_SIZE);
    const maxTileIndex = 2 ** z - 1;

    const out = Buffer.alloc(widthPx * heightPx * 4);

    for (let ty = firstTileY; ty <= lastTileY; ty += 1) {
      if (ty < 0 || ty > maxTileIndex) continue;
      for (let tx = firstTileX; tx <= lastTileX; tx += 1) {
        const wrappedX =
          ((tx % (maxTileIndex + 1)) + (maxTileIndex + 1)) % (maxTileIndex + 1);
        const tile = await this.tiles.fetchTile(z, wrappedX, ty);
        const image = decodeImage(tile.buffer, tile.contentType);

        const tileOriginX = tx * TILE_SIZE;
        const tileOriginY = ty * TILE_SIZE;

        for (let py = 0; py < image.height; py += 1) {
          const destY = tileOriginY + py - originY;
          if (destY < 0 || destY >= heightPx) continue;
          for (let px = 0; px < image.width; px += 1) {
            const destX = tileOriginX + px - originX;
            if (destX < 0 || destX >= widthPx) continue;
            const srcIdx = (py * image.width + px) * 4;
            const destIdx =
              (Math.floor(destY) * widthPx + Math.floor(destX)) * 4;
            out[destIdx] = image.data[srcIdx];
            out[destIdx + 1] = image.data[srcIdx + 1];
            out[destIdx + 2] = image.data[srcIdx + 2];
            out[destIdx + 3] = 255;
          }
        }
      }
    }

    // Use the same rounded `z` the tile grid above was actually fetched and
    // addressed at (Web Mercator tiles only exist at integer zoom levels),
    // not the raw `zoom` argument — the stitched image's true pixel scale
    // is `z`'s, so the overlay must project at `z` too or it drifts off the
    // imagery beneath it as `zoom` gets more fractional.
    this.drawDesign(out, widthPx, heightPx, doc, z, panelSizeByModelId);

    const png = new PNG({ width: widthPx, height: heightPx });
    out.copy(png.data);
    return PNG.sync.write(png);
  }

  private drawDesign(
    buf: Buffer,
    widthPx: number,
    heightPx: number,
    doc: Pick<RoofDesignDoc, 'anchor' | 'arrays' | 'obstructions'>,
    zoom: number,
    panelSizeByModelId: Map<string, { widthM: number; heightM: number }>,
  ): void {
    const project = (p: LocalPoint) =>
      projectLocalMetresToPixel(p, doc.anchor.lat, zoom, widthPx, heightPx);

    for (let i = 0; i < doc.arrays.length; i += 1) {
      const array = doc.arrays[i];
      const colorHex = ARRAY_PALETTE[i % ARRAY_PALETTE.length];
      const rgb = hexToRgb(colorHex);
      const polygonPx = array.polygon.map(project);
      fillPolygon(buf, widthPx, heightPx, polygonPx, rgb, ARRAY_FILL_ALPHA);
      strokePolygon(
        buf,
        widthPx,
        heightPx,
        polygonPx,
        rgb,
        ARRAY_STROKE_ALPHA,
        ARRAY_STROKE_WIDTH_PX,
      );

      const panelSize = panelSizeByModelId.get(array.panelModelId) ?? {
        widthM: 1.134,
        heightM: 1.762,
      };
      const validIds = validPanelIdsForArray(
        array,
        doc.obstructions,
        panelSize,
      );

      for (const panel of array.panels) {
        if (!panel.enabled || !validIds.has(panel.id)) continue;
        const rect = panelRectangle(
          panel.cx,
          panel.cy,
          panelSize.widthM,
          panelSize.heightM,
          panel.rotationDegrees,
        );
        const rectPx = rect.map(project);
        fillPolygon(buf, widthPx, heightPx, rectPx, rgb, PANEL_FILL_ALPHA);
        strokePolygon(
          buf,
          widthPx,
          heightPx,
          rectPx,
          PANEL_STROKE_RGB,
          PANEL_STROKE_ALPHA,
          PANEL_STROKE_WIDTH_PX,
        );
      }
    }
  }
}
