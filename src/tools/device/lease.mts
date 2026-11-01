/**
 * A lease on a phone, so that Claude sessions sharing a plugged-in device take turns with it rather than tapping over
 * each other. `scripts/device-lease.mts` runs this from the hooks `.claude/settings.json` declares: a Bash command that
 * reaches a phone takes its lease or is refused while another session holds it, and the lease is let go when its
 * session finishes a turn with nothing still running on the phone, or ends.
 *
 * A session is its `claude` process rather than its `session_id`: a subagent's commands come from the same process as
 * its parent's and so share the parent's lease, and a lease whose process has gone is one a crash left behind, which
 * the next session to want the phone takes over. The leases live outside the checkout, in one directory every worktree
 * sees, one file per serial so that two phones are two leases.
 */

import { execFileSync } from 'node:child_process';
import { linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

export interface Lease {
  pid: number;
  session: string;
  cwd: string;
  command: string;
  since: string;
}

export interface Process {
  pid: number;
  ppid: number;
  args: string;
}

/** The subcommands of this repository's tools that drive a phone; the rest read files already saved. */
const DRIVES: Record<string, string[]> = { battle: ['run', 'record'], inventory: ['scan', 'snap'] };

/**
 * The commands that run another in front of `adb`, each with its options that take a separate value, as `nice -n 10`.
 * `timeout` takes its duration after them.
 */
const WRAPPERS: Record<string, string[]> = {
  env: ['-u', '-C', '-S', '--unset', '--chdir', '--split-string'],
  exec: ['-a'],
  nice: ['-n', '--adjustment'],
  time: ['-f', '-o', '--format', '--output'],
  timeout: ['-s', '-k', '--signal', '--kill-after'],
};

/** What a process still running on a phone looks like, its own or one a script it runs spawns. */
const ON_DEVICE = /\b(?:adb|scrcpy)\b|scripts\/(?:battle|inventory)\.mts\b/;

export const leaseDir = () => join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), 'pogo-utils-device');

const optionValue = (args: string[], ...names: string[]) => {
  for (const [i, arg] of args.entries()) {
    if (names.includes(arg)) {
      return args[i + 1];
    }

    const name = names.find((name) => name.startsWith('--') && arg.startsWith(`${name}=`));

    if (name) {
      return arg.slice(name.length + 1);
    }
  }
};

/**
 * The phones each part of a shell command reaches, by the serial it names or `undefined` where it leaves `adb` to pick.
 * This reads the command a word at a time rather than parsing the shell, so it finds `adb`, `scrcpy`, `pnpm battle
 * run` and the like where each starts a command — after `;`, `&&`, a pipe or `$(`, and past `timeout 30` or an
 * environment assignment — and not where one is merely mentioned, as in `rg adb` or a commit message. A script that
 * runs `adb` itself is out of its sight.
 */
