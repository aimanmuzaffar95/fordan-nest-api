/**
 * Small formatting helpers shared by the roof proposal PDF assembly +
 * render layers. Kept dependency-free (no pdfkit/typeorm imports) so both
 * `RoofProposalService` (data) and `RoofProposalPdfService` (layout) can use
 * them without a layering cycle.
 */

// `fontkit` ships no type declarations and there's no @types package for it,
// so `import fontkit from 'fontkit'` resolves every member to an untyped
// `any`/error type. We only need the two methods below, so declare a
// minimal local shape for them instead of leaking `any` through this file.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fontkit = require('fontkit') as {
  openSync(path: string): GlyphLookupFont;
};

interface GlyphLookupFont {
  glyphForCodePoint(codePoint: number): { id: number };
}

/**
 * PDFKit's built-in "standard 14" fonts (Helvetica etc.) — and, we've
 * confirmed empirically, *any* TTF registered under one of those reserved
 * names — render text as WinAnsi/Latin-1 only. A character outside that
 * range doesn't degrade gracefully: it corrupts every character after it in
 * the same string. Registering the same TTF under a fresh, non-reserved
 * name gives PDFKit's real Unicode/CID text path instead, which is what we
 * use everywhere (see `registerPdfFonts`/`UI_FONT` below).
 *
 * Even with a full Unicode font, some codepoints (CJK ideographs, most
 * emoji variation sequences, etc.) aren't in DejaVu Sans's glyph table.
 * Those render as a "tofu" box rather than corrupting anything — but a
 * signable customer document shouldn't ship visible tofu either, so we
 * strip codepoints the font can't draw before we ever call `doc.text()`.
 */
export const UI_FONT = 'UISans';
export const UI_FONT_BOLD = 'UISans-Bold';
export const UI_FONT_OBLIQUE = 'UISans-Oblique';
export const UI_FONT_BOLD_OBLIQUE = 'UISans-BoldOblique';

// Resolved lazily (require, not import — avoids a hard dependency at
// module-load time for any caller that never renders a PDF).
function dejaVuPath(file: string): string {
  const pkgDir = require.resolve('dejavu-fonts-ttf/package.json');
  return pkgDir.replace(/package\.json$/, `ttf/${file}`);
}

export const PDF_FONT_FILES = {
  [UI_FONT]: dejaVuPath('DejaVuSans.ttf'),
  [UI_FONT_BOLD]: dejaVuPath('DejaVuSans-Bold.ttf'),
  [UI_FONT_OBLIQUE]: dejaVuPath('DejaVuSans-Oblique.ttf'),
  [UI_FONT_BOLD_OBLIQUE]: dejaVuPath('DejaVuSans-BoldOblique.ttf'),
};

/** Registers the Unicode UI fonts on a fresh PDFKit document. Idempotent per-doc. */
export function registerPdfFonts(doc: PDFKit.PDFDocument): void {
  for (const [name, path] of Object.entries(PDF_FONT_FILES)) {
    doc.registerFont(name, path);
  }
}

let cachedFont: GlyphLookupFont | undefined;
function loadCheckFont(): GlyphLookupFont {
  if (!cachedFont) {
    cachedFont = fontkit.openSync(PDF_FONT_FILES[UI_FONT]);
  }
  return cachedFont;
}

const glyphCoverageCache = new Map<number, boolean>();

function fontHasCodepoint(codePoint: number): boolean {
  // Common whitespace/control chars are always safe to keep — PDFKit/PDF
  // itself handles them, they're not glyph lookups.
  if (codePoint === 0x20 || codePoint === 0x0a || codePoint === 0x09) {
    return true;
  }
  let cached = glyphCoverageCache.get(codePoint);
  if (cached === undefined) {
    const font = loadCheckFont();
    cached = font.glyphForCodePoint(codePoint).id !== 0;
    glyphCoverageCache.set(codePoint, cached);
  }
  return cached;
}

/**
 * Strips any character the embedded Unicode font cannot render (drawing a
 * "tofu" box otherwise). Never corrupts surrounding text — worst case a
 * character is simply dropped. Accented Latin, Cyrillic, Greek, Arabic,
 * Turkish/Polish extended-Latin etc. all pass through untouched; CJK
 * ideographs and unsupported emoji are removed. Also strips C0/C1 control
 * characters, which are invalid in PDF text strings.
 */
