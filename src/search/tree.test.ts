/**
 * What a pill writes, and the path edits the cards are changed through.
 *
 * `leafText` is asserted against `terms.js` rather than against literals, for the reason `optimise.test.ts` gives: a
 * renamed id or a moved ceiling leaves a test asserting nothing, and that reads exactly like a pass.
 */

import { expect, test } from 'vitest';

import { bounded, RANGES, TERMS_BY_ID } from './terms.js';
import { emptyTree, group, isGroup, leafLabel, leafText, nodeAt, update, type Leaf, type Node } from './tree.js';

const yes = (id: string): Leaf => ({ kind: 'term', id, negated: false });
const named = (text: string): Leaf => ({ kind: 'name', text, negated: false });
const all = (...parts: Node[]) => group('all', parts);
const any = (...parts: Node[]) => group('any', parts);

/** One range from the table, so a test pins the floor and ceiling its literals were derived from. */
function range(id: string) {
  const found = RANGES.find((entry) => entry.id === id);

  if (!found) {
    throw new Error(`\`terms.js\` carries no ${id} range`);
  }

  return found;
}

/** A tree said in the shape a failure can be read in: every pill as its text, every group as its junction. */
function shape(node: Node): unknown {
  return isGroup(node) ? { [node.junction]: node.parts.map(shape) } : (leafText(node) ?? '…');
}

test('a pill writes the term the table gives it, and a name writes itself', () => {
  const shiny = TERMS_BY_ID.get('shiny');
  const star = TERMS_BY_ID.get('star4');

  expect([shiny?.term, star?.term]).toEqual(['shiny', '4*']);

  expect(leafText(yes('shiny'))).toBe('shiny');
  expect(leafText({ kind: 'term', id: 'star4', negated: true })).toBe('!4*');
  expect(leafText(named('pikachu'))).toBe('pikachu');
  expect(leafText({ kind: 'name', text: '  +charmander  ', negated: false })).toBe('+charmander');
});

test('a pill with nothing to write yet writes nothing', () => {
  // Each of these is a pill a reader can see on a card, and none of them is something to tell the game about.
  expect(leafText({ kind: 'range', id: 'cp', from: null, to: null, negated: false })).toBeNull();
  expect(leafText({ kind: 'name', text: '   ', negated: false })).toBeNull();

  // An id no table carries is the one case that is a fault rather than an unfinished pill, and answers the same way.
  expect(TERMS_BY_ID.has('sparkly')).toBe(false);
  expect(leafText(yes('sparkly'))).toBeNull();
  expect(leafText({ kind: 'range', id: 'nope', from: 1, to: 2, negated: false })).toBeNull();
});

