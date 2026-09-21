import { compileSelectors, compileSelector, findSelector } from './selector';
import { parsePointer } from './json-pointer';

describe('identity selector compilation', () => {
  it('accepts a single field string or a composite field list', () => {
    const single = compileSelector({ arrayPath: '/items', fields: '/id' });
    expect(single.fields).toEqual(['/id']);
    const composite = compileSelector({ arrayPath: '/items', fields: ['/kind', '/meta/name'] });
    expect(composite.fields).toEqual(['/kind', '/meta/name']);
  });

  it('defaults the duplicate strategy to fallback', () => {
    expect(compileSelector({ arrayPath: '', fields: '/id' }).onDuplicate).toBe('fallback');
  });

  it('rejects a wildcard as the final token because it has to point at an array', () => {
    expect(() => compileSelector({ arrayPath: '/users/*', fields: '/id' })).toThrow(/final token/);
  });

  it('rejects wildcards in identity fields', () => {
    expect(() => compileSelector({ arrayPath: '/users', fields: '/tags/*' })).toThrow(/wildcards/);
  });

  it('rejects relative fields that do not start with a slash', () => {
    expect(() => compileSelector({ arrayPath: '/users', fields: 'id' })).toThrow(/must start with/);
  });

  it('rejects duplicated fields of a composite identity', () => {
    expect(() => compileSelector({ arrayPath: '/users', fields: ['/id', '/id'] })).toThrow(/duplicated field/);
  });

  it('rejects unknown duplicate strategies', () => {
    expect(() => compileSelector({
      arrayPath: '/users',
      fields: '/id',
      // @ts-expect-error testing a runtime invalid value
      onDuplicate: 'explode',
    })).toThrow(/onDuplicate/);
  });

  it('rejects overlapping selectors', () => {
    expect(() => compileSelectors([
      { arrayPath: '/users/*/tags', fields: '/code' },
      { arrayPath: '/users/0/tags', fields: '/code' },
    ])).toThrow(/overlap/);
  });

  it('accepts disjoint selectors and finds them by concrete path', () => {
    const selectors = compileSelectors([
      { arrayPath: '/users/*/tags', fields: '/code' },
      { arrayPath: '/groups', fields: '/gid' },
    ]);
    expect(findSelector(selectors, parsePointer('/users/2/tags'))?.arrayPath).toBe('/users/*/tags');
    expect(findSelector(selectors, parsePointer('/groups'))?.arrayPath).toBe('/groups');
    expect(findSelector(selectors, parsePointer('/orders'))).toBeUndefined();
  });
});
