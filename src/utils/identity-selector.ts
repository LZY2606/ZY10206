import type { ArrayIdentitySelector } from '../differ';
import getType from './get-type';

/**
 * Escape a single segment for a JSON Pointer style path (RFC 6901).
 */
export const escapePointerSegment = (segment: string): string =>
  segment.replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * Unescape a single segment of a JSON Pointer style path (RFC 6901).
 */
export const unescapePointerSegment = (segment: string): string =>
  segment.replace(/~1/g, '/').replace(/~0/g, '~');

/**
 * Join a path segment to a base path, e.g. `joinPath('/items', '0')` => `'/items/0'`.
 */
export const joinPath = (base: string, segment: string): string =>
  `${base}/${escapePointerSegment(segment)}`;

/**
 * Parse a JSON Pointer style path into segments. The root is `''` or `/`.
 */
export const parseSelectorPath = (path: string): string[] => {
  if (path === '' || path === '/') {
    return [];
  }
  if (!path.startsWith('/')) {
    throw new Error(
      `Invalid identity selector path "${path}": ` +
      'paths must be empty (root) or start with "/".',
    );
  }
  return path.slice(1).split('/').map(unescapePointerSegment);
};

/**
 * Check whether a selector path matches an actual array path.
 * The `*` segment matches exactly one array index segment (a non-negative integer).
 */
export const matchSelectorPath = (selectorPath: string, actualPath: string): boolean => {
  const selectorSegments = parseSelectorPath(selectorPath);
  const actualSegments = parseSelectorPath(actualPath);
  if (selectorSegments.length !== actualSegments.length) {
    return false;
  }
  return selectorSegments.every((segment, i) => (
    segment === '*' ? /^\d+$/.test(actualSegments[i]) : segment === actualSegments[i]
  ));
};

/**
 * Find the first selector whose path matches the given array path.
 */
export const findIdentitySelector = (
  selectors: ArrayIdentitySelector[] | undefined,
  path: string,
): ArrayIdentitySelector | undefined => selectors?.find(s => matchSelectorPath(s.path, path));

/**
 * Read a field from an array element. A field is a JSON Pointer relative to the
 * element (e.g. `'/meta/id'`); a bare word (e.g. `'id'`) is treated as a single key.
 * Returns `undefined` when any segment is missing.
 */
export const readIdentityField = (element: any, field: string): any => {
  const segments = field.startsWith('/') ? parseSelectorPath(field) : [field];
  let current = element;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = current[segment];
  }
  return current;
};

/**
 * Normalize a single identity value into a deterministic, type-tagged string:
 *
 * - missing (`undefined`) => `u:`
 * - `null`                => `l:`
 * - string                => `s:<json>` (so string `"1"` !== number `1`)
 * - number                => `n:<canonical>` (`-0` is normalized to `0`; `NaN` is invalid)
 * - boolean               => `b:true` / `b:false`
 * - object                => `o:{...}` with keys sorted recursively (key order insensitive)
 * - array                 => `a:[...]` with items normalized recursively
 *
 * Only reads existing fields; never executes user code.
 */
export const normalizeIdentityValue = (value: any): string => {
  const type = getType(value);
  switch (type) {
    case 'undefined':
      return 'u:';
    case 'null':
      return 'l:';
    case 'string':
      return `s:${JSON.stringify(value)}`;
    case 'number':
      if (Number.isNaN(value)) {
        throw new Error('Invalid identity value: NaN is not allowed in identity fields.');
      }
      if (value === Infinity || value === -Infinity) {
        throw new Error('Invalid identity value: Infinity is not allowed in identity fields.');
      }
      return `n:${Object.is(value, -0) ? '0' : String(value)}`;
    case 'boolean':
      return `b:${value}`;
    case 'object': {
      const keys = Object.keys(value).sort();
      const body = keys
        .map(key => `${JSON.stringify(key)}:${normalizeIdentityValue(value[key])}`)
        .join(',');
      return `o:{${body}}`;
    }
    case 'array':
      return `a:[${value.map((item: any) => normalizeIdentityValue(item)).join(',')}]`;
    default:
      throw new Error(
        `Invalid identity value: type "${type}" is not allowed in identity fields.`,
      );
  }
};

/**
 * Compute the normalized identity of an array element for the given selector.
 * Multiple fields are combined in the configured order (composite identity).
 */
export const computeIdentity = (element: any, selector: ArrayIdentitySelector): string =>
  selector.fields
    .map(field => normalizeIdentityValue(readIdentityField(element, field)))
    .join('\u0000');