export function sanitizeForPdf(value: string): string {
  if (!value) return value;
  let out = '';
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(char)) {
      continue;
    }
    if (fontHasCodepoint(codePoint)) {
      out += char;
    }
  }
  return out;
}

/**
 * Deep-sanitizes every string value in a plain object/array tree (in place
 * is avoided — returns a new structure) so callers can run a single pass
 * over an args object before layout instead of remembering to sanitize at
 * every `doc.text()` call site. Buffers and non-plain values pass through
 * untouched.
 */
/**
 * `sanitizeForPdf` can legitimately reduce a string to nothing — e.g. a
 * customer name that is entirely CJK/unsupported script sanitises to `''`
 * against a font with no glyphs for it. For fields that are load-bearing in
 * the copy around them (a name that a sentence is built from, a heading),
 * an empty string is worse than the original glyph loss: it produces
 * broken-looking output like a bare leading comma. Callers for those
 * specific fields should route the *raw* (pre-sanitize) value through this
 * helper instead of using the sanitized value directly, so a sanitize-to-
 * empty degrades to an explicit, honest fallback rather than silently
 * vanishing.
 */
export function sanitizeWithFallback(
  rawValue: string,
  fallback: string,
): string {
  const raw = rawValue ?? '';
  const sanitized = sanitizeForPdf(raw).trim();
  // A non-empty result isn't enough on its own: a mixed-script name like
  // "田中 J" sanitises to just "J" — a single stray letter is exactly the
  // "worse than empty" case this function exists to prevent, so it needs
  // its own rejection, not just the empty-string one. Require at least two
  // alphanumeric characters (Unicode-aware) before trusting the sanitized
  // result; anything thinner falls back same as an outright empty string.
  const alphanumericCount = (sanitized.match(/[\p{L}\p{N}]/gu) ?? []).length;
  if (alphanumericCount < 2) return fallback;

  // Round 5: a *partial* loss is a narrower but equally silent version of
  // the same bug — "田中 Hiroshi" sanitises to just "Hiroshi", clears the
  // >= 2 bar above, and ships as a document that quietly dropped the
  // customer's surname with no sign anything was lost. Detect this by
  // comparing whitespace-separated "words" (any token containing at least
  // one alphanumeric character) before and after sanitizing: if sanitizing
  // caused an *entire* word to disappear rather than just losing individual
  // unsupported characters within words that survived, the result is a
  // silently-incomplete name, not a merely-simplified one — fall back
  // rather than ship half a name unannounced.
  const isWordToken = (t: string) => /[\p{L}\p{N}]/u.test(t);
  const rawWordCount = raw.trim().split(/\s+/).filter(isWordToken).length;
  const sanitizedWordCount = sanitized.split(/\s+/).filter(isWordToken).length;
  if (rawWordCount >= 2 && sanitizedWordCount < rawWordCount) return fallback;

  return sanitized;
}

export function sanitizeDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return sanitizeForPdf(value) as unknown as T;
  }
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    const items = value as unknown[];
    return items.map((item) => sanitizeDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = sanitizeDeep(val);
    }
    return result as T;
  }
  return value;
}

const COMPASS_POINTS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];

/** Azimuth degrees clockwise from true north -> 16-point compass label. */
export function azimuthToCompass(azimuthDegrees: number): string {
  const normalized = ((azimuthDegrees % 360) + 360) % 360;
  const index = Math.round(normalized / 22.5) % 16;
  return COMPASS_POINTS[index];
}

export function formatAzimuth(azimuthDegrees: number): string {
  return `${azimuthToCompass(azimuthDegrees)} (${Math.round(azimuthDegrees)}°)`;
}

export function makeCurrencyFormatter(
  currency: string,
): (value: number) => string {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return (value: number) => formatter.format(value);
}

export function formatKwh(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')} kWh`;
}

export function formatKw(value: number): string {
  return `${value.toFixed(value >= 10 ? 1 : 2)} kW`;
}

/** Truncates a long string to a max length with an ellipsis, for table cells that must not overflow. */
export function truncate(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
