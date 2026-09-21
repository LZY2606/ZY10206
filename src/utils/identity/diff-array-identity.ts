import type { ArrayDiffFunc, DiffResult, DifferOptions } from '../../differ';

import diffObject from '../diff-object';
import getType from '../get-type';
import prettyAppendLines from '../pretty-append-lines';
import { addArrayClosingBrackets, addArrayOpeningBrackets, addMaxDepthPlaceholder } from '../array-bracket-utils';

import type { DiffResultIdentity, IdentityRunContext } from './types';
import type { CompiledSelector } from './selector';
import { formatPointer, type Path } from './json-pointer';
import { extractIdentity } from './normalize-identity';

interface IdentityPair {
  oldIndex: number;
  newIndex: number;
  identityKey: string;
  leftEntries: ReturnType<typeof extractIdentity>['entries'];
  rightEntries: ReturnType<typeof extractIdentity>['entries'];
}

const indexStep = (index: number): Path[number] => ({ kind: 'index', index });

const concatInto = (target: DiffResult[], source: DiffResult[]) => {
  for (const line of source) {
    target.push(line);
  }
};

const buildInvalidMessage = (
  arrayPath: string,
  index: number,
  identity: ReturnType<typeof extractIdentity>,
  side: 'before' | 'after',
) => {
  const reasons = identity.entries
    .map(entry => entry.reason)
    .filter(Boolean)
    .join('; ') || 'illegal identity value';
  return `Element at index ${index} of "${arrayPath}" (${side}) cannot be identity matched: ${reasons}.`;
};

/**
 * Diff an object array with an identity selector:
 *
 * 1. Extract normalized identities and pair elements sharing the same key.
 *    Ambiguous (duplicated) or illegal identities are diagnosed and routed to
 *    the regular fallback strategy.
 * 2. Recursively diff every pair, keeping the left side in original order; a
 *    moved-then-modified element therefore stays one linked entity instead of
 *    becoming a remove plus an add.
 * 3. Hand all unmatched element runs to the existing array diff strategy
 *    (normal / LCS / compare-key).
 */
