/**
 * The decisions `pnpm inventory scan` makes that need no phone: which arguments it takes, how a row is written,
 * whether two passes saw the same Pokémon and where storage ends. Here rather than in `scripts/inventory.mts` so the suite can import them,
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

/**
 * Whether two keys can be one Pokémon read twice: the same, or the same but for the IVs where one read missed the
 * overlay. PGSharp's overlay reads on one look and not the next, so a key with IVs and one without are not a
 * disagreement, only a reading that lost a field.
 */
export function agree(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }

  const i = a.lastIndexOf('|');
  const j = b.lastIndexOf('|');

  return i >= 0 && j >= 0 && a.slice(0, i) === b.slice(0, j) && (a.slice(i + 1) === '' || b.slice(j + 1) === '');
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
      const before = known.get(at) ?? step.key;

      if (!agree(before, step.key)) {
        return null;
      }

      // The fuller of the two, so a later read is held to the IVs either of them saw.
      known.set(at, step.key.length > before.length ? step.key : before);
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

    if (open !== undefined && ended.every((key) => key !== undefined && !agree(key, open))) {
      return k;
    }

    const [first, ...rest] = landed.values();

    // A read rules out a world only where it lands on a Pokémon already read, and differently from it.
    if (fallback === undefined && rest.some((key) => !same(key, first))) {
      fallback = k;
    }
  }

  return fallback;
}

function same(a: string | undefined, b: string | undefined): boolean {
  return a === undefined || b === undefined ? a === b : agree(a, b);
}

/** How many times a look back reads a screen that would end the walk on nothing it has read before. */
const LOOKS = 3;

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
 * A look back that rules out storage going on is believed at once where it confirms a Pokémon read before. Where it
 * confirms nothing — every world it leaves landing on a place not yet read, as after `from` skipped past everything
 * before it — it may as well be a misread of the Pokémon storage going on expects, the overlay lost or a name read
 * another way. So the walk looks again, up to {@link LOOKS} times in all: a look that keeps storage going on wins, the
 * same reading every time is believed, and readings that disagree among themselves are taken for misreads, so the walk
 * goes on.
 *
 * Where nothing it has read can tell them apart — a run of twins from the start of the pass, the first Pokémon in
 * storage or one `from` skipped to, with nothing known before it — the walk stops and says so rather than visit a
 * Pokémon it may already have written. A screen that may be new, unread or reading differently from the last, it
 * visits all the same: a wrong guess there writes again only a Pokémon whose screen once went unread, and says so when
 * the end comes.
 */
export async function walk<R extends { key: string | null }>(
  { read, next, back }: Steps<R>,
  visit: (reading: R, index: number) => Promise<void>,
  max: number,
  from: number,
  first?: R,
) {
  const log: Step[] = [];
  let ends = [Infinity];
  let pending = first;
  let latest: string | null = null;
  let misses = 0;

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

  /** Reads the Pokémon a look back landed on, `landed` being what each world had already read there. */
  const look = async (landed: Map<number, string | undefined>) => {
    const looks: string[] = [];

    for (let i = 0; i < LOOKS; i++) {
      const { key } = await read();
      log.push({ key });

      if (key === null) {
        return key;
      }

      const after = worlds();

      if (after.has(Infinity) || [...after.keys()].some((end) => landed.get(end) !== undefined)) {
        return key;
      }

      log.pop();
      looks.push(key);
    }

    const [head = null] = looks;

    // Pairwise, since `agree` is not transitive: two looks with different IVs each agree with one that missed them.
    if (head !== null && looks.every((a) => looks.every((b) => agree(a, b)))) {
      log.push({ key: head });
      return head;
    }

    console.error(`  a look back read ${looks.join(', ')}; taking it for a misread and going on`);
    log.push({ key: null });
    return null;
  };

  for (let index = from; index < from + max; index++) {
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

      const landed = new Map([...possible].map(([end, { at, known }]) => [end, known.get(Math.max(at - k, 0))]));
      await swipe(-1, k);
      const key = await look(landed);
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
      const repeats = index - 1 - Math.min(...ends);

      if (repeats > 0) {
        console.error(`  storage may have ended ${repeats} Pokémon ago, past a screen that would not read`);
      }

      break;
    }

    if (possible.size > 1 && reading.key !== null && latest !== null && agree(reading.key, latest)) {
      console.error(
        `  ${reading.key} may be the last Pokémon read again, so its end cannot be told; stopping this pass`,
      );
      break;
    }

    latest = reading.key ?? latest;
    await visit(reading, index);
    ends.push(index);
    await swipe(1, 1);
  }
}
