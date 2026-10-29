/**
 * What the Search page has to be true of without a DOM around it.
 *
 * The page's own prose convention is the one thing here that is a claim about a string rather than about a render.
 * `help` in `terms.js` is prose this repository authors, and `terms.test.js` holds it to balanced ticks; a refusal from
 * `parse.js` quotes a token the reader typed, which no table can hold. So this is the other half of that invariant,
 * taken from the side the page does not get to author.
 *
 * A span pill's boxes are the other thing here, and the one with a reader at the far end of it: what a box shows and
 * what the tree takes from it are two answers rather than one, which `boxText` carries and the keystrokes below walk.
 */

import { expect, test } from 'vitest';

import { compose, emptyState, presetTree } from '../search/query.js';
import { leafText, spanned } from '../search/tree.js';
import { read } from '../search/parse.js';
import { GROUPS, PRESETS, RANGES, type Range } from '../search/terms.js';
import { unsearchable } from '../tools/inventory/storage.mts';
import { boxText, marked, pickable, rangeTitle, readBound, spans, unmarked } from './search.js';

/**
 * Both halves of what `spans` promises, for any message at all: an odd number of pieces, so the last one is prose and
 * every `<code>` the sentence opened is one it closed; and a join on the tick that gives the message back, so nothing
 * has been dropped or merged away on the way.
 */
const faithful = (message: string) => ({
  message,
  prose: spans(message).length % 2 === 1,
  joined: spans(message).join('`'),
});

const kept = (message: string) => ({ message, prose: true, joined: message });

/** One range from the table, so a test pins the floor and ceiling its literals were derived from. */
function range(id: string) {
  const found = RANGES.find((entry) => entry.id === id);

  if (!found) {
    throw new Error(`\`terms.js\` carries no ${id} range`);
  }

  return found;
}

/**
 * A number typed into one of a span pill's boxes, a digit at a time: what the box shows while the caret is in it, what
 * the tree took from the last keystroke, and what the box shows once the caret has left.
 *
 * Each digit lands at the end of whatever the box is showing, which is where a controlled box just rewritten puts the
 * caret. What this cannot hold is that the page hands the digits in only for the box the caret is in — the render is
 * what does that, and a browser is where it was checked.
 */
function typing(digits: string, which: Range) {
  const path = [0];
  let text = '';
  let bound: number | null = null;

  for (const digit of digits) {
    text = boxText({ path, edge: 'from', text }, path, 'from', bound) + digit;
    bound = readBound(text, which);
  }

  return {
    shown: boxText({ path, edge: 'from', text }, path, 'from', bound),
    bound,
    left: boxText(null, path, 'from', bound),
  };
}

test('a box takes the digits of a bound its own floor is wider than', () => {
  const year = range('year');
  const cp = range('cp');

  expect([year.min, year.max]).toEqual([2016, 2030]);
  expect([cp.min ?? 0, cp.max]).toEqual([0, 99999]);

  /*
   * Every prefix of a year is below the floor, which is what a box showing its own clamp could not survive: `2`
   * clamped up to 2016, the clamp landed in the box with the caret behind it, `20160` clamped down to the ceiling,
   * and every further digit stayed there. 2016 and 2030 were the only two years the boxes could reach.
   */
  expect(typing('2019', year)).toEqual({ shown: '2019', bound: 2019, left: '2019' });

  // The clamp is still what the tree takes, and what the box shows as soon as the caret leaves it.
  expect(typing('20', year)).toEqual({ shown: '20', bound: 2016, left: '2016' });

  // The ceiling never had the same trouble: no prefix of a number inside a range is above it, only the number itself.
  expect(typing('600', cp)).toEqual({ shown: '600', bound: 600, left: '600' });
  expect(typing('600000', cp)).toEqual({ shown: '600000', bound: 99999, left: '99999' });
});

test('the digits stay in the box they were typed into', () => {
  const typed = { path: [0], edge: 'from', text: '20' } as const;

  expect(boxText(typed, [0], 'from', 2019)).toBe('20');

  // The pill beside it and this pill's other end are both boxes the caret is not in, so both show the bound.
  expect(boxText(typed, [1], 'from', 2019)).toBe('2019');
  expect(boxText(typed, [0], 'to', 2019)).toBe('2019');

  // A bound the reader has not filled in is an empty box rather than the floor, which the placeholder says instead.
  expect(boxText(null, [0], 'from', null)).toBe('');
});

