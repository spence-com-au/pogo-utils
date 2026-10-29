/**
 * The reductions, and the arrangements they are deliberately silent about.
 *
 * Every one of them is local to one junction node, which is what the canvas changed: the earlier builder AND'd one
 * clause per category, so "this category's terms" and "the terms AND'd with the rest" were the same set. An
 * arrangement can put a category's terms in two groups, or inside an `any` the rest of the query is not AND'd with, so
 * each case below says which junction it is about — and the pair of cases per reduction, one for each junction, is
 * where the work is.
 *
 * Every expectation is derived from `terms.js` and pinned against it first. A test that spells out `shadow&!purified`
 * is asserting that two ids still exist and still sit in a category declaring exclusivity; a renamed id would leave it
 * asserting nothing, and that reads exactly like a pass.
 */

import { expect, test } from 'vitest';

import POKEMON from '../pokemon/pokedex.js';
import { compose, emptyState, type State } from './query.js';
import { optimise } from './optimise.js';
import { GROUPS, RANGES, TERMS_BY_ID, type Group as Category } from './terms.js';
import { group, leafText, type Leaf, type Node } from './tree.js';

const yes = (id: string): Leaf => ({ kind: 'term', id, negated: false });
const no = (id: string): Leaf => ({ kind: 'term', id, negated: true });
const named = (text: string): Leaf => ({ kind: 'name', text, negated: false });
const span = (from: number | null, to: number | null): Leaf => ({ kind: 'range', id: 'dex', from, to, negated: false });
const all = (...parts: Node[]) => group('all', parts);
const any = (...parts: Node[]) => group('any', parts);

/** What an untouched string, or one rewritten without straying, says about itself. */
const EXACT = { narrowed: false, widened: false };

const state = (tree: Node): State => ({ ...emptyState(), tree });

/** The string an arrangement composes to once shortened, which is the only thing the page shows for it. */
const short = (tree: Node) => compose(optimise(state(tree)).state).query;

/** The same, plus what was said about it. */
const told = (tree: Node) => {
  const { state: shortened, rewrites, lossy } = optimise(state(tree));

  return { query: compose(shortened).query, rewrites, lossy };
};

/** One category by id. It throws rather than defaulting, a category gone being a precondition gone. */
function category(id: string): Category {
  const found = GROUPS.find((entry) => entry.id === id);

  if (!found) {
    throw new Error(`\`terms.js\` carries no ${id} category`);
  }

  return found;
}

/** The term a chip writes, pinned so a case spelling it out is pinned to the table. */
const term = (id: string) => TERMS_BY_ID.get(id)?.term;

test('a name is written as short as it goes, wherever the pill sits', () => {
  // `charmander` names one species and so does `4`, and the game reads the two the same way.
  expect(told(all(named('charmander')))).toEqual({
    query: '4',
    rewrites: [['charmander', '4']],
    lossy: { narrowed: true, widened: false },
  });

  // The one reduction that needs to know nothing about what is around it, so it reaches a pill at any depth.
  expect(short(any(all(named('charmander'), yes('shiny')), named('bulbasaur')))).toBe('4,1&shiny,1');

  // A name that resolves to nothing is passed through: a nickname, a misspelling, or a fragment landing on a species
  // the dex cannot spell.
  expect(told(all(named('mr snuggles')))).toEqual({ query: 'mr snuggles', rewrites: [], lossy: EXACT });
});

test('a name shortened to a fragment says it now matches more nicknames', () => {
  // `eev` reaches Eevee alone among species, as `eevee` does and in fewer characters than `133`. But the game matches a
  // name against nicknames too, and `eev` is also every Pokémon nicknamed *Eevie* — a match the reader did not ask for,
  // which is the wrong direction to be silent about in a string a mass transfer is run from.
  expect(told(all(named('eevee')))).toEqual({
    query: 'eev',
    rewrites: [['eevee', 'eev']],
    lossy: { narrowed: false, widened: true },
  });
});

