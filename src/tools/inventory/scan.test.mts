/**
 * The parts of `pnpm inventory scan` that need no phone: the arguments it takes, the rows it writes and the keys that
 * decide whether a flag search and the full pass saw the same Pokémon. A wrong key is a flag lost from a row or set on
 * the wrong one, and nothing on a phone screen says which.
 */

import { measuresIn, type Detail } from './detail.mts';
import { type Moves } from '../../core/moves.mts';
import { ocr } from '../../core/ocr.mts';
import { findOverlay, ivsOf, readOverlay, widen, type Overlay } from './overlay.mts';
import { decodePng, screenIn } from '../../core/png.mts';
import {
  agree,
  count,
  distance,
  DROP_RETRIES,
  keyOf,
  land,
  landmarkOf,
  landmarksBefore,
  looseKeyOf,
  Marks,
  MOVE_STEPS,
  type MovesLook,
  movesOf,
  otherPokemon,
  OverlayBoxes,
  parseFlags,
  reachMoves,
  shaded,
  shortfall,
  SWEEPS,
  walk,
  type Landmark,
} from './scan.mts';
import { useTestEngine } from '../../core/node/test-engine.mts';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, expect, test, vi } from 'vitest';

afterAll(useTestEngine());

afterEach(() => {
  vi.restoreAllMocks();
});

/** A detail screen read with a 50 HP Pikachu's measurements, and whatever else a test says. */
function detail(fields: Partial<Detail> = {}): Detail {
  return {
    cp: null,
    cps: [],
    name: 'Pikachu',
    hp: 50,
    weight: 6.1,
    height: 0.41,
    types: ['Electric'],
    gender: null,
    favourite: false,
    lucky: false,
    size: null,
    tags: [],
    evolveCandy: null,
    powerUp: null,
    max: null,
    ...fields,
  };
}

const overlay = (attack: number, defense: number, stamina: number): Overlay => ({
  levels: [20],
  iv: { attack, defense, stamina },
  checked: true,
  form: null,
});

test('a screen without its HP has no key, however much else was read', () => {
  expect(keyOf(detail({ hp: null }), overlay(15, 15, 15))).toBeNull();
});

test('a name read with different case and accents keys the same', () => {
  expect(keyOf(detail({ name: 'POKéMON' }), null)).toBe(keyOf(detail({ name: 'pokemon' }), null));
});

test.for([
  ['the HP', detail({ hp: 51 }), overlay(15, 15, 15)],
  ['the weight', detail({ weight: 6.2 }), overlay(15, 15, 15)],
  ['the height', detail({ height: 0.42 }), overlay(15, 15, 15)],
  ['the IVs', detail(), overlay(15, 15, 14)],
  ['an overlay not read', detail(), null],
] as const)('two Pokémon differing only in %s key apart', ([, other, ivs]) => {
  const key = keyOf(detail(), overlay(15, 15, 15));

  expect(keyOf(other, ivs)).not.toBe(key);
  expect(looseKeyOf(other, ivs)).not.toBe(looseKeyOf(detail(), overlay(15, 15, 15)));
});

test('the loose key leaves out the name, which the exact key holds', () => {
  const read = detail({ name: 'Pikachu' });
  const misread = detail({ name: 'Pikachv' });

  expect(keyOf(read, null)).not.toBe(keyOf(misread, null));
  expect(looseKeyOf(read, null)).toBe(looseKeyOf(misread, null));
});

test('a marked Pokémon marks one row, not every row after it', () => {
  const marks = new Marks();

  marks.add(detail(), overlay(15, 15, 15));

  expect(marks.size).toBe(1);
  expect(marks.take(detail(), overlay(15, 15, 15))).toBe(true);
  expect(marks.take(detail(), overlay(15, 15, 15)), 'the one mark was used twice').toBe(false);
});

test('twins the search found twice are both marked, and a third is not', () => {
  const marks = new Marks();

  marks.add(detail(), null);
  marks.add(detail(), null);

  expect(marks.size).toBe(2);
  expect([marks.take(detail(), null), marks.take(detail(), null), marks.take(detail(), null)]).toStrictEqual([
    true,
    true,
    false,
  ]);
});

test('a name read two ways across the passes still finds its mark', () => {
  const marks = new Marks();

  marks.add(detail({ name: 'Sparky' }), overlay(10, 11, 12));

  expect(marks.take(detail({ name: 'Sparkv' }), overlay(10, 11, 12))).toBe(true);
});

test('a weight the flag pass left blank still finds its mark, the shiny Magnemite of a live run', () => {
  const marks = new Marks();
  const magnemite = (hp: number, weight: number | null, height: number) =>
    detail({ name: 'Magnemite', hp, weight, height });

  marks.add(magnemite(45, 6.7, 0.32), overlay(15, 7, 14));
  marks.add(magnemite(50, null, 0.25), overlay(13, 13, 5));
  marks.add(magnemite(71, 3.68, 0.26), overlay(11, 15, 6));

  expect(marks.take(magnemite(50, 5.55, 0.26), overlay(13, 13, 5)), 'a field read on both sides differs').toBe(false);
  expect(marks.take(magnemite(50, 5.55, 0.25), overlay(13, 13, 5))).toBe(true);
  expect(marks.take(magnemite(45, 6.7, 0.32), overlay(15, 7, 14))).toBe(true);
  expect(marks.take(magnemite(71, 3.68, 0.26), overlay(11, 15, 6))).toBe(true);
  expect(marks.take(magnemite(50, 5.55, 0.25), overlay(13, 13, 5)), 'the one mark was used twice').toBe(false);
});

test('a height the full pass left blank still finds its mark', () => {
  const marks = new Marks();

  marks.add(detail(), overlay(15, 15, 15));

  expect(marks.take(detail({ height: null }), overlay(15, 15, 15))).toBe(true);
});

test('a row read in full takes the entry it equals, leaving the one with a blank to its twin', () => {
  const marks = new Marks();

  marks.add(detail({ weight: null }), overlay(15, 15, 15));
  marks.add(detail({ weight: 6.1 }), overlay(15, 15, 15));

  expect(marks.take(detail({ weight: 6.1 }), overlay(15, 15, 15))).toBe(true);
  expect(marks.take(detail({ weight: 7.2 }), overlay(15, 15, 15)), 'the blank entry went to the first row').toBe(true);
});

