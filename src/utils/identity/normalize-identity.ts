import getType from '../get-type';
import type { Path } from './json-pointer';
import type { CompiledSelector } from './selector';

/**
 * The raw result of reading one declared identity field off an element.
 *
 * - `"value"`: the field exists and holds a scalar or `null`.
 * - `"missing"`: the field does not exist (or a parent along the path
 *   is neither present nor an object).
 * - `"invalid"`: the field exists but its value is not a legal identity
 *   component (e.g. `NaN`, `Infinity`, an object, an array, a function...).
 */
export type IdentityEntryStatus = 'value' | 'missing' | 'invalid';

export interface IdentityEntry {
  field: string;
  status: IdentityEntryStatus;
  value?: string | number | boolean | null;
  reason?: string;
}

export interface NormalizedIdentity {
  /**
   * The canonical serialized identity key. Two elements are identity-matched
   * iff their keys are byte-for-byte identical. `undefined` means the element
   * cannot participate in identity matching (`invalid`) and must fall back.
   */
  key?: string;
  entries: IdentityEntry[];
  invalid: boolean;
}

const INVALID_REASONS = {
  notAnObject: 'element is not an object',
  nonScalar: 'identity field must be a JSON scalar or null',
  illegalNumber: 'NaN and Infinity are not legal identity values',
  unsupported: 'identity field value is not representable in JSON',
};

const navigateRelative = (element: any, path: Path): { status: IdentityEntryStatus; value?: any; reason?: string } => {
  let current = element;
  for (const step of path) {
    if (step.kind !== 'key') {
      return { status: 'missing' };
    }
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      return { status: 'missing' };
    }
    if (!Object.prototype.hasOwnProperty.call(current, step.key)) {
      return { status: 'missing' };
    }
    current = current[step.key];
  }
  return { status: 'value', value: current };
};

type NormalizedValueResult = {
  status: IdentityEntryStatus;
  value?: string | number | boolean | null;
  reason?: string;
};

const normalizeValue = (value: any): NormalizedValueResult => {
  if (value === null) {
    return { status: 'value', value: null };
  }
  const type = getType(value);
  if (type === 'number') {
    if (Number.isNaN(value) || value === Infinity || value === -Infinity) {
      return { status: 'invalid', reason: INVALID_REASONS.illegalNumber };
    }
    // `Object.is(-0, 0)` is false; normalize -0 to 0 so they compare equal.
    return { status: 'value', value: value === 0 ? 0 : value };
  }
  if (type === 'string' || type === 'boolean') {
    return { status: 'value', value };
  }
  if (type === 'undefined') {
    return { status: 'invalid', reason: INVALID_REASONS.unsupported };
  }
  return { status: 'invalid', reason: INVALID_REASONS.nonScalar };
};

const VALUE_TAGS: Record<string, string> = {
  string: 's',
  number: 'n',
  boolean: 'b',
  null: 'z',
};

const serializeEntry = (entry: IdentityEntry): string => {
  if (entry.status === 'missing') {
    return `${entry.field}=m`;
  }
  if (entry.status === 'invalid') {
    return `${entry.field}=x`;
  }
  const tag = VALUE_TAGS[entry.value === null ? 'null' : typeof entry.value];
  // JSON.stringify gives a canonical encoding for strings/booleans/null and
  // finite numbers; -0 has already been normalized to 0 at this point.
  return `${entry.field}:${tag}:${JSON.stringify(entry.value)}`;
};

/**
 * Extract the normalized identity of an array element according to a selector.
 *
 * The key is order independent for composite identities (entries are sorted by
 * field), distinguishes missing from null, and never confuses a string with a
 * number even when their JSON renderings look alike (e.g. `"1"` vs `1`).
 */
export const extractIdentity = (
  element: any,
  selector: CompiledSelector,
): NormalizedIdentity => {
  if (getType(element) !== 'object') {
    return {
      key: undefined,
      invalid: true,
      entries: [{ field: selector.fields[0], status: 'invalid', reason: INVALID_REASONS.notAnObject }],
    };
  }
  const entries: IdentityEntry[] = selector.parsedFields.map((parsedField, index) => {
    const navigated = navigateRelative(element, parsedField);
    if (navigated.status === 'missing') {
      return { field: selector.fields[index], status: 'missing' };
    }
    const normalized = normalizeValue(navigated.value);
    if (normalized.status === 'invalid') {
      return { field: selector.fields[index], status: 'invalid', reason: normalized.reason };
    }
    return { field: selector.fields[index], status: 'value', value: normalized.value };
  });
  const invalid = entries.some(entry => entry.status === 'invalid');
  if (invalid) {
    return { key: undefined, entries, invalid: true };
  }
  const key = entries
    .map(entry => serializeEntry(entry))
    .sort()
    .join('|');
  return { key, entries, invalid: false };
};
