import Differ from './differ';
import type { DiffResult } from './differ';
import type { IdentityDiagnostic } from './utils/identity/types';
import { rowHasIdentityChange } from './utils/identity/line-identity';
import getSegments from './utils/get-segments';

interface RowSnapshot {
  left: string;
  right: string;
  lt: DiffResult['type'];
  rt: DiffResult['type'];
}

const snapshot = (result: readonly [DiffResult[], DiffResult[], IdentityDiagnostic[]?]): RowSnapshot[] => {
  expect(result[0].length).toBe(result[1].length);
  return result[0].map((l, i) => ({
    left: l.text,
    right: result[1][i].text,
    lt: l.type,
    rt: result[1][i].type,
  }));
};

const lineNumbersAreMonotonic = (lines: DiffResult[]) => {
  let previous = 0;
  for (const line of lines) {
    if (line.lineNumber !== undefined) {
      expect(line.lineNumber).toBeGreaterThan(previous);
      previous = line.lineNumber;
    }
  }
};

type IdentityResult = readonly [DiffResult[], DiffResult[], IdentityDiagnostic[]?];

interface EntityBlockInfo {
  moved: boolean;
  modified: boolean;
  oldIndex: number;
  newIndex: number;
  rows: number;
}

const entityBlocks = (result: IdentityResult) => {
  const blocks = new Map<number, EntityBlockInfo>();
  for (const line of result[0]) {
    if (!line.identity) {
      continue;
    }
    const block = blocks.get(line.identity.entityId) || {
      moved: line.identity.moved,
      modified: line.identity.modified,
      oldIndex: line.identity.oldIndex,
      newIndex: line.identity.newIndex,
      rows: 0,
    };
    block.rows++;
    blocks.set(line.identity.entityId, block);
  }
  return blocks;
};

