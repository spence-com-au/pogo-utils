/**
 * Whether an IV percentage pill's string never misses and takes nothing it need not.
 *
 * Each string is composed the way the page composes it and then read the way the game reads it, over every one of the
 * 4,096 IV spreads, so what is checked is the string itself rather than the boxes behind it. The bands the game reads
 * are written out here from the community phrase list rather than imported, so a band mistyped in `ivs.js` is a band
 * this disagrees with.
 */

import { expect, test } from 'vitest';

import { all, any, yes } from '../testing/search.js';
import { COMPARISONS, ivNote, type Comparison, type IvLeaf } from './ivs.js';
import { optimise } from './optimise.js';
import { compose, emptyState } from './query.js';
import { type Node } from './tree.js';

/** "Based on IV value: 0=0, 1=1-5, 2=6-10, 3=11-14, 4=15", and "Based on sum of IVs: 0=0-22, 1=23-29, 2=30-36, 3=37-44, 4=45". */
const BARS = [
  [0, 0],
  [1, 5],
  [6, 10],
  [11, 14],
  [15, 15],
];

const STARS = [
  [0, 22],
  [23, 29],
  [30, 36],
  [37, 44],
  [45, 45],
];

interface Spread {
  attack: number;
  defense: number;
  hp: number;
}

const SPREADS: readonly Spread[] = Array.from({ length: 16 ** 3 }, (_, at) => ({
  attack: Math.floor(at / 256),
  defense: Math.floor(at / 16) % 16,
  hp: at % 16,
}));

const sum = ({ attack, defense, hp }: Spread) => attack + defense + hp;

/** The percentage PGSharp prints, as `confirmed` in `tools/inventory/overlay.mts` computes it. */
const shown = (spread: Spread) => Math.floor((sum(spread) / 45) * 100);

const within = (bands: readonly number[][], band: number, value: number) => {
  const [low = 0, high = -1] = bands[band] ?? [];

  return low <= value && value <= high;
};

/** One alternative of a clause, read as the game reads it. Anything this does not know is a failure. */
function alternative(text: string): (spread: Spread) => boolean {
  const star = /^(!?)([0-4])\*$/.exec(text);

  if (star) {
    const [, not, band] = star;

    return (spread) => within(STARS, Number(band), sum(spread)) !== (not === '!');
  }

  const span = /^(\d)?(-)?(\d)?(attack|defense|hp)$/.exec(text);

  if (span) {
    const [, from, dash, to, stat = 'hp'] = span;
    const low = Number(from ?? 0);
    const high = Number(to ?? (dash ? 4 : from));

    return (spread) =>
      [...BARS.keys()].some((band) => band >= low && band <= high && within(BARS, band, spread[stat as keyof Spread]));
  }

  throw new Error(`\`${text}\` is no IV term`);
}

/** A whole search string as the game reads it: every clause, and any one alternative of each. */
function reading(query: string): (spread: Spread) => boolean {
  const clauses = query === '' ? [] : query.split('&').map((clause) => clause.split(',').map(alternative));

  return (spread) => clauses.every((clause) => clause.some((one) => one(spread)));
}

/** The bars and stars a spread shows the game, which is everything a string can tell it by. */
const seen = (spread: Spread) =>
  [
    STARS.findIndex((_, band) => within(STARS, band, sum(spread))),
    ...(['attack', 'defense', 'hp'] as const).map((stat) =>
      BARS.findIndex((_, band) => within(BARS, band, spread[stat])),
    ),
  ].join();

const pill = (compare: Comparison, percent: number | null, negated = false): IvLeaf => ({
  kind: 'iv',
  compare,
  percent,
  negated,
});

const queryOf = (tree: Node, shorten = false) => {
  const state = { ...emptyState(), tree: all(tree) };

  return compose(shorten ? optimise({ ...state, optimise: true }).state : state).query;
};

