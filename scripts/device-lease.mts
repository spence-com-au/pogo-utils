/**
 * The hooks that make Claude sessions take turns with a plugged-in phone, run from `.claude/settings.json` with the
 * hook's JSON on stdin — see `src/tools/device/lease.mts` for the lease itself.
 *
 *   node scripts/device-lease.mts pre     before a Bash command: take the lease on each phone it reaches, or refuse it
 *                                         with exit status 2, holding none of them, and say who holds the phone
 *   node scripts/device-lease.mts stop    at the end of a turn: let go of this session's leases, unless something it
 *                                         started is still running on a phone or a background subagent still runs
 *   node scripts/device-lease.mts end     as the session ends: let go of its leases
 *
 * Anything that goes wrong here fails open, as a hook error the command runs past rather than a refusal.
 */

import {
  acquire,
  anyLease,
  busy,
  defaultSerial,
  devicesReached,
  isSerial,
  leaseDir,
  processes,
  refusal,
  release,
  sessionOf,
} from '../src/tools/device/lease.mts';
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8')) as {
  session_id: string;
  cwd: string;
  tool_input?: { command?: string };
  background_tasks?: { type: string; status: string }[];
};
const dir = leaseDir();

switch (process.argv[2]) {
  case 'pre': {
    const command = input.tool_input?.command ?? '';
    const reached = devicesReached(command);

    if (!reached.length) {
      break;
    }

    const serials = new Set(reached.map((serial) => serial ?? defaultSerial()).filter(isSerial));
    const table = processes();
    const session = sessionOf(table, process.pid);

    if (!session) {
      break;
    }

    const mine = { pid: session, session: input.session_id, cwd: input.cwd, command, since: new Date().toISOString() };

    const taken: string[] = [];

    for (const serial of serials) {
      const outcome = acquire(dir, serial, mine, table);

      if (outcome === 'taken') {
        taken.push(serial);
      } else if (outcome !== 'renewed') {
        // A refused command runs on none of its phones, so it holds none of the leases it took on the way: kept, two
        // sessions that each hold one phone and want the other's would wait on each other for ever.
        release(dir, session, taken);
        console.error(refusal(dir, serial, outcome));
        process.exit(2);
      }
    }

    break;
  }

  case 'stop': {
    if (!anyLease(dir)) {
      break;
    }

    const table = processes();
    const session = sessionOf(table, process.pid);

    // A background subagent shares the session's lease and outlives its turn, and between its commands nothing of it
    // shows among the processes.
    const subagents = input.background_tasks?.some((task) => task.type === 'subagent' && task.status === 'running');

    if (session && !subagents && !busy(table, session, process.pid)) {
      release(dir, session);
    }

    break;
  }

  case 'end': {
    const session = sessionOf(processes(), process.pid);

    if (session) {
      release(dir, session);
    }

    break;
  }

  default:
    throw new Error(`unknown hook: ${process.argv[2]}`);
}