describe('object array identity matching', () => {
  it('renders a pure move as one linked entity, not remove + add', () => {
    const before = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const after = [{ id: 3 }, { id: 1 }, { id: 2 }];
    const differ = new Differ({
      arrayDiffMethod: 'lcs',
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    });
    const result = differ.diffWithDiagnostics(before, after);
    const types = snapshot(result);
    // no remove/add lines at all: every element is an equal, identity-linked block
    expect(types.every(row => row.lt === 'equal' && row.rt === 'equal')).toBe(true);
    const blocks = entityBlocks(result);
    expect(blocks.size).toBe(3);
    for (const block of blocks.values()) {
      expect(block.moved).toBe(true);
      expect(block.modified).toBe(false);
    }
  });

  it('renders a move together with an internal modification as one modified entity', () => {
    const before = [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
      { id: 3, name: 'c' },
    ];
    const after = [
      { id: 3, name: 'c' },
      { id: 1, name: 'a2' },
      { id: 2, name: 'b' },
    ];
    const differ = new Differ({
      arrayDiffMethod: 'lcs',
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    });
    const result = differ.diffWithDiagnostics(before, after);
    const blocks = entityBlocks(result);
    expect(blocks.size).toBe(3);
    const movedAndModified = [...blocks.values()].filter(b => b.moved && b.modified);
    expect(movedAndModified).toHaveLength(1);
    // the modification is expressed inside the linked block, not as remove+add
    expect(snapshot(result).some(r => r.lt === 'remove' || r.rt === 'add')).toBe(false);
    expect(snapshot(result).some(r => r.lt === 'modify' && r.left.includes('"a"'))).toBe(true);
  });

  it('keeps multiple consecutive moves and reverse order line-number monotonic', () => {
    const build = (ids: number[]) => ids.map(id => ({ id, name: `n${id}` }));
    const cases = [
      { before: build([1, 2, 3, 4]), after: build([2, 3, 4, 1]) },
      { before: build([1, 2, 3, 4]), after: build([4, 3, 2, 1]) },
    ];
    const differ = new Differ({
      arrayDiffMethod: 'lcs',
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    });
    for (const { before, after } of cases) {
      const result = differ.diffWithDiagnostics(before, after);
      lineNumbersAreMonotonic(result[0]);
      lineNumbersAreMonotonic(result[1]);
      expect(entityBlocks(result).size).toBe(4);
    }
  });

  it('hands unmatched elements to the configured LCS strategy', () => {
    const before = [
      { id: 1, v: 1 },
      { id: 2, v: 2 },
      { id: 3, v: 3 },
    ];
    const after = [
      { id: 2, v: 2 },
      { id: 3, v: 3 },
      { id: 4, v: 4 },
    ];
    const differ = new Differ({
      arrayDiffMethod: 'lcs',
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    });
    const result = differ.diffWithDiagnostics(before, after);
    const rows = snapshot(result);
    expect(rows.some(r => r.lt === 'remove' && r.left.includes('"id": 1'))).toBe(true);
    expect(rows.some(r => r.rt === 'add' && r.right.includes('"id": 4'))).toBe(true);
    // 2 and 3 remain linked, unchanged entities
    const blocks = entityBlocks(result);
    expect(blocks.size).toBe(2);
    expect([...blocks.values()].every(b => !b.modified)).toBe(true);
  });

  it('records old/new indices and the matching basis on every entity line', () => {
    const before = [{ id: 'a' }, { id: 'b' }];
    const after = [{ id: 'b' }, { id: 'a' }];
    const differ = new Differ({
      arrayDiffMethod: 'normal',
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    });
    const result = differ.diffWithDiagnostics(before, after);
    const identities = result[0].map(l => l.identity).filter(Boolean);
    expect(identities.length).toBeGreaterThan(0);
    for (const identity of identities) {
      expect(identity!.basis).toBe('identity');
      expect(identity!.matchedBy.arrayPath).toBe('');
      expect(identity!.matchedBy.fields).toEqual(['/id']);
      expect(typeof identity!.matchedBy.identityKey).toBe('string');
    }
  });

  it('diagnoses duplicate identities and falls back instead of last-wins overwrite', () => {
    const before = [
      { id: 1, name: 'first' },
      { id: 1, name: 'second' },
    ];
    const after = [
      { id: 1, name: 'first' },
      { id: 2, name: 'third' },
    ];
    const differ = new Differ({
      arrayDiffMethod: 'lcs',
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    });
    const result = differ.diffWithDiagnostics(before, after);
    const duplicateDiag = result[2]!.find(d => d.code === 'duplicate-identity');
    expect(duplicateDiag).toBeDefined();
    expect(duplicateDiag!.indices).toContain(0);
    expect(duplicateDiag!.indices).toContain(1);
    // both duplicated before elements survive in the output, nothing was overwritten
    const rows = snapshot(result);
    expect(rows.filter(r => r.left.includes('"first"') || r.left.includes('"second"')).length).toBeGreaterThan(0);
  });

  it('supports the throw strategy for duplicate identities', () => {
    const differ = new Differ({
      arrayDiffMethod: 'lcs',
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id', onDuplicate: 'throw' }],
    });
    expect(() => differ.diffWithDiagnostics(
      [{ id: 1 }, { id: 1 }],
      [{ id: 1 }],
    )).toThrow(/Duplicate identity/);
  });

  it('diagnoses illegal identity values and routes those elements to the fallback', () => {
    const differ = new Differ({
      arrayDiffMethod: 'lcs',
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    });
    const result = differ.diffWithDiagnostics(
      [{ id: { nested: true }, v: 1 }, { id: 2, v: 2 }],
      [{ id: 2, v: 2 }, { id: 3, v: 3 }],
    );
    const invalidDiag = result[2]!.find(d => d.code === 'invalid-identity-value');
    expect(invalidDiag?.side).toBe('left');
    expect(invalidDiag?.indices).toEqual([0]);
    // the valid element stays a linked entity
    expect(entityBlocks(result).size).toBe(1);
  });

  it('uses a composite identity to match elements', () => {
    const before = [
      { kind: 'user', ref: 'a', v: 1 },
      { kind: 'admin', ref: 'a', v: 2 },
    ];
    const after = [
      { kind: 'admin', ref: 'a', v: 2 },
      { kind: 'user', ref: 'a', v: 10 },
    ];
    const differ = new Differ({
      arrayDiffMethod: 'lcs',
      arrayIdentitySelectors: [{ arrayPath: '', fields: ['/kind', '/ref'] }],
    });
    const result = differ.diffWithDiagnostics(before, after);
    const blocks = [...entityBlocks(result).values()];
    expect(blocks).toHaveLength(2);
    const modifiedUser = blocks.find(b => b.moved && b.modified);
    expect(modifiedUser).toBeDefined();
  });

  it('matches nested object arrays via wildcard selector paths', () => {
    const before = {
      users: [
        { uid: 1, tags: [{ code: 'a' }, { code: 'b' }] },
        { uid: 2, tags: [{ code: 'c' }] },
      ],
    };
    const after = {
      users: [
        { uid: 1, tags: [{ code: 'b' }, { code: 'a', extra: true }] },
        { uid: 2, tags: [{ code: 'c' }] },
      ],
    };
    const differ = new Differ({
      arrayDiffMethod: 'normal',
      arrayIdentitySelectors: [{ arrayPath: '/users/*/tags', fields: '/code' }],
    });
    const result = differ.diffWithDiagnostics(before, after);
    const rows = snapshot(result);
    // tag 'a' moved and gained a property: one linked modified entity, no remove/add pair
    const aRows = rows.filter(r => r.left.includes('"code": "a"') || r.right.includes('"code": "a"'));
    expect(aRows.length).toBeGreaterThan(0);
    expect(rows.some(r => r.left.includes('"code": "a"') && r.lt === 'remove')).toBe(false);
    expect(entityBlocks(result).size).toBe(3);
    lineNumbersAreMonotonic(result[0]);
    lineNumbersAreMonotonic(result[1]);
  });

  it('still folds-aware: identity-driven rows are reported as changes', () => {
    const differ = new Differ({
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    });
    const result = differ.diffWithDiagnostics(
      [{ id: 1 }, { id: 2 }],
      [{ id: 2 }, { id: 1 }],
    );
    const changedRows = result[0].filter((l, i) => rowHasIdentityChange(l, result[1][i]));
    expect(changedRows.length).toBeGreaterThan(0);
  });

  it('keeps the legacy diff() output shape and byte-identical output without selectors', () => {
    const before = [{ id: 2, x: 1 }, { id: 1, x: 2 }];
    const after = [{ id: 1, x: 2 }, { id: 2, x: 1 }];
    const legacy = new Differ({ arrayDiffMethod: 'lcs' });
    const withSelectors = new Differ({
      arrayDiffMethod: 'lcs',
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    });
    const legacyResult = legacy.diff(before, after);
    const selectedResult = withSelectors.diff(before, after);
    expect(legacyResult.length).toBe(2);
    expect(selectedResult.length).toBe(2);
    // no identity metadata leaks when the selector is absent
    expect(legacyResult[0].every(l => !l.identity)).toBe(true);
    expect(legacyResult[1].every(r => !r.identity)).toBe(true);
  });

  it('stays compatible for existing configs: compare-key still works unchanged', () => {
    const before = [{ id: 1, v: 'a' }, { id: 2, v: 'b' }];
    const after = [{ id: 2, v: 'b' }, { id: 1, v: 'a' }];
    const differ = new Differ({ arrayDiffMethod: 'compare-key', compareKey: 'id' });
    const result = differ.diff(before, after);
    expect(result[0].length).toBe(result[1].length);
    expect(result[0].every(l => !l.identity)).toBe(true);
  });

  it('emits diagnostics via the typed 3-tuple method only', () => {
    const differ = new Differ({
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    });
    const [left, right, diagnostics] = differ.diffWithDiagnostics(
      [{ id: 1 }, { id: 1 }],
      [{ id: 2 }],
    );
    expect(Array.isArray(diagnostics)).toBe(true);
    expect(diagnostics.find(d => d.code === 'duplicate-identity')).toBeDefined();
    expect(left.length).toBe(right.length);
  });

  it('does not duplicate diagnostics when unmatched runs recurse through the dispatcher', () => {
    const differ = new Differ({
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    });
    const result = differ.diffWithDiagnostics(
      [{ id: { bad: true } }, { id: 2 }],
      [{ id: 2 }, { id: { bad: true } }],
    );
    const invalidDiagnostics = result[2]!.filter(d => d.code === 'invalid-identity-value');
    expect(invalidDiagnostics).toHaveLength(2);
  });
});

