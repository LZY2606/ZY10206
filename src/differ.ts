import cleanFields from './utils/clean-fields';
import concat from './utils/concat';
import detectCircular from './utils/detect-circular';
import diffArrayIdentity from './utils/diff-array-identity';
import diffArrayLCS from './utils/diff-array-lcs';
import diffArrayNormal from './utils/diff-array-normal';
import diffArrayCompareKey from './utils/diff-array-compare-key';
import diffObject from './utils/diff-object';
import getType from './utils/get-type';
import sortInnerArrays from './utils/sort-inner-arrays';
import stringify from './utils/stringify';

export interface DifferOptions {
  /**
   * Whether to detect circular reference in source objects before diff starts. Default
   * is `true`. If you are confident for your data (e.g. from `JSON.parse` or an API
   * response), you can set it to `false` to improve performance, but the algorithm may
   * not stop if circular reference does show up.
   */
  detectCircular?: boolean;
  /**
   * Max depth, default `Infinity` means no depth limit.
   */
  maxDepth?: number;
  /**
   * Support recognizing modifications, default `true` means the differ will output the
   * `* modified` sign apart from the basic `+ add` and `- remove` sign. If you prefer
   * Git output, please set it to `false`.
   */
  showModifications?: boolean;
  /**
   * The way to diff arrays, default is `"normal"`.
   *
   * For example, if we got 2 arrays: `a =[1, 2, 3]` and `b = [2, 3, 1, 4, 0]`, and the
   * `showModifications` is set to `true`.
   *
   * When using `normal`, the differ will compare the items in the same index one by one.
   * The time complexity is faster (`O(LEN)`). The output will be:
   *
   * ```diff
   *   a b
   * * 1 2
   * * 2 3
   * * 3 1
   * +   4
   * +   0
   * ```
   *
   * When using `lcs`, the differ will perform the LCS (Longest Common Subsequence) algorithm,
   * assuming the items in the subsequence are unchanged. The time complexity for LCS is
   * slower (`O(LEN^2)`). The output will be:
   *
   * ```diff
   *   a b
   * - 1
   *   2 2
   *   3 3
   * +   1
   * +   4
   * +   0
   * ```
   *
   * When using `unorder-normal`, the differ will first sort 2 arrays, then act like `normal`.
   * The output will be:
   *
   * ```diff
   *   a b
   * * 1 0
   * * 2 1
   * * 3 2
   * * 4 3
   * +   4
   * ```
   *
   * When using `unorder-lcs`, the differ will first sort 2 arrays, then act like `lcs`.
   * The output will be:
   *
   * ```diff
   *   a b
   * +   0
   *   1 1
   *   2 2
   *   3 3
   * +   4
   * ```
   *
   * When using `compare-key`, the differ will match objects in arrays by a specific key
   * property (specified by `compareKey` option). This is useful when comparing arrays of
   * objects where the order doesn't matter but you want to match related objects.
   * The output will be:
   *
   * ```diff
   *   a b
   *   1 1
   * - 2
   * +   3
   *   4 4
   * ```
   */
  arrayDiffMethod?:
    | 'normal'
    | 'lcs'
    | 'unorder-normal'
    | 'unorder-lcs'
    | 'compare-key';
  /**
   * Whether to ignore the case when comparing strings, default `false`.
   */
  ignoreCase?: boolean;
  /**
   * Whether to ignore the case when comparing keys, default `false`.
   *
   * Notice: if there are keys with different cases in the same object, the algorithm may fail
   * since it's not able to tell which key is the correct one.
   */
  ignoreCaseForKey?: boolean;
  /**
   * Whether to use recursive equal to compare objects, default `false`.
   *
   * This will only applied to objects, not arrays.
   *
   * Two objects are considered equal if they have the same properties and values, for example:
   *
   * ```js
   * const x = { 'a': 1, 'b': 2 };
   * const y = { 'b': 2, 'a': 1 };
   * ```
   *
   * The `x` and `y` here will be considered equal.
   *
   * This comparation process is slow in huge objects.
  */
  recursiveEqual?: boolean;
  /**
   * If the value is set, differ will make sure the key order of results is the same as inputs
   * ("before" or "after"). Otherwise, differ will sort the keys of results.
   */
  preserveKeyOrder?: 'before' | 'after';
  /**
   * The key to use for matching objects in arrays when using `compare-key` array diff method.
   * Objects with the same value for this key will be matched and compared, regardless of their
   * position in the array.
   */
  compareKey?: string;
  /**
   * Optional identity selectors for arrays of objects. When the path of an array
   * matches a selector, elements are matched by a stable identity (computed from
   * the configured fields) instead of by position, so moves are detected and
   * matched elements are diffed recursively against each other.
   *
   * Paths are JSON Pointer style: `''` (or `'/'`) is the root, segments are object
   * keys, and `*` matches exactly one array index, e.g.:
   *
   * ```js
   * const differ = new Differ({
   *   arrayIdentitySelectors: [
   *     { path: '/items', fields: ['id'] },
   *     { path: '/items/*\/children', fields: ['name', 'version'] },
   *   ],
   * });
   * ```
   *
   * When no selector is configured (or none matches an array), the output is
   * identical to the previous behaviour.
   */
  arrayIdentitySelectors?: ArrayIdentitySelector[];
  /**
   * Called when an identity-related diagnostic is produced, e.g. when duplicate
   * identities are found in the same array (in which case the differ falls back
   * to the configured `arrayDiffMethod` for that array instead of silently
   * overwriting earlier occurrences).
   */
  onIdentityDiagnostic?: (diagnostic: IdentityDiagnostic) => void;
  /**
   * The behavior when encountering values that are not part of the JSON spec, e.g. `undefined`, `NaN`, `Infinity`, `123n`, `() => alert(1)`, `Symbol.iterator`.
   *
   * - `UndefinedBehavior.throw`: throw an error
   * - `UndefinedBehavior.ignore`: ignore the key-value pair
   * - `UndefinedBehavior.stringify`: try to stringify the value
   *
   * Default is `UndefinedBehavior.stringify`.
   */
  undefinedBehavior?: UndefinedBehavior;
}

