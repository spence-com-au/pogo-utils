/**
 * The parts of `pnpm inventory scan` that need no phone: the arguments it takes, the CSV it writes and the keys that
 * decide whether a flag search and the full pass saw the same Pokémon. A wrong key is a flag lost from a row or set on
 * the wrong one, and nothing on a phone screen says which.
 */

import { type Detail } from './detail.mts';
import { type Moves } from './moves.mts';
import { findOverlay, readOverlay, widen, type Overlay } from './overlay.mts';
import { decodePng, screenIn } from './png.mts';
import {
  agree,
  count,
  csv,
  distance,
  DROP_RETRIES,
  FLAGS,
  keyOf,
  land,
  landmarkOf,
  landmarksBefore,
  looseKeyOf,
  Marks,
  MOVE_STEPS,
  movesOf,
  otherPokemon,
  OverlayBoxes,
  parseCsv,
  parseFlags,
  reachMoves,
  shaded,
  shortfall,
  SWEEPS,
  walk,
  type Landmark,
} from './scan.mts';
import { CLEAR_KEYS } from './storage.mts';
import { useTestEngine } from './test-engine.mts';
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

test('a screen with no key is neither marked nor matched', () => {
  const marks = new Marks();

  marks.add(detail({ hp: null }), null);

  expect(marks.size).toBe(0);
  expect(marks.take(detail({ hp: null }), null)).toBe(false);
});

test('a Pokémon the search did not find is not marked', () => {
  const marks = new Marks();

  marks.add(detail(), overlay(15, 15, 15));

  expect(marks.take(detail(), overlay(0, 15, 15))).toBe(false);
  expect(marks.take(detail(), overlay(15, 15, 15)), 'the miss used up the mark').toBe(true);
});