test('a span pill leaves an empty bound open rather than filling it from its own range', () => {
  /*
   * The floor and the ceiling are asserted first so the strings below are known to be *omitting* a bound the table
   * could have supplied rather than agreeing with one by accident — filling them is what wrote `cp3000-5000` and
   * `1-151`. The dex carries no prefix, a bare span being how the game searches dex numbers, so its open low end is
   * the bare leading dash the phrase list gives as its own example of the form.
   */
  expect(range('cp').max).toBe(99999);
  expect([range('dex').prefix, range('dex').min]).toEqual(['', 1]);

  expect(leafText({ kind: 'range', id: 'cp', from: 3000, to: null, negated: false })).toBe('cp3000-');
  expect(leafText({ kind: 'range', id: 'dex', from: null, to: 151, negated: false })).toBe('-151');

  // Both boxes filled is the closed span it always was, including when the reader types the higher number into the
  // lower box, and a span whose ends meet is the one number it holds.
  expect(leafText({ kind: 'range', id: 'cp', from: 100, to: 2000, negated: false })).toBe('cp100-2000');
  expect(leafText({ kind: 'range', id: 'cp', from: 2000, to: 100, negated: false })).toBe('cp100-2000');
  expect(leafText({ kind: 'range', id: 'cp', from: 100, to: 100, negated: false })).toBe('cp100');

  /*
   * A span open at the bottom needs no dash in two cases, and the two are separate tests because the ranges whose
   * floor is not nought pull them apart — `to === (range.min ?? 0)` alone would write the `-0` the second forbids,
   * and `to === 0` alone would leave the first spelling a dash it has no use for.
   *
   * On the floor, the span is the single value sitting on it: `min` is the whole of what a bound can be, which is
   * what `bounded` holds every builder to.
   */
  expect([range('dex').min, range('year').min]).toEqual([1, 2016]);
  expect(leafText({ kind: 'range', id: 'dex', from: null, to: 1, negated: false })).toBe('1');
  expect(leafText({ kind: 'range', id: 'year', from: null, to: 2016, negated: false })).toBe('year2016');

  /*
   * And a nought never goes to the right of a dash, whatever the floor, because `-0` is the one spelling two of the
   * list's rules both claim — `{phrase}-{N}` reads it as values at or below nought, and "If `{M}` is 0, the search is
   * treated as `{phrase}{N}-` instead" reads it as an `{N}` that is not there — with nothing saying which wins. `0`
   * is claimed by `{phrase}{N}` alone. Preferring one reading over two is the whole of the reason and the only one
   * the list supports; what the game answers for `-0` is not written down.
   *
   * **Not the round trip, which cannot tell these two apart where the arm does its work.** `bounded` clamps a nought
   * to the floor, so below a floor above nought *neither* spelling composes itself: `-0` reads back `{ null, 1 }` and
   * `0` reads back `{ 1, 1 }`, and both write `1`. The property only separates them where the floor is nought, and
   * there the test above has already fired.
   */
  expect(leafText({ kind: 'range', id: 'dex', from: null, to: 0, negated: false })).toBe('0');
  expect(leafText({ kind: 'range', id: 'year', from: null, to: 0, negated: false })).toBe('year0');

  // Both unreachable through `bounded`, which is what makes this an invariant held rather than a bug fixed.
  expect([bounded(0, range('dex')), bounded(0, range('year'))]).toEqual([1, 2016]);

  // Where the floor *is* nought the two cases are one, which is six of the eight ranges.
  expect(range('hp').min).toBeUndefined();
  expect(leafText({ kind: 'range', id: 'hp', from: null, to: 0, negated: false })).toBe('hp0');
  expect(leafText({ kind: 'range', id: 'hp', from: 0, to: null, negated: false })).toBe('hp0-');
});

test('a pill says the label its chip said, so a card and the catalogue agree', () => {
  expect(leafLabel(yes('star4'))).toBe(TERMS_BY_ID.get('star4')?.label);
  expect(leafLabel(named('pikachu'))).toBe('pikachu');
  expect(leafLabel({ kind: 'range', id: 'cp', from: null, to: null, negated: false })).toBe(range('cp').label);
});

test('a path names the node it leads to, and nothing where it leads nowhere', () => {
  const tree = all(yes('shiny'), any(yes('fire'), yes('water')));

  expect(nodeAt(tree, [])).toBe(tree);
  expect(nodeAt(tree, [0])).toEqual(yes('shiny'));
  expect(nodeAt(tree, [1, 1])).toEqual(yes('water'));

  // A path can lead past the end of a group, or into a pill as though it were one.
  expect(nodeAt(tree, [9])).toBeNull();
  expect(nodeAt(tree, [0, 0])).toBeNull();
});

test('an edit rebuilds only the spine down to what it changed', () => {
  const inner = any(yes('fire'), yes('water'));
  const tree = all(yes('shiny'), inner, yes('lucky'));
  const changed = update(tree, [1, 0], (node) => ({ ...(node as Leaf), negated: true }));

  expect(shape(changed)).toEqual({ all: ['shiny', { any: ['!fire', 'water'] }, 'lucky'] });

  // Everything off the spine is the node it already was, which is what lets a render decide what to redraw by
  // identity rather than by comparing two trees.
  expect(isGroup(changed) && changed.parts[0]).toBe(tree.parts[0]);
  expect(isGroup(changed) && changed.parts[2]).toBe(tree.parts[2]);
  expect(isGroup(changed) && changed.parts[1]).not.toBe(inner);
});

test('an edit answering null takes the node out', () => {
  const tree = all(yes('shiny'), yes('lucky'), yes('costume'));

  expect(shape(update(tree, [1], () => null))).toEqual({ all: ['shiny', 'costume'] });

  // The root is the one node that cannot go: the cards have to have something to be the parts of, and an empty root
  // group is how a query says nothing.
  expect(shape(update(tree, [], () => null))).toEqual(shape(tree));
});

test('an empty tree is a group with nothing in it, joined the way the game joins its clauses', () => {
  const tree = emptyTree();

  expect([tree.junction, tree.parts.length]).toEqual(['all', 0]);
});