test('a screen with no key is neither marked nor answered', () => {
  const marks = new Marks();

  marks.add(detail({ hp: null }), null);

  expect(marks.size).toBe(0);
  expect(marks.take(detail({ hp: null }), null), 'a `false` nothing checked').toBeNull();
});

test('a Pokémon the search did not find is not marked', () => {
  const marks = new Marks();

  marks.add(detail(), overlay(15, 15, 15));

  expect(marks.take(detail(), overlay(0, 15, 15))).toBe(false);
  expect(marks.take(detail(), overlay(15, 15, 15)), 'the miss used up the mark').toBe(true);
});

test('the flags named are the flags searched, and an empty name is no flag', () => {
  expect(parseFlags('shiny,lucky')).toStrictEqual(['shiny', 'lucky']);
  expect(parseFlags('shiny,,shadow,')).toStrictEqual(['shiny', 'shadow']);
  expect(parseFlags('')).toStrictEqual([]);
});

test('a flag that is not a search is refused, naming the ones that are', () => {
  expect(() => parseFlags('shiny,sparkly')).toThrow(
    'unknown flag sparkly; the choices are shiny, lucky, costume, shadow, purified',
  );
});

test('a count left out is the fallback, and a whole number is itself', () => {
  expect(count('limit', undefined, Infinity)).toBe(Infinity);
  expect(count('skip', '0', 5)).toBe(0);
  expect(count('limit', '12', Infinity)).toBe(12);
});

test.for(['-1', '1.5', 'ten', 'NaN', 'Infinity'])('a count of %j is refused rather than run with', (value) => {
  expect(() => count('limit', value, Infinity)).toThrow(`--limit takes a whole number, not ${value}`);
});

/**
 * Walks a storage of `keys` the way a phone would: a swipe past either end goes nowhere. Answers the position each
 * Pokémon was visited at, so a walk that visits the right keys from the wrong place is caught as well. A null key is a
 * screen that never reads, and the first read of each position in `missed` comes back unread, as a screen OCR misses
 * once does. Each swipe forward whose number, counting from 0, is in `dropped` goes nowhere, as #581's phone dropped
 * one in ten, or each swipe `dropped` answers true for, given which way it goes and how many went that way before it.
 * `total` is the count the game shows for the walk. The second read of each position in `again` reads as that entry
 * says, as a screen whose overlay or name reads another way on a second look.
 */
async function walked(
  keys: readonly (string | null)[],
  max = Infinity,
  from = 0,
  missed: readonly number[] = [],
  dropped: readonly number[] | ((move: 1 | -1, before: number) => boolean) = [],
  total: number | null = null,
  again: Readonly<Record<number, string>> = {},
) {
  let at = from;
  const swiped = { [1]: 0, [-1]: 0 };
  const unread = new Set(missed);
  const reads = new Map<number, number>();
  const drops =
    typeof dropped === 'function' ? dropped : (move: 1 | -1, n: number) => move === 1 && dropped.includes(n);
  const visited: [string | null, number][] = [];

  const swipe = (move: 1 | -1) => {
    if (!drops(move, swiped[move]++)) {
      at = Math.min(Math.max(at + move, 0), keys.length - 1);
    }
  };

  await walk(
    {
      read: async () => {
        reads.set(at, (reads.get(at) ?? 0) + 1);

        if (unread.delete(at)) {
          return { key: null };
        }

        return { key: (reads.get(at) === 2 ? again[at] : undefined) ?? keys[at] ?? null };
      },
      next: async () => swipe(1),
      back: async () => swipe(-1),
    },
    async ({ key }) => void visited.push([key, at]),
    max,
    from,
    undefined,
    total,
  );

  return visited;
}

test.for([
  ['a twin in the middle', ['a', 'b', 'b', 'c']],
  ['a twin last', ['a', 'b', 'b']],
  ['triplets last', ['a', 'b', 'b', 'b']],
  ['no twin at all', ['a', 'b', 'c']],
] as const)('the walk visits every Pokémon once, given %s', async ([, keys]) => {
  expect(await walked(keys)).toEqual(keys.map((key, i) => [key, i]));
});

test('a walk skipped past the first Pokémon tells twins from the end by what it has read since', async () => {
  expect(await walked(['a', 'b', 'c', 'c'], Infinity, 1)).toEqual([
    ['b', 1],
    ['c', 2],
    ['c', 3],
  ]);
});

test('a walk stops after the most it was asked for', async () => {
  expect(await walked(['a', 'b', 'b', 'c'], 3)).toEqual([
    ['a', 0],
    ['b', 1],
    ['b', 2],
  ]);
});

test.for([
  ['the first Pokémon in storage', ['a', 'a', 'b'], 0],
  ['the one a walk skipped to', ['a', 'b', 'b', 'b'], 2],
] as const)('twins from %s stop the walk, saying why', async ([, keys, from]) => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  expect(await walked(keys, Infinity, from)).toEqual([[keys[from], from]]);
  expect(error).toHaveBeenCalledWith(expect.stringContaining('its end cannot be told'));
});

test('a miss just before a run that ends storage does not visit the last Pokémon twice', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  expect(await walked(['x', 'a', 'a'], Infinity, 0, [1])).toEqual([
    ['x', 0],
    [null, 1],
    ['a', 2],
  ]);
  expect(error).not.toHaveBeenCalled();
});

test('a third unreadable screen in a row stops the pass, and two do not', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  expect(await walked(['a', null, null, 'd', 'e'])).toEqual([
    ['a', 0],
    [null, 1],
    [null, 2],
    ['d', 3],
    ['e', 4],
  ]);
  expect(error).not.toHaveBeenCalledWith(expect.stringContaining('three unreadable screens'));

  expect(await walked(['a', null, null, null, 'e'])).toEqual([
    ['a', 0],
    [null, 1],
    [null, 2],
  ]);
  expect(error).toHaveBeenCalledWith(expect.stringContaining('three unreadable screens in a row; stopping this pass'));
  error.mockRestore();
});