test('a range chip names its own phrase, whichever end the phrase sits on', () => {
  /*
   * The tooltip used to be spelled at the chip as `range.prefix || 'a dex span'`, which was true while the dex was the
   * only range with an empty prefix. The three IVs carry their phrase in `suffix` and so have an empty prefix too, and
   * every one of them advertised itself as a dex span — the shape being read off the wrong end of the range.
   *
   * Over the whole table rather than over the IVs by name, since the fault was a fallback catching a case nobody had
   * added yet. The dex is the one range with a phrase at neither end, so it is the only one the words are for.
   */
  const shapes = Object.fromEntries(RANGES.map((entry) => [entry.id, rangeTitle(entry).split(' — ')[0]]));

  expect({
    cp: shapes.cp,
    dex: shapes.dex,
    ivattack: shapes.ivattack,
    ivhp: shapes.ivhp,
    maxmove: shapes.maxmove,
  }).toEqual({
    cp: 'cp{N}',
    dex: 'a dex span',
    ivattack: '{N}attack',
    ivhp: '{N}hp',
    maxmove: 'maxmove{N}',
  });

  // And no other range borrows the dex's words, which is the whole of what went wrong.
  expect(RANGES.filter((entry) => shapes[entry.id] === 'a dex span').map((entry) => entry.id)).toEqual(['dex']);
});

test('each part of a comma-separated paste is unmarked, not just the head of it', () => {
  /*
   * The two halves of this were each right and wrong together. Unmarking ran on the whole string and `names` split
   * what came out, so only the first part was ever unmarked and every later one took a second mark: a pasted
   * `#keepers,#dupes` composed `#keepers` and `##dupes`, which is the silent miss the unmarking exists to stop, one
   * comma along. A table over `unmarked` alone passed straight over it, never having walked two parts — so this is
   * over `marked`, which is the composition, and the single-value rows are here to show the order changed nothing
   * about them.
   */
  expect(
    Object.fromEntries(
      (
        [
          ['#', '#keepers,#dupes'],
          ['@3', '@3crunch,@3bite'],
          ['@', '@3crunch,@3bite'],
          ['#', 'keepers,dupes'],
          ['@3', 'crunch,bite'],
          ['#', '#keepers'],
          ['@3', '@3crunch'],

          // The spaces around a name are the reader's, not the name's, and an empty part is no pill at all.
          ['#', ' #keepers , #dupes '],
          ['#', '#keepers,,'],
          ['#', ''],
        ] as const
      ).map(([mark, typed]) => [`${mark} + ${JSON.stringify(typed)}`, marked(mark, typed)]),
    ),
  ).toEqual({
    '# + "#keepers,#dupes"': ['#keepers', '#dupes'],
    '@3 + "@3crunch,@3bite"': ['@3crunch', '@3bite'],

    // *Any slot* drops each pasted slot, the dropdown owning it — the same rule as a single value, applied per part.
    '@ + "@3crunch,@3bite"': ['@crunch', '@bite'],

    '# + "keepers,dupes"': ['#keepers', '#dupes'],
    '@3 + "crunch,bite"': ['@3crunch', '@3bite'],
    '# + "#keepers"': ['#keepers'],
    '@3 + "@3crunch"': ['@3crunch'],
    '# + " #keepers , #dupes "': ['#keepers', '#dupes'],
    '# + "#keepers,,"': ['#keepers'],
    '# + ""': [],
  });
});

test('a mark the reader typed is dropped rather than doubled', () => {
  /*
   * The boxes add the mark, so a phrase pasted out of the reference carried one of its own: `#keepers` composed
   * `##keepers` and `@3crunch` composed `@@3crunch`, neither matching anything nor saying so anywhere.
   *
   * The slot is the asymmetry worth pinning. Digits are part of an `@` mark, so the dropdown settles the slot and a
   * pasted one is dropped with the rest of the mark — taking the paste instead would spell *First charged* beside a
   * pasted `@3` as `@23crunch`. A tag can be called `3things`, so a `#` leaves digits alone.
   */
  expect(
    Object.fromEntries(
      (
        [
          ['@3', '@3crunch'],
          ['@3', '@crunch'],
          ['@3', 'crunch'],
          ['@', '@3crunch'],
          ['@', 'crunch'],
          ['#', '#keepers'],
          ['#', 'keepers'],
          ['#', '#3things'],
          ['#', '3things'],
        ] as const
      ).map(([mark, typed]) => [`${mark} + ${typed}`, `${mark}${unmarked(mark, typed)}`]),
    ),
  ).toEqual({
    '@3 + @3crunch': '@3crunch',
    '@3 + @crunch': '@3crunch',
    '@3 + crunch': '@3crunch',

    // A slot pasted where the dropdown says *Any slot* is dropped too, the dropdown being the one that owns it.
    '@ + @3crunch': '@crunch',
    '@ + crunch': '@crunch',

    '# + #keepers': '#keepers',
    '# + keepers': '#keepers',

    // The digits of a tag's own name are the tag's, not the mark's.
    '# + #3things': '#3things',
    '# + 3things': '#3things',
  });
});

