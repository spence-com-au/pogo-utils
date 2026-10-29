/**
 * A fixture's bytes off disk, for a test the browser project checks: it has no Node types to import `node:fs` by, and
 * should not, though the suite runs under Node all the same. So `node:fs` is had from `process` at run time, typed as
 * the one function used.
 */

interface Node {
  process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: URL): Uint8Array } };
}

export function fixture(url: URL): Uint8Array {
  return new Uint8Array((globalThis as unknown as Node).process.getBuiltinModule('node:fs').readFileSync(url));
}