test('a screen read two different ways, leaving no end to storage it fits, stops the pass', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  // The second Pokémon goes unread, and the look back that tells the third from it read again reads it `q`. At the end
  // the look back reads it `b` all three times, which fits neither storage going on, with `c` there, nor storage
  // ending, with `q` there, so the pass stops on the look back, each Pokémon visited once and none past the end.
  expect(await walked(['a', 'b', 'c'], Infinity, 0, [1], [], null, { 1: 'q' })).toEqual([
    ['a', 0],
    [null, 1],
    ['c', 2],
  ]);
  expect(error).toHaveBeenCalledWith(expect.stringContaining('one screen read two different ways'));
  error.mockRestore();
});

// The look back that tells the miss from the Pokémon before it ends where it began, reading the miss again.
test('a miss on the last Pokémon in storage is read again, and ends the walk there', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  expect(await walked(['o', 'p', 'q'], Infinity, 0, [2])).toEqual([
    ['o', 0],
    ['p', 1],
    ['q', 2],
  ]);
  expect(error).not.toHaveBeenCalled();
});

test('a miss on a twin of the Pokémon before a run is settled by the run going on', async () => {
  expect(await walked(['x', 'x', 'a', 'a'], Infinity, 0, [1])).toEqual([
    ['x', 0],
    [null, 1],
    ['a', 2],
    ['a', 3],
  ]);
});

// The two read the same at every place a swipe back can reach, so the walk writes the same rows for both and says the
// last may be the unread one again, which it is in the second.
test.for([
  ['a twin of the first', ['x', 'x', 'a']],
  ['the last', ['x', 'a']],
] as const)('a miss on %s, just before the end, says the last row may repeat', async ([, keys]) => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  expect((await walked(keys, Infinity, 0, [1])).map(([key]) => key)).toEqual(['x', null, 'a']);
  expect(error).toHaveBeenCalledWith(expect.stringContaining('storage may have ended 1 Pokémon ago'));
});

test.for([
  ['a twin', ['x', 'a', 'a', 'a', 'b']],
  ['another Pokémon', ['x', 'y', 'a', 'a', 'b']],
] as const)('a miss just before a run of twins still visits every Pokémon once, given %s', async ([, keys]) => {
  expect((await walked(keys, Infinity, 0, [1])).map(([, at]) => at)).toEqual(keys.map((_, i) => i));
});

test('a key with IVs agrees with the same key read without the overlay, and not with other IVs', () => {
  expect(agree('a|1|2|3|1/2/3', 'a|1|2|3|')).toBe(true);
  expect(agree('a|1|2|3|', 'a|1|2|3|1/2/3')).toBe(true);
  expect(agree('a|1|2|3|1/2/3', 'a|1|2|3|1/2/4')).toBe(false);
  expect(agree('a|1|2|3|', 'a|1|2|4|')).toBe(false);
  expect(agree('a', 'b')).toBe(false);
});

const ivKey = (name: string) => `${name}|50|1.5|0.4|15/15/15`;
const blindKey = (name: string) => `${name}|50|1.5|0.4|`;

test('a look back that misses the overlay a first read saw goes on, after a skip', async () => {
  const keys = [ivKey('z'), ivKey('a'), ivKey('a'), ivKey('c')];

  expect(await walked(keys, Infinity, 1, [], [], null, { 1: blindKey('a') })).toEqual([
    [keys[1], 1],
    [keys[2], 2],
    [keys[3], 3],
  ]);
});

test('a look back that reads a Pokémon another way, then as before, is a misread and the walk goes on', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  expect(await walked(['z', 'a', 'a', 'c'], Infinity, 1, [], [], null, { 1: 'q' })).toEqual([
    ['a', 1],
    ['a', 2],
    ['c', 3],
  ]);
  expect(error).not.toHaveBeenCalled();
});

// Nothing then tells the twins from the end, so the walk stops — but on a screen it says it could not settle, not
// silently on a misread.
test('a look back that reads three ways is taken for a misread rather than the end of storage', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const keys = ['a', 'b', 'b', 'c'];
  let at = 1;
  let looks = 0;
  const visited: [string | null, number][] = [];

  await walk(
    {
      // Every read of the first twin after the first answers something new.
      read: async () => ({ key: at === 1 && looks++ > 0 ? `m${looks}` : (keys[at] ?? null) }),
      next: async () => void (at = Math.min(at + 1, keys.length - 1)),
      back: async () => void (at = Math.max(at - 1, 0)),
    },
    async ({ key }) => void visited.push([key, at]),
    Infinity,
    1,
  );

  expect(visited).toEqual([['b', 1]]);
  expect(error).toHaveBeenCalledWith(expect.stringContaining('taking it for a misread'));
  expect(error).toHaveBeenCalledWith(expect.stringContaining('its end cannot be told'));
});

/**
 * What #581's phone did: one swipe in ten went nowhere, which `walk` takes for the end of storage, and the passes came
 * out at 82 of 908 shiny and 45 of 2,708 in all with nothing said. Held against the game's own count, they fail.
 */
test('a pass that stops short of the count the game shows for it fails, saying how short', () => {
  expect(shortfall('shiny', 82, 908)).toBe('shiny: the game counts 908 Pokémon, but the pass stopped after 82');
  expect(shortfall('the full pass', 5, 2708, 40)).toBe(
    'the full pass: the game counts 2708 Pokémon, but the pass stopped after 5 of the 2668 after --skip 40',
  );
});

test.for([
  ['reached the count', 908, 908, 0, Infinity],
  ['visited a screen twice past it', 909, 908, 0, Infinity],
  ['reached its --limit', 10, 2708, 0, 10],
  ['reached the end after its --skip', 8, 2708, 2700, Infinity],
  ['a count that did not read', 45, null, 0, Infinity],
] as const)('a pass that %s does not fail', ([, visited, counted, skip, limit]) => {
  expect(shortfall('pass', visited, counted, skip, limit)).toBeNull();
});

