/**
 * `bin/adb` and the hooks of `scripts/adb-lease.mts` end to end, each run as a session runs it: the wrapper first on
 * the PATH in front of an `adb` of the test's own, each command in a process session of its own as Claude Code runs a
 * Bash command, and the hooks with their JSON on stdin. A session is a `sleep` standing in for its `claude` process,
 * which is all a lease goes by — its pid and start time — and the lease database and the file naming the session are
 * kept in the test's own directory.
 */

import { type ChildProcess, execFile, execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const WRAPPER = fileURLToPath(new URL('../../../bin/adb', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../../../scripts/adb-lease.mts', import.meta.url));
const SETTINGS = fileURLToPath(new URL('../../../.claude/settings.json', import.meta.url));

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
function start(command: string, args: string[], environment?: NodeJS.ProcessEnv): Promise<number> {
  const child = spawn(command, args, { env: environment, detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
  running.push(child);

  return new Promise((resolve) => child.stdout.once('data', () => resolve(child.pid ?? 0)));
}

/** Ends the process `start` ran as `pid`, resolving once it has gone. */
async function kill(pid: number) {
  const child = running.find((spawned) => spawned.pid === pid);
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

/** What Claude Code runs a Bash or Monitor command by: `bash` given a script that `eval`s it single-quoted. */
const script = (command: string) => ['-c', `eval '${command.replaceAll("'", `'"'"'`)}' < /dev/null`];

/** Runs the `PreToolUse` hooks of a `tool` command of `pid`'s subagent `agent`, or of the session's own where none. */
const note = (pid: number, agent: string | undefined, command: string, tool = 'Bash') =>
  settingsHooks(pid, 'PreToolUse', tool, {
    ...(agent && { agent_id: agent }),
    tool_name: tool,
    tool_input: { command },
  });

/** `command` as a Bash command of `pid`'s already noted, in a process session of its own. */
const run = (pid: number, command: string) =>
  promisify(execFile)('setsid', ['-w', 'bash', ...script(command)], { env: env(pid) }).then(
    ({ stderr }) => ({ code: 0, stderr }),
    (error: { code: number; stderr: string }) => error,
  );

/** `command` as a Bash command of `pid`'s subagent `agent`, or of the session's own where it is none. */
function bash(pid: number, agent: string | undefined, command: string) {
  note(pid, agent, command);
  return run(pid, command);
}

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

test.each([
  ['has no file', undefined],
  ['has a file that is not JSON', 'not json'],
  ['has a file that names it no one', '{"name":7}'],
])('refuses another session without a name where the holder %s', async (_, contents) => {
  const a = await session('pogo-utils-a');
  const b = await session('pogo-utils-b');
  await adb(a, 'shell', 'true');

  if (contents === undefined) {
    rmSync(join(dir, 'sessions', `${a}.json`));
  } else {
    writeFileSync(join(dir, 'sessions', `${a}.json`), contents);
  }

  const { code, stderr } = await adb(b, 'shell', 'true');

  expect(code).toBe(1);
  expect(stderr).toContain('the phone PHONE is in use by another Claude session (session');
  expect(stderr).toContain('or find that session with ListAgents and ask it with SendMessage.');
});

test('fails where no adb is on the PATH besides the wrapper', async () => {
  const { code, stderr } = await promisify(execFile)(process.execPath, [SCRIPT, 'adb', 'shell', 'true'], {
    env: { ...env(), PATH: dirname(WRAPPER) },
  }).then(
    () => ({ code: 0, stderr: '' }),
    (error: { code: number; stderr: string }) => error,
  );

  expect(code).not.toBe(0);
  expect(stderr).toContain('no adb on the PATH besides the lease wrappers');
});

test('leases each phone apart', async () => {
  const a = await session('pogo-utils-a');
  const b = await session('pogo-utils-b');
  await adb(a, 'shell', 'true');

  expect(await adb(b, '-s', 'OTHER', 'shell', 'true')).toMatchObject({ code: 0 });
  expect(await adb(a, '-s', 'OTHER', 'shell', 'true')).toMatchObject({ code: 1 });
});

test('refuses what acts on every phone while another session holds any, taking none itself', async () => {
  const a = await session('pogo-utils-a');
  const b = await session('pogo-utils-b');
  await adb(a, '-s', 'OTHER', 'shell', 'true');

  const { code, stderr } = await adb(b, 'kill-server');

  expect(code).toBe(1);
  expect(stderr).toContain('the phone OTHER is in use by the Claude session pogo-utils-a');
  expect(await adb(b, '-s', 'PHONE', 'disconnect')).toMatchObject({ code: 1 });
  expect(await adb(a, 'kill-server')).toMatchObject({ code: 0 });

  hook(a, 'end');

  expect(await adb(b, 'disconnect')).toMatchObject({ code: 0 });
  expect(await adb(a, 'shell', 'true')).toMatchObject({ code: 0 });
  expect(ran()).toStrictEqual(['-s OTHER shell true', 'kill-server', 'disconnect', 'shell true']);
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

test('lets go when run by hand, with nothing on stdin', async () => {
  const a = await session('pogo-utils-a');
  const b = await session('pogo-utils-b');
  await adb(a, 'shell', 'true');
  execFileSync('node', [SCRIPT, 'stop'], { env: env(a), input: '' });

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

test.each(['Bash', 'Monitor'])(
  "refuses a subagent's %s command while another of its session's holds the phone, saying which",
  async (tool) => {
    const a = await session('pogo-utils-a');
    await bash(a, 'fork-1', "adb shell input text 'one'");
    note(a, 'fork-2', "adb shell input text 'one'", tool);

    const { code, stderr } = await run(a, "adb shell input text 'one'");

    expect(code).toBe(1);
    expect(stderr).toContain('the phone PHONE is in use by fork-1, another subagent of this Claude session');
    expect(stderr).toContain('which last ran `adb shell input text one`');
    expect(stderr).toContain('`until adb -s PHONE get-state');
    expect(ran()).toStrictEqual(['shell input text one']);
  },
);

test('shares the phone between a session and each of its subagents, which carry on with it past its turn', async () => {
  const a = await session('pogo-utils-a');
  const b = await session('pogo-utils-b');
  await adb(a, 'shell', 'true');
  hook(a, 'stop', { background_tasks: [{ type: 'subagent', status: 'running' }] });

  expect(await bash(a, 'fork-1', 'adb shell true')).toMatchObject({ code: 0 });
  expect(await bash(a, undefined, 'adb shell true')).toMatchObject({ code: 0 });
  expect(await adb(b, 'shell', 'true')).toMatchObject({ code: 1 });
});

test('lets go as a subagent finishes of what it took, and of nothing its session holds', async () => {
  const a = await session('pogo-utils-a');
  const b = await session('pogo-utils-b');
  await adb(a, '-s', 'OTHER', 'shell', 'true');
  await bash(a, 'fork-1', 'adb shell true');
  settingsHooks(a, 'SubagentStop', 'general-purpose', {
    agent_id: 'fork-1',
    background_tasks: [{ type: 'subagent', status: 'running' }],
  });

  expect(await bash(a, 'fork-2', 'adb shell true')).toMatchObject({ code: 0 });
  expect(await adb(b, '-s', 'OTHER', 'shell', 'true')).toMatchObject({ code: 1 });
});

test('keeps the phone for a command a finished subagent left on it, and lets go as that ends', async () => {
  const a = await session('pogo-utils-a');
  const go = join(dir, 'go');
  execFileSync('mkfifo', [go]);
  const battle = `adb shell true && echo && read -r _ < ${go} && adb shell true && exec sleep 1000`;
  note(a, 'fork-1', battle);
  const pid = await start('bash', script(battle), env(a));
  hook(a, 'stop', { agent_id: 'fork-1' });
  writeFileSync(go, '\n');
  await vi.waitFor(() => expect(ran()).toHaveLength(2));

  const { code, stderr } = await bash(a, 'fork-2', 'adb shell true');

  expect(code).toBe(1);
  expect(stderr).toContain('It has finished, and the phone is free once the command it left running ends.');

  await kill(pid);

  expect(await bash(a, 'fork-2', 'adb shell true')).toMatchObject({ code: 0 });
});

test('holds the phone between the commands of a finished subagent resumed with SendMessage', async () => {
  const a = await session('pogo-utils-a');
  const battle = 'adb shell true && echo && exec sleep 1000';
  note(a, 'fork-1', battle);
  const pid = await start('bash', script(battle), env(a));
  hook(a, 'stop', { agent_id: 'fork-1' });

  expect(await bash(a, 'fork-1', 'adb shell input tap 1 1')).toMatchObject({ code: 0 });

  await kill(pid);

  expect(await bash(a, 'fork-2', 'adb shell true')).toMatchObject({ code: 1 });
});

test('gives a phone to exactly one of the subagents of a session racing for it', async () => {
  const a = await session('pogo-utils-a');
  const commands = [...Array(8).keys()].map((i) => `adb shell echo ${i}`);
  commands.forEach((command, i) => note(a, `fork-${i}`, command));

  const codes = await Promise.all(commands.map(async (command) => (await run(a, command)).code));

  expect(codes.filter((code) => code === 0)).toHaveLength(1);
});

/**
 * Runs the hooks `.claude/settings.json` gives `event` as Claude Code runs them, for those whose matcher, a regular
 * expression, matches `type`: the error or notification type the event fired for. `input` is what the event is given,
 * which for any but `Stop` carries no `background_tasks`.
 */
function settingsHooks(pid: number, event: string, type = '', input: object = {}) {
  const { hooks } = JSON.parse(readFileSync(SETTINGS, 'utf8')) as {
    hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
  };

  const matching = (hooks[event] ?? []).filter(({ matcher }) => !matcher || new RegExp(`^(?:${matcher})$`).test(type));

  for (const { command } of matching.flatMap((entry) => entry.hooks)) {
    execFileSync('sh', ['-c', command], {
      env: { ...env(pid), CLAUDE_PROJECT_DIR: dirname(dirname(SETTINGS)) },
      input: JSON.stringify({ hook_event_name: event, ...input }),
    });
  }
}

test.each([
  ['a turn ends', 'Stop', '', { background_tasks: [] }],
  ['a session sits idle after an interrupted or failed turn', 'Notification', 'idle_prompt', {}],
])('lets go as %s', async (_, event, type, input) => {
  const a = await session('pogo-utils-a');
  const b = await session('pogo-utils-b');
  await adb(a, 'shell', 'true');
  settingsHooks(a, event, type, input);

  expect(await adb(b, 'shell', 'true')).toMatchObject({ code: 0 });
});

// `StopFailure` is not told whether a background subagent still runs, and a permission prompt comes mid-turn, so
// letting go on either could hand the phone over between commands that are still using it.
test.each([
  ['an API error ends a turn', 'StopFailure', 'rate_limit'],
  ['a session waits on a permission prompt mid-turn', 'Notification', 'permission_prompt'],
])('keeps the phone as %s', async (_, event, type) => {
  const a = await session('pogo-utils-a');
  const b = await session('pogo-utils-b');
  await adb(a, 'shell', 'true');
  settingsHooks(a, event, type);

  expect(await adb(b, 'shell', 'true')).toMatchObject({ code: 1 });
});

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
