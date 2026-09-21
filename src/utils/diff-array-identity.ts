import type { ArrayDiffFunc, DiffResult, DifferOptions, IdentityMatchInfo } from '../differ';
import concat from './concat';
import diffArrayCompareKey from './diff-array-compare-key';
import diffArrayLCS from './diff-array-lcs';
import diffArrayNormal from './diff-array-normal';
import diffObject from './diff-object';
import getType from './get-type';
import { computeIdentity, findIdentitySelector, joinPath } from './identity-selector';
import { addArrayClosingBrackets, addArrayOpeningBrackets, addMaxDepthPlaceholder } from './array-bracket-utils';

/**
 * The array diff function for the configured `arrayDiffMethod`, without identity matching.
 */
const getBaseArrayDiffFunc = (options: DifferOptions): ArrayDiffFunc => {
  if (options.arrayDiffMethod === 'compare-key') {
    return diffArrayCompareKey;
  }
  if (options.arrayDiffMethod === 'lcs' || options.arrayDiffMethod === 'unorder-lcs') {
    return diffArrayLCS;
  }
  return diffArrayNormal;
};

/**
 * Returns the identity-aware dispatcher when identity selectors are configured,
 * otherwise `null` (so callers can keep their existing recursion behaviour).
 */
export const getIdentityAwareArrayDiffFunc = (options: DifferOptions): ArrayDiffFunc | null =>
  options.arrayIdentitySelectors?.length ? diffArrayIdentity : null;

/**
 * Boolean mask marking the longest increasing subsequence of `seq`.
 * Used to tell "in place" matches from "moved" matches.
 */
export const lisMask = (seq: number[]): boolean[] => {
  const n = seq.length;
  const mask = new Array(n).fill(false);
  if (!n) {
    return mask;
  }
  const dp = new Array(n).fill(1);
  const prev = new Array(n).fill(-1);
  let best = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (seq[j] < seq[i] && dp[j] + 1 > dp[i]) {
        dp[i] = dp[j] + 1;
        prev[i] = j;
      }
    }
    if (dp[i] > dp[best]) {
      best = i;
    }
  }
  for (let k = best; k !== -1; k = prev[k]) {
    mask[k] = true;
  }
  return mask;
};

interface IdentityIndex {
  map: Map<string, number>;
  duplicates: string[];
}

const buildIdentityIndex = (arr: any[], selectorFields: string[]): IdentityIndex => {
  const map = new Map<string, number>();
  const duplicates: string[] = [];
  const selector = { path: '', fields: selectorFields };
  for (let i = 0; i < arr.length; i++) {
    const identity = computeIdentity(arr[i], selector);
    if (map.has(identity)) {
      // never overwrite the first occurrence; record the ambiguity instead
      if (!duplicates.includes(identity)) {
        duplicates.push(identity);
      }
    } else {
      map.set(identity, i);
    }
  }
  return { map, duplicates };
};

