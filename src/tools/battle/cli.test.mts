/**
 * `scripts/battle.mts` driven as a subprocess, which is the one way a test reaches it: nothing imports it, and importing
 * it would run it. What is refused before a phone is asked for needs no `adb` or device, and a run that changes the
 * phone's setting and then fails or is stopped is driven against a fake `adb` on the `PATH`, which answers as a phone
 * does and logs what it was asked.
 */

import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { devNull, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, onTestFinished, test } from 'vitest';
import { reads } from '../../core/node/test-cache.mts';
import { tessdata } from '../../core/node/test-engine.mts';

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
  expect(stdout).toContain('pnpm battle record [OPTIONS] OUT');
});

test.each([[[]], [['run']], [['record', 'out.h264']]])('--help after %j prints the usage', async (args) => {
  const { code, stdout } = await battle(...args, '--help');

  expect(code).toBe(0);
  expect(stdout).toContain('pnpm battle record [OPTIONS] OUT');
});

/** A typo's usage goes with the refusal on stderr, leaving stdout to the `help` that was asked for. */
test('an unknown command prints the usage to stderr and fails', async () => {
  const { code, stdout, stderr } = await battle('rnu');

  expect(code).toBe(1);
  expect(stderr).toContain('pnpm battle record [OPTIONS] OUT');
  expect(stdout).toBe('');
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

/**
 * A directory holding an `adb` that runs `body` as a shell script, `body` being handed the directory to keep files in.
 * It is removed when the test is over.
 */
function fakeAdb(body: (dir: string) => string) {
  const dir = mkdtempSync(join(tmpdir(), 'battle-adb-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'adb'), `#!/bin/sh\n${body(dir)}`, { mode: 0o755 });

  return dir;
}

/** `record` to `out` for a second, with the `adb` in `bin` the first on the PATH. */
function record(bin: string, out: string) {
  return promisify(execFile)('node', [SCRIPT, 'record', '--seconds', '1', out], {
    env: { ...process.env, PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}` },
    timeout: 10_000,
  }).then(
    ({ stderr }) => ({ code: 0, stderr }),
    (error: { code: number; stderr: string }) => error,
  );
}

// `/dev/full` is Linux only, and `ubuntu-latest` is every runner in `.github/workflows/`.
test.skipIf(process.platform !== 'linux')('reports an OUT it cannot write and stops recording', async () => {
  // An `adb` that answers `wm size`, then writes its pid and a byte before it records for a minute. A script that left
  // it running would leave that pid alive, which is what is checked: the child's piped stdio lets the script exit
  // whether or not it stopped the child. `/dev/full` takes the byte only to fail it, so the failure comes after the pid
  // is written.
  const bin = fakeAdb(
    (dir) =>
      `[ "$1" = shell ] && echo "Physical size: 1440x3040" && exit\necho $$ > ${join(dir, 'pid')}\necho x\nexec sleep 60\n`,
  );
  const pidFile = join(bin, 'pid');

  try {
    const { code, stderr } = await record(bin, '/dev/full');

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

// The screen is recorded at the size `wm size` answers with, an override ahead of the physical size: 1440×3040 is
// 360×760 and 1080×1920 is 360×640.
test.each([
  ['Physical size: 1440x3040', '360x760'],
  ['Physical size: 1440x3040\nOverride size: 1080x1920', '360x640'],
])('records %j at %s and writes it to OUT', async (answer, size) => {
  const bin = fakeAdb(
    (dir) => `[ "$1" = shell ] && echo '${answer}' && exit\necho "$@" > ${join(dir, 'args')}\nprintf x\n`,
  );
  const out = join(bin, 'out.h264');

  const { code, stderr } = await record(bin, out);

  expect(code).toBe(0);
  expect(stderr).toContain(`recording 1s to ${out}`);
  expect(readFileSync(join(bin, 'args'), 'utf8')).toContain(`--size=${size}`);
  expect(readFileSync(out, 'utf8')).toBe('x');
});

test.each([[''], ['Error: no display']])('refuses a wm size that answered %j', async (answer) => {
  const bin = fakeAdb((dir) => `[ "$1" = shell ] && echo '${answer}' && exit\necho recorded > ${join(dir, 'args')}\n`);

  const { code, stderr } = await record(bin, join(bin, 'out.h264'));

  expect(code).toBe(1);
  expect(stderr).toContain(`wm size answered ${JSON.stringify(answer)} rather than the screen's size`);
  expect(existsSync(join(bin, 'args'))).toBe(false);
});

// A `screenrecord` that refuses exits 0 with its reason on stderr, so the exit code is not all there is to go by.
test.each([
  ['exits 0 with its reason on stderr', 'echo "Unable to get output buffers" >&2', 'Unable to get output buffers'],
  ['exits non-zero without a reason', 'exit 3', 'exit 3, nothing recorded'],
])('reports a screenrecord that %s', async (_, body, reason) => {
  const bin = fakeAdb(() => `[ "$1" = shell ] && echo "Physical size: 1440x3040" && exit\n${body}\n`);

  const { code, stderr } = await record(bin, join(bin, 'out.h264'));

  expect(code).toBe(1);
  expect(stderr).toContain(`screenrecord failed: ${reason}`);
});

// A FIFO stands for any OUT that is not a regular file, such as `/dev/stdout` piped to a player, which reading back
// once the recording is done would wait on for good. Not `/dev/stdout` itself, which `execFile` makes a socket that
// cannot be opened by that name.
test.each([
  ['h264', 0, ''],
  ['', 1, 'screenrecord failed: refused\n'],
])('records %j into a FIFO and exits %i', async (recorded, expectedCode, failure) => {
  const bin = fakeAdb(
    () => `[ "$1" = shell ] && echo "Physical size: 1440x3040" && exit\nprintf '${recorded}'\necho refused >&2\n`,
  );
  const out = join(bin, 'out.h264');
  await promisify(execFile)('mkfifo', [out]);

  const [read, { code, stderr }] = await Promise.all([readFile(out, 'utf8'), record(bin, out)]);

  expect(code).toBe(expectedCode);
  expect(read).toBe(recorded);
  expect(stderr).toBe(`recording 1s to ${out}\n${failure}`);
});

test('refuses a recording with nowhere to go', async () => {
  const { code, stderr } = await battle('record');

  expect(code).toBe(1);
  expect(stderr).toContain('record takes one OUT file');
});

/**
 * A working directory holding the cache `run` would otherwise download, so that a run reaches no network. The game
 * master is the least that loads and still names one form, because a run with no form icon to outline stops before it
 * changes the phone; its icon is a single pixel, which outlines as readily as any. The model is the installed
 * Tesseract's own, the one file that cannot be made up, since `run` holds it to the hash of `tessdata_fast` 4.1.0.
 */
function seeded(): string {
  const bulbasaur = {
    templateId: 'V0001_POKEMON_BULBASAUR',
    data: { pokemonSettings: { pokemonId: 'BULBASAUR', stats: {} } },
  };
  const dir = reads([bulbasaur], ['pm1.icon.png']);
  const model = join(dir, '.cache', 'inventory', 'tessdata');

  mkdirSync(model);
  copyFileSync(join(tessdata(), 'eng.traineddata'), join(model, 'eng.traineddata'));

  return dir;
}

/**
 * An `adb` that logs each call's arguments to `$LOG`, one line apiece, and answers as a phone does: the setting as
 * `$SETTING`, and a screenshot that fails, the first thing a run asks of the screen. With `$HANG` it fails only once a
 * `settings put` has been logged, so that a run held at its screenshot is stopped by the test and not by the fake. The
 * `put` takes its time after logging, so that a second one a run started would be logged well before the first ended.
 */
const ADB = `#!/bin/sh
echo "$*" >> "$LOG"
case "$*" in
  get-state) echo device ;;
  'shell settings get '*) echo "$SETTING" ;;
  'shell settings put '*) sleep 0.3 ;;
  shell) cat > /dev/null ;;
  'exec-out screencap')
    i=0
    while [ -n "$HANG" ] && ! grep -q 'settings put' "$LOG" && [ $i -lt 200 ]; do sleep 0.05; i=$((i + 1)); done
    echo 'screencap: no display' >&2
    exit 1 ;;
esac
`;

/**
 * `run` against that `adb`, the setting reading `setting`. Its working directory is the child's own, so a relative
 * `--keep-video` lands there. `calls` is what the `adb` has been asked so far, and `changes` in the result the part of
 * that which changes the phone, taken once the run is over and its directory removed.
 */
function drive(setting: string, args: string[] = [], hang = false) {
  const dir = seeded();
  const bin = join(dir, 'bin');
  const log = join(dir, 'adb.log');

  mkdirSync(bin);
  writeFileSync(join(bin, 'adb'), ADB, { mode: 0o755 });
  writeFileSync(log, '');

  const child = promisify(execFile)('node', [SCRIPT, 'run', '--leader', 'spark', '--league', 'great', ...args], {
    cwd: dir,
    env: {
      ...process.env,
      PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}`,
      LOG: log,
      SETTING: setting,
      HANG: hang ? '1' : '',
    },
    timeout: 30_000,
  });
  const calls = () => readFileSync(log, 'utf8').split('\n').filter(Boolean);

  return {
    process: child.child,
    calls,
    result: child
      .then(
        ({ stderr }) => ({ code: 0, stderr }),
        (error: { code: number; stderr: string }) => error,
      )
      .then(({ code, stderr }) => {
        const changes = calls().filter((call) => /^shell (svc|settings put) /.test(call));
        rmSync(dir, { recursive: true, force: true });

        return { code, stderr, changes };
      }),
  };
}

test.each([
  ['2', '2'],

  // What `awake.test.ts` holds the Battle tab to as well: a setting Android answers with no number is read as off.
  ['null', '0'],
])('puts stay_on_while_plugged_in, found as %j, back as %s where the run fails', async (found, back) => {
  const { code, stderr, changes } = await drive(found).result;

  expect(code).toBe(1);
  expect(stderr).toContain('screencap: no display');
  expect(stderr, 'the seeded cache was not read, so the run went to the network').not.toContain('Downloading');
  expect(changes).toEqual(['shell svc power stayon usb', `shell settings put global stay_on_while_plugged_in ${back}`]);
});

test('puts the setting back once where a signal stops the run, and exits as the signal does', async () => {
  const { calls, process: child, result } = drive('2', [], true);

  // The handler is in place before the phone is changed, which comes before its screen is asked for.
  await expect.poll(() => calls().some((call) => call.startsWith('exec-out')), { timeout: 20_000 }).toBe(true);
  child.kill('SIGTERM');

  // The screenshot fails once the `put` is logged, so the run's own way out follows the handler's; it is the handler's
  // alone that puts the setting back.
  const { code, changes } = await result;

  expect(code, '128 and the signal').toBe(143);
  expect(changes).toEqual(['shell svc power stayon usb', 'shell settings put global stay_on_while_plugged_in 2']);
});

test('tells a --keep-video nothing reached, and still puts the setting back', async () => {
  const { code, stderr, changes } = await drive('2', ['--keep-video', 'video.ts']).result;

  expect(code).toBe(1);
  expect(stderr).toContain('no picture of the screen came, so video.ts is empty');
  expect(changes.at(-1)).toBe('shell settings put global stay_on_while_plugged_in 2');
});

test('refuses a --keep-video it cannot open before the phone is changed', async () => {
  // Under the fake `adb`, which is no directory.
  const { code, stderr, changes } = await drive('2', ['--keep-video', 'bin/adb/video.ts']).result;

  expect(code).toBe(1);
  expect(stderr).toContain('could not write bin/adb/video.ts');
  expect(changes).toEqual([]);
});