/**
 * #581: a swipe that went nowhere read as the end of storage, and the pass stopped there. With the game's count, the
 * walk swipes again and visits every Pokémon once — the one before the drop not twice, and the one after not skipped.
 */
test.for([
  ['between two Pokémon', ['a', 'b', 'c', 'd'], [1]],
  ['between two of one species', ['a', 'b', 'b', 'c'], [1]],
  ['twice in a row', ['a', 'b', 'c', 'd'], [1, 2]],
  ['twice over the walk', ['a', 'b', 'c', 'd', 'e'], [1, 3]],
] as const)('a dropped swipe %s is sent again short of the count', async ([, keys, dropped]) => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  expect(await walked(keys, Infinity, 0, [], dropped, keys.length)).toEqual(keys.map((key, i) => [key, i]));
  expect(error).toHaveBeenCalledWith(expect.stringContaining('went nowhere'));
});

/**
 * #820: the swipe on to a Pokémon went nowhere, and so did a swipe of the look back for it. Where that was the swipe
 * back, the look read the screen it left and took the Pokémon before for a twin, which the read where the look came
 * back does not fit. Each case drops the third swipe forward, and a swipe of the look back that follows it — or, as in
 * #831, both of them, which leaves every read after the third Pokémon reading it again, as a twin of it would.
 */
test.for([
  ['swipe back', (move: 1 | -1, n: number) => (move === 1 ? n === 2 : n === 0)],
  ['swipe forward again', (move: 1 | -1, n: number) => move === 1 && (n === 2 || n === 3)],
  ['swipe back and forward again', (move: 1 | -1, n: number) => (move === 1 ? n === 2 || n === 3 : n === 0)],
] as const)('a look for a dropped swipe whose %s goes nowhere too visits every Pokémon once', async ([, dropped]) => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const keys = ['a', 'b', 'c', 'd', 'e', 'f'];

  expect(await walked(keys, Infinity, 0, [], dropped, keys.length)).toEqual(keys.map((key, i) => [key, i]));
});

/** Mulberry32: numbers in [0, 1) that are the same for the same seed, so a walk the phone botched can be run again. */
function seeded(seed: number) {
  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * #820's phone dropped 9 of the 106 swipes on, and swipes back can go nowhere as well. With every swipe going nowhere
 * at that rate, a walk seldom reaches the count having visited a Pokémon twice or out of place, which nothing after it
 * would catch.
 */
test('swipes going nowhere at random, either way, seldom cost a walk its place unseen', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const keys = Array.from({ length: 60 }, (_, i) => `pikachu|${50 + (i % 7)}|${(5 + i / 100).toFixed(2)}|0.41|`);
  let unseen = 0;
  let whole = 0;

  for (let seed = 1; seed <= 100; seed++) {
    const random = seeded(seed);
    const visited = await walked(keys, Infinity, 0, [], () => random() < 0.08, keys.length);
    const right = visited.every(([key, at], i) => key === keys[i] && at === i);
    unseen += Number(!right && visited.length === keys.length);
    whole += Number(right && visited.length === keys.length);
  }

  expect(unseen).toBeLessThanOrEqual(3);
  expect(whole).toBeGreaterThanOrEqual(80);
});

test('a walk skipped into storage counts its retries against the whole of storage', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  expect(await walked(['a', 'b', 'c', 'd'], Infinity, 1, [], [1], 4)).toEqual([
    ['b', 1],
    ['c', 2],
    ['d', 3],
  ]);
});

test('a dropped swipe with no count to hold it to still ends the walk, for `shortfall` to report', async () => {
  expect(await walked(['a', 'b', 'c'], Infinity, 0, [], [1])).toEqual([
    ['a', 0],
    ['b', 1],
  ]);
});

test('a count read too high costs a few swipes at the real end and visits nothing twice', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let swipes = 0;
  const keys = ['a', 'b', 'c'];
  let at = 0;
  const visited: string[] = [];

  await walk(
    {
      read: async () => ({ key: keys[at] ?? null }),
      next: async () => void (swipes++, (at = Math.min(at + 1, keys.length - 1))),
      back: async () => void (at = Math.max(at - 1, 0)),
    },
    async ({ key }) => void visited.push(key as string),
    Infinity,
    0,
    undefined,
    10,
  );

  expect(visited).toEqual(keys);
  expect(error).toHaveBeenCalledTimes(DROP_RETRIES);
  expect(swipes).toBeLessThan(keys.length + 3 * (DROP_RETRIES + 1));
});

/**
 * #785: `dynamax&shiny`, counted `(1)`, wrote its one Uxie four times. The swipe on from it went nowhere, and the screen
 * it left, scrolled part way down, read without the shiny or the height, so the Uxie read again did not agree with the
 * first read and was taken for the next Pokémon. The count says there is no next one to look for.
 */
test('a walk visits no further than the count the game shows, however the last Pokémon reads again', async () => {
  // `max` only bounds a walk that goes past the count, which reads its one Pokémon again on every swipe.
  expect(await walked(['a'], 4, 0, [], [], 1, { 0: 'q' })).toEqual([['a', 0]]);
});

test('a drop on the first swipe of a pass cannot be told from a twin, so the walk stops there and says so', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  expect(await walked(['a', 'b', 'c'], Infinity, 0, [], [0], 3)).toEqual([['a', 0]]);
  expect(error).toHaveBeenCalledWith(expect.stringContaining('its end cannot be told'));
});

test('a walk skipped to the last Pokémon in storage ends there, by a look back that reads the same each time', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  expect(await walked(['a', 'b'], Infinity, 1)).toEqual([['b', 1]]);
  expect(error).not.toHaveBeenCalled();
});

test('a look back where one world missed the overlay still tells apart two worlds with different IVs', () => {
  // Storage going on lands on the IV-less read first, and each IV key agrees with it but not with the other.
  const worlds = [
    { at: 5, known: new Map([[4, blindKey('a')]]) },
    { at: 3, known: new Map([[2, ivKey('a')]]) },
    { at: 2, known: new Map([[1, 'a|50|1.5|0.4|1/2/3']]) },
  ];

  expect(distance(worlds, 5)).toBe(1);
});

