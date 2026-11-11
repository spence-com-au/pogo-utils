/**
 * `bin/phone` driven as a subprocess, with an `adb` of the test's own first on the path in place of a phone.
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const BIN = fileURLToPath(new URL('../../../bin/phone', import.meta.url));

/**
 * The script's exit code and output, with an `adb` on the path that writes the arguments it was given, one to a line,
 * to `args` in its directory and then runs `then`. A non-zero exit is an answer here rather than a failure.
 */
async function adb(then: string, ...args: string[]) {
  const bin = mkdtempSync(join(tmpdir(), 'adb-'));
  writeFileSync(join(bin, 'adb'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${bin}/args"\n${then}\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${dirname(process.execPath)}` };

  const { code, stdout, stderr } = await promisify(execFile)(BIN, args, { env }).then(
    (output) => ({ code: 0, ...output }),
    (error: { code: number; stdout: string; stderr: string }) => error,
  );
  const said = existsSync(join(bin, 'args'))
    ? readFileSync(join(bin, 'args'), 'utf8').trimEnd().split('\n')
    : undefined;

  return { code, stdout, stderr, said };
}

test.each([[[]], [['help']], [['--help']], [['screen-off', '--help']]])('%j prints the usage', async (args) => {
  const { code, stdout, said } = await adb('exit 1', ...args);

  expect(code).toBe(0);
  expect(stdout).toContain('bin/phone screen-off [OPTIONS]');
  expect(said).toBeUndefined();
});

test.each([[['screen-dim']], [['screen-off', 'now']]])('refuses %j with the usage', async (args) => {
  const { code, stderr, said } = await adb('exit 1', ...args);

  expect(code).toBe(1);
  expect(stderr).toContain('bin/phone screen-off [OPTIONS]');
  expect(said).toBeUndefined();
});

test.each([
  ['screen-off', 'off'],
  ['screen-on', 'on'],
])('%s runs ScreenPower %s on the phone named', async (command, power) => {
  const { code, said } = await adb('exit 0', command, '--serial', 'PHONE');

  expect(code).toBe(0);
  expect(said?.slice(0, 4)).toStrictEqual(['-s', 'PHONE', 'shell', 'echo']);
  expect(said?.slice(-3)).toStrictEqual(['/', 'ScreenPower', power]);
});

test("reports adb's failure and exits 1", async () => {
  const { code, stderr } = await adb(
    `echo "adb: device 'PHONE' not found" >&2; exit 1`,
    'screen-off',
    '--serial',
    'PHONE',
  );

  expect(code).toBe(1);
  expect(stderr).toContain("ScreenPower off: adb: device 'PHONE' not found");
});
