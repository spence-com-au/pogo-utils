/**
 * The matrices in `.github/workflows/` against what they stand for.
 *
 * `lint.yaml` runs `pnpm lint:<check>` for each check it names, and `test.yaml` runs `pnpm test:<project>` for each
 * vitest project. Both lists are transcribed, so a `lint:*` script or a vitest project added without its matrix entry
 * runs locally and never in CI, which nothing else reports: a check missing from the matrix is not a failure but a
 * check that never runs.
 *
 * The readings are independent on purpose, as in `build.test.mts`: the matrix comes out of the workflow's text, the
 * checks out of `package.json`'s keys and the projects out of `vitest.config.mjs`'s text.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const { scripts } = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

/** The entries of the `matrix` key a workflow names, in the order it lists them. */
function matrix(workflow: string, key: string): string[] {
  const block = new RegExp(`^ +matrix:\\n +${key}:\\n((?: +- '[\\w-]+'\\n)+)`, 'm').exec(read(workflow))?.[1];

  expect(block, `\`${key}\` matrix in ${workflow}`).toBeDefined();

  return [...(block ?? '').matchAll(/'([\w-]+)'/g)].map(([, name = '']) => name);
}

/** The `<prefix>:<name>` scripts `package.json` defines, less the `:fix` variants, which rewrite rather than check. */
const scriptsOf = (prefix: string) =>
  Object.keys(scripts)
    .map((script) => new RegExp(`^${prefix}:([\\w-]+)$`).exec(script)?.[1])
    .filter((name) => name !== undefined && name !== 'fix');

test('`lint.yaml` runs every `lint:*` check `package.json` defines', () => {
  expect(new Set(matrix('.github/workflows/lint.yaml', 'check'))).toStrictEqual(new Set(scriptsOf('lint')));
});

test('`test.yaml` runs every vitest project, each of which has a `test:*` script', () => {
  const projects = [...read('vitest.config.mjs').matchAll(/^ +name: '([\w-]+)',$/gm)].map(([, name]) => name);

  expect(projects.length).toBeGreaterThan(0);
  expect(new Set(matrix('.github/workflows/test.yaml', 'project'))).toStrictEqual(new Set(projects));
  expect(scriptsOf('test')).toStrictEqual(expect.arrayContaining(projects));
});
