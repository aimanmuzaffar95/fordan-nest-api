/**
 * Field-level response scrubbing helper.
 *
 * The product's access-control bar (see BAR-servicetitan.md §"Field-level
 * sensitive-data gating") treats cost/margin, pay rates, contact PII, and
 * internal-only content as *independently* gated fields, not just
 * object-level guards. Hiding a field in a client app is not protection —
 * the device must never receive data the viewer isn't allowed to see.
 *
 * This helper is the single reusable place that expresses "does this
 * viewer see this field" as a declarative map, instead of scattering
 * `condition ? value : null` ternaries across services. Every field-level
 * sensitive-data check in the API should route through this.
 *
 * Usage:
 *   scrubFields(rawShape, {
 *     projectPrice: canViewFinancials,
 *     phoneNumber: canViewContactInfo,
 *   })
 *
 * Any key present in `gates` with value `false` is replaced with `null` in
 * the returned object. Keys not present in `gates`, or present with `true`,
 * pass through unchanged. The input object is never mutated.
 */
export type FieldGateMap<T> = Partial<Record<keyof T, boolean>>;

export function scrubFields<T extends Record<string, unknown>>(
  value: T,
  gates: FieldGateMap<T>,
): T {
  const result: T = { ...value };
  (Object.keys(gates) as (keyof T)[]).forEach((key) => {
    if (gates[key] === false) {
      (result as Record<string, unknown>)[key as string] = null;
    }
  });
  return result;
}

/**
 * Same as {@link scrubFields} but scrubs every element of an array, useful
 * for list endpoints (e.g. staff directory rows).
 */
export function scrubFieldsList<T extends Record<string, unknown>>(
  values: T[],
  gates: FieldGateMap<T>,
): T[] {
  return values.map((value) => scrubFields(value, gates));
}
