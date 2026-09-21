import Differ from './differ';
import type { DiffResult, IdentityDiagnostic } from './differ';
import getSegments from './utils/get-segments';

/** Compact, readable projection of diff lines so failures are easy to read. */
const describeLines = (lines: DiffResult[]) => lines.map(l => (
  `${l.type}:${l.text}` +
  (l.identity
    ? `(id=${l.identity.identity},${l.identity.oldIndex}->${l.identity.newIndex}` +
      `,moved=${l.identity.moved},mod=${l.identity.modified})`
    : '')
));

/** Asserts both sides have strictly increasing line numbers for non-empty lines. */
const expectMonotonicLineNumbers = (left: DiffResult[], right: DiffResult[]) => {
  expect(left.length).toBe(right.length);
  for (const [side, lines] of [['left', left], ['right', right]] as const) {
    const numbers = lines.filter(l => l.text).map(l => l.lineNumber);
    const sorted = [...numbers].sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(`${side} line numbers: ${numbers.join(',')}`).toBe(`${side} line numbers: ${sorted.join(',')}`);
    expect(new Set(numbers).size).toBe(numbers.length);
  }
};

const differWith = (selectors: Array<{ path: string; fields: string[] }>, extra: object = {}) =>
  new Differ({ arrayDiffMethod: 'lcs', arrayIdentitySelectors: selectors, ...extra });

describe('identity array diff: moves', () => {
  const before = {
    items: [
      { id: 'a', v: 1 },
      { id: 'b', v: 2 },
      { id: 'c', v: 3 },
    ],
  };

  it('detects a pure move without any add/remove lines', () => {
    const after = {
      items: [
        { id: 'b', v: 2 },
        { id: 'c', v: 3 },
        { id: 'a', v: 1 },
      ],
    };
    const [left, right] = differWith([{ path: '/items', fields: ['id'] }]).diff(before, after);
    expect(describeLines(left).filter(s => s.startsWith('add') || s.startsWith('remove'))).toEqual([]);
    expect(describeLines(right).filter(s => s.startsWith('add') || s.startsWith('remove'))).toEqual([]);
    // every element keeps one associated entity with its old & new indices
    const identities = left.filter(l => l.text === '{' && l.identity).map(l => l.identity!);
    expect(identities.map(i => [i.oldIndex, i.newIndex])).toEqual([[0, 2], [1, 0], [2, 1]]);
    expect(identities.some(i => i.moved)).toBe(true);
    expect(identities.every(i => !i.modified)).toBe(true);
    expectMonotonicLineNumbers(left, right);
  });

  it('produces a single associated entity for an element that is moved and modified', () => {
    const after = {
      items: [
        { id: 'c', v: 3 },
        { id: 'b', v: 20 },
        { id: 'a', v: 1 },
      ],
    };
    const [left, right] = differWith([{ path: '/items', fields: ['id'] }]).diff(before, after);
    // element "b" appears exactly once on each side (not remove + add)
    const leftB = left.filter(l => l.text === '"id": "b"');
    const rightB = right.filter(l => l.text === '"id": "b"');
    expect(leftB).toHaveLength(1);
    expect(rightB).toHaveLength(1);
    expect(leftB[0].type).toBe('equal');
    expect(leftB[0].identity).toMatchObject({ oldIndex: 1, newIndex: 1, moved: true, modified: true });
    // the inner modification is a modify line inside the same entity
    const modifyLeft = left.filter(l => l.type === 'modify');
    const modifyRight = right.filter(l => l.type === 'modify');
    expect(describeLines(modifyLeft)).toEqual(['modify:"v": 2(id=s:"b",1->1,moved=true,mod=true)']);
    expect(describeLines(modifyRight)).toEqual(['modify:"v": 20(id=s:"b",1->1,moved=true,mod=true)']);
    expect(describeLines(left).filter(s => s.startsWith('add') || s.startsWith('remove'))).toEqual([]);
    expectMonotonicLineNumbers(left, right);
  });

  it('handles consecutive moves and reversed arrays with monotonic line numbers', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `el-${i}`, v: i }));
    const reversed = [...many].reverse();
    const [left, right] = differWith([{ path: '/items', fields: ['id'] }])
      .diff({ items: many }, { items: reversed });
    expectMonotonicLineNumbers(left, right);
    // no content changed, so there must be no add/remove/modify lines at all
    const types = new Set([...left, ...right].map(l => l.type));
    expect([...types]).toEqual(['equal']);
    // at least 7 of 8 elements must be flagged as moved (LIS keeps one in place)
    const blocks = left.filter(l => l.text === '{' && l.identity).map(l => l.identity!);
    expect(blocks.filter(i => i.moved).length).toBeGreaterThanOrEqual(7);
  });
});

