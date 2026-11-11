/**
 * Makes the Claude sessions sharing a plugged-in phone take turns with it, so that two never tap over each other. Run
 * by `bin/adb` and by the hooks `.claude/settings.json` declares:
 *
 *   node scripts/adb-lease.mts start   as a session starts: put `bin/` first on the PATH of its Bash commands and
 *                                      name `bin/adb` as `ADB`, so that the `adb` they run is the one there
 *   node scripts/adb-lease.mts bash    as a Bash or Monitor command is about to run: note it and the subagent running
 *                                      it, if any, so that the `adb` it runs can tell whose it is
 *   node scripts/adb-lease.mts adb …   from that `adb`: take the lease on the phone its arguments reach and become the
 *                                      real `adb`, or refuse while another session or another of the session's
 *                                      subagents holds it, saying which
 *   node scripts/adb-lease.mts stop    as a turn ends: let go of the session's leases, unless a command that reached
 *                                      the phone is still running or a background agent is. `Stop` runs it, and the
 *                                      `idle_prompt` notification about a minute later for a turn that fires no `Stop`:
 *                                      one interrupted with `Esc` or ended by an API error. Not `StopFailure`, which is
 *                                      given no `background_tasks`, while `idle_prompt` never comes as long as a
 *                                      background subagent runs. And as a subagent finishes, from `SubagentStop`: let
 *                                      go of what its own commands took, but for any still running, which keep the
 *                                      session's other subagents off the phone until they end
 *   node scripts/adb-lease.mts end     as the session ends: let go of its leases
 *
 * A lease is taken by `adb` itself rather than by reading Bash commands as they are run, because every way to the phone
 * runs `adb`: by hand and from `pnpm battle`, `pnpm inventory` and `pnpm adb` by `execFile`, off the PATH, and from
 * scrcpy, which runs the one `ADB` names, and otherwise the one on the PATH or, in a portable build, its own. No
 * command can be written so as to slip past it, short of naming the real `adb` by its path.
 *
 * A session is its `claude` process, `CLAUDE_PID`, which Claude Code sets for its Bash commands and its hooks alike,
 * and a lease whose process has gone is one a crash left behind, free for the next session to take. A subagent's
 * commands come from its parent's process too, and share its lease, so that one carrying on the session's work after
 * the session's turn has ended goes on with the phone the session took. Two subagents of one session, though, as forks
 * run side by side, take turns with it as two sessions do. Nothing in a command's environment says which subagent runs
 * it, so the `bash` hook, which is told, notes each command before it runs, and `adb` finds its own among them. The
 * leases are rows of one database outside the checkout, where every worktree finds them, and each change to them is a
 * transaction, which is what lets sessions racing for a phone, or for one a crash left behind, settle on exactly one
 * holder.
 *
 * A session and its commands are told apart by what `/proc` says of them, so the lease holds on Linux alone. Elsewhere,
 * macOS among them, `adb` takes no lease and runs the real one unchecked, and the hooks have nothing to let go of.
 */

