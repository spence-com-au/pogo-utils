/**
 * Which species a Pokédex entry screen is showing, over lines built here rather than read off a capture.
 *
 * `dexOn` takes lines and a game master and no image at all, so a capture buys it nothing a line cannot state — and the
 * three entry captures this was written against carried the only copy of these cases while costing three megabytes of
 * LFS between them. What a capture *could* state and these cannot is that Tesseract reads the title line at all, which
 * is why `screens.test.mts` still asserts the other half: that no capture in the corpus names a dex.
 *
 * The lines are the shape `ocr.mts` answers, text and a box, with positions that no assertion here reads — `dexOn`
 * walks every line and cares only about the text. They are written out rather than factored into a builder because the
 * text is the whole of each case and a helper would hide it.
 */

import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dexOn } from './pokedex.mts';
import { identify, label } from './identify.mts';
import { type GameData } from './game-master.mts';

/** The game master the readers are asserted against, vended beside the captures. */
const DATA = JSON.parse(readFileSync(new URL('fixtures/game-master.json', import.meta.url), 'utf8')) as GameData;

const lines = (...texts: readonly string[]) =>
  texts.map((text, at) => ({ text, left: 0, top: at * 40, width: 400, height: 32 }));

/**
 * The title line of an entry, which is a four-digit number and the species beside it. `©` stands in for the circular
 * arrows the game draws ahead of the number, which folds away to nothing on a real capture.
 */
test('an entry names its species by the number and the name together', () => {
  expect(dexOn(lines('© 0585 DEERLING', 'SEEN 2763', 'CAUGHT 1499'), DATA)).toBe(585);
});

/**
 * The counters are the reason the name is cross-checked rather than the number taken alone: an entry carries other
 * four-digit numbers, and `2763` is no species while `1499` would be one with no name beside it.
 */
test('a four-digit counter with no species beside it is not a dex number', () => {
  expect(dexOn(lines('SEEN 2763', 'CAUGHT 1499'), DATA)).toBe(null);
  expect(dexOn(lines('0585 SEEN'), DATA), 'a number whose species does not match the word beside it').toBe(null);
});

/**
 * The pair the reader exists for. Both fold to `nidoran`, so the name cannot tell them apart and the number is the only
 * thing that does — which is the same loss the detail screen suffers, the game drawing a `♀` or `♂` that OCR drops.
 */
test('both Nidoran are told apart by the number, which is the only thing that can', () => {
  expect(dexOn(lines('0029 NIDORAN'), DATA)).toBe(29);
  expect(dexOn(lines('0032 NIDORAN'), DATA)).toBe(32);
  expect(DATA.forms.find((f) => f.dex === 29)?.species, 'the vended game master has moved').toBe('Nidoran♀');
  expect(DATA.forms.find((f) => f.dex === 32)?.species, 'the vended game master has moved').toBe('Nidoran♂');
});

/**
 * Residue either side of the title, which is what the glyphs read as when they do not fold away. A letter after the
 * name still leads with the species; a digit ahead of the number makes a five-digit run, which is no dex.
 */
test('residue after the name is tolerated and a digit before the number is not', () => {
  expect(dexOn(lines('0032 NIDORAN d'), DATA), 'residue after the name').toBe(32);
  expect(dexOn(lines('90032 NIDORAN'), DATA), 'a digit ahead of the number').toBe(null);
});

/**
 * Two entries at once, which the game really does draw mid-swipe between them. Either would be a guess at which half
 * the walk is standing on, so the answer is neither.
 */
test('a screen mid-swipe between two entries answers neither of them', () => {
  expect(dexOn(lines('0029 NIDORAN', '0032 NIDORAN'), DATA)).toBe(null);
  expect(dexOn(lines('0029 NIDORAN', '0029 NIDORAN'), DATA), 'one entry read twice is still that entry').toBe(29);
});

/**
 * And the end of it: a detail screen whose name has lost its `♂` is answered as Nidoran♂ once the walk hands over the
 * number it read off the entry, without the lost glyph being reported as the Pokédex disagreeing. `NIDORAN` reads as
 * either, and `closest` breaks that tie towards Nidoran♀ — so the dex is what makes the answer right rather than lucky.
 */
test('a Nidoran whose glyph was lost is the Nidoran the entry names', () => {
  const detail = {
    cp: null,
    cps: [],
    name: 'NIDORAN',
    hp: 32,
    weight: 7.1,
    height: 0.52,
    types: ['Poison'],
    gender: null,
    favourite: false,
    size: null,
    tags: [],
    evolveCandy: null,
  };

  const identity = identify(DATA, detail, null, undefined, dexOn(lines('0032 NIDORAN'), DATA));

  expect(identity.form && label(identity.form)).toBe('Nidoran♂');
  expect(identity.notes, 'the lost glyph was reported as the Pokédex disagreeing').toStrictEqual([]);
});