describe('identity array diff: unmatched elements', () => {
  it('hands unmatched elements to the configured fallback strategy', () => {
    const before = { items: [{ id: 'a', v: 1 }, { id: 'x', v: 1 }] };
    const after = { items: [{ id: 'y', v: 2 }, { id: 'a', v: 1 }] };
    const [left, right] = differWith([{ path: '/items', fields: ['id'] }]).diff(before, after);
    // "a" is matched by identity
    const a = left.find(l => l.text === '"id": "a"');
    expect(a?.identity).toMatchObject({ oldIndex: 0, newIndex: 1 });
    // unmatched "x"/"y" go through the LCS fallback: paired as modifications,
    // not as identity matches
    const xLine = left.find(l => l.text === '"id": "x"');
    const yLine = right.find(l => l.text === '"id": "y"');
    expect(xLine?.identity).toBeUndefined();
    expect(yLine?.identity).toBeUndefined();
    expect(xLine?.type).toBe('modify');
    expect(yLine?.type).toBe('modify');
    expectMonotonicLineNumbers(left, right);
  });

  it('reports pure additions and removals for elements without a counterpart', () => {
    const before = { items: [{ id: 'a', v: 1 }, { id: 'b', v: 2 }] };
    const after = { items: [{ id: 'a', v: 1 }] };
    const [left, right] = differWith([{ path: '/items', fields: ['id'] }]).diff(before, after);
    expect(describeLines(left)).toContain('remove:"id": "b"');
    expect(describeLines(right).filter(s => s.startsWith('add'))).toEqual([]);
    expectMonotonicLineNumbers(left, right);
  });
});

describe('identity array diff: ambiguity', () => {
  it('does not let the last duplicate win; emits a diagnostic and falls back', () => {
    const diagnostics: IdentityDiagnostic[] = [];
    const before = { items: [{ id: 'a', v: 1 }, { id: 'a', v: 2 }] };
    const after = { items: [{ id: 'a', v: 3 }] };
    const withSelectors = new Differ({
      arrayDiffMethod: 'lcs',
      arrayIdentitySelectors: [{ path: '/items', fields: ['id'] }],
      onIdentityDiagnostic: d => diagnostics.push(d),
    });
    const [left, right] = withSelectors.diff(before, after);
    // diagnostic is emitted (via callback and on the instance)
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].type).toBe('ambiguous-identity');
    expect(diagnostics[0].path).toBe('/items');
    expect(withSelectors.identityDiagnostics).toEqual(diagnostics);
    // output falls back to the plain strategy: no identity metadata at all
    expect([...left, ...right].some(l => l.identity)).toBe(false);
    // and it is identical to the output without selectors
    const [baseLeft, baseRight] = new Differ({ arrayDiffMethod: 'lcs' }).diff(before, after);
    expect(describeLines(left)).toEqual(describeLines(baseLeft));
    expect(describeLines(right)).toEqual(describeLines(baseRight));
    expectMonotonicLineNumbers(left, right);
  });
});

describe('identity array diff: nesting and wildcards', () => {
  it('matches nested object arrays via wildcard paths', () => {
    const before = {
      groups: [
        { id: 'g1', children: [{ cid: 1 }, { cid: 2 }] },
      ],
    };
    const after = {
      groups: [
        { id: 'g1', children: [{ cid: 2 }, { cid: 1 }] },
      ],
    };
    const [left, right] = differWith([
      { path: '/groups', fields: ['id'] },
      { path: '/groups/*/children', fields: ['cid'] },
    ]).diff(before, after);
    const childBlocks = left.filter(l => l.identity?.selector === '/groups/*/children' && l.text === '{');
    expect(childBlocks.map(b => [b.identity!.oldIndex, b.identity!.newIndex])).toEqual([[0, 1], [1, 0]]);
    expect(childBlocks.some(b => b.identity!.moved)).toBe(true);
    expectMonotonicLineNumbers(left, right);
  });

  it('matches the root array with an empty path selector', () => {
    const before = [{ id: 'a' }, { id: 'b' }];
    const after = [{ id: 'b' }, { id: 'a' }];
    const [left, right] = differWith([{ path: '', fields: ['id'] }]).diff(before, after);
    expect(left.filter(l => l.identity).length).toBeGreaterThan(0);
    expectMonotonicLineNumbers(left, right);
  });
});