const diffArrayIdentity = (
  arrLeft: any[],
  arrRight: any[],
  keyLeft: string,
  keyRight: string,
  level: number,
  options: DifferOptions,
  linesLeft: DiffResult[] = [],
  linesRight: DiffResult[] = [],
  recurse: ArrayDiffFunc,
  pathLeft: Path,
  pathRight: Path,
  selector: CompiledSelector,
  fallback: ArrayDiffFunc,
): [DiffResult[], DiffResult[]] => {
  addArrayOpeningBrackets(linesLeft, linesRight, keyLeft, keyRight, level);

  if (level >= (options.maxDepth || Infinity)) {
    addMaxDepthPlaceholder(linesLeft, linesRight, level);
    addArrayClosingBrackets(linesLeft, linesRight, level);
    return [linesLeft, linesRight];
  }

  type IdentityOptions = DifferOptions & { _identity?: IdentityRunContext };
  const context: IdentityRunContext | undefined = (options as IdentityOptions)._identity;

  const reportDiagnostic = (diagnostic: Parameters<IdentityRunContext['diagnostics']['push']>[0]) => {
    context?.diagnostics.push(diagnostic);
  };

  // Phase 1: extract identities.
  const leftIdentities = arrLeft.map(item => extractIdentity(item, selector));
  const rightIdentities = arrRight.map(item => extractIdentity(item, selector));

  leftIdentities.forEach((identity, index) => {
    if (identity.invalid) {
      reportDiagnostic({
        code: 'invalid-identity-value',
        arrayPath: selector.arrayPath,
        side: 'left',
        indices: [index],
        message: buildInvalidMessage(selector.arrayPath, index, identity, 'before'),
      });
    }
  });
  rightIdentities.forEach((identity, index) => {
    if (identity.invalid) {
      reportDiagnostic({
        code: 'invalid-identity-value',
        arrayPath: selector.arrayPath,
        side: 'right',
        indices: [index],
        message: buildInvalidMessage(selector.arrayPath, index, identity, 'after'),
      });
    }
  });

  const leftBuckets = new Map<string, number[]>();
  const rightBuckets = new Map<string, number[]>();
  leftIdentities.forEach((identity, index) => {
    if (identity.invalid || identity.key === undefined) {
      return;
    }
    const bucket = leftBuckets.get(identity.key) || [];
    bucket.push(index);
    leftBuckets.set(identity.key, bucket);
  });
  rightIdentities.forEach((identity, index) => {
    if (identity.invalid || identity.key === undefined) {
      return;
    }
    const bucket = rightBuckets.get(identity.key) || [];
    bucket.push(index);
    rightBuckets.set(identity.key, bucket);
  });

  const ambiguous = new Set<number>();
  const ambiguousRight = new Set<number>();
  const keys = new Set([...leftBuckets.keys(), ...rightBuckets.keys()]);
  for (const key of keys) {
    const leftBucket = leftBuckets.get(key) || [];
    const rightBucket = rightBuckets.get(key) || [];
    if (leftBucket.length > 1 || rightBucket.length > 1) {
      reportDiagnostic({
        code: 'duplicate-identity',
        arrayPath: selector.arrayPath,
        identityKey: key,
        side: leftBucket.length > 1 && rightBucket.length > 1
          ? 'both'
          : leftBucket.length > 1
            ? 'left'
            : 'right',
        indices: [...leftBucket, ...rightBucket],
        message: [
          `Ambiguous identity "${key}" in "${selector.arrayPath}"`,
          `(before indices: [${leftBucket.join(', ')}], after indices: [${rightBucket.join(', ')}]);`,
          'falling back to the regular array diff strategy for these elements.',
        ].join(' '),
      });
      if (selector.onDuplicate === 'throw') {
        throw new Error(`Duplicate identity "${key}" found in array "${selector.arrayPath}".`);
      }
      leftBucket.forEach(index => ambiguous.add(index));
      rightBucket.forEach(index => ambiguousRight.add(index));
    }
  }

  // Phase 2: build unique pairs, emitted in original (before) index order so
  // the left column stays monotonic and each entity stays a single block.
  const pairs: IdentityPair[] = [];
  const pairedLeft = new Set<number>();
  const pairedRight = new Set<number>();
  for (let i = 0; i < arrLeft.length; i++) {
    if (ambiguous.has(i)) {
      continue;
    }
    const identity = leftIdentities[i];
    if (identity.invalid || identity.key === undefined) {
      continue;
    }
    const rightBucket = rightBuckets.get(identity.key) || [];
    if (rightBucket.length === 1 && !ambiguousRight.has(rightBucket[0])) {
      const j = rightBucket[0];
      pairs.push({
        oldIndex: i,
        newIndex: j,
        identityKey: identity.key,
        leftEntries: identity.entries,
        rightEntries: rightIdentities[j].entries,
      });
      pairedLeft.add(i);
      pairedRight.add(j);
    }
  }
  pairs.sort((a, b) => a.oldIndex - b.oldIndex);

  const leftUnmatched = arrLeft.map((_, index) => index).filter(index => !pairedLeft.has(index));
  const rightUnmatched = arrRight.map((_, index) => index).filter(index => !pairedRight.has(index));

  // Recursion inside a fallback run must not re-enter identity matching for
  // this same array path; deeper arrays still go through the dispatcher.
  const fallbackRecurse: ArrayDiffFunc = (a, b, kL, kR, l, opts, ll = [], lr = [], _recurse, pL, pR) => {
    const isSamePath = !!pL && !!pR &&
      pL.length === pathLeft.length &&
      pR.length === pathRight.length &&
      formatPointer(pL) === formatPointer(pathLeft) &&
      formatPointer(pR) === formatPointer(pathRight);
    if (isSamePath) {
      return fallback(a, b, kL, kR, l, opts, ll, lr, recurse, pL, pR);
    }
    return recurse(a, b, kL, kR, l, opts, ll, lr, recurse, pL, pR);
  };

  const appendFallbackRun = (leftSlice: any[], rightSlice: any[]) => {
    if (!leftSlice.length && !rightSlice.length) {
      return;
    }
    let [runLeft, runRight] = fallbackRecurse(
      leftSlice,
      rightSlice,
      '',
      '',
      level,
      options,
      [],
      [],
      recurse,
      pathLeft,
      pathRight,
    );
    // Strip the outer brackets produced for the slice; the brackets of the
    // current identity-matched array were emitted above.
    runLeft = runLeft.slice(1, -1);
    runRight = runRight.slice(1, -1);
    linesLeft.push(...runLeft);
    linesRight.push(...runRight);
  };

  const appendPair = (pair: IdentityPair) => {
    const itemLeft = arrLeft[pair.oldIndex];
    const itemRight = arrRight[pair.newIndex];
    const pairPathLeft = [...pathLeft, indexStep(pair.oldIndex)];
    const pairPathRight = [...pathRight, indexStep(pair.newIndex)];

    const pairLinesLeft: DiffResult[] = [];
    const pairLinesRight: DiffResult[] = [];
    const leftType = getType(itemLeft);
    const rightType = getType(itemRight);

    if (leftType !== rightType) {
      prettyAppendLines(
        pairLinesLeft,
        pairLinesRight,
        '',
        '',
        itemLeft,
        itemRight,
        level + 1,
        options,
      );
    } else if (leftType === 'object') {
      pairLinesLeft.push({ level: level + 1, type: 'equal', text: '{' });
      pairLinesRight.push({ level: level + 1, type: 'equal', text: '{' });
      // diffObject threads object-key steps itself, so give it the path of the
      // containing array plus the element index as the object's own path.
      const [objLeft, objRight] = diffObject(
        itemLeft,
        itemRight,
        level + 2,
        options,
        recurse,
        pairPathLeft,
        pairPathRight,
      );
      concatInto(pairLinesLeft, objLeft);
      concatInto(pairLinesRight, objRight);
      pairLinesLeft.push({ level: level + 1, type: 'equal', text: '}' });
      pairLinesRight.push({ level: level + 1, type: 'equal', text: '}' });
    } else if (leftType === 'array') {
      const [arrLinesLeft, arrLinesRight] = recurse(
        itemLeft,
        itemRight,
        '',
        '',
        level + 1,
        options,
        [],
        [],
        recurse,
        pairPathLeft,
        pairPathRight,
      );
      concatInto(pairLinesLeft, arrLinesLeft);
      concatInto(pairLinesRight, arrLinesRight);
    } else {
      prettyAppendLines(
        pairLinesLeft,
        pairLinesRight,
        '',
        '',
        itemLeft,
        itemRight,
        level + 1,
        options,
      );
    }

    let modified = false;
    const lineCount = Math.max(pairLinesLeft.length, pairLinesRight.length);
    while (pairLinesLeft.length < lineCount) {
      pairLinesLeft.push({ level: level + 1, type: 'equal', text: '' });
    }
    while (pairLinesRight.length < lineCount) {
      pairLinesRight.push({ level: level + 1, type: 'equal', text: '' });
    }
    for (let k = 0; k < lineCount; k++) {
      const l = pairLinesLeft[k];
      const r = pairLinesRight[k];
      if (l.type !== 'equal' || r.type !== 'equal' || l.text !== r.text || l.level !== r.level) {
        modified = true;
        break;
      }
    }

    const entityId = context ? context.nextEntityId++ : 0;
    const identityMeta: DiffResultIdentity = {
      entityId,
      basis: 'identity',
      oldIndex: pair.oldIndex,
      newIndex: pair.newIndex,
      moved: pair.oldIndex !== pair.newIndex,
      modified,
      matchedBy: {
        arrayPath: selector.arrayPath,
        fields: selector.fields,
        identityKey: pair.identityKey,
      },
      identityEntries: {
        left: pair.leftEntries,
        right: pair.rightEntries,
      },
    };
    // Nested entities (e.g. an identity-matched array inside an identity-matched
    // object) already carry their own metadata; keep it and only annotate the
    // lines belonging to this entity itself.
    pairLinesLeft.forEach((line) => {
      if (!line.identity) {
        line.identity = identityMeta;
      }
    });
    pairLinesRight.forEach((line) => {
      if (!line.identity) {
        line.identity = identityMeta;
      }
    });

    linesLeft.push(...pairLinesLeft);
    linesRight.push(...pairLinesRight);
  };

  // Phase 3: emit pairs (before order) with unmatched runs interleaved.
  let leftCursor = 0;
  let rightCursor = 0;
  for (const pair of pairs) {
    const leftSliceIndices: number[] = [];
    const rightSliceIndices: number[] = [];
    while (leftCursor < leftUnmatched.length && leftUnmatched[leftCursor] < pair.oldIndex) {
      leftSliceIndices.push(leftUnmatched[leftCursor++]);
    }
    while (rightCursor < rightUnmatched.length && rightUnmatched[rightCursor] < pair.newIndex) {
      rightSliceIndices.push(rightUnmatched[rightCursor++]);
    }
    appendFallbackRun(
      leftSliceIndices.map(index => arrLeft[index]),
      rightSliceIndices.map(index => arrRight[index]),
    );
    appendPair(pair);
  }
  appendFallbackRun(
    leftUnmatched.slice(leftCursor).map(index => arrLeft[index]),
    rightUnmatched.slice(rightCursor).map(index => arrRight[index]),
  );

  addArrayClosingBrackets(linesLeft, linesRight, level);
  return [linesLeft, linesRight];
};

export default diffArrayIdentity;
