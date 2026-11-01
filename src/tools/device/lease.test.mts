/**
 * The hooks end to end, each run as `.claude/settings.json` runs it: the script under a `claude` process, with the
 * hook's JSON on stdin. The `claude` here is `/bin/sh` by a link of that name, which is all the lease goes by, so each
 * one stands for a session — several hooks run from one script are one session's, and two scripts are two sessions.
 * The hook's JSON is handed over in files rather than piped, because a shell forks a copy of itself for a pipeline,
 * and that copy, named `claude` too, would be a second session in the middle of the first.
 */

import { devicesReached, type Lease } from './lease.mts';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../scripts/device-lease.mts', import.meta.url));

test.each<[string, (string | undefined)[]]>([
  ['adb -s A shell input tap 1 1', ['A']],
  ['adb shell screencap -p > shot.png', [undefined]],
  ['timeout 30 adb -s A exec-out screencap -p', ['A']],
  ['timeout -s KILL -k 5 30 adb -s A shell true', ['A']],
  ['nice -n 10 adb -s A shell true', ['A']],
  ['time -p adb -s A shell true', ['A']],
  ['env -u ANDROID_SERIAL ANDROID_SERIAL=B adb shell true', ['B']],
  ['exec -a phone adb -s A shell true', ['A']],
  ['ANDROID_SERIAL=B adb shell true', ['B']],
  ['cd x && ~/platform-tools/adb -s A pull /sdcard/f', ['A']],
  ['echo $(adb -s A shell wm size)', ['A']],
  ['scrcpy --serial=C --turn-screen-off', ['C']],
  ['pnpm battle run --league ultra --serial A', ['A']],
  ['pnpm run inventory snap --search pikachu', [undefined]],
  ['node scripts/battle.mts record out.h264', [undefined]],
  ['adb -s A shell true; adb -s B shell true', ['A', 'B']],
  ['timeout 30 \\\n  adb -s A shell input tap 1 1', ['A']],
  ['adb \\\n  -s A shell true', ['A']],
  ['ANDROID_SERIAL=B \\\n adb shell true', ['B']],
  ['for i in 1 2 3; do adb -s A shell input tap 1 1; done', ['A']],
  ['until adb -s A shell pidof com.nianticlabs.pokemongo; do sleep 1; done', ['A']],
  ['if true; then adb -s A shell true; else adb -s B shell true; fi', ['A', 'B']],
  ['{ adb -s A shell true; } && ! adb -s B shell false', ['A', 'B']],
  ['nohup sudo -u josh adb -s A shell true', ['A']],
  ['echo A | xargs -I {} adb -s A shell true', ['A']],
  ['command adb -s A shell true', ['A']],
  ['adb shell du -s /sdcard/DCIM', [undefined]],
  ['adb -H localhost -s A shell ls -s', ['A']],
  ['adb -s "A" shell true', ['A']],
  ["ANDROID_SERIAL='B' adb shell true", ['B']],
  ['size="$(adb -s A shell wm size)"', ['A']],
  ['git log # then adb -s A shell true', []],
  ['cat <<EOF | adb -s A shell sh\nadb -s B shell true\nEOF\nadb -s C shell true', ['A', 'C']],
])('`%s` reaches %j', (command, serials) => {
  expect(devicesReached(command)).toEqual(serials);
});

test.each([
  'rg adb src',
  'git commit -m "Read the adb serial"',
  'git commit -m "Fix the race; adb -s A shell keeps its lease"',
  "echo 'a | adb shell'",
  "git commit -F - <<'EOF'\nLease the phone\n\nadb shell input tap 1 2\nEOF",
  'gh pr create --body "$(cat <<\'EOF\'\nadb shell input tap 1 2\nEOF\n)"',
  'adb devices -l',
  'adb version',
  'pnpm inventory parse shot.png',
  'pnpm battle help',
  'pnpm test',
])('`%s` reaches no phone', (command) => {
  expect(devicesReached(command)).toEqual([]);
});