/** The fields `landmarksBefore` reads, in a file of `rows` given as index, HP, weight, height and IVs. */
function written(rows: readonly (readonly [number, number | null, number | null, number | null, string])[]) {
  return rows
    .map(([index, hp, weight, height, ivs]) => {
      const [attack, defense, stamina] = ivs.split('/').map(Number);
      const iv = ivs === '' ? null : { attack, defense, stamina };

      return `${JSON.stringify({ index, species: 'Pikachu', hp, weight, height, iv, notes: ['a note'] })}\n`;
    })
    .join('');
}

test('a skip is checked against the last rows written up to it, oldest first', () => {
  const text = written([
    [1, 40, 6, 0.4, '1/2/3'],
    [2, 41, 6.1, 0.41, ''],
    [3, 42, 6.2, 0.42, '4/5/6'],
    [4, 43, 6.3, 0.43, '7/8/9'],
  ]);

  expect(landmarksBefore(text, 3)).toStrictEqual([
    { hp: 40, weight: 6, height: 0.4, iv: '1/2/3' },
    { hp: 41, weight: 6.1, height: 0.41, iv: null },
    { hp: 42, weight: 6.2, height: 0.42, iv: '4/5/6' },
  ]);
});

test('a row written lands as the reading that wrote it, an IV of 0 included', () => {
  const text = written([[1, 50, 6.1, 0.41, '0/15/0']]);

  expect(landmarksBefore(text, 1)).toStrictEqual([landmarkOf(detail(), overlay(0, 15, 0))]);
});

test('the rows checked stop at one with no HP, and take the last written under a number', () => {
  const text = written([
    [1, 40, 6, 0.4, ''],
    [2, null, null, null, ''],
    [3, 42, 6.2, 0.42, ''],
    [4, 43, 6.3, 0.43, ''],
    [3, 99, 9, 0.9, ''],
    [4, 44, 6.4, 0.44, ''],
  ]);

  expect(landmarksBefore(text, 4).map(({ hp }) => hp)).toStrictEqual([99, 44]);
  expect(landmarksBefore(text, 3).map(({ hp }) => hp)).toStrictEqual([99]);
});

test.for([
  ['a row the file does not have', 7, 'holds no row 7'],
  ['a row with no HP', 2, 'row 2 has no HP'],
] as const)('a skip to %s is refused', ([, skip, why]) => {
  const text = written([
    [1, 40, 6, 0.4, ''],
    [2, null, null, null, ''],
  ]);

  expect(() => landmarksBefore(text, skip)).toThrow(why);
});

/** The CSV a scan used to write among them, handed to `--out` by a resume of a run from before. */
test.for([
  ['a CSV', 'index,hp\n1,40\n', 'is not valid JSON'],
  ['a row without the fields a landing is checked by', '{"index":1,"hp":40}\n', 'not a file this scan wrote'],
] as const)('a file holding %s is refused', ([, text, why]) => {
  expect(() => landmarksBefore(text, 1)).toThrow(why);
});

/** A Pikachu of `hp`, read whole. */
const landmark = (hp: number): Landmark => ({ hp, weight: 6.1, height: 0.41, iv: '1/2/3' });

/**
 * Lands a skip of `from` over a storage of `hps`, with the forward swipes numbered in `dropped` — counting the blind
 * skip's — going nowhere. Answers where the walk would start and what `land` said it had been off by.
 */
async function landed(hps: readonly number[], from: number, dropped: readonly number[] = [], reach = 10) {
  let position = 0;
  let swipes = 0;
  const drop = new Set(dropped);

  const next = async () => {
    swipes++;

    if (!drop.has(swipes)) {
      position = Math.min(position + 1, hps.length - 1);
    }
  };

  for (let i = 0; i < from; i++) {
    await next();
  }

  const behind = hps.slice(Math.max(from - 3, 0), from).map(landmark);
  const off = await land(
    {
      read: async () => ({ key: String(hps[position]) }),
      next,
      back: async () => void (position = Math.max(position - 1, 0)),
    },
    behind,
    ({ key }) => landmark(Number(key)),
    reach,
  );

  return { position, off };
}

const storage = Array.from({ length: 40 }, (_, i) => 100 + i);

test('a skip that dropped no swipe starts where it was asked to', async () => {
  expect(await landed(storage, 20)).toStrictEqual({ position: 20, off: 0 });
});

test('a skip that dropped swipes steps on by every one it dropped', async () => {
  expect(await landed(storage, 20, [3, 8, 9, 15])).toStrictEqual({ position: 20, off: 4 });
});

test('a swipe dropped while looking for the rows does not move the start', async () => {
  // The skip's 20 swipes, then the search's: the third of those goes nowhere.
  expect((await landed(storage, 20, [5, 23])).position).toBe(20);
});

test('twins among the rows checked are found all the same', async () => {
  const twins = [...storage.slice(0, 18), 500, 500, ...storage.slice(20)];

  expect(await landed(twins, 20, [2])).toStrictEqual({ position: 20, off: 1 });
});

test('a skip to near the start of storage lands where it was asked to', async () => {
  expect((await landed(storage, 1)).position).toBe(1);
});

test('a skip that cannot find the rows before it fails rather than start anywhere', async () => {
  const dropped = Array.from({ length: 15 }, (_, i) => i + 1);

  await expect(landed(storage, 20, dropped, 5)).rejects.toThrow('did not turn up within 5 Pokémon');
});

test('a reading with no HP is no landmark, and one with no IVs matches whatever IVs were written', () => {
  expect(landmarkOf(detail({ hp: null }), null)).toBeNull();
  expect(landmarkOf(detail(), null)).toStrictEqual({ hp: 50, weight: 6.1, height: 0.41, iv: null });
});

test('a twin of the last row written, starting the pass, is not skipped', async () => {
  const twins = [...storage.slice(0, 19), 500, 500, ...storage.slice(21)];

  expect(await landed(twins, 20, [4])).toStrictEqual({ position: 20, off: 1 });
});

