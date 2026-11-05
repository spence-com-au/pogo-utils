/**
 * `bin/adb` and the hooks of `scripts/adb-lease.mts` end to end, each run as a session runs it: the wrapper first on
 * the PATH in front of an `adb` of the test's own, each command in a process session of its own as Claude Code runs a
 * Bash command, and the hooks with their JSON on stdin. A session is a `sleep` standing in for its `claude` process,
 * which is all a lease goes by — its pid and start time — and the lease database and the file naming the session are
 * kept in the test's own directory.
 */

import { type ChildProcess, execFile, execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, test } from 'vitest';

const WRAPPER = fileURLToPath(new URL('../../../bin/adb', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../../../scripts/adb-lease.mts', import.meta.url));

let dir: string;
const running: ChildProcess[] = [];

/**
 * An `adb` that answers `get-serialno` with the phone `-s` names, `PHONE` where it names none and nothing for `GONE`,
 * and writes every other command it is given to `ran`.
 */
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adb-lease-'));
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'sessions'));

  writeFileSync(
    join(dir, 'bin', 'adb'),
    [
      '#!/bin/sh',
      'serial=PHONE',
      '[ "$1" = -s ] && serial=$2',
      'case "$*" in',
      '  *get-serialno) [ "$serial" != GONE ] && echo "$serial" ;;',
      `  *) echo "$*" >> "${dir}/ran" ;;`,
      'esac',
    ].join('\n'),
    { mode: 0o755 },
  );
});

afterEach(() => {
  for (const child of running.splice(0)) {
    child.kill();
  }
});

const ran = () => (existsSync(join(dir, 'ran')) ? readFileSync(join(dir, 'ran'), 'utf8').trimEnd().split('\n') : []);

/**
 * Runs `command` in a process session of its own until the test ends or `kill` ends it, resolving with its pid once it
 * has written its first line.
 */
