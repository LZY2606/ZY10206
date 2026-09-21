import Differ from './differ';
import Viewer from './viewer';

export type {
  InlineDiffOptions,
  InlineDiffResult,
} from './utils/get-inline-diff';

export type {
  ArrayDiffFunc,
  DifferOptions,
  DiffResult,
} from './differ';

export type {
  ViewerProps,
} from './viewer';

export type {
  ArrayIdentitySelectorConfig,
  CompiledSelector,
  DuplicateIdentityStrategy,
} from './utils/identity/selector';

export type {
  DiffResultIdentity,
  IdentityDiagnostic,
  IdentityDiagnosticCode,
} from './utils/identity/types';

export type {
  Path,
  PathStep,
} from './utils/identity/json-pointer';

export {
  getLineIdentityView,
  getLineIdentityClass,
  rowHasIdentityChange,
  type LineIdentityView,
} from './utils/identity/line-identity';

export { Differ, Viewer };