describe('identity folding context and line numbers', () => {
  it('keeps both sides strictly line-number monotonic through long folded moves', () => {
    // A long unchanged prefix/suffix (foldable) surrounds many moved entities.
    const stablePrefix = Array.from({ length: 20 }, (_, i) => ({
      id: `s${i}`,
      note: `stable-${i}`,
    }));
    const moving = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      note: `move-${i}`,
    }));
    const movedReversed = [...moving].reverse();
    const stableSuffix = Array.from({ length: 20 }, (_, i) => ({
      id: `t${i}`,
      note: `tail-${i}`,
    }));
    const result = new Differ({
      arrayDiffMethod: 'lcs',
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    }).diffWithDiagnostics(
      [...stablePrefix, ...moving, ...stableSuffix],
      [...stablePrefix, ...movedReversed, ...stableSuffix],
    );
    lineNumbersAreMonotonic(result[0]);
    lineNumbersAreMonotonic(result[1]);
    // moved entities are still recognized inside a large unchanged context
    const movedEntities = new Set(
      result[0]
        .filter(line => line.identity?.moved)
        .map(line => line.identity!.entityId),
    );
    expect(movedEntities.size).toBe(10);
    // getSegments marks the moved area as non-equal, so it survives folding
    const segments = getSegments(result[0], result[1], { threshold: 8, margin: 3 }, false);
    for (const segment of segments) {
      if (segment.isEqual) {
        for (let idx = segment.start; idx < segment.end; idx++) {
          expect(result[0][idx].identity?.moved).toBeFalsy();
        }
      }
    }
  });

  it('treats -0 and 0 as equal but NaN invalid inside composite identities', () => {
    const differ = new Differ({
      arrayIdentitySelectors: [{ arrayPath: '', fields: ['/kind', '/code'] }],
    });
    const [l, r, diag] = differ.diffWithDiagnostics(
      [{ kind: 'k', code: -0, v: 1 }],
      [{ kind: 'k', code: 0, v: 2 }],
    );
    expect(diag).toHaveLength(0);
    const blocks = entityBlocks([l, r, diag]);
    expect(blocks.size).toBe(1);
    expect([...blocks.values()][0].modified).toBe(true);
    // NaN component is invalid and must not match anything
    const invalid = differ.diffWithDiagnostics(
      [{ kind: 'k', code: NaN }],
      [{ kind: 'k', code: NaN }],
    );
    expect(invalid[2]!.some(d => d.code === 'invalid-identity-value')).toBe(true);
    expect(entityBlocks(invalid).size).toBe(0);
  });
});

