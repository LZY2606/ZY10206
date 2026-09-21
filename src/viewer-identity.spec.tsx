import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import Differ from './differ';
import Viewer from './viewer';
import getSegments from './utils/get-segments';
import { getLineIdentityClass, getLineIdentityView } from './utils/identity/line-identity';

describe('viewer identity rendering contract', () => {
  beforeAll(() => {
    // The Viewer reads document.body / querySelector for the virtual list;
    // server rendering never uses them, but module evaluation must not crash.
    (global as any).document = {
      body: {},
      querySelector: () => null,
    };
  });

  const buildMoveDiff = () => {
    const differ = new Differ({
      arrayDiffMethod: 'lcs',
      arrayIdentitySelectors: [{ arrayPath: '', fields: '/id' }],
    });
    return differ.diffWithDiagnostics(
      [{ id: 1, name: 'a' }, { id: 2, name: 'b' }],
      [{ id: 2, name: 'b' }, { id: 1, name: 'b2' }],
    );
  };

  it('renders move rows with identity classes, entity data and the move badge', () => {
    const [left, right] = buildMoveDiff();
    const html = renderToStaticMarkup(
      React.createElement(Viewer, {
        diff: [left, right] as const,
        lineNumbers: true,
      }),
    );
    expect(html).toContain('identity-row');
    expect(html).toContain('line-move');
    expect(html).toContain('data-entity="1"');
    expect(html).toContain('move-badge');
    // the move-and-modify entity carries the compound class and compound badge
    expect(html).toContain('line-move-modified');
    expect(html).toContain('>⇄*<');
  });

  it('still renders the inline diff inside a moved and modified entity', () => {
    const [left, right] = buildMoveDiff();
    const html = renderToStaticMarkup(
      React.createElement(Viewer, {
        diff: [left, right] as const,
        highlightInlineDiff: true,
      }),
    );
    expect(html).toContain('inline-diff-remove');
    expect(html).toContain('inline-diff-add');
  });

  it('keeps move rows out of the foldable unchanged segments', () => {
    const [left, right] = buildMoveDiff();
    const segments = getSegments(left, right, true, false);
    // every segment covering a moved row must be marked as non-equal so it
    // never collapses behind the "show unchanged lines" placeholder
    for (const segment of segments) {
      if (segment.isEqual) {
        for (let i = segment.start; i < segment.end; i++) {
          expect(left[i].identity?.moved).toBeFalsy();
        }
      }
    }
  });

  it('exposes a stable pure presentation helper', () => {
    const [left, right] = buildMoveDiff();
    const firstMovedIndex = left.findIndex((line, i) => {
      const view = getLineIdentityView(line, right[i]);
      return view?.moveModified && view.entityStart;
    });
    expect(firstMovedIndex).toBeGreaterThan(-1);
    const view = getLineIdentityView(left[firstMovedIndex], right[firstMovedIndex])!;
    expect(getLineIdentityClass(view)).toContain('line-move-modified');
    // second line of the same entity is not an entity start
    const second = getLineIdentityView(
      left[firstMovedIndex + 1],
      right[firstMovedIndex + 1],
      { left: left[firstMovedIndex], right: right[firstMovedIndex] },
    )!;
    expect(second.entityStart).toBe(false);
  });

  it('renders the same move contract without line numbers via inline badge', () => {
    const [left, right] = buildMoveDiff();
    const html = renderToStaticMarkup(
      React.createElement(Viewer, {
        diff: [left, right] as const,
      }),
    );
    expect(html).toContain('move-badge-inline');
    expect(html).toContain('identity-row');
  });
});