const scratch = mkdtempSync(join(tmpdir(), 'device-lease-'));
const bin = join(scratch, 'bin');
const CLAUDE = join(bin, 'claude');
spawnSync('mkdir', [bin]);
symlinkSync('/bin/sh', CLAUDE);

const runtime = mkdtempSync(join(scratch, 'run-'));
const env: NodeJS.ProcessEnv = {
  ...process.env,
  PATH: `${bin}:${process.env.PATH}`,
  XDG_RUNTIME_DIR: runtime,
  HOOK: SCRIPT,
};
delete env.ANDROID_SERIAL;

const DIR = join(runtime, 'pogo-utils-device');

const leaseOf = (serial: string) => {
  const path = join(DIR, `${serial}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Lease) : undefined;
};

let inputs = 0;

/** A file holding the hook's JSON, for a Bash command where one is given. */
const input = (command?: string) => {
  const path = join(scratch, `input-${inputs++}.json`);
  writeFileSync(path, JSON.stringify({ session_id: 's', cwd: '/w', tool_input: command && { command } }));
  return path;
};

/** Runs `script` as one session, `$$` its pid, and answers what it printed. */
const session = (script: string) => {
  const { stdout, stderr } = spawnSync(CLAUDE, ['-c', script], { env, encoding: 'utf8', timeout: 20_000 });
  return { stdout, stderr };
};

const holders: number[] = [];
afterEach(() => {
  for (const pid of holders.splice(0)) {
    process.kill(-pid);
  }
});

/** A session that takes the lease `command` reaches and keeps running, answering its pid once it holds it. */
const holder = (command: string) =>
  new Promise<number>((resolve) => {
    const child = spawn(CLAUDE, ['-c', `node "$HOOK" pre < ${input(command)}; echo ready; sleep 60 & wait`], {
      env,
      detached: true,
    });
    const pid = child.pid ?? 0;
    holders.push(pid);
    child.stdout.on('data', () => resolve(pid));
  });

test('takes a free lease, naming the session and the command', () => {
  const { stdout } = session(`node "$HOOK" pre < ${input('adb -s A1 shell input tap 1 1')}; echo "$? $$"`);

  const [status, pid] = stdout.trim().split(' ');
  expect(status).toBe('0');
  expect(leaseOf('A1')).toMatchObject({
    pid: Number(pid),
    session: 's',
    cwd: '/w',
    command: 'adb -s A1 shell input tap 1 1',
  });
});

test.each(['rg adb src', 'adb -s ../escape shell true', 'adb -s .. shell true'])(
  'takes no lease for `%s`, which reaches no phone',
  (command) => {
    const files = () => [...readdirSync(runtime), ...(existsSync(DIR) ? readdirSync(DIR) : [])];
    const before = files();

    const { stdout } = session(`node "$HOOK" pre < ${input(command)}; echo $?`);

    expect(stdout.trim()).toBe('0');
    expect(files()).toEqual(before);
  },
);

test("refuses a phone another live session holds, saying whose it is, and keeps that session's lease", async () => {
  const pid = await holder('pnpm battle run --serial A2');

  const { stdout, stderr } = session(`node "$HOOK" pre < ${input('adb -s A2 shell true')}; echo $?`);

  expect(stdout.trim()).toBe('2');
  expect(stderr).toContain(`The phone A2 is leased to another Claude session: pid ${pid}`);
  expect(stderr).toContain('last running `pnpm battle run --serial A2`');
  expect(leaseOf('A2')?.pid).toBe(pid);
});

test('lets a second phone go to another session', async () => {
  await holder('adb -s A3 shell true');

  const { stdout } = session(`node "$HOOK" pre < ${input('adb -s B3 shell true')}; echo "$? $$"`);

  const [status, pid] = stdout.trim().split(' ');
  expect(status).toBe('0');
  expect(leaseOf('B3')?.pid).toBe(Number(pid));
});

test('takes over a lease whose session has gone', () => {
  const { stdout: first } = session(`node "$HOOK" pre < ${input('adb -s A4 shell true')}; echo $$`);
  const { stdout: second } = session(`node "$HOOK" pre < ${input('adb -s A4 shell true')}; echo "$? $$"`);

  const [status, pid] = second.trim().split(' ');
  expect(status).toBe('0');
  expect(Number(pid)).not.toBe(Number(first.trim()));
  expect(leaseOf('A4')?.pid).toBe(Number(pid));
});

test('gives an abandoned lease to exactly one of the live sessions racing for it', async () => {
  session(`node "$HOOK" pre < ${input('adb -s A10 shell true')}`);

  const statuses = await Promise.all(
    Array.from(
      { length: 8 },
      () =>
        new Promise<string>((resolve) => {
          const child = spawn(
            CLAUDE,
            ['-c', `node "$HOOK" pre < ${input('adb -s A10 shell true')} 2>/dev/null; echo $?; sleep 60 & wait`],
            { env, detached: true },
          );

          holders.push(child.pid ?? 0);
          child.stdout.on('data', (data: Buffer) => resolve(data.toString().trim()));
        }),
    ),
  );

  expect(statuses.sort()).toEqual(['0', '2', '2', '2', '2', '2', '2', '2']);
  expect(readdirSync(DIR).filter((name) => name.startsWith('A10.'))).toEqual(['A10.json']);
});

test('renews its own lease, keeping when it was taken', () => {
  const { stdout } = session(
    `node "$HOOK" pre < ${input('adb -s A5 shell true')}; cat "$XDG_RUNTIME_DIR/pogo-utils-device/A5.json"; echo` +
      `; sleep 0.01; node "$HOOK" pre < ${input('pnpm battle record --serial A5 out.h264')}; echo $?`,
  );

  const [first, status] = stdout.trim().split('\n');
  expect(status).toBe('0');
  expect(leaseOf('A5')).toMatchObject({
    command: 'pnpm battle record --serial A5 out.h264',
    since: (JSON.parse(first ?? '') as Lease).since,
  });
});

test("takes the lease on the one phone attached where the command names none, and none where it can't tell", () => {
  const adb = join(scratch, 'adb-one');
  spawnSync('mkdir', [adb]);
  writeFileSync(join(adb, 'adb'), '#!/bin/sh\nprintf "List of devices attached\\nONLY\\tdevice\\n"\n', { mode: 0o755 });

  session(`PATH="${adb}:$PATH" node "$HOOK" pre < ${input('adb shell true')}`);
  const { stdout } = session(
    `ANDROID_SERIAL= PATH=/nonexistent:$PATH node "$HOOK" pre < ${input('adb shell')}; echo $?`,
  );

  expect(leaseOf('ONLY')).toBeDefined();
  expect(stdout.trim()).toBe('0');
});

test('lets go at the end of a turn with nothing on the phone', () => {
  session(`node "$HOOK" pre < ${input('adb -s A6 shell true')}; node "$HOOK" stop < ${input()}`);

  expect(leaseOf('A6')).toBeUndefined();
});

test('keeps the lease through the end of a turn while something it started still runs on the phone', () => {
  const { stdout } = session(
    `node "$HOOK" pre < ${input('adb -s A7 shell true')}; sh -c 'sleep 30; :' adb >/dev/null & ` +
      `node "$HOOK" stop < ${input()}; cat "$XDG_RUNTIME_DIR/pogo-utils-device/A7.json"; pkill -P $!; kill $!`,
  );

  expect(stdout).toContain('"command":"adb -s A7 shell true"');
});

test("keeps another session's lease through its own turn's end", async () => {
  const pid = await holder('adb -s A8 shell true');

  session(`node "$HOOK" stop < ${input()}`);

  expect(leaseOf('A8')?.pid).toBe(pid);
});

test('lets go as the session ends, running or not', () => {
  session(
    `node "$HOOK" pre < ${input('adb -s A9 shell true')}; sh -c 'sleep 30; :' adb >/dev/null & ` +
      `node "$HOOK" end < ${input()}; pkill -P $!; kill $!`,
  );

  expect(leaseOf('A9')).toBeUndefined();
});