test('a look back that misses the overlay where the worlds differ only in IVs stops looking, rather than loop', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const keys = ['a|50|1.5|0.4|1/1/1', 'a|50|1.5|0.4|2/2/2', 'a|50|1.5|0.4|2/2/2'];
  let at = 0;
  let reads = 0;
  const seen = new Set<number>();
  const visited: [string | null, number][] = [];

  await walk(
    {
      // The first twin reads its IVs once; every look back at it after that misses the overlay.
      read: async () => {
        if (++reads > 50) {
          throw new Error('the walk is looking back at the same place for ever');
        }

        const key = keys[at] ?? null;
        const blind = at === 1 && seen.has(1);
        seen.add(at);
        return { key: blind && key ? key.slice(0, key.lastIndexOf('|') + 1) : key };
      },
      next: async () => void (at = Math.min(at + 1, keys.length - 1)),
      back: async () => void (at = Math.max(at - 1, 0)),
    },
    async ({ key }) => void visited.push([key, at]),
    Infinity,
    0,
  );

  expect(visited.map(([, place]) => place)).toEqual([0, 1]);
  expect(error).toHaveBeenCalledWith(expect.stringContaining('its end cannot be told'));
});

/**
 * Looks down a detail screen whose moves are `depth` steps down, answering what `movesCutOff` would of each look: the
 * moves where it went that far, and a screen stopping above them where it did not. Answers the steps each look took.
 */
async function lookingFor(depth: number) {
  const steps: number[] = [];

  const { moves } = await reachMoves(async (n) => {
    steps.push(n);

    return n >= depth
      ? { moves: { fast: 'Psycho Cut', charged: ['Future Sight'] }, cutOff: false, overlay: null }
      : { moves: { fast: null, charged: [] }, cutOff: true, overlay: null };
  });

  return { moves, steps };
}

test('moves one step down are looked for once', async () => {
  expect(await lookingFor(1)).toStrictEqual({
    moves: { fast: 'Psycho Cut', charged: ['Future Sight'] },
    steps: [1],
  });
});

test('moves below the screen one step brings up are looked for again, a step further', async () => {
  expect(await lookingFor(2)).toStrictEqual({
    moves: { fast: 'Psycho Cut', charged: ['Future Sight'] },
    steps: [1, 2],
  });
});

test('a screen that never reaches past the moves is looked down `MOVE_STEPS` times and no more', async () => {
  expect(await lookingFor(Infinity)).toStrictEqual({
    moves: { fast: null, charged: [] },
    steps: Array.from({ length: MOVE_STEPS }, (_, i) => i + 1),
  });
});

test('a short reading on a screen that reaches past the moves is a misread, and not looked for again', async () => {
  const steps: number[] = [];
  const { moves } = await reachMoves(async (n) => {
    steps.push(n);

    return { moves: { fast: 'Psycho Cut', charged: [] }, cutOff: false, overlay: null };
  });

  expect(moves).toStrictEqual({ fast: 'Psycho Cut', charged: [] });
  expect(steps).toStrictEqual([1]);
});

const capture = (file: string) => decodePng(readFileSync(new URL(`fixtures/moves/${file}`, import.meta.url)));

/**
 * The live scan's row #6: `roggenrola-detail.png` is the detail screen it read, and `rookidee-bounced.png` the screen
 * it scrolled down to and took `Peck` and `Sky Attack` off, which is the Rookidee before it, `rookidee-detail.png`.
 * PGSharp draws its overlay over the moves screen in the same place, so the box found on the detail screen reads it.
 */
test('the overlay over a moves screen tells whose moves they are', async () => {
  const found = await findOverlay(capture('roggenrola-detail.png'));

  expect(found?.overlay.iv).toStrictEqual({ attack: 3, defense: 11, stamina: 10 });

  const { box, overlay: roggenrola } = found ?? expect.unreachable('no overlay found on the Roggenrola');
  const bounced = await readOverlay(capture('rookidee-bounced.png'), box);
  const rookidee = await readOverlay(capture('rookidee-detail.png'), box);

  expect(bounced?.iv).toStrictEqual({ attack: 11, defense: 6, stamina: 10 });
  expect(otherPokemon(roggenrola, bounced), 'the Roggenrola took the Rookidee’s moves screen for its own').toBe(true);
  expect(otherPokemon(rookidee, bounced), 'the Rookidee’s own moves screen is taken for another’s').toBe(false);
  expect(measuresIn(await ocr(capture('rookidee-bounced.png'))), 'the Rookidee’s HP is the Roggenrola’s').not.toMatch(
    /^95\|/,
  );
});

/**
 * Issue #792: `elgyem-moves.png` is an Elgyem's own moves screen, which the live scan refused for its overlay. Read
 * through the box that scan had kept, as its log printed it, the overlay over the white panel loses the `8` the
 * detail screen's reads; the HP, weight and height under it are the detail screen's all the same.
 */
test('the HP, weight and height over a moves screen say whose it is where its overlay misreads', async () => {
  const box = {
    x: 0.10972222222222222,
    y: 0.20082236842105264,
    width: 0.6076388888888888,
    height: 0.024671052631578955,
  };
  const detailOverlay = await readOverlay(capture('elgyem-detail.png'), box);
  const moves = capture('elgyem-moves.png');
  const shown = await readOverlay(moves, box);

  expect(detailOverlay?.iv).toStrictEqual({ attack: 11, defense: 13, stamina: 8 });
  expect(
    otherPokemon(detailOverlay, shown),
    'the moves screen’s overlay no longer misreads; this test proves nothing',
  ).toBe(true);

  const measures = measuresIn(await ocr(moves));
  const took = await movesOf(
    {
      key: `elgyem|57|7.6|0.46|${ivsOf(detailOverlay?.iv ?? expect.unreachable('no overlay'))}`,
      overlay: detailOverlay,
    },
    async () => ({ moves: { fast: 'Astonish', charged: ['Dark Pulse'] }, cutOff: false, overlay: shown, measures }),
    { read: async () => expect.unreachable('read again'), next: async () => expect.unreachable('swiped') },
  );

  expect(measures).toBe('57|7.6|0.46');
  expect(took.note).toBeNull();
});

