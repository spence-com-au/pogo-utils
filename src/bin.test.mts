/**
 * The commands `package.json` declares under `bin`, run as they are typed: `pnpm battle` and the rest are no scripts,
 * so pnpm runs the one of that name in `node_modules/.bin`. pnpm links no package's own `bin` there, which is why the
 * package depends on itself through `link:.`. The CLI suites run each script with `node`, so a `bin` path gone wrong,
 * the self-link dropped or a script without the `#!/usr/bin/env node` its launcher reads fails here alone.
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, test } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

const { bin } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { bin: Record<string, string> };

test.each(Object.keys(bin))('`pnpm %s help` prints its usage', async (name) => {
  const { stdout } = await promisify(execFile)('pnpm', [name, 'help'], { cwd: ROOT });

  expect(stdout).toMatch(new RegExp(`^ {2}pnpm ${name} `, 'm'));
});