import { execFileSync } from 'node:child_process';
import { accessSync, appendFileSync, constants, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

/** A Bash command's use of a phone for a session. The rows for a phone are its lease, and are all one session's. */
interface Use {
  serial: string;
  pid: number;
  session: string;
  cwd: string;
  since: string;
  args: string;

  /** The process session the command runs in, which Claude Code starts one of for each Bash command. */
  command: number;

  /** When `pid` started, in `/proc`'s ticks, which tells the session apart from a process given its pid since. */
  started: string;
}

/** A use with the subagent whose command took it, or `''` where the session's own command or an older script did. */
interface Held extends Use {
  agent: string;

  /** Whether that subagent has finished, leaving the command running. */
  done: number;
}

/** The directory holding the `adb` that stands in front of the real one. */
const WRAPPER = fileURLToPath(new URL('../bin', import.meta.url));

/**
 * The commands a session runs to look around, which reach no phone and so take no lease and are never refused. Any
 * other command but those of `EVERY` leases the phone `get-serialno` names, among them the host commands that reach
 * none — `connect`, `pair`, `start-server` — which are rare enough here to be held back with the rest.
 */
const HOST = new Set(['devices', 'help', 'version']);

/**
 * The commands that act on more phones than the one `get-serialno` names, whatever `-s` says, so that leasing it would
 * not hold them back: `kill-server` cuts every session's connection, and `disconnect` every wireless one or the one at
 * the address it is given. They take no lease, there being no one phone to take, and are refused while another session
 * holds any.
 */
const EVERY = new Set(['disconnect', 'kill-server']);

/** The options `adb` takes ahead of its command that take the next argument as their value. */
const VALUED = new Set(['-s', '-t', '-H', '-P', '-L', '--one-device']);

/**
 * Where in `/proc/<pid>/stat` a process's session and start time are, counted from the field after its name, which
 * is the last to end in `)` because the name can hold spaces and parentheses of its own.
 */
const SESSION = 3;
const STARTED = 19;

const stat = (pid: number | string) => {
  try {
    const line = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return line.slice(line.lastIndexOf(')') + 2).split(' ');
  } catch {
    return undefined;
  }
};

/** Whether the session that took `use` is still running, which a pid reused by another process since is not. */
const live = (use: Pick<Use, 'pid' | 'started'>) => stat(use.pid)?.[STARTED] === use.started;

function open(): DatabaseSync {
  const dir = join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), 'pogo-utils');
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'adb-lease.sqlite'), { timeout: 10_000 });

  db.exec(`CREATE TABLE IF NOT EXISTS use (
    serial TEXT NOT NULL,
    command INTEGER NOT NULL,
    pid INTEGER NOT NULL,
    started TEXT NOT NULL,
    session TEXT NOT NULL,
    cwd TEXT NOT NULL,
    since TEXT NOT NULL,
    args TEXT NOT NULL,
    PRIMARY KEY (serial, command)
  )`);

  // Kept apart from `use` because a checkout with an older copy of this script writes rows there by position.
  db.exec(`CREATE TABLE IF NOT EXISTS agent (
    serial TEXT NOT NULL,
    command INTEGER NOT NULL,
    agent TEXT NOT NULL,
    PRIMARY KEY (serial, command)
  )`);

  // The subagents that have finished leaving a command on the phone, which holds it only until it ends.
  db.exec('CREATE TABLE IF NOT EXISTS finished (agent TEXT PRIMARY KEY)');

  // `at` is when the `bash` hook that noted the command started, in `/proc`'s ticks.
  db.exec(`CREATE TABLE IF NOT EXISTS bash (
    pid INTEGER NOT NULL,
    started TEXT NOT NULL,
    agent TEXT NOT NULL,
    at INTEGER NOT NULL,
    input TEXT NOT NULL
  )`);

  return db;
}

/**
 * `work` with every other lease change waiting for it, from its first read to its last write. `IMMEDIATE` because a
 * transaction left to take the write lock at its first write lets two sessions read the same free phone, and SQLite
 * then fails whichever of them comes second to write outright rather than having it wait.
 */
function exclusively<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');

  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const executable = (path: string) => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * The `adb` the wrapper stands in front of: the first on the PATH in no checkout's `bin/`, which is told by the lease
 * script beside it. Passing over this checkout's alone would not do: a session started from another's Bash command
 * inherits that checkout's `bin/` behind its own, and each wrapper would take the other for the real `adb` and run it,
 * for ever.
 */
function realAdb(): string {
  const adb = (process.env.PATH ?? '')
    .split(':')
    .filter((dir) => !existsSync(join(dir, '..', 'scripts', 'adb-lease.mts')))
    .map((dir) => join(dir, 'adb'))
    .find(executable);

  if (!adb) {
    throw new Error('adb: no adb on the PATH besides the lease wrappers');
  }

  return adb;
}

/**
 * The phone `adb` would reach given `options`, which `adb` answers itself: `-s`, `-d`, `-t` and `ANDROID_SERIAL`, or
 * the only phone attached. Nothing where it would reach none, or cannot tell which, which is a command that fails
 * without reaching a phone either.
 */