function start(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<number> {
  const child = spawn(command, args, { env, detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
  running.push(child);

  return new Promise((resolve) => child.stdout.once('data', () => resolve(child.pid ?? 0)));
}

/** Ends the process `start` ran as `pid`, resolving once it has gone. */
async function kill(pid: number) {
  const child = running.find((child) => child.pid === pid);
  const exited = new Promise((resolve) => child?.once('exit', resolve));
  child?.kill();
  await exited;
}

/** A stand-in for a `claude` process, which other sessions know by `name`. */
async function session(name: string): Promise<number> {
  const pid = await start('sh', ['-c', 'echo; exec sleep 1000']);
  writeFileSync(join(dir, 'sessions', `${pid}.json`), JSON.stringify({ name }));
  return pid;
}

/** What a Bash command of the session with process `pid` has in its environment, or a shell outside any session. */
const env = (pid?: number) => ({
  PATH: `${dirname(WRAPPER)}:${join(dir, 'bin')}:${process.env.PATH}`,
  XDG_RUNTIME_DIR: dir,
  CLAUDE_CONFIG_DIR: dir,
  ...(pid && { CLAUDE_PID: String(pid), CLAUDE_CODE_SESSION_ID: `session-${pid}` }),
});

/** `adb …` as a Bash command of `pid`'s, with its exit code and what it wrote to stderr. */
const adb = (pid: number | undefined, ...args: string[]) =>
  promisify(execFile)('setsid', ['-w', 'adb', ...args], { env: env(pid) }).then(
    ({ stderr }) => ({ code: 0, stderr }),
    (error: { code: number; stderr: string }) => error,
  );

const hook = (pid: number, name: string, input: object = {}) =>
  execFileSync('node', [SCRIPT, name], { env: env(pid), input: JSON.stringify(input) });

test('takes a free phone and runs the command', async () => {
  const a = await session('pogo-utils-a');

  expect(await adb(a, 'shell', 'input', 'tap', '1', '1')).toMatchObject({ code: 0 });
  expect(await adb(a, 'exec-out', 'screencap', '-p')).toMatchObject({ code: 0 });
  expect(ran()).toStrictEqual(['shell input tap 1 1', 'exec-out screencap -p']);
});

test('refuses another session, saying who has the phone and how to wait or ask', async () => {
  const a = await session('pogo-utils-a');
  const b = await session('pogo-utils-b');
  await adb(a, 'shell', 'input', 'tap', '1', '1');

  const { code, stderr } = await adb(b, 'shell', 'input', 'tap', '2', '2');

  expect(code).toBe(1);
  expect(stderr).toContain(
    `the phone PHONE is in use by the Claude session pogo-utils-a (session session-${a}, pid ${a},`,
  );
  expect(stderr).toContain('which last ran `adb shell input tap 1 1`');
  expect(stderr).toContain('`until adb -s PHONE get-state');
  expect(stderr).toContain('ask pogo-utils-a for it with SendMessage');
  expect(ran()).toStrictEqual(['shell input tap 1 1']);
});

test('leases each phone apart', async () => {
  const a = await session('pogo-utils-a');
  const b = await session('pogo-utils-b');
  await adb(a, 'shell', 'true');

  expect(await adb(b, '-s', 'OTHER', 'shell', 'true')).toMatchObject({ code: 0 });
  expect(await adb(a, '-s', 'OTHER', 'shell', 'true')).toMatchObject({ code: 1 });
});

test('leaves alone what reaches no phone, and a shell outside any session', async () => {
  const a = await session('pogo-utils-a');
  const b = await session('pogo-utils-b');
  await adb(a, 'shell', 'true');

  expect(await adb(b, 'devices')).toMatchObject({ code: 0 });
  expect(await adb(b, '--version')).toMatchObject({ code: 0 });
  expect(await adb(b, '-s', 'GONE', 'shell', 'true')).toMatchObject({ code: 0 });
  expect(await adb(undefined, 'shell', 'true')).toMatchObject({ code: 0 });
  expect(ran()).toStrictEqual(['shell true', 'devices', '--version', '-s GONE shell true', 'shell true']);
});

test('frees the phone of a session that has gone', async () => {
  const a = await session('pogo-utils-a');
  const b = await session('pogo-utils-b');
  await adb(a, 'shell', 'true');
  await kill(a);

  expect(await adb(b, 'shell', 'true')).toMatchObject({ code: 0 });
});

test('lets go at the end of a turn with nothing that reached the phone still running, whatever else is', async () => {
  const a = await session('pogo-utils-a');
  const b = await session('pogo-utils-b');
  await adb(a, 'shell', 'true');
  hook(a, 'stop', { background_tasks: [{ type: 'shell', status: 'running' }] });

  expect(await adb(b, 'shell', 'true')).toMatchObject({ code: 0 });
});

test('keeps the phone past the end of a turn while a command that reached it runs on', async () => {
  const a = await session('pogo-utils-a');
  const b = await session('pogo-utils-b');
  const battle = await start('sh', ['-c', 'adb shell true && echo && exec sleep 1000'], env(a));
  hook(a, 'stop');

  expect(await adb(b, 'shell', 'true')).toMatchObject({ code: 1 });

  await kill(battle);
  hook(a, 'stop');

  expect(await adb(b, 'shell', 'true')).toMatchObject({ code: 0 });
});

test.each(['subagent', 'workflow', 'teammate'])(
  'keeps the phone past the end of a turn while a background %s runs',
  async (type) => {
    const a = await session('pogo-utils-a');
    const b = await session('pogo-utils-b');
    await adb(a, 'shell', 'true');
    hook(a, 'stop', { background_tasks: [{ type, status: 'running' }] });

    expect(await adb(b, 'shell', 'true')).toMatchObject({ code: 1 });
  },
);

test('lets go as the session ends, whatever is still running', async () => {
  const a = await session('pogo-utils-a');
  const b = await session('pogo-utils-b');
  await start('sh', ['-c', 'adb shell true && echo && exec sleep 1000'], env(a));
  hook(a, 'end');

  expect(await adb(b, 'shell', 'true')).toMatchObject({ code: 0 });
});

test.each([
  ['a free phone', false],
  ['a phone its holder left behind', true],
])('gives %s to exactly one of the sessions racing for it', async (_, abandoned) => {
  if (abandoned) {
    const gone = await session('pogo-utils-gone');
    await adb(gone, 'shell', 'true');
    await kill(gone);
  }

  const sessions = await Promise.all([...Array(8).keys()].map((i) => session(`pogo-utils-${i}`)));
  const codes = await Promise.all(sessions.map(async (pid) => (await adb(pid, 'shell', 'true')).code));

  expect(codes.filter((code) => code === 0)).toHaveLength(1);
});

test('puts the wrapper first on the PATH of a starting session, and names it as `ADB` for scrcpy', async () => {
  const a = await session('pogo-utils-a');
  const file = join(dir, 'env.sh');
  execFileSync('node', [SCRIPT, 'start'], { env: { ...env(a), CLAUDE_ENV_FILE: file } });

  const sourced = execFileSync('sh', ['-c', `. '${file}'; command -v adb; echo "$ADB"`], {
    env: { PATH: '/usr/bin:/bin' },
  });

  expect(sourced.toString()).toBe(`${WRAPPER}\n${WRAPPER}\n`);
});

/**
 * As a session started from another's Bash command has it: its own checkout's `bin/` first on the PATH and the other
 * checkout's after, which it inherited — or the other way about.
 */
test("reaches the real adb past another checkout's wrapper on the PATH", async () => {
  const other = join(dir, 'other');
  cpSync(dirname(WRAPPER), join(other, 'bin'), { recursive: true });
  cpSync(SCRIPT, join(other, 'scripts', 'adb-lease.mts'));
  const a = await session('pogo-utils-a');

  for (const wrappers of [
    [dirname(WRAPPER), join(other, 'bin')],
    [join(other, 'bin'), dirname(WRAPPER)],
  ]) {
    await promisify(execFile)('setsid', ['-w', 'adb', 'shell', 'true'], {
      env: { ...env(a), PATH: [...wrappers, join(dir, 'bin'), process.env.PATH].join(':') },
    });
  }

  expect(ran()).toStrictEqual(['shell true', 'shell true']);
});
