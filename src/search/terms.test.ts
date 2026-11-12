/**
 * What the table has to be true of beyond what its types say.
 *
 * A category's `help` is prose in this repository's own convention and `pages/search.js` renders it through `ticked`,
 * which splits on the tick and sets the odd pieces in `<code>`. So a sentence that opens a pair and never closes it
 * leaves its tail code-set on the page — the reverse of a sentence that skips `ticked`, which prints its own ticks, as
 * `the game has no \`gen1\`` would. Balanced ticks are an invariant of this table, and an invariant nothing checks is
 * one the next sentence added here can break quietly.
 *
 * The other two are about names colliding, and both are the kind of fault that leaves the page working: a term and a
 * range sharing an id draws two chips that read each other's pill, and a shortcut naming no range writes no span at
 * all. Neither throws, and neither shows up anywhere but in the one search that quietly stopped meaning what it said.
 */

import { expect, test } from 'vitest';

import { bounded, GROUPS, RANGES, RANGES_BY_ID, SHORTCUTS, TERMS_BY_ID } from './terms.js';

const ticks = (text: string) => [...text].filter((character) => character === '`').length;

test('every help sentence closes the backticks it opens', () => {
  const open = GROUPS.filter((category) => ticks(category.help ?? '') % 2 === 1);

  // Whether any of them quotes at all is the other half: this would pass just as quietly over a table of plain prose.
  expect({
    open: open.map((category) => category.id),
    quotes: GROUPS.some((category) => ticks(category.help ?? '') > 0),
  }).toEqual({ open: [], quotes: true });
});

/**
 * A pill on the canvas is its label and nothing else — the heading the chip sits under is not drawn there, and the four
 * type groups share a hue, so neither position nor colour says which group a pill came from. So a label that reads as
 * a quantifier names nothing a reader can act on: *Safe to transfer* would draw `!background` as a pill reading `Any`.
 */
test('no label leans on the heading above it to say what it is', () => {
  const bare = new Set(['all', 'any', 'both', 'either', 'neither', 'none']);
  const leans = (label: string) => bare.has(label.trim().toLowerCase());
  const labels = [...GROUPS.flatMap((category) => category.terms), ...RANGES].map((one) => one.label);

  // `caught` is the other half, as above: the filter would report an empty list just as quietly over no labels at all.
  expect({ leaning: labels.filter(leans), caught: leans('Any'), some: labels.length > 0 }).toEqual({
    leaning: [],
    caught: true,
    some: true,
  });
});

test('no range is named the same as a term, and no two terms the same as each other', () => {
  /*
   * An `id` is what a catalogue entry is known by, so a term and a range sharing one are one name for two entries —
   * `holds` in `cards.js` keys a pill by its kind as well and tells them apart, but a reader going by the `id` alone
   * would not. Which is a live trap rather than a hypothetical — `dynamax` is a chip and `dynamax{N}` a span, and the
   * range is `dynamaxmoves` for this reason alone.
   *
   * Terms against each other is the same fault one table over, `TERMS_BY_ID` being flat across every group: the four
   * groups that read a type hold eighteen words apiece and only the `id` prefix keeps `fire` from meaning four things.
   */
  const terms = GROUPS.flatMap((category) => category.terms.map((term) => term.id));
  const shared = RANGES.filter((range) => terms.includes(range.id)).map((range) => range.id);

  /*
   * And no two ranges share one either, which `RANGES_BY_ID` makes a divergence rather than a duplicate: `parse.js`
   * walks `RANGES` in order and takes the first row of a repeated id, where every other reader goes through the map
   * and takes the last. A typed `hp300-` would be read against one row's bounds and written against another's.
   */
  expect({
    shared,
    duplicated: terms.length - new Set(terms).size,
    counted: TERMS_BY_ID.size,
    ranged: RANGES_BY_ID.size,
  }).toEqual({ shared: [], duplicated: 0, counted: terms.length, ranged: RANGES.length });
});

test('every shortcut stands for a span of a range that exists, within that range', () => {
  /*
   * A shortcut carries the floor rather than the string, so both of its readers derive the span through the writer
   * that composes one. That leaves the floor itself to check: a range this cannot find writes no pill in `parse.js`
   * and no span in the `clauses.js` caveat, and a floor outside the range's own limits is a pill `bounded` moves under
   * whoever made it — the one thing every builder of a span is held to.
   */
  const found = SHORTCUTS.map((one) => {
    const range = RANGES.find((entry) => entry.id === one.range);

    return {
      phrase: one.phrase,
      named: range !== undefined,
      inside: range !== undefined && bounded(one.from, range) === one.from,
    };
  });

  expect({ found, some: SHORTCUTS.length > 0 }).toEqual({
    found: SHORTCUTS.map((one) => ({ phrase: one.phrase, named: true, inside: true })),
    some: true,
  });
});

/**
 * A named range's names are indexed by the value they name, so the first has to be the range's floor and the last its
 * ceiling. A level the game gains, or a ceiling raised without a name for it, would otherwise draw a dropdown that
 * either stops short of what the span can hold or offers a value the game does not have.
 *
 * Over every range carrying names rather than over `buddylevel` by name, since the field is what the page reads. That
 * there is one at all is the other half, as with the ticks above: this would pass just as quietly over a table where
 * nothing is named, and every pill would be back to bare digits.
 */
test('a named range runs from its first name to its last', () => {
  const named = RANGES.filter((range) => range.levels);

  expect({
    spans: named.map((range) => ({ id: range.id, min: range.min ?? 0, max: range.max })),
    some: named.length > 0,
  }).toEqual({
    spans: named.map((range) => ({ id: range.id, min: 0, max: (range.levels ?? []).length - 1 })),
    some: true,
  });
});