test('a ruled-out name reaching several species keeps its fragment rather than a comma', () => {
  // `nidoran` is both Nidoran, which the dex cannot run together, and `nidor` would reach Nidorina and Nidorino too.
  expect([Number(POKEMON.NIDORAN_F), Number(POKEMON.NIDORAN_M)]).toEqual([29, 32]);
  expect(short(all(named('nidoran')))).toBe('29,32');

  // Ruled out, `!29,32` would be not 29 *or* 32, which is every Pokémon — a reader excluding both Nidoran would have
  // excluded nothing, from a string a mass transfer is run from.
  const ruled: Leaf = { kind: 'name', text: 'nidoran', negated: true };

  expect(told(all(ruled))).toEqual({
    query: '!nidora',
    rewrites: [['nidoran', 'nidora']],
    lossy: { narrowed: false, widened: true },
  });
  expect(short(any(ruled, yes('shiny')))).toBe('!nidora,shiny');

  // A single span has no comma to lose the `!` across, so a ruled-out name reaching one species still becomes it.
  expect(short(all({ kind: 'name', text: 'charmander', negated: true }))).toBe('!4');
});

test('a family keeps its name, there being no family data here to turn it into numbers', () => {
  // `+charmander` is the Charmander family, and which species share one is not something this repository holds. A
  // family is the families of everything the name reaches, nicknames included, so the shorter fragment widens it as it
  // would a bare name.
  expect(told(all(named('+charmander')))).toEqual({
    query: '+charma',
    rewrites: [['+charmander', '+charma']],
    lossy: { narrowed: false, widened: true },
  });
});

test('a name the game cannot spell is left alone', () => {
  // `pokedex.js` drops the apostrophe, so `farfetchd` reads as an ordinary word where the game's name is `Farfetch'd`.
  expect(told(all(named('farfetch')))).toEqual({ query: 'farfetch', rewrites: [], lossy: EXACT });
});

test('dex spans AND’d collapse into their overlap, and OR’d into their union', () => {
  const gen1 = term('gen1');
  const gen2 = term('gen2');

  expect([gen1, gen2]).toEqual(['1-151', '152-251']);
  expect(category('generation').exclusive).toBeUndefined();

  // An `any` of two generations is the span they cover between them, which is what the fixed builder always wrote.
  expect(short(any(yes('gen1'), yes('gen2')))).toBe('1-251');

  // An `all` of them is nothing at all — no species is in two generations — so the pills stay as the two clauses they
  // were. Writing their overlap would be writing no clause, turning a search that finds nothing into one that finds
  // everything.
  expect(short(all(yes('gen1'), yes('gen2')))).toBe('1-151&152-251');

  // A name that became a number joins the arithmetic: Charmander inside Gen 1 is just Charmander.
  expect(short(all(named('charmander'), yes('gen1')))).toBe('4');
  expect(short(all(span(1, 151), yes('gen1')))).toBe('1-151');
  expect(short(all(span(100, 400), yes('gen1')))).toBe('100-151');

  /*
   * So does a span with an end left open, which the writer spells as a dash with nothing after it. A dex pill is read
   * back *through that writer*, so the open end has to be closed against the dex here or the pill drops out of the
   * arithmetic silently — leaving both it and the generation it should have absorbed in the string, which looks like a
   * reduction that merely declined rather than one that could not read its own input.
   *
   * **What comes back out is closed at both ends on purpose, though an open one would be a character shorter.** A
   * collapse landing on the dex's own floor could write `-151` where this writes `1-151`, and the answer is the
   * generation chips: `1-151` is the Gen 1 term as well as a dex span, so the page's own shortened output reads back
   * as the chip that says *Gen 1* where `-151` reads back as an anonymous span. A reduction is shown to the reader to
   * be checked, and one character is not worth the spelling they can recognise. The character is only ever on offer
   * where a bound sits exactly on `WHOLE`, which is the overlap a generation has with the ends of the dex.
   */
  expect(short(all(span(null, 400), yes('gen1')))).toBe('1-151');
  expect(short(all(span(100, null), yes('gen1')))).toBe('100-151');
});

test('spans covering the whole dex earn no clause either way', () => {
  const dex = RANGES.find((range) => range.id === 'dex');

  expect([dex?.min, dex?.max]).toEqual([1, 1025]);

  // Every generation at once is every species, which says nothing — and in an `any` it makes the whole group say
  // nothing, where in an `all` it is only those pills that have earned nothing.
  const every = GROUPS.find((entry) => entry.id === 'generation')?.terms.map((one) => yes(one.id)) ?? [];

  expect(short(any(...every))).toBe('');
  expect(short(all(yes('shiny'), span(1, 1025), span(1, 1025)))).toBe('shiny');
});

