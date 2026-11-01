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
 * The rows of a CSV as `csv` writes them: a field quoted where it holds a comma, a quote or a line break, and a quote
 * inside one doubled. A line break outside quotes ends a row, and a trailing one does not start another.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * What a row already written says of its Pokémon that the screen can be checked against: the HP, weight and height,
 * and the IVs where they were read. The name is left out for the reason `looseKeyOf` leaves it out, and the IVs are
 * only compared where both sides have them, an overlay that went unread once being no reason to miss the row.
 */
export interface Landmark {
  hp: number;
  weight: number | null;
  height: number | null;
  iv: string | null;
}

export function landmarkOf(detail: Detail, overlay: Overlay | null): Landmark | null {
  if (detail.hp === null) {
    return null;
  }

  const iv = overlay ? `${overlay.iv.attack}/${overlay.iv.defense}/${overlay.iv.stamina}` : null;

  return { hp: detail.hp, weight: detail.weight, height: detail.height, iv };
}

export function sameLandmark(a: Landmark | null, b: Landmark | null): boolean {
  return (
    a !== null &&
    b !== null &&
    a.hp === b.hp &&
    a.weight === b.weight &&
    a.height === b.height &&
    (a.iv === null || b.iv === null || a.iv === b.iv)
  );
}

/** How many rows already written a landing is checked against, the last of them being the row before it. */
export const LANDMARKS = 3;

/**
 * The rows of a scan's CSV that a pass resumed with `--skip` lands just past, oldest first: row `skip` itself and the
 * ones written before it, up to `most` of them, stopping at a row that skips a number or has no HP to be known by.
 * Row `skip` is the last one written under that number, a file resumed wrongly before holding it more than once.
 *
 * Throws where row `skip` is missing or has no HP, which is a landing nothing could check.
 */
export function landmarksBefore(text: string, skip: number, most = LANDMARKS): Landmark[] {
  const [header = [], ...rows] = parseCsv(text);
  const columns = ['index', 'hp', 'weight_kg', 'height_m', 'attack_iv', 'defense_iv', 'stamina_iv'];

  if (columns.some((name) => !header.includes(name))) {
    throw new Error('it is not a CSV this scan wrote, missing a column it is checked by');
  }

  const field = (row: readonly string[], name: string) => row[header.indexOf(name)] ?? '';

  const number = (row: readonly string[], name: string) => {
    const text = field(row, name);

    return text === '' ? null : Number(text);
  };

  const landmark = (row: readonly string[]): Landmark | null => {
    const read = number(row, 'hp');
    const iv = ['attack_iv', 'defense_iv', 'stamina_iv'].map((name) => field(row, name));

    return read === null
      ? null
      : {
          hp: read,
          weight: number(row, 'weight_kg'),
          height: number(row, 'height_m'),
          iv: iv.every(Boolean) ? iv.join('/') : null,
        };
  };

  const last = rows.findLastIndex((row) => number(row, 'index') === skip);

  if (last === -1) {
    throw new Error(`it holds no row ${skip} to check the landing against`);
  }

  const found: Landmark[] = [];

  for (const row of rows.slice(0, last + 1).reverse()) {
    const mark = landmark(row);

    if (found.length >= most || number(row, 'index') !== skip - found.length || mark === null) {
      break;
    }

    found.unshift(mark);
  }

  if (found.length === 0) {
    throw new Error(`its row ${skip} has no HP, so nothing on the screen can be checked against it`);
  }

  return found;
}

/** How many Pokémon past where a skip should have landed `land` looks for it: a fifth of the skip, and ten at least. */
export const reachOf = (skip: number) => Math.max(10, Math.ceil(skip / 5));

/**
 * How many more swipes back than `behind` holds `land` starts from, so that a skip landed past where it should have, or
 * a swipe back that went nowhere, still starts the search ahead of the rows it is looking for.
 */
const MARGIN = 2;

/** Collapses a run of readings that are one Pokémon read again, which is what a swipe that went nowhere leaves. */
function collapse(marks: readonly (Landmark | null)[]): (Landmark | null)[] {
  return marks.filter((mark, i) => i === 0 || !sameLandmark(mark, marks[i - 1] ?? null));
}

/**
 * Puts a pass resumed with `--skip` on the Pokémon after the rows already written, whatever the swipes that got it
 * there dropped. A swipe can go nowhere, and a skip made of a hundred of them blind lands short by every one that did,
 * so the rows written next would be the last ones again under numbers that have moved on.
 *
 * So it swipes back past where the rows `behind` should be, reads forward until the last of what it has read is them,
 * and swipes on past them. Runs of one Pokémon read twice are collapsed on both sides, which is what lets a swipe that
 * goes nowhere on the way, or a twin among `behind`, leave the match standing. That costs a twin run `behind` ends on:
 * the match comes on its first, and a swipe dropped while stepping past the rest goes unseen, a swipe dropped and a
 * twin reading the same. Answers how far off the skip had landed,
 * short where positive; throws where `behind` does not turn up within `reach` Pokémon of where it should have been.
 */
export async function land<R extends { key: string | null }>(
  { read, next, back }: Steps<R>,
  behind: readonly Landmark[],
  mark: (reading: R) => Landmark | null,
  reach: number,
): Promise<number> {
  const wanted = collapse(behind);
  const start = behind.length + MARGIN;
  const seen: (Landmark | null)[] = [];
  const last = behind.at(-1) ?? null;
  const run = Math.max(behind.length - behind.findLastIndex((m) => !sameLandmark(m, last)) - 1, 1);

  for (let i = 0; i < start; i++) {
    await back();
  }

  for (let reads = 0; reads < start + reach; reads++) {
    if (reads > 0) {
      await next();
    }

    seen.push(mark(await read()));
    const tail = collapse(seen).slice(-wanted.length);

    // The match comes on the first of a run of twins `behind` ends on, collapsed as it is, so the walk is put past the
    // whole run rather than past its first.
    if (tail.length === wanted.length && tail.every((m, i) => sameLandmark(m, wanted[i] ?? null))) {
      for (let i = 0; i < run; i++) {
        await next();
      }

      return reads + run - start;
    }
  }

  throw new Error(`the rows before it did not turn up within ${reach} Pokémon of where the skip landed`);
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
    await visit(reading, index);
    ends.push(index);
    await swipe(1, 1);
  }
}