export function devicesReached(command: string): (string | undefined)[] {
  const reached: (string | undefined)[] = [];

  for (const part of command.split(/&&|\|\||\$\(|[;|&\n(`]/)) {
    const words = part.trim().split(/\s+/);
    let serial: string | undefined;

    for (;;) {
      const word = words[0] ?? '';

      const valued = WRAPPERS[word];

      if (/^\w+=/.test(word)) {
        serial = /^ANDROID_SERIAL=(.+)$/.exec(word)?.[1] ?? serial;
        words.shift();
      } else if (valued) {
        words.shift();

        while (words[0]?.startsWith('-')) {
          if (valued.includes(words.shift() ?? '')) {
            words.shift();
          }
        }

        if (word === 'timeout') {
          words.shift();
        }
      } else {
        break;
      }
    }

    const [program = '', ...args] = words;
    const name = basename(program);

    if (name === 'adb') {
      const subcommand = args.find((arg, i) => !arg.startsWith('-') && !['-s', '-t'].includes(args[i - 1] ?? ''));

      if (subcommand === 'devices' || subcommand === 'version') {
        continue;
      }

      reached.push(optionValue(args, '-s') ?? serial);
    } else if (name === 'scrcpy') {
      reached.push(optionValue(args, '-s', '--serial') ?? serial);
    } else {
      const [tool, subcommand] =
        name === 'pnpm'
          ? args.filter((arg, i) => i > 0 || arg !== 'run')
          : name === 'node'
            ? [/^(?:\.\/)?scripts\/(\w+)\.mts$/.exec(args[0] ?? '')?.[1], args[1]]
            : [];

      if (DRIVES[tool ?? '']?.includes(subcommand ?? '')) {
        reached.push(optionValue(args, '--serial') ?? serial);
      }
    }
  }

  return reached;
}

/** The serial `adb` picks when given none: `ANDROID_SERIAL`, or the one phone attached, or none at all. */
export function defaultSerial(): string | undefined {
  if (process.env.ANDROID_SERIAL) {
    return process.env.ANDROID_SERIAL;
  }

  let listing: string;

  try {
    listing = execFileSync('adb', ['devices'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
  } catch {
    return undefined;
  }

  const attached = [...listing.matchAll(/^(\S+)\tdevice$/gm)].map(([, serial]) => serial);
  return attached.length === 1 ? attached[0] : undefined;
}

export function processes(): Map<number, Process> {
  const listing = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,args='], { encoding: 'utf8' });
  const table = new Map<number, Process>();

  for (const [, pid, ppid, args = ''] of listing.matchAll(/^\s*(\d+)\s+(\d+)\s(.*)$/gm)) {
    table.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), args: args.trim() });
  }

  return table;
}

/** Whether `pid` is a running `claude`, which a pid reused by something else since is not. */
const isClaude = (table: Map<number, Process>, pid: number) =>
  basename(table.get(pid)?.args.split(' ')[0] ?? '') === 'claude';

/** The `claude` process `pid` runs under, which a hook's is the parent of the shell that runs it. */
export function sessionOf(table: Map<number, Process>, pid: number): number | undefined {
  for (let at = table.get(pid); at; at = table.get(at.ppid)) {
    if (isClaude(table, at.pid)) {
      return at.pid;
    }
  }
}

/** Whether anything `session` started is still running on a phone, leaving out the hook that asks. */
export function busy(table: Map<number, Process>, session: number, asking: number): boolean {
  const ancestors = new Set<number>();

  for (let at = table.get(asking); at; at = table.get(at.ppid)) {
    ancestors.add(at.pid);
  }

  return [...table.values()].some((process) => {
    if (ancestors.has(process.pid) || !ON_DEVICE.test(process.args)) {
      return false;
    }

    for (let at = table.get(process.ppid); at; at = table.get(at.ppid)) {
      if (at.pid === session) {
        return true;
      }
    }

    return false;
  });
}

const leasePath = (dir: string, serial: string) => join(dir, `${serial}.json`);

const readLease = (path: string): Lease | undefined => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Lease;
  } catch {
    return undefined;
  }
};

const code = (error: unknown) => (error as NodeJS.ErrnoException).code;

/**
 * Takes the lease on `serial` for `mine.pid`, or renews it where that session already holds it, and answers the lease
 * of the live session that holds it instead. The lease is only ever created by `link`, which fails where the file
 * exists, so of the sessions racing for a free lease exactly one gets it. An abandoned lease is moved aside rather than
 * overwritten, which only one session can do, and then raced for like a free one; a live lease moved aside because
 * another session took it in the meantime is put back.
 */
export function acquire(dir: string, serial: string, mine: Lease, table: Map<number, Process>): Lease | undefined {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = leasePath(dir, serial);
  const draft = `${path}.${process.pid}`;
  const aside = `${draft}.abandoned`;

  try {
    writeFileSync(draft, JSON.stringify(mine));

    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        linkSync(draft, path);
        return undefined;
      } catch (error) {
        if (code(error) !== 'EEXIST') {
          throw error;
        }
      }

      const held = readLease(path);

      if (!held) {
        continue;
      }

      if (held.pid === mine.pid) {
        writeFileSync(draft, JSON.stringify({ ...mine, since: held.since }));
        renameSync(draft, path);
        return undefined;
      }

      if (isClaude(table, held.pid)) {
        return held;
      }

      try {
        renameSync(path, aside);
      } catch (error) {
        if (code(error) !== 'ENOENT') {
          throw error;
        }

        continue;
      }

      if (readLease(aside)?.pid !== held.pid) {
        linkSync(aside, path);
      }

      rmSync(aside, { force: true });
    }

    throw new Error(`could not take the lease ${path}`);
  } finally {
    rmSync(draft, { force: true });
  }
}

/** Lets go of every lease `session` holds. */
export function release(dir: string, session: number) {
  let names: string[];

  try {
    names = readdirSync(dir);
  } catch {
    return;
  }

  for (const name of names.filter((name) => name.endsWith('.json'))) {
    if (readLease(join(dir, name))?.pid === session) {
      rmSync(join(dir, name), { force: true });
    }
  }
}

/** Whether `dir` holds any lease at all, which a turn's end checks before it pays for listing every process. */
export function anyLease(dir: string): boolean {
  try {
    return readdirSync(dir).some((name) => name.endsWith('.json'));
  } catch {
    return false;
  }
}

/** What a session refused the phone is told: who holds it, and how to wait for it or ask for it. */
export const refusal = (dir: string, serial: string, held: Lease) =>
  [
    `The phone ${serial} is leased to another Claude session: pid ${held.pid}, session ${held.session},`,
    `working in ${held.cwd}, since ${held.since}, last running \`${held.command}\`.`,
    `Its lease ends when that session finishes a turn with nothing still running on the phone, or when it exits.`,
    `Wait for that in the background with`,
    `\`while [ -e ${leasePath(dir, serial)} ] && kill -0 ${held.pid}; do sleep 10; done\`,`,
    `then try again, or find the session with ListAgents and ask it with SendMessage.`,
    `Do not delete the lease to get past this.`,
  ].join(' ');