export interface ArrayIdentitySelector {
  /**
   * JSON Pointer style path of the array this selector applies to.
   * `''` or `'/'` means the root array; `*` matches exactly one array index.
   */
  path: string;
  /**
   * Fields composing the identity of each element. Each field is a JSON Pointer
   * relative to the element (e.g. `'/meta/id'`); a bare word (e.g. `'id'`) is
   * treated as a single key. Multiple fields form a composite identity.
   */
  fields: string[];
}

export interface IdentityDiagnostic {
  type: 'ambiguous-identity';
  /** Path of the array where the diagnostic was produced. */
  path: string;
  /** Path of the selector that was applied. */
  selector: string;
  /** The duplicated normalized identities. */
  identities: string[];
  message: string;
}

/**
 * Metadata attached to lines that belong to an identity-matched array element.
 */
export interface IdentityMatchInfo {
  /** The normalized identity that matched. */
  identity: string;
  /** The selector path that produced this match. */
  selector: string;
  /** Index of the element in the left (before) array. */
  oldIndex: number;
  /** Index of the element in the right (after) array. */
  newIndex: number;
  /** Whether the element changed its relative position. */
  moved: boolean;
  /** Whether the element content was modified. */
  modified: boolean;
}

export enum UndefinedBehavior {
  stringify = 'stringify',
  ignore = 'ignore',
  throw = 'throw',
}

export interface DiffResult {
  level: number;
  type: 'modify' | 'add' | 'remove' | 'equal';
  text: string;
  comma?: boolean;
  lineNumber?: number;
  /**
   * Present when this line belongs to an array element matched by an
   * `arrayIdentitySelectors` entry. Pure moves have `moved: true` and
   * `modified: false`, so viewers can render them differently from edits.
   */
  identity?: IdentityMatchInfo;
}

export type ArrayDiffFunc = (
  arrLeft: any[],
  arrRight: any[],
  keyLeft: string,
  keyRight: string,
  level: number,
  options: DifferOptions,
  ...args: any[]
) => [DiffResult[], DiffResult[]];

const EQUAL_EMPTY_LINE: DiffResult = { level: 0, type: 'equal', text: '' };
const EQUAL_LEFT_BRACKET_LINE: DiffResult = { level: 0, type: 'equal', text: '{' };
const EQUAL_RIGHT_BRACKET_LINE: DiffResult = { level: 0, type: 'equal', text: '}' };