const BAND = { x: 0.15, y: 0.198, width: 0.7, height: 0.03 };
const SCREEN = decodePng(readFileSync(new URL('fixtures/no-pgsharp.png', import.meta.url)));

/**
 * Issue #587: a box kept from one Pokémon that clips the next one's line, so that only a sweep reads it. Each sweep
 * succeeds, so the overlay is plainly on, and the scan must go on sweeping long after the first five.
 */
test('a sweep that reads the overlay spends none of the ration', async () => {
  const find = vi.fn(async () => ({ box: BAND, overlay: overlay(12, 11, 14) }));
  const boxes = new OverlayBoxes(BAND, find, async () => null);

  for (let i = 0; i < SWEEPS * 2; i++) {
    expect(await boxes.overlayOn(SCREEN, true), `Pokémon ${i + 1} went unread`).toStrictEqual(overlay(12, 11, 14));
  }

  expect(find).toHaveBeenCalledTimes(SWEEPS * 2);
});

test('sweeps that find nothing stop at the ration, so a phone without the overlay is not swept for ever', async () => {
  const find = vi.fn(async () => null);
  const boxes = new OverlayBoxes(null, find, async () => null);

  for (let i = 0; i < SWEEPS * 2; i++) {
    expect(await boxes.overlayOn(SCREEN, true)).toBeNull();
  }

  expect(find).toHaveBeenCalledTimes(SWEEPS);
});

test('a sweep widens the kept box rather than replacing it, and a look without leave reads the box alone', async () => {
  const tight = { x: 0.2, y: 0.2, width: 0.5, height: 0.02 };
  const find = vi.fn(async () => ({ box: BAND, overlay: overlay(1, 2, 3) }));
  const boxes = new OverlayBoxes(tight, find, async () => null);

  expect(await boxes.overlayOn(SCREEN, false)).toBeNull();
  expect(find).not.toHaveBeenCalled();

  await boxes.overlayOn(SCREEN, true);
  expect(boxes.box).toStrictEqual(widen(tight, BAND));
});

/**
 * The real readers: the box swept off `gengar-gigantamax.png` clips `audino.png`'s line, which is the miss a scan of
 * that phone meets, and a sweep reads it all the same and widens the box to read both.
 */
test('a kept box that clips another Pokémon’s overlay is widened by a sweep until it reads both', async () => {
  const screen = (file: string) => screenIn(decodePng(readFileSync(new URL(`fixtures/${file}`, import.meta.url))));
  const gengar = screen('gengar-gigantamax.png');
  const audino = screen('audino.png');
  const found = (await findOverlay(gengar)) ?? expect.unreachable('no overlay found on the Gengar');

  expect(await readOverlay(audino, found.box), 'the Gengar’s box no longer clips the Audino').toBeNull();

  const boxes = new OverlayBoxes(found.box, findOverlay, readOverlay);

  expect(await boxes.overlayOn(audino, true)).not.toBeNull();
  expect(await readOverlay(audino, boxes.box ?? expect.unreachable('no box'))).not.toBeNull();
  expect(await readOverlay(gengar, boxes.box ?? expect.unreachable('no box'))).not.toBeNull();
});

test('an overlay that went unread says nothing of whose moves they are', () => {
  expect(otherPokemon(overlay(3, 11, 10), null)).toBe(false);
  expect(otherPokemon(null, overlay(11, 6, 10))).toBe(false);
});

interface Shown {
  key: string;
  overlay: Overlay;
  moves: Moves;
}

/** The HP, weight and height a key carries, which is what a moves screen that reads all three of them shows. */
const measuresOf = (key: string) => key.split('|').slice(1, 4).join('|');

const ROOKIDEE: Shown = {
  key: 'rookidee|75|2.69|0.25|11/6/10',
  overlay: overlay(11, 6, 10),
  moves: { fast: 'Peck', charged: ['Sky Attack'] },
};

const ROGGENROLA: Shown = {
  key: 'roggenrola|95|16.26|0.37|3/11/10',
  overlay: overlay(3, 11, 10),
  moves: { fast: 'Smack Down', charged: ['Rock Blast'] },
};

const PIDOVE: Shown = {
  key: 'pidove|50|2.1|0.3|13/5/6',
  overlay: overlay(13, 5, 6),
  moves: { fast: 'Quick Attack', charged: ['Air Cutter'] },
};

/**
 * The moves `movesOf` takes for the Roggenrola, read off a storage of the Rookidee, it and a Pidove with the phone at
 * `at`. Each look down shows where the phone is, but for a first look caught on `stale`; `swipes` is how many swipes
 * on the phone takes before it drops the rest, `blind` how many reads of the screen miss its HP, and `read` what the
 * walk made of the Roggenrola. Answers where the phone ends and where each look down was taken.
 */
async function lookingDown(
  at: number,
  {
    stale = null as Shown | null,
    swipes = Infinity,
    blind = 0,
    read = ROGGENROLA as Omit<Shown, 'moves'>,
    measured = true,
  } = {},
) {
  const shown = [ROOKIDEE, ROGGENROLA, PIDOVE];
  let place = at;
  let left = swipes;
  let misses = blind;
  let caught = stale;
  const looked: number[] = [];
  const here = () => shown[place] ?? expect.unreachable('swiped off the end');

  const took = await movesOf(
    { key: read.key, overlay: read.overlay },
    async () => {
      const screen = caught ?? here();
      caught = null;
      looked.push(place);

      return {
        moves: screen.moves,
        cutOff: false,
        overlay: screen.overlay,
        measures: measured ? measuresOf(screen.key) : '||',
      };
    },
    {
      read: async () => (misses-- > 0 ? { key: null, overlay: null } : { key: here().key, overlay: here().overlay }),
      next: async () => {
        if (left-- > 0) {
          place++;
        }
      },
    },
  );

  return { moves: took.look?.moves ?? null, note: took.note, place, looked };
}

test('moves read off the Pokémon read are taken as they are', async () => {
  expect(await lookingDown(1)).toStrictEqual({ moves: ROGGENROLA.moves, note: null, place: 1, looked: [1] });
});

