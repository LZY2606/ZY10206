/**
 * A step inside a JSON Pointer style path.
 *
 * - `{ kind: 'key', key }` is a property of an object.
 * - `{ kind: 'index', index }` is an element of an array, with a concrete index.
 * - `{ kind: 'index-any' }` stands for "any element of an array" and is produced
 *   by the restricted wildcard token `*` in an identity selector.
 */
export type PathStep =
  | { kind: 'key'; key: string }
  | { kind: 'index'; index: number }
  | { kind: 'index-any' };

export type Path = PathStep[];

/**
 * Unescape a JSON Pointer reference token (RFC 6901, section 4):
 * `~1` becomes `/` and `~0` becomes `~`.
 */
export const unescapePointerToken = (token: string): string => {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
};

/**
 * Parse a JSON Pointer style path into structured steps.
 *
 * The empty string denotes the root document, the root array in particular is
 * the array which is the top level input of the differ.
 *
 * The restricted wildcard token `*` is parsed into an `index-any` step. A token
 * is treated as an array index only when it consists of digits, otherwise it
 * is an object property key.
 */
export const parsePointer = (pointer: string): Path => {
  if (pointer === '') {
    return [];
  }
  if (!pointer.startsWith('/')) {
    throw new Error(`Invalid identity selector path "${pointer}": a non-root path must start with "/".`);
  }
  return pointer.split('/').slice(1).map((rawToken) => {
    if (rawToken === '*') {
      return { kind: 'index-any' as const };
    }
    const token = unescapePointerToken(rawToken);
    if (/^(0|[1-9]\d*)$/.test(token)) {
      return { kind: 'index' as const, index: Number(token) };
    }
    return { kind: 'key' as const, key: token };
  });
};

/**
 * Convert a concrete runtime path back into its canonical JSON Pointer string.
 * A concrete path never contains `index-any` steps.
 */
export const formatPointer = (path: Path): string => {
  if (!path.length) {
    return '';
  }
  return path.map((step) => {
    if (step.kind === 'index-any') {
      return '/*';
    }
    if (step.kind === 'index') {
      return `/${step.index}`;
    }
    return `/${step.key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
  }).join('');
};

/**
 * Match a concrete runtime path against a (possibly wildcard-bearing) selector path.
 */
export const matchPath = (pattern: Path, actual: Path): boolean => {
  if (pattern.length !== actual.length) {
    return false;
  }
  for (let i = 0; i < pattern.length; i++) {
    const expected = pattern[i];
    const real = actual[i];
    if (expected.kind === 'index-any') {
      if (real.kind === 'key') {
        return false;
      }
      continue;
    }
    if (expected.kind !== real.kind) {
      return false;
    }
    if (expected.kind === 'index' && real.kind === 'index' && expected.index !== real.index) {
      return false;
    }
    if (expected.kind === 'key' && real.kind === 'key' && expected.key !== real.key) {
      return false;
    }
  }
  return true;
};

/**
 * Decide whether 2 selector paths overlap, i.e. there exists at least one
 * concrete runtime path matched by both of them.
 */
export const pathsOverlap = (a: Path, b: Path): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i].kind === 'index-any' || b[i].kind === 'index-any') {
      const other = a[i].kind === 'index-any' ? b[i] : a[i];
      if (other.kind === 'key') {
        return false;
      }
      continue;
    }
    if (a[i].kind !== b[i].kind) {
      return false;
    }
    const ai = a[i];
    const bi = b[i];
    if (ai.kind === 'index' && bi.kind === 'index' && ai.index !== bi.index) {
      return false;
    }
    if (ai.kind === 'key' && bi.kind === 'key' && ai.key !== bi.key) {
      return false;
    }
  }
  return true;
};
