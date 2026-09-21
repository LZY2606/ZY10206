import {
  Differ,
  getLineIdentityClass,
  getLineIdentityView,
  rowHasIdentityChange,
} from './index';
import type {
  ArrayIdentitySelectorConfig,
  DiffResultIdentity,
  IdentityDiagnostic,
  Path,
  PathStep,
} from './index';

it('public API surface is importable and typed', () => {
  const config: ArrayIdentitySelectorConfig = { arrayPath: '/items/*/rows', fields: ['/a', '/b'] };
  const differ = new Differ({ arrayIdentitySelectors: [config] });
  const result = differ.diffWithDiagnostics(
    { items: [{ rows: [{ a: 1, b: 2 }] }] },
    { items: [{ rows: [{ a: 1, b: 2 }] }] },
  );
  const diagnostics: IdentityDiagnostic[] = result[2];
  expect(Array.isArray(diagnostics)).toBe(true);
  const path: Path = [{ kind: 'index', index: 0 }];
  const step: PathStep = { kind: 'key', key: 'k' };
  void path;
  void step;
  const view = getLineIdentityView(result[0][0], result[1][0]);
  expect(typeof getLineIdentityClass(view)).toBe('string');
  expect(typeof rowHasIdentityChange(result[0][0], result[1][0])).toBe('boolean');
  const meta: DiffResultIdentity | undefined = result[0][0].identity;
  void meta;
});