function reached(adb: string, options: string[]): string | undefined {
  try {
    return execFileSync(adb, [...options, 'get-serialno'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * The name other sessions message the one with process `pid` by, from the file Claude Code keeps for each session it
 * runs. That file is its own rather than anything it documents, so a refusal does without the name where it is missing
 * or reads differently.
 */
function sessionName(pid: number): string | undefined {
  const dir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');

  try {
    const { name } = JSON.parse(readFileSync(join(dir, 'sessions', `${pid}.json`), 'utf8')) as { name?: unknown };
    return typeof name === 'string' ? name : undefined;
  } catch {
    return undefined;
  }
}

/** What a command refused the phone is told: who has it, and how to wait for it or ask for it. */
function refusal(held: Held): string {
  const until = `until adb -s ${held.serial} get-state >/dev/null 2>&1; do sleep 30; done`;
  const wait = `Wait for it in the background with \`${until}\`, which takes the phone the moment it is free`;

  if (held.pid === claudePid) {
    return [
      `adb: the phone ${held.serial} is in use by ${held.agent}, another subagent of this Claude session`,
      `(working in ${held.cwd}), which last ran \`adb ${held.args}\` on it at ${held.since}.`,
      held.done
        ? 'It has finished, and the phone is free once the command it left running ends.'
        : 'It lets go of the phone as it finishes.',
      `${wait}.`,
      'Do not run the real adb by its path to get past this.',
    ].join(' ');
  }

  const name = sessionName(held.pid);

  return [
    `adb: the phone ${held.serial} is in use by ${name ? `the Claude session ${name}` : 'another Claude session'}`,
    `(session ${held.session}, pid ${held.pid}, working in ${held.cwd}),`,
    `which last ran \`adb ${held.args}\` on it at ${held.since}.`,
    'That session lets go of it when it ends a turn with nothing it started still on the phone,',
    'or about a minute after an interrupted or failed one, or exits.',
    `${wait},`,
    name
      ? `or ask ${name} for it with SendMessage.`
      : 'or find that session with ListAgents and ask it with SendMessage.',
    'Do not run the real adb by its path to get past this.',
  ].join(' ');
}

/** `input` as the script Claude Code runs a Bash or Monitor command with has it: single-quoted, for `eval`. */
const evaled = (input: string) => `eval '${input.replaceAll("'", `'"'"'`)}'`;

/**
 * The subagent whose Bash or Monitor command runs in process session `command`, or `''` for one of the session's own or
 * one the `bash` hook never noted. Its `bash` starts once the hook has noted it, so of the commands noted with the text
 * its script runs, it is the one whose hook started last before then. Another subagent's command with the same text
 * whose hook starts in between — while this one's hook runs, or while a permission prompt holds this command back —
 * takes this one's place, so that both are taken for the later subagent and neither is refused.
 */
function agentOf(db: DatabaseSync, command: number): string {
  const begun = stat(command)?.[STARTED];
  let script: string;

  try {
    script = readFileSync(`/proc/${command}/cmdline`, 'utf8');
  } catch {
    return '';
  }

  const noted = db
    .prepare('SELECT agent, input FROM bash WHERE pid = ? AND at <= ? ORDER BY at DESC')
    .iterate(claudePid, Number(begun)) as unknown as Iterable<{ agent: string; input: string }>;

  for (const { agent, input } of noted) {
    if (script.includes(evaled(input))) {
      return agent;
    }
  }

  return '';
}

/** Whether any process is still running in one of the process sessions `commands` names. */
function running(commands: number[]): boolean {
  const sessions = new Set(commands.map(String));

  // Where there is no `/proc`, no lease was taken to leave a command for, so it is not read for an empty list.
  return (
    sessions.size > 0 &&
    readdirSync('/proc').some((pid) => /^\d+$/.test(pid) && sessions.has(stat(pid)?.[SESSION] ?? ''))
  );
}

// Not a number outside a Claude session, which has no lease to take or let go.
const claudePid = Number(process.env.CLAUDE_PID);

switch (process.argv[2]) {
  case 'start': {
    const file = process.env.CLAUDE_ENV_FILE;

    if (file) {
      const wrapper = `'${WRAPPER.replaceAll("'", `'\\''`)}'`;
      appendFileSync(file, `export PATH=${wrapper}:"$PATH"\nexport ADB=${wrapper}/adb\n`);
    }

    break;
  }

  case 'adb': {
    const args = process.argv.slice(3);
    const adb = realAdb();
    const at = args.findIndex((arg, i) => !arg.startsWith('-') && !VALUED.has(args[i - 1] ?? ''));
    const started = stat(claudePid)?.[STARTED];
    const every = EVERY.has(args[at] ?? '');

    const serial =
      started && at !== -1 && !HOST.has(args[at] ?? '') && !every ? reached(adb, args.slice(0, at)) : undefined;

    if (started && (every || serial)) {
      const db = open();
      const command = Number(stat('self')?.[SESSION]);
      const agent = agentOf(db, command);

      // Another session's use, while it runs, or another subagent's of this one where this command is a subagent's too,
      // while that subagent runs or the command it left does: the session's own share with all its subagents.
      const theirs = (use: Held) =>
        use.pid === claudePid
          ? agent !== '' && use.agent !== '' && use.agent !== agent && (!use.done || running([use.command]))
          : live(use);

      const held = exclusively(db, () => {
        const uses = db
          .prepare(
            `SELECT use.*, coalesce(agent.agent, '') AS agent, finished.agent IS NOT NULL AS done
            FROM use LEFT JOIN agent USING (serial, command) LEFT JOIN finished ON finished.agent = agent.agent
            ORDER BY since DESC`,
          )
          .all() as unknown as Held[];

        const holder = uses.find((use) => (every || use.serial === serial) && theirs(use));

        if (holder || !serial) {
          return holder;
        }

        const mine: Use = {
          serial,
          command,
          pid: claudePid,
          started,
          session: process.env.CLAUDE_CODE_SESSION_ID ?? '',
          cwd: process.cwd(),
          since: new Date().toISOString(),
          args: args.join(' '),
        };

        db.prepare('DELETE FROM use WHERE serial = ? AND pid != ?').run(serial, claudePid);
        db.prepare(
          `INSERT OR REPLACE INTO use VALUES (:serial, :command, :pid, :started, :session, :cwd, :since, :args)`,
        ).run({ ...mine });
        db.prepare('INSERT OR REPLACE INTO agent VALUES (?, ?, ?)').run(serial, command, agent);
        db.exec('DELETE FROM agent WHERE (serial, command) NOT IN (SELECT serial, command FROM use)');
        db.exec('DELETE FROM finished WHERE agent NOT IN (SELECT agent FROM agent)');
      });

      if (held) {
        console.error(refusal(held));
        process.exit(1);
      }
    }

    // Replaces this process, as `exec` would, and so returns only where Node has no `execve`, as on Windows.
    process.execve?.(adb, [adb, ...args]);
    throw new Error('adb: this Node cannot run adb in its place');
  }

  case 'bash': {
    const at = stat('self')?.[STARTED];
    const started = stat(claudePid)?.[STARTED];

    if (!at || !started) {
      break;
    }

    const { agent_id: agent = '', tool_input: input } = JSON.parse(readFileSync(0, 'utf8')) as {
      agent_id?: string;
      tool_input: { command: string };
    };

    const db = open();

    // A session that crashed never ran `end`, so what it noted goes as another notes a command.
    exclusively(db, () => {
      const sessions = db.prepare('SELECT DISTINCT pid, started FROM bash').all() as Pick<Use, 'pid' | 'started'>[];

      for (const gone of sessions.filter((session) => !live(session))) {
        db.prepare('DELETE FROM bash WHERE pid = ? AND started = ?').run(gone.pid, gone.started);
      }

      db.prepare('INSERT INTO bash VALUES (?, ?, ?, ?, ?)').run(claudePid, started, agent, Number(at), input.command);

      // A finished subagent runs no more commands of its own unless `SendMessage` resumes it, which this one has.
      db.prepare('DELETE FROM finished WHERE agent = ?').run(agent);
    });

    break;
  }

  case 'stop': {
    // Run by hand, as a session asked by another to let go of the phone does, it is given nothing on stdin.
    const { agent_id: agent, background_tasks: tasks } = JSON.parse(readFileSync(0, 'utf8') || '{}') as {
      agent_id?: string;
      background_tasks?: { type: string; status: string }[];
    };

    // A background agent goes on using the phone for the session after its turn, and between its commands nothing of it
    // is left running to be seen. The hooks reference labels each task by the feature that made it, and these are the
    // ones that run agents. `SubagentStop` is given the session's too, which keep no subagent from letting go.
    const agents = new Set(['subagent', 'workflow', 'teammate']);

    if (!claudePid || (!agent && tasks?.some((task) => agents.has(task.type) && task.status === 'running'))) {
      break;
    }

    const db = open();

    // A subagent finishing lets go of what its commands took, but for any still running, which hold the phone against
    // the session's other subagents until they end, there being no `SubagentStop` to come for them.
    if (agent) {
      exclusively(db, () => {
        const uses = db
          .prepare(
            'SELECT serial, command FROM use JOIN agent USING (serial, command) WHERE pid = ? AND agent.agent = ?',
          )
          .all(claudePid, agent) as Pick<Use, 'serial' | 'command'>[];

        const left = uses.filter(({ command }) => running([command]));

        for (const { serial, command } of uses.filter((use) => !left.includes(use))) {
          db.prepare('DELETE FROM use WHERE serial = ? AND command = ?').run(serial, command);
        }

        if (left.length > 0) {
          db.prepare('INSERT OR IGNORE INTO finished VALUES (?)').run(agent);
        }
      });

      break;
    }

    exclusively(db, () => {
      const uses = db.prepare('SELECT command FROM use WHERE pid = ?').all(claudePid) as Pick<Use, 'command'>[];

      if (!running(uses.map(({ command }) => command))) {
        db.prepare('DELETE FROM use WHERE pid = ?').run(claudePid);
        db.prepare('DELETE FROM bash WHERE pid = ?').run(claudePid);
      }
    });

    break;
  }

  case 'end':
    if (claudePid) {
      const db = open();
      db.prepare('DELETE FROM use WHERE pid = ?').run(claudePid);
      db.prepare('DELETE FROM bash WHERE pid = ?').run(claudePid);
    }

    break;

  default:
    throw new Error(`unknown command: ${process.argv[2]}`);
}