test('every comparison never misses, and takes no Pokémon the game could have told apart from what it asked for', () => {
  const sights = SPREADS.map(seen);

  // Checked once for each set of spreads wanted, which many comparisons share: `≥ 90%` wants what `> 88%` does.
  const checked = new Set<string>();

  for (const { id, holds } of COMPARISONS) {
    for (let percent = 0; percent <= 100; percent += 1) {
      for (const negated of [false, true]) {
        const leaf = pill(id, percent, negated);
        const wanted = (spread: Spread) => holds(shown(spread), percent) !== negated;
        const query = queryOf(leaf);
        const case_ = `${negated ? '!' : ''}${id} ${percent}: ${query}`;
        const key = SPREADS.map((spread) => (wanted(spread) ? 1 : 0)).join('');

        if (checked.has(key)) {
          continue;
        }

        checked.add(key);

        const reachable = new Set(sights.filter((_, at) => wanted(SPREADS[at] ?? { attack: 0, defense: 0, hp: 0 })));

        if (query === '') {
          // Left out of the string, which the note says, and only where the comparison holds for nothing or for every
          // cell the game can see.
          expect(ivNote(leaf), case_).toMatch(/leaves (this|it) out/);
          expect(reachable.size === 0 || sights.every((sight) => reachable.has(sight)), case_).toBe(true);

          continue;
        }

        const matches = reading(query);
        const shortened = reading(queryOf(leaf, true));

        expect(
          SPREADS.filter((spread, at) => matches(spread) !== reachable.has(sights[at] ?? '')),
          case_,
        ).toEqual([]);

        // The Shorten toggle rewrites the string and not what it matches.
        expect(
          SPREADS.filter((spread) => shortened(spread) !== matches(spread)),
          case_,
        ).toEqual([]);

        const extra = SPREADS.filter((spread) => matches(spread) && !wanted(spread)).map(shown);
        const [low = 0, high = 0] = [Math.min(...extra), Math.max(...extra)];

        expect(ivNote(leaf), case_).toBe(
          extra.length === 0
            ? null
            : `The game reads IVs only in bands, so this also finds some at ${low === high ? low : `${low}–${high}`}%.`,
        );
      }
    }
  }

  // Enough distinct sets that the sweep is a sweep, so a loop that stopped looping would be caught.
  expect(checked.size).toBeGreaterThan(100);
});

test('a line on a band edge is written exactly, and one inside a band says what else it takes', () => {
  // 82% is where 3★ starts, so the stars say it outright.
  expect(queryOf(pill('ge', 82))).toBe('3*,4*');
  expect(ivNote(pill('ge', 82))).toBeNull();

  // 90% is inside 3★, and 14/14/12 (88%) shows the game every band 14/14/13 (91%) does.
  expect(queryOf(pill('ge', 90))).toBe('3*,4*&3-attack&3-defense&3-hp');
  expect(ivNote(pill('ge', 90))).toBe('The game reads IVs only in bands, so this also finds some at 82–88%.');

  expect(queryOf(pill('eq', 0))).toBe('0attack&0defense&0hp');
  expect(queryOf(pill('lt', 100))).toBe('-3attack,-3defense,-3hp');
});

test('a comparison no IVs or every IV meet is left out, and the note says why', () => {
  expect(queryOf(pill('eq', 90))).toBe('');
  expect(ivNote(pill('eq', 90))).toBe('No Pokémon is at 90%, so the string leaves this out.');

  expect(queryOf(pill('ge', 0))).toBe('');
  expect(ivNote(pill('ge', 0))).toBe('Every Pokémon is at or above 0%, so the string leaves this out.');

  // Ruled out, the comparison is said turned round rather than with a "not" in front of it.
  expect(ivNote(pill('gt', 100, true))).toBe('Every Pokémon is at or below 100%, so the string leaves this out.');
});

test('a pill with no percentage yet asks nothing', () => {
  expect(queryOf(pill('ge', null))).toBe('');
  expect(ivNote(pill('ge', null))).toBeNull();
});

test('a pill beside another on its card is one alternative, each of its clauses taking the other too', () => {
  expect(queryOf(any(pill('ge', 90), yes('shiny')))).toBe('3*,4*,shiny&3-attack,shiny&3-defense,shiny&3-hp,shiny');
});

test('a pill no Pokémon meets leaves its card, and the card keeps its other alternatives', () => {
  // `= 90%` is no alternative at all, so the card is `shiny` alone rather than a card asking nothing beside `fire`.
  expect(queryOf(all(any(pill('eq', 90), yes('shiny')), yes('fire')))).toBe('shiny&fire');
  expect(queryOf(all(any(pill('eq', 90), yes('shiny')), yes('fire')), true)).toBe('shiny&fire');
});
