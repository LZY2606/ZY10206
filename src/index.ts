import Differ from './differ';
import Viewer from './viewer';

export type {
  InlineDiffOptions,
  InlineDiffResult,
} from './utils/get-inline-diff';

export type {
  ArrayDiffFunc,
  ArrayIdentitySelector,
  DifferOptions,
  DiffResult,
  IdentityDiagnostic,
  IdentityMatchInfo,
} from './differ';

export type {
  ViewerProps,
} from './viewer';

export { Differ, Viewer };