test('a span over the whole of any range earns no clause, unless only some species hold one', () => {
  expect(RANGES.filter((range) => range.sparse).map((range) => range.id)).toEqual([
    'megalevel',
    'dynamaxmoves',
    'gigantamaxmoves',
    'maxmove',
    'maxguard',
    'maxspirit',
  ]);

  // Every range, so a row added to `terms.js` is held to this as well as the ones there now.
  for (const range of RANGES) {
    const floor = range.min ?? 0;
    const pill = (from: number | null, to: number | null, negated = false): Leaf => ({
      kind: 'range',
      id: range.id,
      from,
      to,
      negated,
    });

    // Open above the floor, open below the ceiling, and the two ends typed the wrong way round.
    for (const one of [pill(floor, null), pill(null, range.max), pill(range.max, floor)]) {
      const text = leafText(one);

      // In an `any` it is true of everything, so the group asks nothing and the `shiny` beside it never filtered.
      expect({
        text,
        all: short(all(yes('shiny'), one)),
        any: short(all(yes('lucky'), any(yes('shiny'), one))),
      }).toEqual({
        text,
        all: range.sparse ? `shiny&${text}` : 'shiny',
        any: range.sparse ? `lucky&shiny,${text}` : 'lucky',
      });
    }

    // Ruled out it matches nothing, and dropping it would turn that into a search for everything; one short of either
    // bound still says something.
    for (const one of [pill(floor, null, true), pill(floor + 1, null), pill(null, range.max - 1)]) {
      expect(short(all(yes('shiny'), one))).toBe(`shiny&${leafText(one)}`);
    }
  }
});

test('a negated span is left out of the arithmetic', () => {
  // Ruling a span out is not asking for one, so there is nothing to intersect it with.
  const ruled: Leaf = { kind: 'range', id: 'dex', from: 1, to: 151, negated: true };

  expect(short(all(yes('gen1'), ruled))).toBe('1-151&!1-151');
});

test('an all asking for one term of an exclusive category drops the refusals beside it', () => {
  const rocket = category('rocket');

  expect(rocket.exclusive).toBe(true);
  expect([term('shadow'), term('purified')]).toEqual(['shadow', 'purified']);

  // Purifying a Shadow Pokémon is what makes it Purified, so nothing is both and the refusal says nothing.
  expect(short(all(yes('shadow'), no('purified')))).toBe('shadow');
  expect(short(all(yes('star4'), no('star0')))).toBe(term('star4'));

  // Refusing the very term asked for is a search for nothing, and the reader is owed the sight of that: it is left
  // standing whatever other refusals beside it go.
  expect(short(all(yes('shadow'), no('shadow')))).toBe('shadow&!shadow');
  expect(short(all(yes('star3'), no('star3')))).toBe('3*&!3*');
  expect(short(all(yes('shadow'), no('shadow'), no('purified')))).toBe('shadow&!shadow');

  // A category that declares nothing gets nothing: a Pokémon can be any number of these at once.
  expect(category('status').exclusive).toBeUndefined();
  expect(short(all(yes('shiny'), no('lucky')))).toBe('shiny&!lucky');

  /*
   * The regional forms are the category that *reads* exclusive and is not, which is the whole of why they declare
   * nothing: the community phrase list has Hisuian Decidueye — an Alola species — as the one Pokémon two regions
   * together will find, so the refusal below takes away a Pokémon that `alola` on its own matches. Declaring the fact
   * would have dropped the refusal and put that one back in.
   */
  expect(category('form').exclusive).toBeUndefined();
  expect(short(all(yes('alola'), no('hisui')))).toBe('alola&!hisui');
});

test('an any of every term of an exhaustive category asks for nothing at all', () => {
  const type = category('type');
  const appraisal = category('appraisal');

  expect([type.exhaustive, appraisal.exhaustive]).toEqual([true, true]);

  // Every species has a type and every Pokémon has a star rating, so asking for any of them asks for nothing.
  expect(short(any(...type.terms.map((one) => yes(one.id))))).toBe('');
  expect(short(any(...appraisal.terms.map((one) => yes(one.id))))).toBe('');

  // One short of all of them is not everything, and Type is not exclusive, so there is nothing further to do: a
  // Gyarados is Flying, which is among the seventeen types that are not Water, and it is still not `!water`.
  const butOne = type.terms.slice(0, -1);

  expect(short(any(...butOne.map((one) => yes(one.id))))).toBe(butOne.map((one) => one.term).join(','));
});