class Differ {
  private options: DifferOptions;
  private arrayDiffFunc: ArrayDiffFunc;
  /** Diagnostics produced by identity matching during the last `diff` call. */
  public identityDiagnostics: IdentityDiagnostic[] = [];

  constructor({
    detectCircular = true,
    maxDepth = Infinity,
    showModifications = true,
    arrayDiffMethod = 'normal',
    ignoreCase = false,
    ignoreCaseForKey = false,
    recursiveEqual = false,
    preserveKeyOrder,
    compareKey,
    arrayIdentitySelectors,
    onIdentityDiagnostic,
    undefinedBehavior = UndefinedBehavior.stringify,
  }: DifferOptions = {}) {
    this.options = {
      detectCircular,
      maxDepth,
      showModifications,
      arrayDiffMethod,
      ignoreCase,
      ignoreCaseForKey,
      recursiveEqual,
      preserveKeyOrder,
      compareKey,
      arrayIdentitySelectors,
      undefinedBehavior,
    };

    if (arrayIdentitySelectors?.length) {
      this.arrayDiffFunc = diffArrayIdentity;
      this.options.onIdentityDiagnostic = diagnostic => {
        this.identityDiagnostics.push(diagnostic);
        onIdentityDiagnostic?.(diagnostic);
      };
    } else if (arrayDiffMethod === 'compare-key') {
      this.arrayDiffFunc = diffArrayCompareKey;
    } else if (arrayDiffMethod === 'lcs' || arrayDiffMethod === 'unorder-lcs') {
      this.arrayDiffFunc = diffArrayLCS;
    } else {
      this.arrayDiffFunc = diffArrayNormal;
    }
  }

  private detectCircular(source: any) {
    if (this.options.detectCircular) {
      if (detectCircular(source)) {
        throw new Error(
          `Circular reference detected in object (with keys ${Object.keys(source).map(t => `"${t}"`).join(', ')})`,
        );
      }
    }
  }

  private sortResultLines(left: DiffResult[], right: DiffResult[]) {
    for (let k = 0; k < left.length; k++) {
      let changed = false;
      for (let i = 1; i < left.length; i++) {
        if (
          left[i].type === 'remove' &&
          left[i - 1].type === 'equal' &&
          right[i].type === 'equal' &&
          right[i - 1].type === 'add'
        ) {
          const t1 = left[i - 1];
          left[i - 1] = left[i];
          left[i] = t1;
          const t2 = right[i - 1];
          right[i - 1] = right[i];
          right[i] = t2;
          changed = true;
        }
      }
      if (!changed) {
        break;
      }
    }
  }

  private calculateLineNumbers(result: DiffResult[]) {
    let lineNumber = 0;
    for (const item of result) {
      if (!item.text) {
        continue;
      }
      item.lineNumber = ++lineNumber;
    }
  }

  private calculateCommas(result: DiffResult[]) {
    const nextLine = Array(result.length).fill(0);
    for (let i = result.length - 1; i > 0; i--) {
      if (result[i].text) {
        nextLine[i - 1] = i;
      } else {
        nextLine[i - 1] = nextLine[i];
      }
    }

    for (let i = 0; i < result.length; i++) {
      if (
        !result[i].text.endsWith('{') &&
        !result[i].text.endsWith('[') &&
        result[i].text &&
        nextLine[i] &&
        result[i].level <= result[nextLine[i]].level
      ) {
        result[i].comma = true;
      }
    }
  }

