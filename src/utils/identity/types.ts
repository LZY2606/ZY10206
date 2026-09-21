import type { IdentityEntry } from './normalize-identity';
import type { DuplicateIdentityStrategy } from './selector';

export type IdentityDiagnosticCode =
  | 'duplicate-identity'
  | 'invalid-identity-value';

export interface IdentityDiagnostic {
  code: IdentityDiagnosticCode;
  /** JSON Pointer style path of the array where the issue happened. */
  arrayPath: string;
  /** The normalized identity key involved (absent for invalid scalar values). */
  identityKey?: string;
  side: 'left' | 'right' | 'both';
  /** Concrete indices of the elements involved. */
  indices: number[];
  message: string;
}

export type IdentityMatchBasis = 'identity';

/**
 * Line-level metadata describing how the object-array element owning this line
 * was aligned by the identity matcher.
 *
 * `oldIndex` / `newIndex` are the indices in the original arrays (for
 * unmatched sides they still carry the concrete index of the element).
 */
export interface DiffResultIdentity {
  entityId: number;
  basis: IdentityMatchBasis;
  oldIndex: number;
  newIndex: number;
  moved: boolean;
  modified: boolean;
  matchedBy: {
    arrayPath: string;
    fields: string[];
    identityKey: string;
  };
  identityEntries?: {
    left: IdentityEntry[];
    right: IdentityEntry[];
  };
}

/**
 * Per-diff mutable context shared through the recursive diff functions.
 */
export interface IdentityRunContext {
  diagnostics: IdentityDiagnostic[];
  nextEntityId: number;
  /** `DuplicateIdentityStrategy` is accepted here for convenience. */
  onDuplicate?: DuplicateIdentityStrategy;
}

export const createIdentityRunContext = (): IdentityRunContext => ({
  diagnostics: [],
  nextEntityId: 1,
});