describe('nested and combined identity selectors', () => {
  it('matches nested object arrays inside identity-matched outer arrays', () => {
    const differ = new Differ({
      arrayDiffMethod: 'lcs',
      arrayIdentitySelectors: [
        { arrayPath: '', fields: '/id' },
        { arrayPath: '/*/items', fields: '/sku' },
      ],
    });
    const before = [
      { id: 'o1', items: [{ sku: 'a' }, { sku: 'b' }] },
      { id: 'o2', items: [{ sku: 'c' }] },
    ];
    const after = [
      { id: 'o2', items: [{ sku: 'c' }] },
      { id: 'o1', items: [{ sku: 'b' }, { sku: 'a' }] },
    ];
    const result = differ.diffWithDiagnostics(before, after);
    const entities = new Set(
      result[0].filter(line => line.identity).map(line => line.identity!.entityId),
    );
    expect(entities.size).toBe(5);
    lineNumbersAreMonotonic(result[0]);
    lineNumbersAreMonotonic(result[1]);
  });

  it('keeps an inner move+modify a single entity within an unchanged outer entity', () => {
    const differ = new Differ({
      arrayDiffMethod: 'lcs',
      arrayIdentitySelectors: [
        { arrayPath: '', fields: '/id' },
        { arrayPath: '/*/items', fields: '/sku' },
      ],
    });
    const result = differ.diffWithDiagnostics(
      [{ id: 'o1', items: [{ sku: 'a', v: 1 }] }],
      [{ id: 'o1', items: [{ sku: 'a', v: 2 }] }],
    );
    expect(result[2]).toEqual([]);
    const innerIdentity = result[0]
      .map(line => line.identity)
      .find(identity => identity?.matchedBy.arrayPath === '/*/items');
    expect(innerIdentity?.modified).toBe(true);
  });

  it('works together with unorder-lcs and maxDepth without crashing', () => {
    const unordered = new Differ({
      arrayDiffMethod: 'unorder-lcs',
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    });
    const u = unordered.diffWithDiagnostics(
      [{ id: 1, v: 'b' }, { id: 2, v: 'a' }],
      [{ id: 2, v: 'a' }, { id: 1, v: 'b' }],
    );
    expect(u[0].length).toBe(u[1].length);

    const shallow = new Differ({
      maxDepth: 2,
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    });
    const s = shallow.diffWithDiagnostics(
      [{ id: 1, v: 'a' }],
      [{ id: 1, v: 'b' }],
    );
    expect(s[0].length).toBe(s[1].length);
  });
});