  diff(sourceLeft: any, sourceRight: any) {
    this.identityDiagnostics = [];
    this.detectCircular(sourceLeft);
    this.detectCircular(sourceRight);

    if (
      this.options.arrayDiffMethod === 'unorder-normal' ||
      this.options.arrayDiffMethod === 'unorder-lcs'
    ) {
      sourceLeft = sortInnerArrays(sourceLeft, this.options);
      sourceRight = sortInnerArrays(sourceRight, this.options);
    }

    if (this.options.undefinedBehavior === UndefinedBehavior.ignore) {
      sourceLeft = cleanFields(sourceLeft) ?? null;
      sourceRight = cleanFields(sourceRight) ?? null;
    }

    let resultLeft: DiffResult[] = [];
    let resultRight: DiffResult[] = [];

    const typeLeft = getType(sourceLeft);
    const typeRight = getType(sourceRight);
    if (typeLeft !== typeRight) {
      const strLeft = stringify(sourceLeft, undefined, 1, this.options.maxDepth, this.options.undefinedBehavior);
      resultLeft = strLeft.split('\n').map(line => ({
        level: line.match(/^\s+/)?.[0]?.length || 0,
        type: 'remove',
        text: line.replace(/^\s+/, '').replace(/,$/g, ''),
        comma: line.endsWith(','),
      }));
      const strRight = stringify(sourceRight, undefined, 1, this.options.maxDepth, this.options.undefinedBehavior);
      resultRight = strRight.split('\n').map(line => ({
        level: line.match(/^\s+/)?.[0]?.length || 0,
        type: 'add',
        text: line.replace(/^\s+/, '').replace(/,$/g, ''),
        comma: line.endsWith(','),
      }));
      const lLength = resultLeft.length;
      const rLength = resultRight.length;
      resultLeft = concat(resultLeft, Array(rLength).fill(0).map(() => ({ ...EQUAL_EMPTY_LINE })));
      resultRight = concat(resultRight, Array(lLength).fill(0).map(() => ({ ...EQUAL_EMPTY_LINE })), true);
    } else if (typeLeft === 'object') {
      [resultLeft, resultRight] = diffObject(sourceLeft, sourceRight, 1, this.options, this.arrayDiffFunc);
      resultLeft.unshift({ ...EQUAL_LEFT_BRACKET_LINE });
      resultLeft.push({ ...EQUAL_RIGHT_BRACKET_LINE });
      resultRight.unshift({ ...EQUAL_LEFT_BRACKET_LINE });
      resultRight.push({ ...EQUAL_RIGHT_BRACKET_LINE });
    } else if (typeLeft === 'array') {
      [resultLeft, resultRight] = this.arrayDiffFunc(sourceLeft, sourceRight, '', '', 0, this.options);
    } else if (sourceLeft !== sourceRight) {
      if (this.options.ignoreCase) {
        if (
          typeof sourceLeft === 'string' &&
          typeof sourceRight === 'string' &&
          sourceLeft.toLowerCase() === sourceRight.toLowerCase()
        ) {
          resultLeft = [{ level: 0, type: 'equal', text: sourceLeft }];
          resultRight = [{ level: 0, type: 'equal', text: sourceRight }];
        }
      } else if (this.options.showModifications) {
        resultLeft = [{
          level: 0,
          type: 'modify',
          text: stringify(sourceLeft, undefined, undefined, this.options.maxDepth, this.options.undefinedBehavior),
        }];
        resultRight = [{
          level: 0,
          type: 'modify',
          text: stringify(sourceRight, undefined, undefined, this.options.maxDepth, this.options.undefinedBehavior),
        }];
      } else {
        resultLeft = [
          {
            level: 0,
            type: 'remove',
            text: stringify(sourceLeft, undefined, undefined, this.options.maxDepth, this.options.undefinedBehavior),
          },
          { ...EQUAL_EMPTY_LINE },
        ];
        resultRight = [
          { ...EQUAL_EMPTY_LINE },
          {
            level: 0,
            type: 'add',
            text: stringify(sourceRight, undefined, undefined, this.options.maxDepth, this.options.undefinedBehavior),
          },
        ];
      }
    } else {
      resultLeft = [{
        level: 0,
        type: 'equal',
        text: stringify(sourceLeft, undefined, undefined, this.options.maxDepth, this.options.undefinedBehavior),
      }];
      resultRight = [{
        level: 0,
        type: 'equal',
        text: stringify(sourceRight, undefined, undefined, this.options.maxDepth, this.options.undefinedBehavior),
      }];
    }

    this.sortResultLines(resultLeft, resultRight);

    this.calculateLineNumbers(resultLeft);
    this.calculateLineNumbers(resultRight);

    this.calculateCommas(resultLeft);
    this.calculateCommas(resultRight);

    return [resultLeft, resultRight] as const;
  }
}

export default Differ;
