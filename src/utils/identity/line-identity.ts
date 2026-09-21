import type { DiffResult } from '../../differ';

/**
 * Presentation view of the identity metadata attached to a diff line.
 *
 * The viewer (and any custom renderer) consumes this view instead of reading
 * raw metadata, so the rendering contract stays stable:
 *
 * - `moveOnly` rows are pure moves: element content is unchanged, position
 *   moved.
 * - `moveModified` rows belong to an element that was moved and whose content
 *   was also changed.
 * - `entityStart` marks the first row of an entity block, used for the move
 *   gutter badge.
 */
export interface LineIdentityView {
  entityId: number;
  moveOnly: boolean;
  moveModified: boolean;
  entityStart: boolean;
}

/**
 * Compute the presentation view for one row, given the previous rendered row
 * (used to tell the first line of an entity block). Returns `undefined` when
 * the row is not identity matched.
 */
export const getLineIdentityView = (
  leftLine: DiffResult,
  rightLine: DiffResult,
  previous?: { left?: DiffResult; right?: DiffResult },
): LineIdentityView | undefined => {
  const identity = leftLine.identity || rightLine.identity;
  if (!identity) {
    return undefined;
  }
  const moveOnly = !!identity.moved && !identity.modified;
  const moveModified = !!identity.moved && !!identity.modified;
  const previousIdentity = previous
    ? previous.left?.identity || previous.right?.identity
    : undefined;
  const entityStart = !previousIdentity || previousIdentity.entityId !== identity.entityId;
  return {
    entityId: identity.entityId,
    moveOnly,
    moveModified,
    entityStart,
  };
};

/**
 * CSS class fragments the viewer applies to a row cell, in addition to the
 * regular `line-<type>` class.
 */
export const getLineIdentityClass = (view: LineIdentityView | undefined): string => {
  if (!view) {
    return '';
  }
  return [
    'line-identity',
    view.moveOnly ? 'line-move' : '',
    view.moveModified ? 'line-move-modified' : '',
  ].filter(Boolean).join(' ');
};

/**
 * Whether two rendered sides carry any identity-driven change. Used by the
 * unchanged-lines folding logic so a pure move is never hidden as "equal".
 */
export const rowHasIdentityChange = (leftLine: DiffResult, rightLine: DiffResult): boolean => {
  const identity = leftLine.identity || rightLine.identity;
  return !!identity && (identity.moved || identity.modified);
};
