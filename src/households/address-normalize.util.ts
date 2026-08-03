/**
 * Address normalisation for household/duplicate matching (PRD v2 Phase 1).
 *
 * Deliberately conservative: the goal is to make two spellings of the *same*
 * property collide, not to guess that two nearby properties are related. A
 * false merge is far more expensive than a missed one, so anything ambiguous
 * is left to differ.
 */

/** Street-type synonyms folded to a canonical short form. */
const STREET_TYPES: Record<string, string> = {
  street: 'st',
  st: 'st',
  road: 'rd',
  rd: 'rd',
  avenue: 'ave',
  ave: 'ave',
  av: 'ave',
  drive: 'dr',
  dr: 'dr',
  court: 'ct',
  ct: 'ct',
  place: 'pl',
  pl: 'pl',
  lane: 'ln',
  ln: 'ln',
  terrace: 'tce',
  tce: 'tce',
  parade: 'pde',
  pde: 'pde',
  crescent: 'cres',
  cres: 'cres',
  close: 'cl',
  cl: 'cl',
  boulevard: 'blvd',
  blvd: 'blvd',
  highway: 'hwy',
  hwy: 'hwy',
  circuit: 'cct',
  cct: 'cct',
  way: 'way',
  grove: 'gr',
  gr: 'gr',
};

/** Unit/subdwelling prefixes — kept, because unit 1 ≠ unit 2. */
const UNIT_PREFIXES = new Set(['unit', 'u', 'apt', 'apartment', 'flat', 'lot']);

const AU_STATES = new Set([
  'nsw',
  'vic',
  'qld',
  'wa',
  'sa',
  'tas',
  'act',
  'nt',
]);

/**
 * A stable key for "the same dwelling". Returns null when the address is too
 * thin to match on — better no key than a key that collides with everything.
 */
export function normalizeAddressKey(
  address: string | null | undefined,
): string | null {
  if (!address) return null;

  const cleaned = address
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/[^a-z0-9/\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '') return null;

  const tokens = cleaned.split(' ');
  const out: string[] = [];

  for (const token of tokens) {
    if (token === '') continue;
    // Drop states — they add nothing once the postcode is present, and they
    // are the field people most often abbreviate inconsistently.
    if (AU_STATES.has(token)) continue;
    if (UNIT_PREFIXES.has(token)) {
      out.push('u');
      continue;
    }
    out.push(STREET_TYPES[token] ?? token);
  }

  const key = out.join(' ').trim();
  if (key === '') return null;

  // A bare postcode or a single word is not a dwelling.
  const hasNumber = /\d/.test(key);
  const wordCount = key.split(' ').length;
  if (!hasNumber || wordCount < 2) return null;

  return key.slice(0, 180);
}

/**
 * Confidence that two customers are the same household.
 * `exact` — identical normalised address.
 * `strong` — same street number + street name, differing tail.
 * `weak` — same street name and postcode only.
 */
export type HouseholdMatchStrength = 'exact' | 'strong' | 'weak';

export function compareAddressKeys(
  a: string | null,
  b: string | null,
): HouseholdMatchStrength | null {
  if (!a || !b) return null;
  if (a === b) return 'exact';

  const at = a.split(' ');
  const bt = b.split(' ');
  const aNum = at.find((t) => /^\d/.test(t));
  const bNum = bt.find((t) => /^\d/.test(t));

  const aWords = at.filter((t) => !/\d/.test(t));
  const bWords = bt.filter((t) => !/\d/.test(t));
  const sharedWords = aWords.filter((w) => bWords.includes(w));

  if (aNum && bNum && aNum === bNum && sharedWords.length >= 1) {
    return 'strong';
  }
  if (sharedWords.length >= 2) return 'weak';
  return null;
}
