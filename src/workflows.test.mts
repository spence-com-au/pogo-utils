/**
 * The matrices in `.github/workflows/` against what they stand for.
 *
 * `lint.yaml` runs `pnpm lint:<check>` for each check it names, read against `package.json`'s `lint:*` scripts: a
 * `lint:*` script added without its matrix entry runs locally and never in CI, which nothing else reports — a check
 * missing from the matrix is not a failure but a check that never runs. The two readings are independent on purpose, as
 * in `build.test.mts`: the matrix comes out of the workflow's text and the checks out of `package.json`'s keys.
 *
 * `test.yaml` runs `pnpm test` — the whole suite — under each OCR engine its matrix names. The one the pages read with,
 * the WebAssembly build, is the leg a drop would quietly stop covering, since the CLI is the default a bare run takes,
 * so that leg is held here.
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

/**
 * The `ocr` engine each entry in `test.yaml`'s matrix reads under, which it lists under `include` rather than as a plain
 * list so one entry can set `ocr` where the default leaves it the CLI's Tesseract.
 */
function enginesRun(): string[] {
  const workflow = '.github/workflows/test.yaml';
  const block = /^ +matrix:\n +include:\n([\s\S]*?)\n {4}\w/m.exec(read(workflow))?.[1];

  expect(block, `\`include\` matrix in ${workflow}`).toBeDefined();

  return [...(block ?? '').matchAll(/^ +ocr: '([\w-]+)'$/gm)].map(([, name = '']) => name);
}

/** The `<prefix>:<name>` scripts `package.json` defines, less the `:fix` variants, which rewrite rather than check. */
const scriptsOf = (prefix: string) =>
  Object.keys(scripts)
    .map((script) => new RegExp(`^${prefix}:([\\w-]+)$`).exec(script)?.[1])
    .filter((name) => name !== undefined && name !== 'fix');

test('`lint.yaml` runs every `lint:*` check `package.json` defines', () => {
  expect(new Set(matrix('.github/workflows/lint.yaml', 'check'))).toStrictEqual(new Set(scriptsOf('lint')));
});

test('`test.yaml` reads the suite under the WebAssembly engine the pages read with', () => {
  expect(enginesRun()).toContain('wasm');
});
