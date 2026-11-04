/**
 * Makes the Claude sessions sharing a plugged-in phone take turns with it, so that two never tap over each other. Run
 * by `bin/adb` and by the hooks `.claude/settings.json` declares:
 *
 *   node scripts/adb-lease.mts start   as a session starts: put `bin/` first on the PATH of its Bash commands, so
 *                                      that the `adb` they run is the one there
 *   node scripts/adb-lease.mts adb …   from that `adb`: take the lease on the phone its arguments reach and print the
 *                                      real `adb` to run, or refuse while another session holds it, saying which
 *   node scripts/adb-lease.mts stop    as a turn ends: let go of the session's leases, unless a command that reached
 *                                      the phone is still running or a background subagent is
 *   node scripts/adb-lease.mts end     as the session ends: let go of its leases
 *
 * A lease is taken by `adb` itself rather than by reading Bash commands as they are run, because every way to the phone
 * runs `adb` off the PATH: by hand, from scrcpy, and from `pnpm battle`, `pnpm inventory` and `pnpm adb` by `execFile`.
 * No command can be written so as to slip past it, short of naming the real `adb` by its path.
 *
 * A session is its `claude` process, `CLAUDE_PID`, which Claude Code sets for its Bash commands and its hooks alike: a
 * subagent's commands come from its parent's process, so share its lease, and a lease whose process has gone is one a
 * crash left behind, free for the next session to take. The leases are rows of one database outside the checkout, where
 * every worktree finds them, and each change to them is a transaction, which is what lets sessions racing for a phone,
 * or for one a crash left behind, settle on exactly one holder.
 */

import { execFileSync } from 'node:child_process';
import { accessSync, appendFileSync, constants, readdirSync, readFileSync, realpathSync } from 'node:fs';
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

/** The directory holding the `adb` that stands in front of the real one. */
const WRAPPER = fileURLToPath(new URL('../bin', import.meta.url));

/** What `adb` does without reaching a phone, which takes no lease and so is never refused. */
const HOST = new Set(['devices', 'help', 'version']);

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
const live = (use: Use) => stat(use.pid)?.[STARTED] === use.started;

function open(): DatabaseSync {
  const db = new DatabaseSync(join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), 'pogo-utils-adb-lease.sqlite'), {
    timeout: 10_000,
  });

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

/** The `adb` the wrapper stands in front of: the first on the PATH that is not the wrapper itself. */
function realAdb(): string {
  const wrapper = realpathSync(join(WRAPPER, 'adb'));

  const adb = (process.env.PATH ?? '')
    .split(':')
    .map((dir) => join(dir, 'adb'))
    .find((adb) => executable(adb) && realpathSync(adb) !== wrapper);

  if (!adb) {
    throw new Error('adb: no adb on the PATH besides this wrapper');
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

/** What a session refused the phone is told: who has it, and how to wait for it or ask for it. */
function refusal(held: Use): string {
  const name = sessionName(held.pid);

  return [
    `adb: the phone ${held.serial} is in use by ${name ? `the Claude session ${name}` : 'another Claude session'}`,
    `(session ${held.session}, pid ${held.pid}, working in ${held.cwd}),`,
    `which last ran \`adb ${held.args}\` on it at ${held.since}.`,
    'That session lets go of it when it ends a turn with nothing it started still on the phone, or exits.',
    `Wait for it in the background with \`until adb -s ${held.serial} get-state >/dev/null 2>&1; do sleep 30; done\`,`,
    'which takes the phone the moment it is free,',
    name
      ? `or ask ${name} for it with SendMessage.`
      : 'or find that session with ListAgents and ask it with SendMessage.',
    'Do not run the real adb by its path to get past this.',
  ].join(' ');
}

/** Whether any process is still running in one of the process sessions `commands` names. */
function running(commands: number[]): boolean {
  const sessions = new Set(commands.map(String));

  return readdirSync('/proc').some((pid) => /^\d+$/.test(pid) && sessions.has(stat(pid)?.[SESSION] ?? ''));
}

// Not a number outside a Claude session, which has no lease to take or let go.
const pid = Number(process.env.CLAUDE_PID);

switch (process.argv[2]) {
  case 'start': {
    const file = process.env.CLAUDE_ENV_FILE;

    if (file) {
      appendFileSync(file, `export PATH='${WRAPPER.replaceAll("'", `'\\''`)}':"$PATH"\n`);
    }

    break;
  }

  case 'adb': {
    const args = process.argv.slice(3);
    const adb = realAdb();
    const at = args.findIndex((arg, i) => !arg.startsWith('-') && !VALUED.has(args[i - 1] ?? ''));
    const started = stat(pid)?.[STARTED];
    const serial = started && at !== -1 && !HOST.has(args[at] ?? '') ? reached(adb, args.slice(0, at)) : undefined;

    if (started && serial) {
      const db = open();

      const mine: Use = {
        serial,
        command: Number(stat('self')?.[SESSION]),
        pid,
        started,
        session: process.env.CLAUDE_CODE_SESSION_ID ?? '',
        cwd: process.cwd(),
        since: new Date().toISOString(),
        args: args.join(' '),
      };

      const held = exclusively(db, () => {
        const others = db
          .prepare('SELECT * FROM use WHERE serial = ? AND pid != ? ORDER BY since DESC')
          .all(serial, pid) as unknown as Use[];

        if (others.some(live)) {
          return others[0];
        }

        db.prepare('DELETE FROM use WHERE serial = ? AND pid != ?').run(serial, pid);
        db.prepare(
          `INSERT OR REPLACE INTO use VALUES (:serial, :command, :pid, :started, :session, :cwd, :since, :args)`,
        ).run({ ...mine });
      });

      if (held) {
        console.error(refusal(held));
        process.exit(1);
      }
    }

    console.log(adb);
    break;
  }

  case 'stop': {
    const { background_tasks: tasks } = JSON.parse(readFileSync(0, 'utf8')) as {
      background_tasks?: { type: string; status: string }[];
    };

    // A background subagent goes on using the phone for the session after its turn, and between its commands nothing
    // of it is left running to be seen.
    if (!pid || tasks?.some((task) => task.type === 'subagent' && task.status === 'running')) {
      break;
    }

    const db = open();

    exclusively(db, () => {
      const uses = db.prepare('SELECT command FROM use WHERE pid = ?').all(pid) as Pick<Use, 'command'>[];

      if (!running(uses.map(({ command }) => command))) {
        db.prepare('DELETE FROM use WHERE pid = ?').run(pid);
      }
    });

    break;
  }

  case 'end':
    if (pid) {
      open().prepare('DELETE FROM use WHERE pid = ?').run(pid);
    }

    break;

  default:
    throw new Error(`unknown command: ${process.argv[2]}`);
}
