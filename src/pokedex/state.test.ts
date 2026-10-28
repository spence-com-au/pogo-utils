import { expect, test } from 'vitest';

import { ENTRIES, GENERATION_NUMBERS, type Entry } from './entries.js';
import {
  availabilityOf,
  emptyState,
  fromFragment,
  matches,
  MODES,
  registered,
  matchesQuery,
  toFragment,
  TOGGLES,
  type State,
} from './state.js';

const state = (over: Partial<State>): State => ({ ...emptyState(), ...over });
const admitted = (over: Partial<State>) => ENTRIES.filter((entry) => matches(entry, state(over)));

/** The entry a case is about, which has to be there for the case to be about anything. */
const entryAt = (dex: number): Entry => {
  const entry = ENTRIES.find((e) => e.dex === dex);

  if (!entry) {
    throw new Error(`the dex has no #${dex}`);
  }

  return entry;
};

test('an empty state writes no fragment and admits the whole dex', () => {
  expect(toFragment(emptyState())).toBe('');
  expect(admitted({})).toHaveLength(ENTRIES.length);
});

/**
 * The round trip is the contract, since the fragment is the only place the state lives: a link a reader shares has to
 * reopen the view they were looking at. Every field is set, because a field the fragment drops would round-trip fine on
 * a state that happened to leave it at its default.
 */
test('a state survives being written to a fragment and read back', () => {
  const original = state({
    mode: 'xxs',
    q: 'pika',
    generation: 9,
    availability: 'out',
    flags: new Set(['shiny', 'legendary', 'hunt-xxs']),
    open: entryAt(150).dex,
  });

  expect(toFragment(original)).toBe('m=xxs&q=pika&g=9&a=out&f=shiny.legendary.hunt-xxs&n=150');
  expect(fromFragment(toFragment(original))).toEqual(original);
});

/**
 * A query is a value, not a fragment fragment: `&` and `=` in it have to come back as themselves rather than as another
 * parameter. `URLSearchParams` is what makes that so, and a join written by hand is what would not.
 */
test('a query carrying the fragment’s own punctuation round-trips', () => {
  const original = state({ q: 'mr. mime&a=in' });

  expect(toFragment(original)).toBe('q=mr.+mime%26a%3Din');
  expect(fromFragment(toFragment(original))).toEqual(original);
});

/**
 * A fragment is a reader's URL, so every field is checked rather than taken: an unknown generation, availability, flag
 * id or dex number lands on the default instead of filtering by something no control can reach to undo. The flags case
 * keeps the two real ids beside the two bad ones, so it says the bad ones were dropped rather than that the whole field
 * was.
 */
test('a hand-edited fragment can only produce a state the controls could have', () => {
  const read = fromFragment('m=lucky&q=pika&g=99&a=sideways&f=shiny.nonsense.hunt-xxs.legendary-ish&n=99999');

  expect(read).toEqual(
    state({ q: 'pika', generation: null, availability: '', flags: new Set(['shiny', 'hunt-xxs']), open: null }),
  );
});

/** An empty `f` is no flags rather than one flag named the empty string, which no toggle answers to. */
test('an empty flag list reads as no flags', () => {
  expect(fromFragment('f=').flags).toEqual(new Set());
  expect(TOGGLES.has('')).toBe(false);
});

/** A query is trimmed on the way out, so trailing space a reader typed is not something their link carries. */
test('toFragment trims the query and omits it when that leaves nothing', () => {
  expect(toFragment(state({ q: '  pika  ' }))).toBe('q=pika');
  expect(toFragment(state({ q: '   ' }))).toBe('');
});

/**
 * Both the fragment and the `<select>` are read through `availabilityOf`, so neither a reader's URL nor markup the
 * script does not own can set it to a fourth thing.
 */
test.for([
  { given: 'in', reads: 'in' },
  { given: 'out', reads: 'out' },
  { given: '', reads: '' },
  { given: null, reads: '' },
  { given: 'IN', reads: '' },
  { given: 'released', reads: '' },
])('availabilityOf($given) is $reads', ({ given, reads }) => {
  expect(availabilityOf(given)).toBe(reads);
});

