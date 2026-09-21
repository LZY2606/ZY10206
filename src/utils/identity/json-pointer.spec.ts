import { formatPointer, matchPath, parsePointer, pathsOverlap, unescapePointerToken } from './json-pointer';

describe('identity JSON Pointer paths', () => {
  it('parses the root path', () => {
    expect(parsePointer('')).toEqual([]);
    expect(formatPointer([])).toBe('');
  });

  it('parses object keys, numeric indices and the restricted wildcard', () => {
    expect(parsePointer('/users/*/tags/0')).toEqual([
      { kind: 'key', key: 'users' },
      { kind: 'index-any' },
      { kind: 'key', key: 'tags' },
      { kind: 'index', index: 0 },
    ]);
  });

  it('unescapes ~0 and ~1 in the documented order', () => {
    expect(unescapePointerToken('a~1b~0c')).toBe('a/b~c');
    expect(parsePointer('/a~1b~0c')).toEqual([{ kind: 'key', key: 'a/b~c' }]);
  });

  it('round-trips concrete paths', () => {
    const path = parsePointer('/users/3/tags/1/code');
    expect(formatPointer(path)).toBe('/users/3/tags/1/code');
  });

  it('rejects paths not starting with a slash', () => {
    expect(() => parsePointer('users')).toThrow(/must start with "\/"/);
  });

  it('matches concrete paths against wildcard patterns', () => {
    const pattern = parsePointer('/users/*/tags');
    expect(matchPath(pattern, parsePointer('/users/0/tags'))).toBe(true);
    expect(matchPath(pattern, parsePointer('/users/12/tags'))).toBe(true);
    expect(matchPath(pattern, parsePointer('/users/0/roles'))).toBe(false);
    expect(matchPath(pattern, parsePointer('/users/tags'))).toBe(false);
  });

  it('detects overlapping selector paths', () => {
    expect(pathsOverlap(parsePointer('/a/*/b'), parsePointer('/a/0/b'))).toBe(true);
    expect(pathsOverlap(parsePointer('/a/0/b'), parsePointer('/a/1/b'))).toBe(false);
    expect(pathsOverlap(parsePointer('/a/*/b'), parsePointer('/a/*/b'))).toBe(true);
    expect(pathsOverlap(parsePointer('/a/*/b'), parsePointer('/a/*/c'))).toBe(false);
  });
});
