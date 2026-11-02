/**
 * The decisions `pnpm inventory scan` makes that need no phone: which arguments it takes, how a row is written,
 * whether two passes saw the same Pokémon, where storage ends and whether a pass got there. Here rather than in `scripts/inventory.mts` so the suite can import them,
 * that script parsing `process.argv` and driving a phone at its top level.
 */

import { type Detail } from './detail.mts';
import { fold } from './ocr.mts';
import { type Overlay } from './overlay.mts';

/** The searches that answer the yes-or-no columns, each column named for the game's own search term. */
export const FLAGS = ['shiny', 'lucky', 'costume', 'shadow', 'purified'] as const;

export type Flag = (typeof FLAGS)[number];

export function parseFlags(list: string): Flag[] {
  const names = list.split(',').filter(Boolean);
  const unknown = names.filter((n) => !(FLAGS as readonly string[]).includes(n));

  if (unknown.length > 0) {
    throw new Error(`unknown flag ${unknown.join(', ')}; the choices are ${FLAGS.join(', ')}`);
  }

  return names as Flag[];
}

/** A count option, checked here rather than left to turn into a `NaN` that quietly writes nothing after a long run. */
export function count(option: string, value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const n = Number(value);

  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`--${option} takes a whole number, not ${value}`);
  }

  return n;
}