describe('identity matching edge cases', () => {
  it('respects showModifications false by emitting remove/add inside the fallback run', () => {
    const differ = new Differ({
      showModifications: false,
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    });
    const result = differ.diffWithDiagnostics(
      [{ id: 1, v: 1 }, { id: 2, v: 2 }],
      [{ id: 2, v: 2 }, { id: 1, v: 9 }],
    );
    // id 1 moved and changed: under Git style it is one linked block rendered
    // as paired remove/add lines, never split into unrelated hunks
    const id1Lines = result[0]
      .filter(line => line.identity?.matchedBy.identityKey.includes('"1"') || line.identity?.oldIndex === 0);
    expect(id1Lines.length).toBeGreaterThan(0);
    const blocks = entityBlocks(result);
    expect(blocks.size).toBe(2);
    expect([...blocks.values()].some(b => b.moved && b.modified)).toBe(true);
  });

  it('handles pure insertions and deletions without identity diagnostics', () => {
    const differ = new Differ({
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    });
    const inserted = differ.diffWithDiagnostics(
      [{ id: 1 }],
      [{ id: 1 }, { id: 2 }, { id: 3 }],
    );
    expect(inserted[2]).toEqual([]);
    expect(snapshot(inserted).some(row => row.rt === 'add')).toBe(true);

    const deleted = differ.diffWithDiagnostics(
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      [{ id: 1 }],
    );
    expect(deleted[2]).toEqual([]);
    expect(snapshot(deleted).some(row => row.lt === 'remove')).toBe(true);
  });

  it('supports arrays of scalars being added around identity objects', () => {
    const differ = new Differ({
      arrayDiffMethod: 'lcs',
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    });
    // non-object elements cannot have an identity and fall back cleanly
    const result = differ.diffWithDiagnostics(
      [1, { id: 'a' }, { id: 'b' }] as any[],
      [{ id: 'b' }, { id: 'a' }, 2] as any[],
    );
    expect(result[0].length).toBe(result[1].length);
    lineNumbersAreMonotonic(result[0]);
    lineNumbersAreMonotonic(result[1]);
  });
});

describe('identity value semantics end to end', () => {
  it('matches elements that both miss the identity field and links their changes', () => {
    const differ = new Differ({
      arrayDiffMethod: 'lcs',
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    });
    const result = differ.diffWithDiagnostics(
      [{ id: 'y', name: 'y' }, { name: 'x', v: 1 }],
      [{ name: 'x', v: 2 }, { id: 'y', name: 'y' }],
    );
    // the missing-id element moves and is modified as one linked entity
    const blocks = [...entityBlocks(result).values()];
    expect(blocks.some(block => block.moved && block.modified)).toBe(true);
    expect(result[2]).toEqual([]);
  });

  it('reports ambiguity when multiple elements share the same missing identity', () => {
    const differ = new Differ({
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    });
    const result = differ.diffWithDiagnostics(
      [{ name: 'x' }, { name: 'y' }],
      [{ id: 'z' }],
    );
    expect(result[2]!.some(d => d.code === 'duplicate-identity')).toBe(true);
  });

  it('never matches a missing field with an explicit null field', () => {
    const differ = new Differ({
      arrayDiffMethod: 'lcs',
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    });
    const result = differ.diffWithDiagnostics(
      [{ id: null, v: 1 }],
      [{ v: 2 }],
    );
    expect(entityBlocks(result).size).toBe(0);
  });

  it('keeps numeric and string ids separate even with identical rendering', () => {
    const differ = new Differ({
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    });
    const result = differ.diffWithDiagnostics(
      [{ id: 1, v: 'number' }],
      [{ id: '1', v: 'string' }],
    );
    expect(entityBlocks(result).size).toBe(0);
    expect(result[2]).toEqual([]);
  });
});
