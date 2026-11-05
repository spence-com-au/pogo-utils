/**
 * The decisions `pnpm inventory scan` makes that need no phone: which arguments it takes, how a row is written, whether
 * two passes saw the same Pokémon, where storage ends and whether a pass got there. Here rather than in
 * `scripts/inventory.mts` so the suite can import them, that script parsing `process.argv` and driving a phone at its
 * top level.
 */

import { type Detail } from './detail.mts';
import { type Shade } from './identify.mts';
import { type Moves } from './moves.mts';
import { fold } from './ocr.mts';
import { ivsOf, widen, type findOverlay, type Overlay, type OverlayBox, type readOverlay } from './overlay.mts';
import { type Image } from './png.mts';

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

/** A yes-or-no column: blank where nothing answered it, rather than a `no` nothing checked. */
export type Mark = 'yes' | 'no' | '';

/**
 * The `shadow` and `purified` columns, each from its search pass where that ran and from `shadow`, what the stardust to
 * power up says, where it did not — with a note where both answered and disagree, the pass's answer being the one
 * kept — and `identify`'s `shadowed` from the two together. Null where they disagree, one of them being wrong and
 * nothing here saying which.
 */
export function shaded(
  passes: Readonly<Record<'shadow' | 'purified', Mark>>,
  shadow: Shade | null,
): { shadow: Mark; purified: Mark; shadowed: boolean | null; notes: string[] } {
  const notes: string[] = [];

  const column = (f: 'shadow' | 'purified'): Mark => {
    const seen = shadow === null ? '' : shadow === f ? 'yes' : 'no';

    if (passes[f] !== '' && seen !== '' && passes[f] !== seen) {
      notes.push(`the ${f} search says ${passes[f]}, where the stardust to power up says ${seen}`);
    }

    return passes[f] || seen;
  };

  const marks = { shadow: column('shadow'), purified: column('purified') };
  const either = marks.shadow === 'yes' || marks.purified === 'yes';
  const neither = marks.shadow === 'no' && marks.purified === 'no';

  return { ...marks, shadowed: notes.length > 0 ? null : either ? true : neither ? false : null, notes };
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
 * Whether two keys can be one Pokémon read twice: the same, or the same but for fields among the last `blank` that one
 * read left blank — by default the IVs alone, where one read missed the overlay. PGSharp's overlay reads on one look
 * and not the next, so a key with IVs and one without are not a disagreement, only a reading that lost a field. The
 * walk keeps the default, since `replay` takes the longer of two keys for the fuller, which holds only while one field
 * can be the one missing; `Marks` lets the weight and height go too.
 */
export function agree(a: string, b: string, blank = 1): boolean {
  const x = a.split('|');
  const y = b.split('|');

  return x.length === y.length && x.every((f, i) => f === y[i] || (i >= x.length - blank && (f === '' || y[i] === '')));
}

/** The same without the name, so a nickname read differently in two passes still matches. */
export function looseKeyOf(detail: Detail, overlay: Overlay | null): string {
  const iv = overlay ? ivsOf(overlay.iv) : '';

  return [detail.hp, detail.weight, detail.height, iv].join('|');
}

interface Found {
  key: string;
  loose: string;
}

/**
 * The Pokémon a flag search found, held as a multiset of keys so that each one marks exactly one row of the full pass.
 * A looser key without the name is kept beside each, since a name is the field OCR is likeliest to read two ways.
 */
export class Marks {
  readonly #found: Found[] = [];
  size = 0;

  add(detail: Detail, overlay: Overlay | null) {
    const key = keyOf(detail, overlay);

    if (key) {
      this.#found.push({ key, loose: looseKeyOf(detail, overlay) });
      this.size++;
    }
  }

  /**
   * Whether this Pokémon was in the search, using up the match so a twin is not marked by the same entry. Last of all
   * the weight, height and IVs may each be blank on one side, since OCR reads a field on one pass and loses it on the
   * other: the shiny pass read `magnemite|50||0.25|13/13/5` for the full pass's `magnemite|50|5.55|0.25|13/13/5`. Last,
   * so a row takes an entry the same as it before one that merely fails to differ, which is left for a twin. What no
   * order can do is see the rows still to come: a row with a field blank takes the first entry it fits, which a later
   * row may have matched exactly. That needs two of one species sharing an HP and every field both read, and moves a
   * mark between them rather than gaining or losing one.
   */
  take(detail: Detail, overlay: Overlay | null): boolean {
    const key = keyOf(detail, overlay);
    const loose = looseKeyOf(detail, overlay);

    if (key === null) {
      return false;
    }

    for (const fits of [
      (e: Found) => e.key === key,
      (e: Found) => e.loose === loose,
      (e: Found) => agree(e.key, key, 3),
    ]) {
      const i = this.#found.findIndex(fits);

      if (i >= 0) {
        this.#found.splice(i, 1);
        return true;
      }
    }

    return false;
  }
}

/** How many sweeps may find nothing before the scan stops looking for an overlay it has not found. */
export const SWEEPS = 5;

/**
 * PGSharp's overlay, with the box it sits in found on the way if it is not known yet. The box does not move between
 * Pokémon — only between phones — so it is worth finding once and keeping, which is the difference between a sweep
 * of the upper screen and one crop. Only a box that actually yielded a reading is kept: one that merely looked right
 * would go on being wrong for every Pokémon after it, where not keeping it costs another sweep.
 *
 * `find` and `read` are `findOverlay` and `readOverlay`, taken rather than imported so the suite can count sweeps.
 */
export class OverlayBoxes {
  box: OverlayBox | null;
  readonly #find: typeof findOverlay;
  readonly #read: typeof readOverlay;

  /** Spent only by a sweep that finds nothing, a phone with the overlay switched off otherwise sweeping for ever. */
  #sweepsLeft = SWEEPS;

  constructor(box: OverlayBox | null, find: typeof findOverlay, read: typeof readOverlay) {
    this.box = box;
    this.#find = find;
    this.#read = read;
  }

  /**
   * The overlay on `image`. `sweep` is the caller's leave to look for it, which it withholds on a look this Pokémon is
   * being given for some other reason — the crop is still read, so a box already known still answers.
   *
   * A sweep that reads the overlay costs nothing of the ration, because it is proof the overlay is switched on. A box
   * found on one Pokémon clips another's line for as long as a scan runs — 7 of one scan's first 130 Pokémon, each
   * read whole by a sweep — so a miss on a phone known to draw the overlay is always worth one.
   */
  async overlayOn(image: Image, sweep: boolean): Promise<Overlay | null> {
    const known = this.box && (await this.#read(image, this.box));

    if (known || !sweep || this.#sweepsLeft <= 0) {
      return known ?? null;
    }

    const found = await this.#find(image);

    if (!found) {
      this.#sweepsLeft--;
      return null;
    }

    // A box tightened on one Pokémon clips a longer line on another — a three digit percentage is a character wider,
    // and two of twenty-five captures missed for exactly that. So the box is widened to cover both rather than
    // swapped, which converges instead of flipping between the two Pokémon that disagree.
    this.box = this.box ? widen(this.box, found.box) : found.box;

    return found.overlay;
  }
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

  const iv = overlay ? ivsOf(overlay.iv) : null;

  return { hp: detail.hp, weight: detail.weight, height: detail.height, iv };
}

function sameLandmark(a: Landmark | null, b: Landmark | null): boolean {
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
const LANDMARKS = 3;

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
    const attack = number(row, 'attack_iv');
    const defense = number(row, 'defense_iv');
    const stamina = number(row, 'stamina_iv');

    return read === null
      ? null
      : {
          hp: read,
          weight: number(row, 'weight_kg'),
          height: number(row, 'height_m'),
          iv: attack === null || defense === null || stamina === null ? null : ivsOf({ attack, defense, stamina }),
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
export interface World {
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
export function distance(worlds: ReadonlyMap<number, World>, index: number): number | undefined {
  let fallback: number | undefined;

  for (let k = 1; k <= index; k++) {
    const landed = new Map([...worlds].map(([end, { at, known }]) => [end, known.get(Math.max(at - k, 0))]));
    const open = landed.get(Infinity);
    const ended = [...landed].filter(([end]) => end !== Infinity).map(([, key]) => key);

    if (open !== undefined && ended.every((key) => key !== undefined && !agree(key, open))) {
      return k;
    }

    const keys = [...landed.values()];

    // A read rules out a world only where it lands on a Pokémon already read, and differently from it. Pairwise, since
    // `agree` is not transitive: two keys with different IVs each agree with one that missed them.
    if (fallback === undefined && keys.some((a) => keys.some((b) => !same(a, b)))) {
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
 *
 * A swipe the phone drops looks like the end too: the look-back finds the Pokémon before the last where storage going
 * on would have put the last, and rules out storage going on. `total`, the count the game shows for what is walked,
 * says whether that end is real, and without one the walk ends there as before. Where it is not — the end found at the
 * last Pokémon visited, short of `total` — the swipe forward is taken as dropped rather than the end: struck from what
 * the walk has done, as though never sent, and sent again, up to `DROP_RETRIES` times in a row, so that a count read
 * too high costs a few swipes at the real end. Struck rather than the end merely set aside, which would take the screen
 * read again for a twin: one Pokémon written twice and the next one skipped. An end found further back, past an unread
 * screen, is not retried, and is left to `shortfall` to report, as is a drop on the first swipe of a pass: with nothing
 * read before the first Pokémon, the look-back cannot tell a drop from a twin, and the walk stops as it does for twins
 * there.
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

      const landed = new Map([...possible].map(([end, { at, known }]) => [end, known.get(Math.max(at - k, 0))]));
      await swipe(-1, k);
      const key = await look(landed);
      await swipe(1, k);
      ends = [...possible.keys()];
      const left = possible.size;
      possible = worlds();

      if (key === null) {
        break;
      }

      // A look that rules out no world and teaches none of them anything leaves the walk where it was, and the next
      // look would land on the same place: a read that missed the overlay, say, where the worlds differ only in IVs.
      const learnt = [...possible].some(([end, { at, known }]) => known.get(Math.max(at - k, 0)) !== landed.get(end));

      if (possible.size === left && !learnt) {
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

    if (possible.size > 1 && reading.key !== null && latest !== null && agree(reading.key, latest)) {
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

/**
 * What one look down a detail screen for the moves found, whether `movesCutOff` said they can run on below it, and
 * PGSharp's overlay as it reads on the screen looked at, which it draws there too.
 */
export interface MovesLook {
  moves: Moves;
  cutOff: boolean;
  overlay: Overlay | null;
}

/**
 * How many steps down a detail screen the scan will go for the moves. One reaches them on almost every Pokémon, and
 * the second is Necrozma's: its fusion panel leaves the `GYMS & RAIDS` tab at the foot of the screen one step brings
 * up. Bounded, since a screen `movesCutOff` cannot place the tab on — one that misread it — would otherwise be looked
 * down for ever.
 */
export const MOVE_STEPS = 2;

/**
 * The look that found the moves, looked for `steps` steps down the screen and, while a look comes back short of a fast
 * and a charged move on a screen the moves can run on past, one step further each time, up to `MOVE_STEPS`. So the
 * ordinary Pokémon costs the one look it always did: another is taken only once the first has been read and found
 * wanting, since `look` reads while the phone scrolls back up, and deciding before that would put the read in front of
 * every scroll back.
 */
export async function reachMoves<L extends MovesLook>(look: (steps: number) => Promise<L>): Promise<L> {
  for (let steps = 1; ; steps++) {
    const found = await look(steps);
    const { moves, cutOff } = found;

    if ((moves.fast !== null && moves.charged.length > 0) || !cutOff || steps >= MOVE_STEPS) {
      return found;
    }
  }
}

/**
 * Whether two overlays are of different Pokémon: both read, and their IVs differ. One that went unread says nothing
 * either way. The IVs rather than the level, whose shortlist is a guess that moves between two reads of one screen.
 */
export function otherPokemon(a: Overlay | null, b: Overlay | null): boolean {
  return a !== null && b !== null && ivsOf(a.iv) !== ivsOf(b.iv);
}

/** Whether two keys differ in each of the HP, weight and height, every one of them read on both. */
function elsewhere(a: string, b: string): boolean {
  const x = a.split('|').slice(1, 4);
  const y = b.split('|').slice(1, 4);

  return x.every((f, i) => f !== '' && y[i] !== '' && f !== y[i]);
}

/**
 * The moves of the Pokémon `reading` read, `reach` scrolling down the screen from a reading of it and reading them —
 * never another Pokémon's. A swipe to the next Pokémon can bounce back after the detail screen was read: a live scan
 * read a Roggenrola at `L21 IV53 3/11/10`, and the screen it scrolled down to was the Rookidee before it, `L20 IV60
 * 11/6/10` over `Peck` and `Sky Attack`, which the row was written with. So the overlay over the moves is held to the
 * reading's, and where it is another Pokémon's the screen is read again to find which one the phone is on: this one,
 * the moves screen having been a frame of another, or the one before it, which one swipe on puts right. Then the moves
 * are looked for again, once. That also leaves the walk where it thinks it is: left on the Rookidee, its next swipe
 * landed on the Roggenrola again, which it took for a swipe that went nowhere.
 *
 * Answers the look taken for this Pokémon, so that whatever else was read off its screen is this Pokémon's too, and a
 * note of what happened. Where it could not be put right there is no look, and nothing off another's screen is kept.
 */
export async function movesOf<R extends { key: string | null; overlay: Overlay | null }, L extends MovesLook>(
  reading: R,
  reach: (from: R) => Promise<L>,
  { read, next }: Pick<Steps<R>, 'read' | 'next'>,
): Promise<{ look: L | null; note: string | null }> {
  const first = await reach(reading);

  if (!otherPokemon(reading.overlay, first.overlay) || reading.key === null) {
    return { look: first, note: null };
  }

  const other = `the moves screen showed another Pokémon, ${ivsOf((first.overlay as Overlay).iv)}`;
  const lost = { look: null, note: `${other}, and this Pokémon could not be found again` };
  let again = await read();

  // A swipe the walk does not log, so taken only where the screen is surely another Pokémon: one whose HP, weight and
  // height all read and all differ from this one's, as the Rookidee's 75 HP, 2.69kg and 0.25m do from the Roggenrola's
  // 95, 16.26 and 0.37. Not on the IVs, which are what disagreed: a misread of them in `reading` would send the phone
  // on from this Pokémon to the next, which the walk would then swipe past without ever reading. A misread of any one
  // of the three only costs the moves.
  if (again.key !== null && elsewhere(again.key, reading.key)) {
    await next();
    again = await read();
  }

  if (again.key === null || !agree(again.key, reading.key)) {
    return lost;
  }

  const second = await reach(again);

  return otherPokemon(reading.overlay, second.overlay)
    ? { look: null, note: `${other}, and another again when looked at twice` }
    : { look: second, note: `${other}, so they were looked for again` };
}