export function csv(value: string | number | null): string {
  const text = value === null ? '' : String(value);

  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * What identifies one Pokémon across two passes. CP is not part of it: it is white over the artwork and the reading
 * OCR misses most, so requiring it would make screens unreadable and stop a walk after three. The overlay's IVs
 * discriminate better — HP, weight, height and 15/15/15 together are shared by almost nothing — and HP alone is what a
 * key needs to exist at all.
 */
export function keyOf(detail: Detail, overlay: Overlay | null): string | null {
  if (detail.hp === null) {
    return null;
  }

  return `${fold(detail.name ?? '')}|${looseKeyOf(detail, overlay)}`;
}

/** The same without the name, so a nickname read differently in two passes still matches. */
export function looseKeyOf(detail: Detail, overlay: Overlay | null): string {
  const iv = overlay ? `${overlay.iv.attack}/${overlay.iv.defense}/${overlay.iv.stamina}` : '';

  return [detail.hp, detail.weight, detail.height, iv].join('|');
}

/**
 * The Pokémon a flag search found, held as a multiset of keys so that each one marks exactly one row of the full pass.
 * A looser key without the name is kept beside it, since a name is the field OCR is likeliest to read two ways.
 */
export class Marks {
  readonly #exact = new Map<string, number>();
  readonly #loose = new Map<string, number>();
  size = 0;

  add(detail: Detail, overlay: Overlay | null) {
    const key = keyOf(detail, overlay);

    if (key) {
      bump(this.#exact, key, 1);
      bump(this.#loose, looseKeyOf(detail, overlay), 1);
      this.size++;
    }
  }

  /** Whether this Pokémon was in the search, using up the match so a twin is not marked by the same entry. */
  take(detail: Detail, overlay: Overlay | null): boolean {
    const key = keyOf(detail, overlay);
    const loose = looseKeyOf(detail, overlay);

    if (key && (this.#exact.get(key) ?? 0) > 0) {
      bump(this.#exact, key, -1);
      bump(this.#loose, loose, -1);
      return true;
    }

    if (key && (this.#loose.get(loose) ?? 0) > 0) {
      bump(this.#loose, loose, -1);
      return true;
    }

    return false;
  }
}

function bump(map: Map<string, number>, key: string, by: number) {
  map.set(key, (map.get(key) ?? 0) + by);
}

/**
 * Why a pass that visited `visited` Pokémon stopped short of what the game counted for it, or null where it did not or
 * the count did not read. `walk` sends again a swipe it finds dropped, but not every time: a drop past an unread
 * screen, one dropped `DROP_RETRIES` times over, or a count that did not read leaves a walk stopped short, as do the
 * reasons it stops of its own. This is what keeps such a pass from being written as complete: a full pass of 45 out
 * of 2,708, or a shiny pass of 82 out of 908 that writes `no` against every shiny it missed.
 *
 * `skip` and `limit` are the full pass's `--skip` and `--limit`, which are what it was asked to visit of the count.
 */
export function shortfall(
  pass: string,
  visited: number,
  counted: number | null,
  skip = 0,
  limit = Infinity,
): string | null {
  if (counted === null) {
    return null;
  }

  const expected = Math.min(limit, Math.max(counted - skip, 0));

  if (visited >= expected) {
    return null;
  }

  const of = skip > 0 ? ` of the ${counted - skip} after --skip ${skip}` : '';

  return `${pass}: the game counts ${counted} Pokémon, but the pass stopped after ${visited}${of}`;
}

/** What `walk` needs of the phone: a read of the Pokémon open, and a swipe to the next one or back to the one before. */
export interface Steps<R extends { key: string | null }> {
  read: () => Promise<R>;
  next: () => Promise<void>;
  back: () => Promise<void>;
}

/** One thing a walk did: a swipe forward or back, or a read and the key it answered. */
type Step = { move: 1 | -1 } | { key: string | null };

/** Where a walk would be, and what each place in storage read, had storage ended at one place. */
interface World {
  at: number;
  known: Map<number, string>;
}

/**
 * Plays `log` over a storage whose last Pokémon is at `end`, where a swipe past either end goes nowhere: the world the
 * walk was in if that is where storage ends, or null if it would have read one place two different ways.
 */
function replay(log: readonly Step[], from: number, end: number): World | null {
  const known = new Map<number, string>();
  let at = from;

  for (const step of log) {
    if ('move' in step) {
      at = Math.min(Math.max(at + step.move, 0), end);
    } else if (step.key !== null) {
      if ((known.get(at) ?? step.key) !== step.key) {
        return null;
      }

      known.set(at, step.key);
    }
  }

  return { at, known };
}

/**
 * How far to swipe back to tell the worlds apart, if any distance can: the shortest at which storage still going on
 * and every place it might have ended would land on Pokémon already read differently, failing that the shortest at
 * which a read could rule any of them out. No further than `index`, so storage still going on never lands on its
 * start, and the same distance forward brings the walk back to where it was in every world.
 */
function distance(worlds: Map<number, World>, index: number): number | undefined {
  let fallback: number | undefined;

  for (let k = 1; k <= index; k++) {
    const landed = new Map([...worlds].map(([end, { at, known }]) => [end, known.get(Math.max(at - k, 0))]));
    const open = landed.get(Infinity);
    const ended = [...landed].filter(([end]) => end !== Infinity).map(([, key]) => key);

    if (open !== undefined && ended.every((key) => key !== undefined && key !== open)) {
      return k;
    }

    const keys = new Set([...landed.values()]);

    // A read rules out a world only where it lands on a Pokémon already read, and differently from it.
    if (fallback === undefined && keys.size > 1) {
      fallback = k;
    }
  }

  return fallback;
}

/** How many times in a row `walk` sends again a swipe forward it takes to have been dropped. */
export const DROP_RETRIES = 3;

/**
 * Hands `visit` each Pokémon from the one open at `from`, `first` being that one's reading where it has already been
 * made, and stops after `max` of them or at the end of storage.
 *
 * The end is a swipe that goes nowhere, so the Pokémon read next is the last one again — but a key carries nothing
 * positional, and the next Pokémon can be a genuine twin of the last: storage sorts a species' duplicates together, and
 * HP, weight and height are read at the precision the game prints them. Nor does a screen OCR missed say what it was,
 * so the Pokémon read after one may be that one read again. So the walk keeps every swipe and read it has made, and
 * each place storage might have ended — every one it has visited, until a read rules it out by reading that place two
 * ways. Where one is left beside storage going on, it swipes back to where the two would land on Pokémon it read
 * differently, reads, and swipes forward again.
 *
 * Where nothing it has read can tell them apart — a run of twins from the start of the pass, the first Pokémon in
 * storage or one `from` skipped to, with nothing known before it — the walk stops and says so rather than visit a
 * Pokémon it may already have written. A screen that may be new, unread or reading differently from the last, it
 * visits all the same: a wrong guess there writes again only a Pokémon whose screen once went unread, and says so when
 * the end comes.
 *
 * A swipe the phone drops looks like the end too: the look-back finds the Pokémon before the last where storage going
 * on would have put the last, and rules out storage going on. `total`, the count the game shows for what is walked,
 * says whether that end is real, and without one the walk ends there as before. Where it is not — the end found at the last Pokémon visited, short of `total` — the
 * swipe forward is taken as dropped rather than the end: struck from what the walk has done, as though never sent, and
 * sent again, up to `DROP_RETRIES` times in a row, so that a count read too high costs a few swipes at the real end.
 * Struck rather than the end merely set aside, which would take the screen read again for a twin: one Pokémon written
 * twice and the next one skipped. An end found further back, past an unread screen, is not retried, and is left to
 * `shortfall` to report, as is a drop on the first swipe of a pass: with nothing read before the first Pokémon, the
 * look-back cannot tell a drop from a twin, and the walk stops as it does for twins there.
 */
export async function walk<R extends { key: string | null }>(
  { read, next, back }: Steps<R>,
  visit: (reading: R, index: number) => Promise<void>,
  max: number,
  from: number,
  first?: R,
  total: number | null = null,
) {
  const log: Step[] = [];
  let ends = [Infinity];
  let pending = first;
  let latest: string | null = null;
  let misses = 0;
  let retries = 0;

  const swipe = async (move: 1 | -1, times: number) => {
    for (let i = 0; i < times; i++) {
      await (move === 1 ? next() : back());
      log.push({ move });
    }
  };

  const worlds = () =>
    new Map(
      ends.flatMap((end) => {
        const world = replay(log, from, end);
        return world ? [[end, world] as const] : [];
      }),
    );

  for (let index = from; index < from + max; index++) {
    // The swipe forward that brought the walk here, the last step taken, where this is not the first Pokémon.
    const forward = log.length - 1;
    const before = { ends: [...ends], misses };
    const reading = pending ?? (await read());
    pending = undefined;
    log.push({ key: reading.key });
    misses = reading.key === null ? misses + 1 : 0;

    if (misses >= 3) {
      console.error('  three unreadable screens in a row; stopping this pass');
      break;
    }

    let possible = worlds();

    while (possible.has(Infinity) && possible.size > 1) {
      const k = distance(possible, index);

      if (k === undefined) {
        break;
      }

      await swipe(-1, k);
      const { key } = await read();
      log.push({ key });
      await swipe(1, k);
      ends = [...possible.keys()];
      possible = worlds();

      if (key === null) {
        break;
      }
    }

    ends = [...possible.keys()];

    if (ends.length === 0) {
      console.error('  one screen read two different ways, so this pass cannot tell where it is; stopping it');
      break;
    }

    if (!possible.has(Infinity)) {
      if (total !== null && Math.min(...ends) === index - 1 && index < total && retries < DROP_RETRIES) {
        console.error(`  the swipe to #${index + 1} went nowhere, short of the ${total} counted; swiping again`);
        retries++;
        log.splice(forward, 1);
        ({ ends, misses } = before);
        await swipe(1, 1);
        index--;
        continue;
      }

      const repeats = index - 1 - Math.min(...ends);

      if (repeats > 0) {
        console.error(`  storage may have ended ${repeats} Pokémon ago, past a screen that would not read`);
      }

      break;
    }

    if (possible.size > 1 && reading.key !== null && reading.key === latest) {
      console.error(
        `  ${reading.key} may be the last Pokémon read again, so its end cannot be told; stopping this pass`,
      );
      break;
    }

    latest = reading.key ?? latest;
    retries = 0;
    await visit(reading, index);
    ends.push(index);
    await swipe(1, 1);
  }
}
