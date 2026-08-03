import {
  compareAddressKeys,
  normalizeAddressKey,
} from './address-normalize.util';

describe('normalizeAddressKey', () => {
  it('folds street-type synonyms and casing', () => {
    expect(normalizeAddressKey('12 Smith Street, Richmond VIC 3121')).toBe(
      normalizeAddressKey('12 smith st richmond 3121'),
    );
  });

  it('drops states but keeps unit numbers', () => {
    const unit1 = normalizeAddressKey('Unit 1/12 Smith St, NSW 2000');
    const unit2 = normalizeAddressKey('Unit 2/12 Smith St, NSW 2000');
    expect(unit1).not.toBeNull();
    // Different dwellings must never collide — this is the expensive mistake.
    expect(unit1).not.toBe(unit2);
  });

  it('treats flat/apt/unit as the same prefix', () => {
    expect(normalizeAddressKey('Flat 3 22 Ocean Rd')).toBe(
      normalizeAddressKey('Unit 3 22 Ocean Road'),
    );
  });

  it('returns null for input too thin to identify a dwelling', () => {
    expect(normalizeAddressKey(null)).toBeNull();
    expect(normalizeAddressKey('')).toBeNull();
    expect(normalizeAddressKey('   ')).toBeNull();
    expect(normalizeAddressKey('Melbourne')).toBeNull();
    // A bare postcode is not an address.
    expect(normalizeAddressKey('3121')).toBeNull();
  });

  it('caps the key length', () => {
    const key = normalizeAddressKey(`12 ${'a'.repeat(400)} st`);
    expect(key).not.toBeNull();
    expect(key!.length).toBeLessThanOrEqual(180);
  });
});

describe('compareAddressKeys', () => {
  const k = (s: string) => normalizeAddressKey(s);

  it('reports exact for identical keys', () => {
    expect(
      compareAddressKeys(k('12 Smith St 3121'), k('12 smith street 3121')),
    ).toBe('exact');
  });

  it('reports strong when the street number and street match', () => {
    expect(
      compareAddressKeys(k('12 Smith St Richmond'), k('12 Smith St 3121')),
    ).toBe('strong');
  });

  it('reports weak on shared street words alone', () => {
    expect(
      compareAddressKeys(k('12 Smith St Richmond'), k('40 Smith St Richmond')),
    ).toBe('weak');
  });

  it('reports no match for unrelated addresses', () => {
    expect(
      compareAddressKeys(k('12 Smith St Richmond'), k('9 Ocean Dr Bondi')),
    ).toBeNull();
  });

  it('reports no match when either key is null', () => {
    expect(compareAddressKeys(null, k('12 Smith St 3121'))).toBeNull();
    expect(compareAddressKeys(k('12 Smith St 3121'), null)).toBeNull();
  });
});
