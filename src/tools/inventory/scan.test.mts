/**
 * The parts of `pnpm inventory scan` that need no phone: the arguments it takes, the CSV it writes and the keys that
 * decide whether a flag search and the full pass saw the same Pokémon. A wrong key is a flag lost from a row or set on
 * the wrong one, and nothing on a phone screen says which.
 */

import { type Detail } from './detail.mts';
import { type Overlay } from './overlay.mts';
import { count, csv, FLAGS, keyOf, looseKeyOf, Marks, parseFlags, walk } from './scan.mts';
import { CLEAR_KEYS } from './storage.mts';
import { expect, test, vi } from 'vitest';

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
    size: null,
    tags: [],
    evolveCandy: null,
    ...fields,
  };
}

const overlay = (attack: number, defense: number, stamina: number): Overlay => ({
  levels: [20],
  iv: { attack, defense, stamina },
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
 * of each position in `missed` comes back unread, as a screen OCR misses once does.
 */
async function walked(keys: readonly string[], max = Infinity, from = 0, missed: readonly number[] = []) {
  let at = from;
  const unread = new Set(missed);
  const visited: [string | null, number][] = [];

  await walk(
    {
      read: async () => ({ key: unread.delete(at) ? null : (keys[at] ?? null) }),
      next: async () => void (at = Math.min(at + 1, keys.length - 1)),
      back: async () => void (at = Math.max(at - 1, 0)),
    },
    async ({ key }) => void visited.push([key, at]),
    max,
    from,
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
  error.mockRestore();
});

test('a miss just before a run that ends storage does not visit the last Pokémon twice', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  expect(await walked(['x', 'a', 'a'], Infinity, 0, [1])).toEqual([
    ['x', 0],
    [null, 1],
    ['a', 2],
  ]);
  expect(error).not.toHaveBeenCalled();
  error.mockRestore();
});

test('a miss on the last Pokémon in storage ends the walk there', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  expect(await walked(['o', 'p', 'q'], Infinity, 0, [2])).toEqual([
    ['o', 0],
    ['p', 1],
    [null, 2],
  ]);
  expect(error).not.toHaveBeenCalled();
  error.mockRestore();
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
  error.mockRestore();
});

test.for([
  ['a twin', ['x', 'a', 'a', 'a', 'b']],
  ['another Pokémon', ['x', 'y', 'a', 'a', 'b']],
] as const)('a miss just before a run of twins still visits every Pokémon once, given %s', async ([, keys]) => {
  expect((await walked(keys, Infinity, 0, [1])).map(([, at]) => at)).toEqual(keys.map((_, i) => i));
});