describe('identity array diff: normalization in matching', () => {
  it('matches -0 and 0, but not string "1" and number 1', () => {
    const before = { items: [{ id: -0, v: 'old' }, { id: 1, v: 'x' }] };
    const after = { items: [{ id: 0, v: 'new' }, { id: '1', v: 'x' }] };
    const [left] = differWith([{ path: '/items', fields: ['id'] }]).diff(before, after);
    // -0 matches 0: one entity, modified in place
    const zeroBlock = left.find(l => l.text === '"v": "old"');
    expect(zeroBlock?.identity).toMatchObject({ oldIndex: 0, newIndex: 0, modified: true });
    // number 1 does not match string "1": both are unmatched and handed to the
    // LCS fallback, which pairs them as a modification (without identity metadata)
    const idLine = left.find(l => l.text === '"id": 1');
    expect(idLine?.type).toBe('modify');
    expect(idLine?.identity).toBeUndefined();
  });

  it('throws a readable error for NaN in identity fields', () => {
    const d = differWith([{ path: '/items', fields: ['id'] }]);
    expect(() => d.diff({ items: [{ id: NaN }] }, { items: [{ id: 1 }] })).toThrow(/NaN/);
  });

  it('matches composite object identities regardless of key order', () => {
    const before = { items: [{ key: { a: 1, b: 2 }, v: 'old' }] };
    const after = { items: [{ key: { b: 2, a: 1 }, v: 'new' }] };
    const [left] = differWith([{ path: '/items', fields: ['key'] }]).diff(before, after);
    const vLine = left.find(l => l.text === '"v": "old"');
    expect(vLine?.identity).toMatchObject({ oldIndex: 0, newIndex: 0, moved: false, modified: true });
  });
});

describe('identity array diff: folding context', () => {
  it('does not fold pure moves into hidden unchanged segments', () => {
    const size = 30;
    const beforeItems = Array.from({ length: size }, (_, i) => ({ id: `el-${i}`, v: i }));
    // move the first element to the end, keep everything else unchanged
    const afterItems = [...beforeItems.slice(1), beforeItems[0]];
    const [left, right] = differWith([{ path: '/items', fields: ['id'] }])
      .diff({ items: beforeItems }, { items: afterItems });
    const segments = getSegments(left, right, { threshold: 8, margin: 3 }, false);
    const hiddenRanges = segments.filter(s => 'hasLinesBefore' in s || 'hasLinesAfter' in s);
    expect(hiddenRanges.length).toBeGreaterThan(0);
    const foldedMovedLines: string[] = [];
    left.forEach((line, index) => {
      if (!line.identity?.moved) {
        return;
      }
      const hidden = hiddenRanges.some(s => index >= s.start && index < s.end);
      if (hidden) {
        foldedMovedLines.push(`line ${index} ("${line.text}")`);
      }
    });
    expect(`folded moved lines: ${foldedMovedLines.join(', ')}`).toBe('folded moved lines: ');
    expectMonotonicLineNumbers(left, right);
  });
});

describe('identity array diff: compatibility', () => {
  it('keeps output unchanged when no selector is configured or none matches', () => {
    const before = { items: [{ id: 'b', v: 2 }, { id: 'a', v: 1 }], other: [1, 2] };
    const after = { items: [{ id: 'a', v: 1 }, { id: 'b', v: 3 }], other: [2, 3] };
    const [baseLeft, baseRight] = new Differ({ arrayDiffMethod: 'lcs' }).diff(before, after);
    for (const options of [
      { arrayDiffMethod: 'lcs' as const },
      { arrayDiffMethod: 'lcs' as const, arrayIdentitySelectors: [] },
      { arrayDiffMethod: 'lcs' as const, arrayIdentitySelectors: [{ path: '/nope', fields: ['id'] }] },
    ]) {
      const [left, right] = new Differ(options).diff(before, after);
      expect(left).toEqual(baseLeft);
      expect(right).toEqual(baseRight);
    }
  });
});
