/**
 * `scripts/battle.mts` driven as a subprocess, which is the one way a test reaches it: nothing imports it, and importing
 * it would run it. Only what is refused before a phone is asked for, so nothing here needs `adb` or a device.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../scripts/battle.mts', import.meta.url));

/** The script's exit code and output, a non-zero exit being an answer here rather than a failure. */
async function battle(...args: string[]) {
  try {
    const { stdout, stderr } = await promisify(execFile)('node', [SCRIPT, ...args]);

    return { code: 0, stdout, stderr };
  } catch (error) {
    const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string };

    return { code, stdout, stderr };
  }
}

test('help prints the usage out of the header', async () => {
  const { code, stdout } = await battle('help');

  expect(code).toBe(0);
  expect(stdout).toContain('pnpm battle record [--seconds N] [--serial SERIAL] OUT');
});

test.each([[[]], [['run']], [['record', 'out.h264']]])('--help after %j prints the usage', async (args) => {
  const { code, stdout } = await battle(...args, '--help');

  expect(code).toBe(0);
  expect(stdout).toContain('pnpm battle record [--seconds N] [--serial SERIAL] OUT');
});

test('refuses a flag it does not know', async () => {
  const { code, stderr } = await battle('record', '--seconds=5', '--loud', 'out.h264');

  expect(code).toBe(1);
  expect(stderr).toContain("Unknown option '--loud'");
});

test.each([
  ['record', ['--verbose', 'out.h264'], '--verbose'],
  ['record', ['--no-graphics', 'out.h264'], '--no-graphics'],
  ['record', ['--keep-video', 'run.ts', 'out.h264'], '--keep-video'],
  ['run', ['--leader', 'spark', '--league', 'great', '--seconds', '5'], '--seconds'],
])('refuses a flag %s does not act on', async (command, args, flag) => {
  const { code, stderr } = await battle(command, ...args);

  expect(code).toBe(1);
  expect(stderr).toContain(`${command} does not act on ${flag}`);
});

test('run acts on --no-graphics', async () => {
  // Refused for the league it lacks, which is asked after the flags each command acts on.
  const { code, stderr } = await battle('run', '--no-graphics', '--leader', 'spark');

  expect(code).toBe(1);
  expect(stderr).toContain('--league takes one of great, ultra, master');
});

test.each([
  [['--league', 'great'], '--leader takes one of blanche, candela, spark'],
  [['--leader', 'arlo', '--league', 'great'], '--leader takes one of blanche, candela, spark'],
  [['--leader', 'spark'], '--league takes one of great, ultra, master'],
  [['--leader', 'spark', '--league', 'great', '--count', '0'], '--count takes a whole number of battles'],
  [['--mode', 'rocket', '--league', 'great'], '--mode takes one of training, gbl'],
  [['--mode', 'gbl'], '--league is needed for GO Battle League'],
  [['--mode', 'gbl', '--league', ' '], '--league is needed for GO Battle League'],
  [['--mode', 'gbl', '--league', 'ultra', '--leader', 'spark'], '--leader is for training'],
  [['--leader', 'spark', '--league', 'great', '--party', 'GBL'], '--party is for GO Battle League'],
  [['--mode', 'gbl', '--league', 'ultra', '--party', ' '], '--party takes the name of a party'],
])('refuses run %j', async (args, message) => {
  const { code, stderr } = await battle('run', ...args);

  expect(code).toBe(1);
  expect(stderr).toContain(message);
});

test.each([['0'], ['181'], ['2.5'], ['ten']])('refuses --seconds %s', async (seconds) => {
  const { code, stderr } = await battle('record', '--seconds', seconds, 'out.h264');

  expect(code).toBe(1);
  expect(stderr).toContain('--seconds takes a whole number from 1 to 180');
});

test('reports an adb it cannot find rather than throwing', async () => {
  const { code, stderr } = await promisify(execFile)('node', [SCRIPT, 'record', '--seconds', '1', devNull], {
    env: { ...process.env, PATH: dirname(process.execPath) },
  }).then(
    () => ({ code: 0, stderr: '' }),
    (error: { code: number; stderr: string }) => error,
  );

  expect(code).toBe(1);
  expect(stderr).toContain("could not read the screen's size: adb shell wm size: spawn adb ENOENT");
});

// `/dev/full` is Linux only, and `ubuntu-latest` is every runner in `.github/workflows/`.
test.skipIf(process.platform !== 'linux')('reports an OUT it cannot write and stops recording', async () => {
  // An `adb` that answers `wm size`, then writes its pid and a byte before it records for a minute. A script that left
  // it running would leave that pid alive, which is what is checked: the child's piped stdio lets the script exit
  // whether or not it stopped the child. `/dev/full` takes the byte only to fail it, so the failure comes after the pid
  // is written.
  const bin = mkdtempSync(join(tmpdir(), 'battle-adb-'));
  const pidFile = join(bin, 'pid');
  const adb = `#!/bin/sh\n[ "$1" = shell ] && echo "Physical size: 1440x3040" && exit\necho $$ > ${pidFile}\necho x\nexec sleep 60\n`;
  writeFileSync(join(bin, 'adb'), adb, { mode: 0o755 });

  try {
    const { code, stderr } = await promisify(execFile)('node', [SCRIPT, 'record', '--seconds', '1', '/dev/full'], {
      env: { ...process.env, PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}` },
      timeout: 10_000,
    }).then(
      () => ({ code: 0, stderr: '' }),
      (error: { code: number; stderr: string }) => error,
    );

    expect(code).toBe(1);
    expect(stderr).toContain('could not write /dev/full');
    expect(stderr).toContain('ENOSPC');

    const pid = Number(readFileSync(pidFile, 'utf8'));

    await expect
      .poll(() => {
        try {
          process.kill(pid, 0);

          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
  } finally {
    try {
      process.kill(Number(readFileSync(pidFile, 'utf8')));
    } catch {
      // Stopped already, which is the point.
    }
  }
});

test('refuses a recording with nowhere to go', async () => {
  const { code, stderr } = await battle('record');

  expect(code).toBe(1);
  expect(stderr).toContain('record takes one OUT file');
});