/**
 * A number is a dex number and only a dex number, because a reader typing one has a species in mind. `25`, `#25` and
 * `#0025` are the same species; `2` is Ivysaur and not every number with a 2 in it, which is what tells this apart from
 * the name search below.
 */
test('a number means that dex number, however it was typed', () => {
  const pikachu = entryAt(25);
  expect(pikachu.name).toBe('Pikachu');

  for (const typed of ['25', '#25', '#0025', ' 25 ']) {
    expect(admitted({ q: typed })).toEqual([pikachu]);
  }

  expect(admitted({ q: '2' })).toEqual([entryAt(2)]);
  expect(matchesQuery(pikachu, '2')).toBe(false);
});

/** A number past the end of the dex names nothing, rather than falling back to matching it as text. */
test('a dex number nothing carries admits nothing', () => {
  const past = Math.max(...ENTRIES.map((entry) => entry.dex)) + 1;
  expect(admitted({ q: String(past) })).toEqual([]);
});

/**
 * Anything that is not a number is part of a name, folded the way the search page folds it. Flabébé is the case the
 * fold is for — a reader with an ASCII keyboard types `flabebe` — and it is checked against the accented spelling the
 * dex actually carries so that a dex that had dropped the accent would fail here rather than pass for nothing.
 */
test('a name is matched folded, so an ASCII spelling finds an accented one', () => {
  const flabebe = entryAt(669);

  expect(flabebe.name).toBe('Flabébé');
  expect(admitted({ q: 'flabebe' })).toEqual([flabebe]);
  expect(admitted({ q: 'FLABÉBÉ' })).toEqual([flabebe]);
});

/**
 * A fragment of a name matches anywhere in it rather than only at the front, which is what the page's own help text
 * says. Charmander begins with `char` and Pecharunt carries it in the middle, so the pair is what tells the two
 * readings apart — the same distinction `search/optimise.ts` counts.
 */
test('a name fragment matches anywhere in the name', () => {
  const names = admitted({ q: 'char' }).map((entry) => entry.name);

  expect(names).toContain('Charmander');
  expect(names).toContain('Pecharunt');
});

/**
 * A query comes out of the fragment of a link someone shared, and is tested against every entry on every render, so a
 * long one has to cost its length rather than its square. A long run of zeros ending in something other than a digit is
 * the shape that backtracks when the leading zeros and the digits after them can trade characters, and leading zeros
 * before a real number still have to read as that number. The budget is generous for linear work and orders of
 * magnitude short of what the quadratic version took over the whole dex.
 */
test('a long run of zeros costs its length, not its square', () => {
  const zeros = '0'.repeat(5_000);
  const started = performance.now();

  expect(admitted({ q: `${zeros}x` })).toEqual([]);
  expect(admitted({ q: `#${zeros}25` })).toEqual([entryAt(25)]);
  expect(performance.now() - started).toBeLessThan(1_000);
});

test('an empty query admits everything', () => {
  expect(matchesQuery(entryAt(25), '   ')).toBe(true);
});

/**
 * The generation control narrows to one generation's span, and the spans partition the dex — so the admitted counts
 * across every generation add up to the whole of it with nothing counted twice. Derived rather than transcribed, since
 * a span is `generations.ts`'s to say.
 */
test('the generations partition the dex between them', () => {
  const counts = GENERATION_NUMBERS.map((generation) => admitted({ generation }).length);
  const dated = ENTRIES.filter((entry) => entry.generation !== null);

  expect(counts.reduce((a, b) => a + b, 0)).toBe(dated.length);
  expect(admitted({ generation: 1 })).toHaveLength(151);
});

/** Released and unreleased are the two halves of the dex, so the one control covers it with neither overlap nor gap. */
test('the availability control splits the dex in two', () => {
  const inGame = admitted({ availability: 'in' });
  const outOfGame = admitted({ availability: 'out' });

  expect(inGame.length + outOfGame.length).toBe(ENTRIES.length);
  expect(inGame.every((entry) => entry.released)).toBe(true);
  expect(outOfGame.some((entry) => entry.released)).toBe(false);
});

/**
 * Two flags narrow to what both are true of rather than to either. The figures are a relationship rather than a count,
 * because membership of these lists is a data change that lands on `master` on its own — what has to hold is that the
 * intersection is inside both and smaller than both, which is the whole of the claim and is what a flag ORed instead of
 * ANDed would break.
 */