test('a sentence is split on its backtick pairs', () => {
  expect(spans('the game has no `gen1`')).toEqual(['the game has no ', 'gen1', '']);
  expect(spans('`a` and `b`')).toEqual(['', 'a', ' and ', 'b', '']);
  expect(spans('no ticks at all')).toEqual(['no ticks at all']);
});

test('an unpaired tick leaves the sentence prose rather than opening a span it cannot close', () => {
  for (const message of ['a`b', '`', '``', 'a `b` c', 'a `b` c`', '`a`b`c`', '']) {
    expect(faithful(message)).toEqual(kept(message));
  }
});

test('a refusal quoting a tick the reader typed keeps it, and keeps the rest of the sentence prose', () => {
  /*
   * The reachable case: a name holding a tick, the box splitting on commas and leaving everything else alone, so the
   * token this refusal quotes is the reader's own text. Seven ticks cannot be paired — before this, the stray one
   * vanished off the page and the tail of the refusal was handed to `<code>`.
   */
  const refusal = read('(shiny)`a').error ?? '';

  expect([...refusal].filter((character) => character === '`')).toHaveLength(7);
  expect(faithful(refusal)).toEqual(kept(refusal));

  // The tick is still there to be read, in the prose at the end rather than swallowed as a delimiter.
  expect(spans(refusal).at(-1)).toBe('a`');
});

/** What a pair composes, through the writer rather than a second model of it. */
const write = (which: Range, [from, to]: readonly [number | null, number | null]) =>
  leafText({ kind: 'range', id: which.id, from, to, negated: false });

/*
 * Every pair the two named ends can reach, against the *set* each denotes rather than against one spelling of it.
 *
 * Three picks wrote a span covering the whole range before: the floor as the lowest end with the other open, the
 * ceiling as the highest with the lowest open, and those two the other way round, which `leafText` swaps into order.
 * A filter looking for one of the three strings passed while the other two sat in the swept data — so what is held
 * here is the span's coverage, which is what "says nothing" means however it is written.
 *
 * Both orders of picking, because each end narrows the other and a reader may start at either. The pair with neither
 * end set is left out: it writes nothing at all, which is the pill asking nothing rather than a clause matching
 * everything.
 */

test('no pick takes a span that says something to one that says nothing', () => {
  const which = range('buddylevel');
  const floor = which.min ?? 0;
  const bounds = [null, ...Array.from({ length: which.max - floor + 1 }, (_, step) => floor + step)];

  /*
   * A span covers the range when the ends it denotes reach both limits, which is how `leafText` reads a pair: an open
   * bottom is the floor and an open top the ceiling. Both ends open is left out — that writes nothing at all, which is
   * the pill asking nothing rather than a clause matching everything.
   */
  const covers = (from: number | null, to: number | null) => {
    const ends = [from ?? floor, to ?? which.max];

    return (from !== null || to !== null) && Math.min(...ends) <= floor && Math.max(...ends) >= which.max;
  };

  /*
   * Every state against every pick either end offers from it, the blank included. A state is not only what the control
   * can build: `buddy0` and `buddy5` are documented spellings, so the Advanced pane and a link both hand over pairs
   * with both ends set, and the question is what the *next* pick does from there.
   */
  const opened = bounds.flatMap((from) =>
    bounds.flatMap((to) =>
      (['from', 'to'] as const).flatMap((edge) =>
        pickable(which, edge, edge === 'from' ? from : to, edge === 'from' ? to : from)
          .map(({ level }) => (edge === 'from' ? ([level, to] as const) : ([from, level] as const)))
          .filter((next) => covers(...next) && !covers(from, to))
          .map((next) => ({ from, to, picked: `${edge}=${next[edge === 'from' ? 0 : 1]}`, wrote: write(which, next) })),
      ),
    ),
  );

  /*
   * The refusals above are one direction only, and a `pickable` answering just the blank and the bound would satisfy
   * every one of them while making a span impossible to narrow. So the levels between the ends are asserted too, from
   * a mid-state rather than the blank pill the three probes beside it read: with the lowest on two the highest offers
   * two, three and four — two for the span whose ends meet, and not five, which is the ceiling it never offers.
   */
  const narrowing = pickable(which, 'to', null, 2)
    .map(({ level }) => level)
    .filter((level) => level !== null);

  expect({
    opened,
    narrowing,
    anyLevel: pickable(which, 'from', null, null).some(({ level }) => level === null),
    floorAtHighest: pickable(which, 'to', null, null).some(({ level }) => level === floor),
    ceilingAtLowest: pickable(which, 'from', null, null).some(({ level }) => level === which.max),
    states: bounds.length ** 2,
  }).toEqual({
    opened: [],
    narrowing: [2, 3, 4],
    anyLevel: true,
    floorAtHighest: true,
    ceilingAtLowest: true,
    states: 49,
  });
});

