import { compileSelector } from './selector';
import { extractIdentity } from './normalize-identity';

const selector = (fields: string | string[]) =>
  compileSelector({ arrayPath: '/items', fields });

describe('normalized identity', () => {
  it('distinguishes missing fields from explicit null', () => {
    const missing = extractIdentity({}, selector('/id'));
    const explicitNull = extractIdentity({ id: null }, selector('/id'));
    expect(missing.entries[0].status).toBe('missing');
    expect(explicitNull.entries[0].status).toBe('value');
    expect(missing.key).not.toBe(explicitNull.key);
  });

  it('treats -0 and 0 as the same identity but keeps them distinct from other numbers', () => {
    const negZero = extractIdentity({ id: -0 }, selector('/id'));
    const zero = extractIdentity({ id: 0 }, selector('/id'));
    const one = extractIdentity({ id: 1 }, selector('/id'));
    expect(negZero.key).toBe(zero.key);
    expect(zero.key).not.toBe(one.key);
  });

  it('does not match NaN identity values and reports them invalid', () => {
    const nan = extractIdentity({ id: NaN }, selector('/id'));
    expect(nan.invalid).toBe(true);
    expect(nan.key).toBeUndefined();
    expect(nan.entries[0].reason).toMatch(/NaN/);
  });

  it('treats Infinity and -Infinity as illegal identity values', () => {
    for (const value of [Infinity, -Infinity]) {
      const result = extractIdentity({ id: value }, selector('/id'));
      expect(result.invalid).toBe(true);
      expect(result.key).toBeUndefined();
    }
  });

  it('never confuses a string with a number', () => {
    const numeric = extractIdentity({ id: 1 }, selector('/id'));
    const stringy = extractIdentity({ id: '1' }, selector('/id'));
    expect(numeric.key).not.toBe(stringy.key);
    expect(numeric.key).toContain(':n:');
    expect(stringy.key).toContain(':s:');
  });

  it('keeps booleans distinct from numbers and strings', () => {
    const bool = extractIdentity({ id: true }, selector('/id'));
    const num = extractIdentity({ id: 1 }, selector('/id'));
    expect(bool.key).not.toBe(num.key);
    expect(bool.key).toContain(':b:');
  });

  it('makes composite identities independent of field declaration order', () => {
    const a = extractIdentity({ kind: 'user', ref: 'x' }, selector(['/kind', '/ref']));
    const b = extractIdentity({ ref: 'x', kind: 'user' }, selector(['/ref', '/kind']));
    expect(a.key).toBe(b.key);
  });

  it('uses field paths when sorting composite keys, so values of different fields stay distinct', () => {
    const a = extractIdentity({ a: '1', b: '2' }, selector(['/a', '/b']));
    const b = extractIdentity({ a: '2', b: '1' }, selector(['/a', '/b']));
    expect(a.key).not.toBe(b.key);
  });

  it('supports deeply nested field combinations', () => {
    const result = extractIdentity(
      { meta: { name: 'a' }, kind: 'k' },
      selector(['/kind', '/meta/name']),
    );
    expect(result.entries.map(e => e.status)).toEqual(['value', 'value']);
    expect(result.key).toContain('/meta/name');
  });

  it('marks an intermediate non-object path as missing', () => {
    const result = extractIdentity({ meta: null }, selector('/meta/name'));
    expect(result.entries[0].status).toBe('missing');
  });

  it('rejects object, array, undefined and function identity components', () => {
    expect(extractIdentity({ id: {} }, selector('/id')).invalid).toBe(true);
    expect(extractIdentity({ id: [] }, selector('/id')).invalid).toBe(true);
    expect(extractIdentity({ id: undefined }, selector('/id')).invalid).toBe(true);
    expect(extractIdentity({ id: () => 1 }, selector('/id')).invalid).toBe(true);
  });

  it('does not match non-object elements', () => {
    const result = extractIdentity(42, selector('/id'));
    expect(result.invalid).toBe(true);
    expect(result.entries[0].reason).toMatch(/not an object/);
  });

  it('serializes keys deterministically so matching is byte-for-byte', () => {
    const a = extractIdentity({ id: 'a"b\\c' }, selector('/id'));
    const b = extractIdentity({ id: 'a"b\\c' }, selector('/id'));
    expect(a.key).toBe(b.key);
  });
});
