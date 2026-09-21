import {
  computeIdentity,
  findIdentitySelector,
  matchSelectorPath,
  normalizeIdentityValue,
  parseSelectorPath,
  readIdentityField,
} from './identity-selector';

const selector = (fields: string[]) => ({ path: '', fields });

describe('identity-selector: path matching', () => {
  it('matches the root array with an empty or "/" path', () => {
    expect(matchSelectorPath('', '')).toBe(true);
    expect(matchSelectorPath('/', '')).toBe(true);
    expect(matchSelectorPath('', '/items')).toBe(false);
  });

  it('matches exact paths', () => {
    expect(matchSelectorPath('/items', '/items')).toBe(true);
    expect(matchSelectorPath('/items', '/other')).toBe(false);
    expect(matchSelectorPath('/a/b', '/a/b')).toBe(true);
    expect(matchSelectorPath('/a/b', '/a')).toBe(false);
    expect(matchSelectorPath('/a', '/a/b')).toBe(false);
  });

  it('matches a single array index with the "*" wildcard', () => {
    expect(matchSelectorPath('/items/*/children', '/items/0/children')).toBe(true);
    expect(matchSelectorPath('/items/*/children', '/items/12/children')).toBe(true);
    // wildcard only matches array indices, not object keys
    expect(matchSelectorPath('/items/*/children', '/items/foo/children')).toBe(false);
    // wildcard matches exactly one segment
    expect(matchSelectorPath('/items/*', '/items/0/children')).toBe(false);
  });

  it('supports JSON Pointer escaping in path segments', () => {
    expect(parseSelectorPath('/a~1b/c~0d')).toEqual(['a/b', 'c~d']);
    expect(matchSelectorPath('/a~1b', '/a~1b')).toBe(true);
  });

  it('rejects paths that do not start with "/"', () => {
    expect(() => parseSelectorPath('items')).toThrow(/Invalid identity selector path/);
  });
});

describe('identity-selector: field reading', () => {
  it('reads bare keys and nested JSON Pointers', () => {
    const el = { id: 1, meta: { uid: 'u1' } };
    expect(readIdentityField(el, 'id')).toBe(1);
    expect(readIdentityField(el, '/meta/uid')).toBe('u1');
    expect(readIdentityField(el, 'missing')).toBeUndefined();
    expect(readIdentityField(el, '/meta/deeper/missing')).toBeUndefined();
  });
});

describe('identity-selector: value normalization', () => {
  it('distinguishes missing, null and scalar values', () => {
    expect(normalizeIdentityValue(undefined)).not.toBe(normalizeIdentityValue(null));
    expect(normalizeIdentityValue(null)).not.toBe(normalizeIdentityValue(0));
    expect(normalizeIdentityValue(undefined)).not.toBe(normalizeIdentityValue(''));
  });

  it('treats string "1" and number 1 as different identities', () => {
    expect(normalizeIdentityValue('1')).not.toBe(normalizeIdentityValue(1));
  });

  it('treats -0 and 0 as the same identity', () => {
    expect(normalizeIdentityValue(-0)).toBe(normalizeIdentityValue(0));
  });

  it('rejects NaN as an invalid identity input', () => {
    expect(() => normalizeIdentityValue(NaN)).toThrow(/NaN/);
    expect(() => normalizeIdentityValue({ nested: [NaN] })).toThrow(/NaN/);
  });

  it('normalizes composite objects independently of key order', () => {
    const a = normalizeIdentityValue({ x: 1, y: { p: 'a', q: [1, 2] } });
    const b = normalizeIdentityValue({ y: { q: [1, 2], p: 'a' }, x: 1 });
    expect(a).toBe(b);
  });

  it('keeps array order significant inside composite values', () => {
    expect(normalizeIdentityValue([1, 2])).not.toBe(normalizeIdentityValue([2, 1]));
  });
});

describe('identity-selector: composite identities', () => {
  it('combines fields in the configured order', () => {
    const el = { a: 1, b: 2 };
    expect(computeIdentity(el, selector(['a', 'b'])))
      .not.toBe(computeIdentity({ a: 2, b: 1 }, selector(['a', 'b'])));
    expect(computeIdentity(el, selector(['a', 'b'])))
      .toBe(computeIdentity({ b: 2, a: 1 }, selector(['a', 'b'])));
  });

  it('finds the first matching selector', () => {
    const selectors = [
      { path: '/items', fields: ['id'] },
      { path: '/items/*/children', fields: ['cid'] },
    ];
    expect(findIdentitySelector(selectors, '/items')).toBe(selectors[0]);
    expect(findIdentitySelector(selectors, '/items/3/children')).toBe(selectors[1]);
    expect(findIdentitySelector(selectors, '/other')).toBeUndefined();
  });
});