test.for([
  [null, ''],
  [12.5, '12.5'],
  ['Pikachu', 'Pikachu'],
  ['Trade, maybe', '"Trade, maybe"'],
  ['say "hi"', '"say ""hi"""'],
  ['two\nlines', '"two\nlines"'],
] as const)('%j is written to the CSV as %j', ([value, written]) => {
  expect(csv(value)).toBe(written);
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
 * That the clear is longer than every search the scan sends. A flag is typed into the box as it stands — `search(flag)`
 * — so `FLAGS` is the list of terms the scan sends, and they are short enough that this passes today with room to
 * spare. The point is that it fails the moment a longer one is added, where before nothing related the two numbers.
 */
test('the clear is longer than every search the scan sends', () => {
  for (const term of FLAGS) {
    expect(term.length, `the scan sends ${JSON.stringify(term)}, which the clear cannot remove`).toBeLessThanOrEqual(
      CLEAR_KEYS,
    );
  }
});

/**
 * Walks a storage of `keys` the way a phone would: a swipe past either end goes nowhere. Answers the position each
 * Pokémon was visited at, so a walk that visits the right keys from the wrong place is caught as well. The first read
 * of each position in `missed` comes back unread, as a screen OCR misses once does. Each swipe forward whose number,
 * counting from 0, is in `dropped` goes nowhere, as #581's phone dropped one in ten, and `total` is the count the
 * game shows for the walk. The second read of each position in `again` reads as that entry says, as a screen whose
 * overlay or name reads another way on a second look.
 */
async function walked(
  keys: readonly string[],
  max = Infinity,
  from = 0,
  missed: readonly number[] = [],
  dropped: readonly number[] = [],
  total: number | null = null,
  again: Readonly<Record<number, string>> = {},
) {
  let at = from;
  let forward = 0;
  const unread = new Set(missed);
  const reads = new Map<number, number>();
  const drops = new Set(dropped);
  const visited: [string | null, number][] = [];

  await walk(
    {
      read: async () => {
        reads.set(at, (reads.get(at) ?? 0) + 1);

        if (unread.delete(at)) {
          return { key: null };
        }

        return { key: (reads.get(at) === 2 ? again[at] : undefined) ?? keys[at] ?? null };
      },
      next: async () => void (at = drops.has(forward++) ? at : Math.min(at + 1, keys.length - 1)),
      back: async () => void (at = Math.max(at - 1, 0)),
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

test('a miss on the last Pokémon in storage ends the walk there', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  expect(await walked(['o', 'p', 'q'], Infinity, 0, [2])).toEqual([
    ['o', 0],
    ['p', 1],
    [null, 2],
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

const iv = (name: string) => `${name}|50|1.5|0.4|15/15/15`;
const blind = (name: string) => `${name}|50|1.5|0.4|`;

test('a look back that misses the overlay a first read saw goes on, after a skip', async () => {
  const keys = [iv('z'), iv('a'), iv('a'), iv('c')];

  expect(await walked(keys, Infinity, 1, [], [], null, { 1: blind('a') })).toEqual([
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

test('a walk skipped into storage counts its retries against the whole of storage', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

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
  const worlds = new Map([
    [Infinity, { at: 5, known: new Map([[4, blind('a')]]) }],
    [3, { at: 3, known: new Map([[2, iv('a')]]) }],
    [2, { at: 2, known: new Map([[1, 'a|50|1.5|0.4|1/2/3']]) }],
  ]);

  expect(distance(worlds, 5)).toBe(1);
});

test('a CSV reads back the rows `csv` wrote, quotes, commas, line breaks and all', () => {
  const rows = [
    ['index', 'notes'],
    ['1', 'say "hi", twice'],
    ['2', 'two\nlines'],
    ['3', ''],
  ];

  expect(parseCsv(rows.map((row) => `${row.map(csv).join(',')}\n`).join(''))).toStrictEqual(rows);
});

/** The columns `landmarksBefore` reads, in a CSV of `rows` given as index, HP, weight, height and IVs. */
function written(rows: readonly (readonly [number, string, string, string, string])[]) {
  const header = 'index,species,hp,weight_kg,height_m,attack_iv,defense_iv,stamina_iv,notes\n';

  return (
    header +
    rows
      .map(([index, hp, weight, height, iv]) => {
        const [a = '', d = '', s = ''] = iv.split('/');
        return `${index},Pikachu,${hp},${weight},${height},${a},${d},${s},"a, note"\n`;
      })
      .join('')
  );
}

test('a skip is checked against the last rows written up to it, oldest first', () => {
  const text = written([
    [1, '40', '6', '0.4', '1/2/3'],
    [2, '41', '6.1', '0.41', ''],
    [3, '42', '6.2', '0.42', '4/5/6'],
    [4, '43', '6.3', '0.43', '7/8/9'],
  ]);

  expect(landmarksBefore(text, 3)).toStrictEqual([
    { hp: 40, weight: 6, height: 0.4, iv: '1/2/3' },
    { hp: 41, weight: 6.1, height: 0.41, iv: null },
    { hp: 42, weight: 6.2, height: 0.42, iv: '4/5/6' },
  ]);
});

test('the rows checked stop at one with no HP, and take the last written under a number', () => {
  const text = written([
    [1, '40', '6', '0.4', ''],
    [2, '', '', '', ''],
    [3, '42', '6.2', '0.42', ''],
    [4, '43', '6.3', '0.43', ''],
    [3, '99', '9', '0.9', ''],
    [4, '44', '6.4', '0.44', ''],
  ]);

  expect(landmarksBefore(text, 4).map(({ hp }) => hp)).toStrictEqual([99, 44]);
  expect(landmarksBefore(text, 3).map(({ hp }) => hp)).toStrictEqual([99]);
});

test.for([
  ['a row the CSV does not have', 7, 'holds no row 7'],
  ['a row with no HP', 2, 'row 2 has no HP'],
] as const)('a skip to %s is refused', ([, skip, why]) => {
  const text = written([
    [1, '40', '6', '0.4', ''],
    [2, '', '', '', ''],
  ]);

  expect(() => landmarksBefore(text, skip)).toThrow(why);
});

test('a CSV without the columns a landing is checked by is refused', () => {
  expect(() => landmarksBefore('index,hp\n1,40\n', 1)).toThrow('not a CSV this scan wrote');
});

/** A Pikachu of `hp`, read whole. */
const at = (hp: number): Landmark => ({ hp, weight: 6.1, height: 0.41, iv: '1/2/3' });

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

  const behind = hps.slice(Math.max(from - 3, 0), from).map(at);
  const off = await land(
    {
      read: async () => ({ key: String(hps[position]) }),
      next,
      back: async () => void (position = Math.max(position - 1, 0)),
    },
    behind,
    ({ key }) => at(Number(key)),
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
  { stale = null as Shown | null, swipes = Infinity, blind = 0, read = ROGGENROLA as Omit<Shown, 'moves'> } = {},
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

      return { moves: screen.moves, cutOff: false, overlay: screen.overlay };
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
    'IVs misread on the detail screen, the moves screen showing the true ones',
    { read: { key: 'roggenrola|95|16.26|0.37|8/11/10', overlay: overlay(8, 11, 10) } },
  ],
] as const)('%s leaves the moves blank without a swipe', async ([, options]) => {
  expect(await lookingDown(1, options)).toStrictEqual({
    moves: null,
    note: expect.stringContaining('could not be found again'),
    place: 1,
    looked: [1],
  });
});

/** A default scan runs neither pass, so what the stardust says is both columns and `identify`'s `shadowed`. */
test('the screen fills the shadow and purified columns no pass answered', () => {
  const unasked = { shadow: '', purified: '' } as const;

  expect(shaded(unasked, 'neither')).toStrictEqual({ shadow: 'no', purified: 'no', shadowed: false, notes: [] });
  expect(shaded(unasked, 'shadow')).toStrictEqual({ shadow: 'yes', purified: 'no', shadowed: true, notes: [] });
  expect(shaded(unasked, 'purified')).toStrictEqual({ shadow: 'no', purified: 'yes', shadowed: true, notes: [] });
  expect(shaded(unasked, null)).toStrictEqual({ shadow: '', purified: '', shadowed: null, notes: [] });
  expect(shaded({ shadow: '', purified: 'no' }, null), 'one pass alone cannot rule both out').toStrictEqual({
    shadow: '',
    purified: 'no',
    shadowed: null,
    notes: [],
  });
});

/**
 * The game's own search outranks the screen, and where they part it is noted rather than settled — so neither is
 * trusted to rule out a form only a shadow can be.
 */
test('a pass that ran keeps its answer, and a disagreement with the screen is noted', () => {
  expect(shaded({ shadow: 'yes', purified: 'no' }, 'shadow')).toStrictEqual({
    shadow: 'yes',
    purified: 'no',
    shadowed: true,
    notes: [],
  });
  expect(shaded({ shadow: 'no', purified: '' }, 'shadow')).toStrictEqual({
    shadow: 'no',
    purified: 'no',
    shadowed: null,
    notes: ['the shadow search says no, where the stardust to power up says yes'],
  });
});
