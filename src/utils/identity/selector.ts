import { matchPath, parsePointer, pathsOverlap, type Path } from './json-pointer';

/**
 * What to do when one normalized identity key appears more than once in the
 * same side of an array.
 *
 * - `"fallback"` (default): emit an ambiguity diagnostic and route every
 *   element involved (on both sides) to the regular array diff strategy.
 * - `"throw"`: abort the whole diff with an error describing the conflict.
 */
export type DuplicateIdentityStrategy = 'fallback' | 'throw';

/**
 * Declarative identity selector for one object array.
 *
 * The selector can only read existing fields (or combinations of existing
 * fields) of an object element; it never executes arbitrary code.
 */
export interface ArrayIdentitySelectorConfig {
  /**
   * JSON Pointer style path of the target array.
   *
   * - `""` means the top level array.
   * - `"/items"` means the array at property `items` of the root object.
   * - `"/users/*\/roles"` means the `roles` array nested inside every element
   *   of the root `users` array; the wildcard `*` is only allowed at array
   *   element positions and cannot be the final token.
   */
  arrayPath: string;
  /**
   * One or more JSON Pointer tokens relative to the element object.
   *
   * A single string `"/id"` uses the `id` field; multiple strings form a
   * composite identity, e.g. `["/kind", "/meta/name"]`.
   */
  fields: string | string[];
  /** Duplicate identity handling, default `"fallback"`. */
  onDuplicate?: DuplicateIdentityStrategy;
}

export interface CompiledSelector {
  arrayPath: string;
  fields: string[];
  parsedArrayPath: Path;
  parsedFields: Path[];
  onDuplicate: DuplicateIdentityStrategy;
}

const parseRelativeField = (field: string): Path => {
  if (field === '') {
    throw new Error('Identity selector fields must be JSON Pointer tokens starting with "/", got "".');
  }
  if (!field.startsWith('/')) {
    throw new Error(`Invalid identity selector field "${field}": it must start with "/".`);
  }
  const path = parsePointer(field);
  for (const step of path) {
    if (step.kind === 'index-any') {
      throw new Error(`Invalid identity selector field "${field}": wildcards are not allowed in fields.`);
    }
  }
  return path;
};

export const compileSelector = (config: ArrayIdentitySelectorConfig): CompiledSelector => {
  if (!config || typeof config !== 'object') {
    throw new Error('An identity selector must be an object with "arrayPath" and "fields".');
  }
  const { arrayPath, fields, onDuplicate = 'fallback' } = config;
  if (typeof arrayPath !== 'string') {
    throw new Error('Identity selector "arrayPath" must be a string.');
  }
  if (onDuplicate !== 'fallback' && onDuplicate !== 'throw') {
    throw new Error(`Identity selector "onDuplicate" must be "fallback" or "throw", got "${onDuplicate}".`);
  }
  const parsedArrayPath = parsePointer(arrayPath);
  const lastStep = parsedArrayPath[parsedArrayPath.length - 1];
  if (lastStep && lastStep.kind === 'index-any') {
    throw new Error(
      `Invalid identity selector path "${arrayPath}": the wildcard "*" must ` +
      'point at an array, so it cannot be the final token.',
    );
  }
  const fieldList = Array.isArray(fields) ? fields : [fields];
  if (!fieldList.length) {
    throw new Error(`Identity selector for "${arrayPath}" must declare at least one field.`);
  }
  const seenFields = new Set<string>();
  const parsedFields: Path[] = [];
  for (const field of fieldList) {
    if (typeof field !== 'string') {
      throw new Error(`Identity selector fields for "${arrayPath}" must be strings.`);
    }
    const parsed = parseRelativeField(field);
    const normalized = field.replace(/\/$/, '');
    if (seenFields.has(normalized)) {
      throw new Error(`Identity selector for "${arrayPath}" contains duplicated field "${field}".`);
    }
    seenFields.add(normalized);
    parsedFields.push(parsed);
  }
  return {
    arrayPath,
    fields: fieldList,
    parsedArrayPath,
    parsedFields,
    onDuplicate,
  };
};

export const compileSelectors = (
  configs: ArrayIdentitySelectorConfig[] | undefined,
): CompiledSelector[] => {
  if (!configs) {
    return [];
  }
  if (!Array.isArray(configs)) {
    throw new Error('"arrayIdentitySelectors" must be an array of selector configs.');
  }
  const compiled = configs.map(compileSelector);
  for (let i = 0; i < compiled.length; i++) {
    for (let j = i + 1; j < compiled.length; j++) {
      if (pathsOverlap(compiled[i].parsedArrayPath, compiled[j].parsedArrayPath)) {
        throw new Error(
          `Identity selector paths "${compiled[i].arrayPath}" and ` +
          `"${compiled[j].arrayPath}" overlap; each object array may only ` +
          'have one identity selector.',
        );
      }
    }
  }
  return compiled;
};

export const findSelector = (
  selectors: CompiledSelector[],
  path: Path,
): CompiledSelector | undefined => {
  return selectors.find(selector => matchPath(selector.parsedArrayPath, path));
};
