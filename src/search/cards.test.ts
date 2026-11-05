/**
 * The cards the Builder draws, and the trees that arrive in some other shape.
 *
 * The property everything here rests on is that laying a tree out as cards never changes what it searches for: a card
 * is a clause, so the string composed from the cards has to be the string composed from the tree they came from.
 */

import { expect, test } from 'vitest';

import { all, any, named, no, shape, yes } from '../testing/search.js';
import { added, asCards, cardsOf, holds, pillsOf, toggled } from './cards.js';
import { compose, fromFragment } from './query.js';
import { read } from './parse.js';
import { emptyTree, type Group, type Leaf, type Node } from './tree.js';

/** The cards a tree is laid out as, which every test here expects to exist. */
function cards(tree: Node): Group {
  const laid = asCards(tree);

  if (laid === null) {
    throw new Error('the tree spread past what a card can hold');
  }

  return laid;
}

const written = (tree: Node) => compose({ tree, optimise: false }).query;

test('a tree already in cards is kept as it was arranged', () => {
  const tree = all(yes('shiny'), any(yes('fire'), yes('water')), no('traded'));

  expect(cards(tree)).toEqual(tree);
});

test('an empty card goes, and a card of one alternative is that pill', () => {
  expect(shape(cards(all(any(), any(yes('fire')), named('pikachu'))))).toEqual({ all: ['fire', 'pikachu'] });
});

test('a link holding an empty group loads without it', () => {
  const { tree } = fromFragment('q=A2_O0_Npikachu');

  expect(shape(cards(tree))).toEqual({ all: ['pikachu'] });
});

test('a tree deeper than cards is multiplied out into the clauses its string is written as', () => {
  const tree = read('(pikachu&shiny),(pumpkaboo&xxl)').tree;

  if (tree === null) {
    throw new Error('the query did not parse');
  }

  const laid = cards(tree);

  expect(laid.parts.every((card) => pillsOf(card).length > 0)).toBe(true);
  expect(written(laid)).toBe(written(tree));
});

test('a root joined with any is one card of alternatives', () => {
  expect(shape(cards(any(yes('shiny'), yes('lucky'))))).toEqual({ all: [{ any: ['shiny', 'lucky'] }] });
});

test('a tree spreading past what a search box takes has no cards', () => {
  const pairs = Array.from({ length: 12 }, (_, at) => all(named(`a${at}`), named(`b${at}`)));

  expect(asCards(any(...pairs))).toBeNull();
  expect(shape(cardsOf(any(...pairs)))).toEqual({ all: [] });
  expect(shape(cardsOf(all(yes('shiny'))))).toEqual({ all: ['shiny'] });
});

test('a chip pressed for the card past the last starts a card', () => {
  const root = toggled(emptyTree(), 0, yes('shiny'));

  expect(shape(root)).toEqual({ all: ['shiny'] });
  expect(holds(root, 0, yes('shiny'))).toBe(true);
});

test('a second chip pressed for a card makes it a card of alternatives', () => {
  const root = toggled(toggled(emptyTree(), 0, yes('fire')), 0, yes('water'));

  expect(shape(root)).toEqual({ all: [{ any: ['fire', 'water'] }] });
});

test('a chip pressed again takes its pill out, ruled out or not, and an emptied card goes', () => {
  const root = all(yes('shiny'), any(no('fire'), yes('water')));

  expect(shape(toggled(root, 1, yes('fire')))).toEqual({ all: ['shiny', 'water'] });
  expect(shape(toggled(root, 0, yes('shiny')))).toEqual({ all: [{ any: ['!fire', 'water'] }] });
});

test('a chip reads the card it is pressed for and no other', () => {
  const root = all(yes('shiny'), yes('fire'));

  expect([holds(root, 0, yes('shiny')), holds(root, 1, yes('shiny')), holds(root, 2, yes('shiny'))]).toEqual([
    true,
    false,
    false,
  ]);
  expect(shape(toggled(root, 1, yes('shiny')))).toEqual({ all: ['shiny', { any: ['fire', 'shiny'] }] });
});

test('a span chip is read by its range rather than by its bounds', () => {
  const span: Leaf = { kind: 'range', id: 'cp', from: 2500, to: null, negated: false };
  const pressed: Leaf = { kind: 'range', id: 'cp', from: null, to: null, negated: false };

  expect(holds(all(span), 0, pressed)).toBe(true);
  expect(shape(toggled(all(span), 0, pressed))).toEqual({ all: [] });
});

test('a name added twice to one card is one pill, and two names are two alternatives', () => {
  const once = added(emptyTree(), 0, named('pikachu'));

  expect(added(once, 0, named('pikachu'))).toBe(once);
  expect(shape(added(once, 0, named('eevee')))).toEqual({ all: [{ any: ['pikachu', 'eevee'] }] });
});