test('an any holding every term of an exhaustive category asks nothing, whatever else is beside them', () => {
  const gender = category('gender');
  const type = category('type');
  const appraisal = category('appraisal');

  expect([gender.exhaustive, type.exhaustive, appraisal.exhaustive]).toEqual([true, true, true]);
  expect(TERMS_BY_ID.has('shiny')).toBe(true);

  // Everything OR'd with Shiny is still everything, where splicing the category away alone would leave `shiny`.
  expect(short(any(...gender.terms.map((one) => yes(one.id)), yes('shiny')))).toBe('');
  expect(short(any(yes('shiny'), ...type.terms.map((one) => yes(one.id))))).toBe('');
  expect(short(any(...appraisal.terms.map((one) => yes(one.id)), named('pikachu')))).toBe('');

  // Nested, the group goes and the `all` around it keeps the rest of what it asks.
  expect(short(all(yes('lucky'), any(...gender.terms.map((one) => yes(one.id)), yes('shiny'))))).toBe('lucky');
});

test('copies of one chip are one term, not every term of its category', () => {
  const appraisal = category('appraisal');

  expect(appraisal.terms.length).toBe(5);

  // Five copies of `0*` ask for `0*`, however many pills that is.
  const copies = Array.from({ length: appraisal.terms.length }, () => yes('star0'));

  expect(short(any(...copies))).not.toBe('');
  expect(short(any(...copies)).split(',')).toContain(term('star0'));
});

test('copies of one covered term are not the whole of what a union covers', () => {
  const union = category('background').terms.find((one) => one.covers);
  const first = 'locationbackground';

  expect(union?.covers).toContain(first);

  // Two copies of one covered term are that term, not the union of it and the one beside it.
  expect(short(all(yes(first), yes(first)))).not.toBe(term('background'));
});

test('an any of all but some of a partition is written as the complement where that is shorter', () => {
  const appraisal = category('appraisal');

  expect([appraisal.exclusive, appraisal.exhaustive]).toEqual([true, true]);
  expect(appraisal.terms.map((one) => one.term)).toEqual(['0*', '1*', '2*', '3*', '4*']);

  // Four of the five ratings say the fifth, and `!4*` is eight characters shorter than `0*,1*,2*,3*`.
  expect(short(any(yes('star0'), yes('star1'), yes('star2'), yes('star3')))).toBe('!4*');

  // Two of them are not: `!0*&!1*&!2*` is longer than `3*,4*`, so the two spellings are weighed and the short one won.
  expect(short(any(yes('star3'), yes('star4')))).toBe('3*,4*');

  // Three of them leave two out, and `!3*&!4*` is shorter than `0*,1*,2*` — but the pills go back into this `any`,
  // where `!3*,!4*` is every Pokémon there is, none being both. Every choice of three stays as it was arranged.
  const ids = appraisal.terms.map((one) => one.id);
  const threes = ids.flatMap((first, i) =>
    ids.slice(i + 1).flatMap((second, j) => ids.slice(i + j + 2).map((third) => [first, second, third])),
  );

  expect(threes).toHaveLength(10);

  for (const three of threes) {
    expect(short(any(...three.map(yes)))).toBe(three.map(term).join(','));
  }

  // An `all` of two is a search for nothing, and the reader is owed the sight of that rather than a rewrite of it.
  expect(short(all(yes('star3'), yes('star4')))).toBe('3*&4*');
});

