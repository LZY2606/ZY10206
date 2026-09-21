import cleanFields from './utils/clean-fields';
import concat from './utils/concat';
import detectCircular from './utils/detect-circular';
import diffArrayLCS from './utils/diff-array-lcs';
import diffArrayNormal from './utils/diff-array-normal';
import diffArrayCompareKey from './utils/diff-array-compare-key';
import diffObject from './utils/diff-object';
import getType from './utils/get-type';
import sortInnerArrays from './utils/sort-inner-arrays';
import stringify from './utils/stringify';
import { compileSelectors, type ArrayIdentitySelectorConfig, type CompiledSelector } from './utils/identity/selector';
import { createIdentityRunContext, type DiffResultIdentity, type IdentityDiagnostic } from './utils/identity/types';
import type { Path } from './utils/identity/json-pointer';
import { findSelector } from './utils/identity/selector';
import diffArrayIdentity from './utils/identity/diff-array-identity';

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
   * The behavior when encountering values that are not part of the JSON spec, e.g. `undefined`, `NaN`, `Infinity`, `123n`, `() => alert(1)`, `Symbol.iterator`.
   *
   * - `UndefinedBehavior.throw`: throw an error
   * - `UndefinedBehavior.ignore`: ignore the key-value pair
   * - `UndefinedBehavior.stringify`: try to stringify the value
   *
   * Default is `UndefinedBehavior.stringify`.
   */
  undefinedBehavior?: UndefinedBehavior;
  /**
   * Optional identity selectors for object arrays. Each selector points at an
   * array via a JSON Pointer style path and declares one or more existing
   * fields of an element that form its identity. Elements sharing an identity
   * are recursively compared even when they move; unmatched elements are still
   * handled by the configured `arrayDiffMethod`.
   *
   * When omitted, the output is byte-for-byte compatible with older versions.
   */
  arrayIdentitySelectors?: ArrayIdentitySelectorConfig[];
  /** @internal compiled identity selectors, populated by the Differ. */
  _identitySelectors?: CompiledSelector[];
  /** @internal per-diff run context carrying diagnostics and entity ids. */
  _identity?: {
    diagnostics: IdentityDiagnostic[];
    nextEntityId: number;
  };
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
   * Present only when this line belongs to an object-array element aligned by
   * a configured identity selector.
   */
  identity?: DiffResultIdentity;
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

/**
 * Signature of the array diff functions that thread the concrete runtime
 * paths and their own recursion entry, used by the identity-aware internals.
 */
export type PathAwareArrayDiffFunc = (
  arrLeft: any[],
  arrRight: any[],
  keyLeft: string,
  keyRight: string,
  level: number,
  options: DifferOptions,
  linesLeft?: DiffResult[],
  linesRight?: DiffResult[],
  recurse?: PathAwareArrayDiffFunc,
  pathLeft?: Path,
  pathRight?: Path,
) => [DiffResult[], DiffResult[]];

const EQUAL_EMPTY_LINE: DiffResult = { level: 0, type: 'equal', text: '' };
const EQUAL_LEFT_BRACKET_LINE: DiffResult = { level: 0, type: 'equal', text: '{' };
const EQUAL_RIGHT_BRACKET_LINE: DiffResult = { level: 0, type: 'equal', text: '}' };

