/**
 * Per-array colour palette, shared source of truth for both the Solar
 * Design Studio's server-side render composite
 * (`roof-design-render-composite.service.ts`) and the proposal PDF's
 * array-table legend (`../jobs/roof-proposal-pdf.service.ts`, which imports
 * `ARRAY_PALETTE` from here). Keeping both consumers importing this one
 * array — rather than each declaring its own literal — is what keeps
 * "row N -> shape on the image" true by construction instead of by
 * convention.
 *
 * Spaced by perceived luminance (0.299R+0.587G+0.114B; roughly 25+ points
 * apart on a 0-255 scale — navy 58.7, teal 86.3, green 110.7, amber 135.4)
 * so swatches stay distinguishable on a black-and-white printer, not just
 * on screen.
 */
export const ARRAY_PALETTE = ['#1e3a8a', '#0f766e', '#16a34a', '#d97706'];