test('a union term is written in place of the whole of what it covers, on the side its junction allows', () => {
  const background = category('background');
  const union = background.terms.find((one) => one.covers);

  expect(union?.id).toBe('background');
  expect(union?.covers).toEqual(['locationbackground', 'specialbackground']);
  expect(background.exclusive).toBeUndefined();

  // Either backdrop is a backdrop, and neither backdrop rules out both.
  expect(short(any(yes('locationbackground'), yes('specialbackground')))).toBe('background');
  expect(short(all(no('locationbackground'), no('specialbackground')))).toBe('!background');

  // Beside the union itself a term it covers adds nothing to that side.
  expect(short(any(yes('background'), yes('locationbackground')))).toBe('background');

  // Short of all of them the union says more than they do, and there is nothing to swap it for. Both of these are
  // searches a reader would want the sight of: the first is the Event backdrops, the second matches nothing.
  expect(short(all(yes('background'), no('locationbackground')))).toBe('background&!locationbackground');
  expect(short(any(yes('locationbackground')))).toBe('locationbackground');

  /*
   * On the other side the union is not the same search, so it is not written in. Two backdrops AND'd ask for one that
   * is both and match nothing; the union beside one of them is that one; two refusals OR'd let through everything but a
   * Pokémon with both; and a refusal of the union OR'd with one of a covered term is that refusal alone.
   */
  expect(short(all(yes('locationbackground'), yes('specialbackground')))).toBe('locationbackground&specialbackground');
  expect(short(all(yes('background'), yes('locationbackground')))).toBe('background&locationbackground');
  expect(short(any(no('locationbackground'), no('specialbackground')))).toBe('!locationbackground,!specialbackground');
  expect(short(any(no('background'), no('locationbackground')))).toBe('!background,!locationbackground');
});

test('a union term is named more briefly than the terms it covers', () => {
  /*
   * The swap is unconditional, so this is the property the table has to hold rather than a branch in the code. A union
   * named at more length would still be correct to swap in and would no longer be worth swapping, which wants a field
   * of its own rather than a guard no test could reach.
   */
  for (const entry of GROUPS) {
    for (const union of entry.terms.filter((one) => one.covers)) {
      const covered = (union.covers ?? []).map((id) => entry.terms.find((one) => one.id === id));

      // An id naming no term of its own category would read as a term nobody placed, so the swap would go quiet.
      expect({ union: union.id, missing: covered.filter((one) => one === undefined).length }).toEqual({
        union: union.id,
        missing: 0,
      });

      const asUnion = union.term.length;
      const asCovered = covered.map((one) => one?.term.length ?? 0).reduce((sum, one) => sum + one + 1, -1);

      expect({ union: union.id, shorter: asUnion < asCovered }).toEqual({ union: union.id, shorter: true });
    }
  }
});

test('a category arriving at one junction with mixed polarity is left alone', () => {
  /*
   * `any[shadow, !purified]` really is `!purified`, shadow being inside it — but the facts in `terms.js` are stated
   * for a category's choices arriving on one side, which is the arrangement the catalogue leads a reader to. A
   * reduction nobody has thought about is worth less than the clause it saves.
   */
  expect(short(any(yes('shadow'), no('purified')))).toBe('shadow,!purified');
  expect(short(any(yes('star0'), no('star4')))).toBe('0*,!4*');
});

test('a category split across two groups is two separate questions', () => {
  // The whole of what being local to one node means: a pill one group over is a pill the reduction knows nothing
  // about, which is the only reading that cannot make a search broader than it was.
  expect(short(all(yes('shadow'), any(no('purified'), yes('shiny'))))).toBe('shadow&!purified,shiny');
});

test('the arrangement the reader made is never the one that was shortened', () => {
  const tree = all(named('charmander'), yes('gen1'));
  const before = structuredClone(tree);

  optimise(state(tree));

  // The cards and the link go on carrying what was placed, so turning the toggle off puts the long string back rather
  // than leaving a rewrite to undo.
  expect(tree).toEqual(before);
});

test('shortening an already shortened arrangement changes nothing further', () => {
  const cases: Node[] = [
    all(named('charmander'), yes('gen1')),
    any(yes('star0'), yes('star1'), yes('star2'), yes('star3')),
    any(yes('locationbackground'), yes('specialbackground')),
    all(yes('shadow'), no('purified')),
    any(yes('gen1'), yes('gen2')),
    all(yes('shiny'), any(yes('fire'), yes('water'))),
  ];

  for (const tree of cases) {
    const once = optimise(state(tree)).state;
    const twice = optimise(once).state;

    expect({ tree: compose(once).query, again: compose(twice).query }).toEqual({
      tree: compose(once).query,
      again: compose(once).query,
    });
  }
});
