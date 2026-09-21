import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Differ from './differ';
import Viewer from './viewer';

const renderDiff = (before: any, after: any, viewerProps: object = {}) => {
  const diff = new Differ({
    arrayDiffMethod: 'lcs',
    arrayIdentitySelectors: [{ path: '/items', fields: ['id'] }],
  }).diff(before, after);
  return renderToStaticMarkup(<Viewer diff={diff} {...viewerProps} />);
};

describe('viewer: identity moves (minimal render contract)', () => {
  it('renders pure moves with a dedicated class instead of "No change detected"', () => {
    const before = { items: [{ id: 'a', v: 1 }, { id: 'b', v: 2 }] };
    const after = { items: [{ id: 'b', v: 2 }, { id: 'a', v: 1 }] };
    const html = renderDiff(before, after);
    expect(html).toContain('line-moved');
    expect(html).not.toContain('No change detected');
    // a pure move is not an edit: no add/remove/modify line styling
    expect(html).not.toContain('line-add');
    expect(html).not.toContain('line-remove');
    expect(html).not.toContain('line-modify');
  });

  it('applies the move background colour to pure moves only', () => {
    // "x" is moved AND modified; "a" is a pure move; "b"/"c" stay in place
    const before = { items: [{ id: 'x', v: 1 }, { id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'c', v: 3 }] };
    const after = { items: [{ id: 'b', v: 2 }, { id: 'c', v: 3 }, { id: 'a', v: 1 }, { id: 'x', v: 2 }] };
    const html = renderDiff(before, after, {
      bgColour: { move: 'rgb(1,2,3)', modify: 'rgb(4,5,6)' },
    });
    // pure move -> move colour; moved+modified -> modify colour
    expect(html).toContain('background-color:rgb(1,2,3)');
    expect(html).toContain('background-color:rgb(4,5,6)');
    expect(html).toContain('line-modify');
  });

  it('keeps inline diff segments working for moved+modified lines', () => {
    const before = { items: [{ id: 'a', v: 'hello world' }, { id: 'b', v: 2 }] };
    const after = { items: [{ id: 'b', v: 2 }, { id: 'a', v: 'hello json' }] };
    const html = renderDiff(before, after, { highlightInlineDiff: true });
    expect(html).toContain('inline-diff-remove');
    expect(html).toContain('inline-diff-add');
  });

  it('renders identical documents without move markers', () => {
    const same = { items: [{ id: 'a', v: 1 }] };
    const html = renderDiff(same, same, { hideUnchangedLines: true });
    expect(html).toContain('No change detected');
    expect(html).not.toContain('line-moved');
  });
});