const diffArrayIdentity: ArrayDiffFunc = (
  arrLeft: any[],
  arrRight: any[],
  keyLeft: string,
  keyRight: string,
  level: number,
  options: DifferOptions,
  linesLeft: DiffResult[] = [],
  linesRight: DiffResult[] = [],
  path: string = '',
): [DiffResult[], DiffResult[]] => {
  const selector = findIdentitySelector(options.arrayIdentitySelectors, path);
  const isObjectArray = (arr: any[]) => arr.every(item => getType(item) === 'object');

  if (!selector || !isObjectArray(arrLeft) || !isObjectArray(arrRight)) {
    return getBaseArrayDiffFunc(options)(
      arrLeft, arrRight, keyLeft, keyRight, level, options, linesLeft, linesRight, path,
    );
  }

  const leftIndex = buildIdentityIndex(arrLeft, selector.fields);
  const rightIndex = buildIdentityIndex(arrRight, selector.fields);

  if (leftIndex.duplicates.length || rightIndex.duplicates.length) {
    // Ambiguous identities: never silently keep the last occurrence.
    // Emit a diagnostic and fall back to the unambiguous base strategy.
    const duplicated = [...leftIndex.duplicates, ...rightIndex.duplicates];
    options.onIdentityDiagnostic?.({
      type: 'ambiguous-identity',
      path,
      selector: selector.path,
      identities: duplicated,
      message:
        `Ambiguous identity at "${path || '/'}" (selector "${selector.path}"): ` +
        `duplicate identities ${duplicated.map(t => JSON.stringify(t)).join(', ')}; ` +
        'falling back to the configured array diff method.',
    });
    return getBaseArrayDiffFunc(options)(
      arrLeft, arrRight, keyLeft, keyRight, level, options, linesLeft, linesRight, path,
    );
  }

  addArrayOpeningBrackets(linesLeft, linesRight, keyLeft, keyRight, level);

  if (level >= (options.maxDepth || Infinity)) {
    addMaxDepthPlaceholder(linesLeft, linesRight, level);
    addArrayClosingBrackets(linesLeft, linesRight, level);
    return [linesLeft, linesRight];
  }

  // Match elements with the same identity (both maps hold unique identities here).
  const pairs: Array<{ leftIndex: number; rightIndex: number; identity: string }> = [];
  leftIndex.map.forEach((i, identity) => {
    const j = rightIndex.map.get(identity);
    if (j !== undefined) {
      pairs.push({ leftIndex: i, rightIndex: j, identity });
    }
  });
  const matchedLeft = new Set(pairs.map(p => p.leftIndex));
  const matchedRight = new Set(pairs.map(p => p.rightIndex));
  const inPlace = lisMask(pairs.map(p => p.rightIndex));
  const pairByLeft = new Map(pairs.map((p, k) => [p.leftIndex, { ...p, moved: !inPlace[k] }]));

  const unmatchedLeft = arrLeft.filter((_, i) => !matchedLeft.has(i));
  const unmatchedRight = arrRight.filter((_, j) => !matchedRight.has(j));

  let fallbackEmitted = false;
  const emitUnmatchedFallback = () => {
    if (fallbackEmitted || (!unmatchedLeft.length && !unmatchedRight.length)) {
      return;
    }
    fallbackEmitted = true;
    // Hand the unmatched elements to the existing strategy (LCS / normal / compare-key).
    const [fallbackLeft, fallbackRight] = getBaseArrayDiffFunc(options)(
      unmatchedLeft, unmatchedRight, '', '', level, options, [], [], path,
    );
    // Strip the synthetic array brackets, keep the inner item lines.
    linesLeft = concat(linesLeft, fallbackLeft.slice(1, -1));
    linesRight = concat(linesRight, fallbackRight.slice(1, -1));
  };

  // Emit matched pairs in left (before) document order; the unmatched block is
  // emitted at the position of the first unmatched left element (or at the end).
  for (let i = 0; i < arrLeft.length; i++) {
    const pair = pairByLeft.get(i);
    if (!pair) {
      emitUnmatchedFallback();
      continue;
    }
    const blockLeft: DiffResult[] = [{ level: level + 1, type: 'equal', text: '{' }];
    const blockRight: DiffResult[] = [{ level: level + 1, type: 'equal', text: '{' }];
    const [objectLeft, objectRight] = diffObject(
      arrLeft[pair.leftIndex],
      arrRight[pair.rightIndex],
      level + 2,
      options,
      diffArrayIdentity,
      joinPath(path, String(pair.leftIndex)),
    );
    const closingLeft: DiffResult[] = [{ level: level + 1, type: 'equal', text: '}' }];
    const closingRight: DiffResult[] = [{ level: level + 1, type: 'equal', text: '}' }];
    const mergedLeft = concat(blockLeft, concat(objectLeft, closingLeft)) as DiffResult[];
    const mergedRight = concat(blockRight, concat(objectRight, closingRight)) as DiffResult[];
    const modified = [...mergedLeft, ...mergedRight].some(line => line.type !== 'equal');
    const info: IdentityMatchInfo = {
      identity: pair.identity,
      selector: selector.path,
      oldIndex: pair.leftIndex,
      newIndex: pair.rightIndex,
      moved: pair.moved,
      modified,
    };
    for (const line of [...mergedLeft, ...mergedRight]) {
      // nested identity matches keep their own (more specific) metadata
      if (!line.identity) {
        line.identity = info;
      }
    }
    linesLeft = concat(linesLeft, mergedLeft);
    linesRight = concat(linesRight, mergedRight);
  }
  emitUnmatchedFallback();

  addArrayClosingBrackets(linesLeft, linesRight, level);
  return [linesLeft, linesRight];
};

export default diffArrayIdentity;