/*
 * Every state can be emptied, which is the other half of refusing a pick: a rule that stops a span saying nothing
 * could as easily leave a pill no sequence of picks can clear, and a reader cannot drag their way out of one end's
 * options. Walked as a breadth-first search over the real transitions rather than argued, because the count is the
 * part a sentence gets wrong — the docblock on `pickable` said two where the floor-and-ceiling state takes three.
 *
 * Three is the worst of the 49, and `(5, null)` and `(null, 0)` take one, which is what that docblock claims of them.
 */

test('every state the ends can hold empties, in no more than three picks', () => {
  const which = range('buddylevel');
  const bounds = [null, ...Array.from({ length: which.max - (which.min ?? 0) + 1 }, (_, step) => step)];
  const seen = (pair: readonly [number | null, number | null]) => `${pair[0]},${pair[1]}`;

  const picks = (start: readonly [number | null, number | null]) => {
    const depths = new Map([[seen(start), 0]]);
    const queue = [start];

    for (const state of queue) {
      const [from, to] = state;
      const depth = depths.get(seen(state)) ?? 0;

      if (from === null && to === null) {
        return depth;
      }

      for (const edge of ['from', 'to'] as const) {
        for (const { level } of pickable(which, edge, edge === 'from' ? from : to, edge === 'from' ? to : from)) {
          const next = (edge === 'from' ? [level, to] : [from, level]) as readonly [number | null, number | null];

          if (!depths.has(seen(next))) {
            depths.set(seen(next), depth + 1);
            queue.push(next);
          }
        }
      }
    }

    return Infinity;
  };

  const walked = bounds.flatMap((from) => bounds.map((to) => picks([from, to] as const)));

  expect({
    stuck: walked.filter((depth) => depth === Infinity).length,
    worst: Math.max(...walked),
    floorAndCeiling: picks([which.min ?? 0, which.max]),
    ceilingAtLowest: picks([which.max, null]),
    floorAtHighest: picks([null, which.min ?? 0]),
  }).toEqual({ stuck: 0, worst: 3, floorAndCeiling: 3, ceilingAtLowest: 1, floorAtHighest: 1 });
});

/*
 * And a bound the control would not offer is still offered while it is set, which is the difference between a level a
 * reader cannot pick and one the end cannot show. A tree arrives holding a `from` of nought from the Advanced pane or
 * a link — `buddy0` is the documented spelling of *never a buddy* — and a `select` whose value matches none of its
 * options selects nothing, rendering the end blank over a query matching the whole of storage.
 */

test('a bound already set is offered at the end showing it', () => {
  const which = range('buddylevel');
  const floor = which.min ?? 0;
  const has = (edge: 'from' | 'to', level: number, bound: number | null) =>
    pickable(which, edge, bound, null).some((option) => option.level === level);

  expect({
    floorSet: has('from', floor, floor),
    floorUnset: has('from', floor, null),
    floorElsewhere: has('from', floor, floor + 1),
    ceilingSet: has('to', which.max, which.max),
    ceilingUnset: has('to', which.max, null),
  }).toEqual({ floorSet: true, floorUnset: false, floorElsewhere: false, ceilingSet: true, ceilingUnset: false });
});

/**
 * The Search button types the string into the phone through `typeable`, so everything the catalogue offers has to pass
 * it: a chip that composed a string the phone cannot be sent would be one the button refuses. The type-effectiveness
 * chips are what need `<` and `>`, and the favourites are composed whole, being the longest strings a single press
 * makes.
 */
test('every chip, span and favourite the catalogue offers can be sent to the phone', () => {
  const offered = [
    ...GROUPS.flatMap((category) => category.terms.map(({ term }) => term)),
    ...RANGES.map((range) => spanned(range, '1-2')),
    ...PRESETS.map((preset) => compose({ ...emptyState(), tree: presetTree(preset) }).query),
  ];

  for (const term of offered) {
    expect(unsearchable(term), term).toBeNull();
  }
});