class Differ {
  private options: DifferOptions;
  private arrayDiffFunc: ArrayDiffFunc;

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
    undefinedBehavior = UndefinedBehavior.stringify,
    arrayIdentitySelectors,
  }: DifferOptions = {}) {
    const _identitySelectors = compileSelectors(arrayIdentitySelectors);
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
      undefinedBehavior,
      arrayIdentitySelectors,
      _identitySelectors,
    };

    if (arrayDiffMethod === 'compare-key') {
      this.arrayDiffFunc = this.makeIdentityDispatcher(diffArrayCompareKey);
    } else if (arrayDiffMethod === 'lcs' || arrayDiffMethod === 'unorder-lcs') {
      this.arrayDiffFunc = this.makeIdentityDispatcher(diffArrayLCS);
    } else {
      this.arrayDiffFunc = this.makeIdentityDispatcher(diffArrayNormal);
    }
  }

  /**
   * Wrap a base array diff function so that arrays with a configured identity
   * selector are identity-matched first, while everything else (and all
   * unmatched fallback runs) keeps using the base strategy unchanged.
   */
  private makeIdentityDispatcher(base: PathAwareArrayDiffFunc): ArrayDiffFunc {
    const dispatcher: PathAwareArrayDiffFunc = (
      arrLeft,
      arrRight,
      keyLeft,
      keyRight,
      level,
      options,
      linesLeft = [],
      linesRight = [],
      recurse?: PathAwareArrayDiffFunc,
      pathLeft: Path = [],
      pathRight: Path = [],
    ) => {
      const recursion = recurse || dispatcher;
      const selectors = options._identitySelectors;
      const selector = selectors && selectors.length
        ? findSelector(selectors, pathLeft) || findSelector(selectors, pathRight)
        : undefined;
      if (selector) {
        return diffArrayIdentity(
          arrLeft,
          arrRight,
          keyLeft,
          keyRight,
          level,
          options,
          linesLeft,
          linesRight,
          recursion,
          pathLeft,
          pathRight,
          selector,
          base,
        );
      }
      return base(
        arrLeft,
        arrRight,
        keyLeft,
        keyRight,
        level,
        options,
        linesLeft,
        linesRight,
        recursion,
        pathLeft,
        pathRight,
      );
    };
    // Without any configured selector the dispatcher would behave identically
    // to the base function; skip the wrapper to guarantee output compatibility.
    if (!this.options._identitySelectors?.length) {
      return base as ArrayDiffFunc;
    }
    return dispatcher as ArrayDiffFunc;
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

  /**
   * Compute the diff, returning `[beforeLines, afterLines]`.
   *
   * The runtime array additionally carries identity diagnostics as its 3rd
   * element, but the public type stays a 2-tuple so existing consumers (and
   * the `Viewer` prop type) remain fully compatible. Use
   * {@link Differ.diffWithDiagnostics} for the typed 3-tuple.
   */
  diff(sourceLeft: any, sourceRight: any): readonly [DiffResult[], DiffResult[]] {
    const [left, right] = this.diffWithDiagnostics(sourceLeft, sourceRight);
    return [left, right];
  }

  /**
   * Compute the diff and return `[beforeLines, afterLines, diagnostics]`.
   * The diagnostics array describes ambiguous or illegal element identities
   * encountered by the configured identity selectors; it is empty when no
   * selectors are configured.
   */
  diffWithDiagnostics(
    sourceLeft: any,
    sourceRight: any,
  ): readonly [DiffResult[], DiffResult[], IdentityDiagnostic[]] {
    this.detectCircular(sourceLeft);
    this.detectCircular(sourceRight);

    const identityRun = this.options._identitySelectors?.length
      ? createIdentityRunContext()
      : undefined;
    const options: DifferOptions = identityRun
      ? { ...this.options, _identity: identityRun }
      : this.options;

    if (
      this.options.arrayDiffMethod === 'unorder-normal' ||
      this.options.arrayDiffMethod === 'unorder-lcs'
    ) {
      sourceLeft = sortInnerArrays(sourceLeft, options);
      sourceRight = sortInnerArrays(sourceRight, options);
    }

    if (options.undefinedBehavior === UndefinedBehavior.ignore) {
      sourceLeft = cleanFields(sourceLeft) ?? null;
      sourceRight = cleanFields(sourceRight) ?? null;
    }

    let resultLeft: DiffResult[] = [];
    let resultRight: DiffResult[] = [];

    const typeLeft = getType(sourceLeft);
    const typeRight = getType(sourceRight);
    if (typeLeft !== typeRight) {
      const strLeft = stringify(sourceLeft, undefined, 1, options.maxDepth, options.undefinedBehavior);
      resultLeft = strLeft.split('\n').map(line => ({
        level: line.match(/^\s+/)?.[0]?.length || 0,
        type: 'remove',
        text: line.replace(/^\s+/, '').replace(/,$/g, ''),
        comma: line.endsWith(','),
      }));
      const strRight = stringify(sourceRight, undefined, 1, options.maxDepth, options.undefinedBehavior);
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
      [resultLeft, resultRight] = diffObject(sourceLeft, sourceRight, 1, options, this.arrayDiffFunc, [], []);
      resultLeft.unshift({ ...EQUAL_LEFT_BRACKET_LINE });
      resultLeft.push({ ...EQUAL_RIGHT_BRACKET_LINE });
      resultRight.unshift({ ...EQUAL_LEFT_BRACKET_LINE });
      resultRight.push({ ...EQUAL_RIGHT_BRACKET_LINE });
    } else if (typeLeft === 'array') {
      [resultLeft, resultRight] = this.arrayDiffFunc(
        sourceLeft,
        sourceRight,
        '',
        '',
        0,
        options,
        [],
        [],
        this.arrayDiffFunc as PathAwareArrayDiffFunc,
        [],
        [],
      );
    } else if (sourceLeft !== sourceRight) {
      if (options.ignoreCase) {
        if (
          typeof sourceLeft === 'string' &&
          typeof sourceRight === 'string' &&
          sourceLeft.toLowerCase() === sourceRight.toLowerCase()
        ) {
          resultLeft = [{ level: 0, type: 'equal', text: sourceLeft }];
          resultRight = [{ level: 0, type: 'equal', text: sourceRight }];
        }
      } else if (options.showModifications) {
        resultLeft = [{
          level: 0,
          type: 'modify',
          text: stringify(sourceLeft, undefined, undefined, options.maxDepth, options.undefinedBehavior),
        }];
        resultRight = [{
          level: 0,
          type: 'modify',
          text: stringify(sourceRight, undefined, undefined, options.maxDepth, options.undefinedBehavior),
        }];
      } else {
        resultLeft = [
          {
            level: 0,
            type: 'remove',
            text: stringify(sourceLeft, undefined, undefined, options.maxDepth, options.undefinedBehavior),
          },
          { ...EQUAL_EMPTY_LINE },
        ];
        resultRight = [
          { ...EQUAL_EMPTY_LINE },
          {
            level: 0,
            type: 'add',
            text: stringify(sourceRight, undefined, undefined, options.maxDepth, options.undefinedBehavior),
          },
        ];
      }
    } else {
      resultLeft = [{
        level: 0,
        type: 'equal',
        text: stringify(sourceLeft, undefined, undefined, options.maxDepth, options.undefinedBehavior),
      }];
      resultRight = [{
        level: 0,
        type: 'equal',
        text: stringify(sourceRight, undefined, undefined, options.maxDepth, options.undefinedBehavior),
      }];
    }

    this.sortResultLines(resultLeft, resultRight);

    this.calculateLineNumbers(resultLeft);
    this.calculateLineNumbers(resultRight);

    this.calculateCommas(resultLeft);
    this.calculateCommas(resultRight);

    return [resultLeft, resultRight, identityRun?.diagnostics || []] as const;
  }
}

export default Differ;
