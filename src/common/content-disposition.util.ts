/**
 * Build a Content-Disposition value that Node will accept for ANY display
 * name. `res.setHeader` throws ERR_INVALID_CHAR on non-Latin-1 bytes (an em
 * dash, an emoji, a Chinese customer name) — and an uncaught throw here took
 * the whole API process down, not just the request. RFC 6266/5987: an ASCII
 * fallback in `filename=` plus the UTF-8 original in `filename*=`.
 */
export function contentDisposition(
  type: 'inline' | 'attachment',
  rawName: string | null | undefined,
  fallback = 'download',
): string {
  const name = (rawName ?? '').replace(/[\r\n"\\]/g, '_').trim() || fallback;
  // Latin-1-safe fallback: replace anything outside printable ASCII.
  const ascii = name.replace(/[^\x20-\x7e]/g, '_') || fallback;
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return ascii === name
    ? `${type}; filename="${ascii}"`
    : `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