/** Row #6 of the live scan: the swipe to the Roggenrola bounced back to the Rookidee after its detail screen read. */
test('a swipe that bounced back is sent again, and the moves read off the Pokémon it reaches', async () => {
  expect(await lookingDown(0)).toStrictEqual({
    moves: ROGGENROLA.moves,
    note: 'the moves screen showed another Pokémon, 11/6/10, so they were looked for again',
    place: 1,
    looked: [0, 1],
  });
});

test('a moves screen caught on another Pokémon while the phone is on this one is looked at again', async () => {
  expect(await lookingDown(1, { stale: ROOKIDEE })).toStrictEqual({
    moves: ROGGENROLA.moves,
    note: 'the moves screen showed another Pokémon, 11/6/10, so they were looked for again',
    place: 1,
    looked: [1, 1],
  });
});

test('another Pokémon’s moves are left blank where this one cannot be found again', async () => {
  expect(await lookingDown(0, { swipes: 0 })).toStrictEqual({
    moves: null,
    note: 'the moves screen showed another Pokémon, 11/6/10, and this Pokémon could not be found again',
    place: 0,
    looked: [0],
  });
});

/**
 * The swipe on is one the walk never logs, so it is taken only on a screen that is surely another Pokémon: taken from
 * this one, it would land on the Pidove, which the walk's next swipe would go past unread.
 */
test.for([
  ['a re-read that misses the HP', { blind: 1, stale: ROOKIDEE }],
  [
    'IVs misread on the detail screen, the moves screen showing the true ones but not its HP, weight or height',
    { read: { key: 'roggenrola|95|16.26|0.37|8/11/10', overlay: overlay(8, 11, 10) }, measured: false },
  ],
] as const)('%s leaves the moves blank without a swipe', async ([, options]) => {
  expect(await lookingDown(1, options)).toStrictEqual({
    moves: null,
    note: expect.stringContaining('could not be found again'),
    place: 1,
    looked: [1],
  });
});

const ELGYEM: { key: string | null; overlay: Overlay | null } = {
  key: 'elgyem|57|7.6|0.46|11/13/8',
  overlay: overlay(11, 13, 8),
};
const ELGYEM_MOVES: Moves = { fast: 'Astonish', charged: ['Dark Pulse'] };

/** A `movesOf` whose every look down shows `shown`, and whose every read of the screen misses it. */
const lookedAt = (reading: typeof ELGYEM, shown: Omit<MovesLook, 'moves' | 'cutOff'>) =>
  movesOf(reading, async () => ({ moves: ELGYEM_MOVES, cutOff: false, ...shown }), {
    read: async () => ({ key: null, overlay: null }),
    next: async () => {},
  });

/**
 * Issue #792: the overlay over an Elgyem's moves screen read `11/13/3` for the `11/13/8` its detail screen read, on
 * both looks, where the same screen read its `57 / 57 HP`, `7.6kg` and `0.46m`. The screen was this Pokémon's.
 */
test('a moves screen whose HP, weight and height are this Pokémon’s keeps its moves under a misread overlay', async () => {
  expect(await lookedAt(ELGYEM, { overlay: overlay(11, 13, 3), measures: '57|7.6|0.46' })).toStrictEqual({
    look: { moves: ELGYEM_MOVES, cutOff: false, overlay: overlay(11, 13, 3), measures: '57|7.6|0.46' },
    note: null,
  });
});

/** The same the other way about: the detail screen's overlay misread, the moves screen's right. */
test('IVs misread on the detail screen keep the moves of a screen whose HP, weight and height agree', async () => {
  const read = { key: 'roggenrola|95|16.26|0.37|8/11/10', overlay: overlay(8, 11, 10) };

  expect(await lookingDown(1, { read })).toStrictEqual({ moves: ROGGENROLA.moves, note: null, place: 1, looked: [1] });
});

/** One field agreeing is no identity, two Pokémon a swipe apart sharing an HP as readily as not. */
test('a moves screen reading only its HP is held to its overlay', async () => {
  expect(await lookedAt(ELGYEM, { overlay: overlay(11, 13, 3), measures: '57||' })).toStrictEqual({
    look: null,
    note: 'the moves screen showed another Pokémon, 11/13/3, and this Pokémon could not be found again',
  });
});

/** Nor does a field that disagrees leave the rest to vouch for it. */
test('a moves screen whose measurements disagree anywhere is held to its overlay', async () => {
  expect(await lookedAt(ELGYEM, { overlay: overlay(11, 13, 3), measures: '57|7.6|0.5' })).toMatchObject({ look: null });
});

/** A default scan runs neither pass, so what the stardust says is both fields and `identify`'s `shadowed`. */
test('the screen fills the shadow and purified fields no pass answered', () => {
  const unasked = { shadow: null, purified: null };

  expect(shaded(unasked, 'neither')).toStrictEqual({ shadow: false, purified: false, shadowed: false, notes: [] });
  expect(shaded(unasked, 'shadow')).toStrictEqual({ shadow: true, purified: false, shadowed: true, notes: [] });
  expect(shaded(unasked, 'purified')).toStrictEqual({ shadow: false, purified: true, shadowed: true, notes: [] });
  expect(shaded(unasked, null)).toStrictEqual({ shadow: null, purified: null, shadowed: null, notes: [] });
  expect(shaded({ shadow: null, purified: false }, null), 'one pass alone cannot rule both out').toStrictEqual({
    shadow: null,
    purified: false,
    shadowed: null,
    notes: [],
  });
});

/**
 * The game's own search outranks the screen, and where they part it is noted rather than settled — so neither is
 * trusted to rule out a form only a shadow can be.
 */
test('a pass that ran keeps its answer, and a disagreement with the screen is noted', () => {
  expect(shaded({ shadow: true, purified: false }, 'shadow')).toStrictEqual({
    shadow: true,
    purified: false,
    shadowed: true,
    notes: [],
  });
  expect(shaded({ shadow: false, purified: null }, 'shadow')).toStrictEqual({
    shadow: false,
    purified: false,
    shadowed: null,
    notes: ['the shadow search says no, where the stardust to power up says yes'],
  });
});