test('two flags narrow to what both hold of', () => {
  const shiny = admitted({ flags: new Set(['shiny']) });
  const legendary = admitted({ flags: new Set(['legendary']) });
  const both = admitted({ flags: new Set(['shiny', 'legendary']) });

  expect(both.length).toBeGreaterThan(0);
  expect(both.length).toBeLessThan(Math.min(shiny.length, legendary.length));
  expect(both.every((entry) => entry.shiny && entry.categories.includes('legendary'))).toBe(true);
});

/** A hunt chip asks the very Set the PGSharp backup is fed, so the page and the backup cannot disagree about a list. */
test('a hunt flag admits exactly the entries that hunt wants', () => {
  const wanted = admitted({ flags: new Set(['hunt-xxs']) });

  expect(wanted.length).toBeGreaterThan(0);
  expect(wanted.every((entry) => entry.hunts.some((hunt) => hunt.id === 'xxs'))).toBe(true);
  expect(ENTRIES.filter((entry) => entry.hunts.some((hunt) => hunt.id === 'xxs'))).toEqual(wanted);
});

/**
 * The controls compose, so a state that sets several admits what all of them hold of. Each is checked against the
 * entries rather than against a count, since what the combination means is the conjunction and not a figure.
 */
test('the controls compose', () => {
  const admits = admitted({ generation: 1, availability: 'in', flags: new Set(['legendary']) });

  expect(admits.length).toBeGreaterThan(0);
  expect(admits.every((e) => e.generation === 1 && e.released && e.categories.includes('legendary'))).toBe(true);
  expect(admits.map((entry) => entry.dex)).not.toContain(entryAt(25).dex);
});

/**
 * The three toggles that are not categories, each asking something of the entry that a category does not: whether any
 * released part of it has a shiny, whether any spawns in the wild, and whether it has forms at all. Checked against the
 * entries rather than a count, for the reason the flag combination above is.
 */
test.for([
  { flag: 'shiny', holds: (entry: Entry) => entry.shiny },
  { flag: 'wild', holds: (entry: Entry) => entry.spawns },
  { flag: 'forms', holds: (entry: Entry) => entry.variants.length > 0 },
])('the $flag toggle admits exactly the entries it holds of', ({ flag, holds }) => {
  const admits = admitted({ flags: new Set([flag]) });

  // Both directions, since a toggle admitting nothing and one admitting everything both satisfy "every entry holds".
  expect(admits.length).toBeGreaterThan(0);
  expect(admits.length).toBeLessThan(ENTRIES.length);
  expect(admits).toEqual(ENTRIES.filter(holds));
});

/**
 * Every mode but the plain one reads a hunt list, and a mode's tile is filled only for a species the game could have
 * registered: one released, and in the shiny dex one whose shiny is. A hunt list wanting a species is what leaves it
 * empty, so each mode's filled tiles are exactly the released ones its list no longer wants.
 */
test('a mode fills the tiles of what its hunt list no longer wants', () => {
  for (const { id } of MODES) {
    for (const entry of ENTRIES) {
      const wanted = entry.hunts.some((h) => h.id === id);
      const possible = entry.released && (id !== 'shiny' || entry.shiny);

      expect(registered(entry, id), `#${entry.dex} in ${id}`).toBe(possible && !wanted);
    }
  }

  // Hoopa is in the game with no shiny, so the shiny dex leaves it empty however the lists read.
  expect(entryAt(720).released).toBe(true);
  expect(registered(entryAt(720), 'shiny')).toBe(false);
  expect(registered(entryAt(720), 'pokemon')).toBe(true);

  // A species the XXL list still wants is empty in the XXL dex and filled in the plain one.
  const wantedXxl = ENTRIES.find((entry) => entry.released && entry.hunts.some(({ id }) => id === 'xxl'));

  expect(wantedXxl && registered(wantedXxl, 'xxl')).toBe(false);
  expect(wantedXxl && registered(wantedXxl, 'pokemon')).toBe(true);

  // Not yet in the game is empty in every mode, however few lists name it.
  const unreleased = ENTRIES.find((entry) => !entry.released);

  expect(unreleased && MODES.some(({ id }) => registered(unreleased, id))).toBe(false);
});
