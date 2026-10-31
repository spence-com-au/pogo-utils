/**
 * What `rescue` takes off a treated CP band and what it turns down — the rule every pass of `wholeCp` is run through,
 * asserted on its own because the corpus cannot isolate it. `screens.test.mts` states the CP each capture ends with,
 * and this rule against three different band readings can all arrive at the same one.
 *
 * The readings quoted below are dumped off the real loop over every fixture, except in the last test, which constructs
 * its inputs: that one is a claim about the rule's whole domain rather than about a capture.
 *
 * What this still cannot pin is *which* treatment earned a rescue. The readings are quoted, so a change that had a
 * cheaper pass start reading `738` would leave this file and all 43 rows green with the third treatment dead. Only a
 * live read per treatment would say, and that wants the band's own crop rather than a second copy of it here.
 */

import { cpOn, joined, readingsOf, rescue } from './detail.mts';
import { type Line } from './ocr.mts';
import { expect, test } from 'vitest';

/** How many digits the longest CP any form can show runs to, which is what `cpDigits` answers off the vended master. */
const LONGEST = 4;

/**
 * `growlithe-nickname.png` is the capture brightness exists for, and its band's three readings at pad 0.35 are the
 * whole case for a third treatment: the two cheaper passes read the line's own `38` back, and only the brightened one
 * finds the 7 the line drew as a `/`. Asserted as the readings rather than as the final CP, that being the part no row
 * says.
 */
test('only the brightened band offers growlithe-nickname its lost digit', () => {
  expect(rescue('P38', '/38', LONGEST), 'the plain band has started offering more than the line read').toBeNull();
  expect(rescue('38', '/38', LONGEST), 'the near-white band has started offering more than the line read').toBeNull();

  expect(rescue('P738', '/38', LONGEST), 'the brightened band no longer rescues the 738 on this screen').toBe('738');
});

/**
 * The acceptance rule's two directions for a line with no `/` in it, on bands that exercise them: `unown-b.png`'s
 * `P487` extending a `48` off the front, as its line read before the `/` after it was kept, and `unown-question.png`'s
 * `4864` off the back — wrongly, off a band that had cut its `6` in half. That band is no longer read, `CP_ACROSS`
 * getting the capture its `486` at the pad before, but the rule still takes what it offered.
 */
test('a longer number sharing an end with the line is taken', () => {
  expect(rescue('P487', '48', LONGEST), 'a band extending the line forwards is no longer taken').toBe('487');
  expect(rescue('CP4864', '48', LONGEST), 'a band extending the line backwards is no longer taken').toBe('4864');
});

/**
 * The rule's two refusals, constructed: a number the line only sits inside is a different number rather than more of
 * the same one, and one sharing neither end is a disagreement. Both matter because brightness reads numeric noise
 * unrelated to the CP on three captures, and this is all that stands between that and an answer.
 */
test('a number the line sits inside, or shares no end with, is turned down', () => {
  expect(rescue('1385', '38', LONGEST), 'a number the line only sits inside is being taken as a rescue').toBeNull();
  expect(rescue('999', '38', LONGEST), 'a band sharing neither end is being taken as a rescue').toBeNull();
});

/**
 * Why `wholeCp` turns a four-digit line away before reading any band at all: the rule wants a number longer than the
 * line's and no longer than a CP, so the two meeting leaves nothing satisfiable. Asserted over a domain rather than one
 * reading, that being the claim the guard rests on — and `charizard-gigantamax.png`'s `691605` is what used to be
 * turned down here, after three passes had already been spawned to produce it.
 */
test('a line already as long as a CP admits no rescue whatever', () => {
  expect(rescue('691605', '1605', LONGEST), 'a six-digit run is being taken despite the cap').toBeNull();

  for (const text of ['1605', '16050', '01605', '1605 1605', '', '99999']) {
    expect(rescue(text, '1605', LONGEST), `\`${text}\` is accepted against a line already at the cap`).toBeNull();
  }
});

const line = (text: string, left: number, top: number, width: number, height: number): Line => ({
  text,
  left,
  top,
  width,
  height,
});

/**
 * What the WebAssembly Tesseract makes of `deoxys-defense.png`'s CP, dumped off the page's own read: the label line
 * stops after `15`, and the rest of the number is a line of its own — read twice, once by each of `readLines`' passes,
 * a few pixels apart. The CLI reads the same screen as one line, so only this file and a corpus run under
 * `INVENTORY_OCR=wasm` reach the join.
 */
test('a CP cut in two by the line breaks is joined to the nearer half', () => {
  const label = line('ce15', 342, 127, 156, 63);
  const lines = [label, line('59', 516, 126, 81, 62), line('69', 498, 127, 99, 99)];

  expect(cpOn(joined(label, lines).text, LONGEST), 'the two halves of the CP are no longer joined').toBe('1569');
});

/** The join's refusals: a word rather than digits, a line on another row, and a gap wider than a glyph's. */
test('only digits abutting the line on its own row are joined to it', () => {
  const label = line('cp15', 342, 127, 156, 63);

  for (const other of [line('69 HP', 498, 127, 99, 63), line('69', 498, 300, 99, 63), line('69', 600, 127, 99, 63)]) {
    expect(joined(label, [label, other]), `${other.text} at ${other.left},${other.top} was joined`).toBe(label);
  }
});

/** `unown-b.png` under the same engine: one space inside the number, which the CLI reads as a slash instead. */
test('a CP with one space inside it is read whole', () => {
  expect(cpOn('cP48 7', LONGEST), 'a CP with a space inside it is read as its first half').toBe('487');
  expect(cpOn('cPe518', LONGEST), 'the ordinary CP line no longer reads').toBe('518');
  expect(cpOn('cP1605 12', LONGEST), 'a number beside a whole CP was read into it').toBe('1605');
});

/** The cap holds however the read is spaced: a digit `joined` hangs off a whole CP makes a number no form can show. */
test('a CP longer than any form can show is refused', () => {
  expect(cpOn('cp14417', LONGEST), 'an unspaced CP past the cap was taken').toBeNull();
  expect(cpOn('cp14417 2', LONGEST), 'the first half of a spaced CP past the cap was taken').toBeNull();
  expect(cpOn('cp1441', LONGEST), 'a CP at the cap is no longer read').toBe('1441');
});

/**
 * What a `/` in a CP could have been: the thin 7 the CLI usually reads it for, or a stroke of nothing. Both, wherever a
 * CP can be either — `maschiff-female.png`'s `cp/56` is 756 and `unown-b.png`'s second line `cP48/7` is 487 — and one
 * where the other is no CP at all, as `burmy-trash.png`'s `4/` and `deoxys-normal.png`'s `1/772` are.
 */
test('a `/` in a CP is read as a 7 and as nothing, wherever either is a CP', () => {
  expect(readingsOf('/56', LONGEST)).toStrictEqual(['756', '56']);
  expect(readingsOf('48/7', LONGEST)).toStrictEqual(['4877', '487']);
  expect(readingsOf('///', LONGEST), 'a CP is no shorter than two digits').toStrictEqual(['777', '77']);
  expect(readingsOf('4/', LONGEST), 'a CP is no shorter than two digits').toStrictEqual(['47']);
  expect(readingsOf('1/772', LONGEST), 'a CP is no longer than the cap').toStrictEqual(['1772']);
  expect(readingsOf('518', LONGEST), 'a CP with no `/` in it is read as it is').toStrictEqual(['518']);
});

/** The `/` survives the label, rather than folding to the space `cpOn` would join the number across. */
test('a CP line keeps its `/` for the readings to resolve', () => {
  expect(cpOn('cp/56', LONGEST)).toBe('/56');
  expect(cpOn('cpe/38°', LONGEST)).toBe('/38');
  expect(cpOn('cp///', LONGEST)).toBe('///');
  expect(cpOn('cpe4/0', LONGEST), 'a number a `/` splits in two is no longer a label line').toBe('4/0');
  expect(cpOn('ce1/772', LONGEST), 'the `/` is no longer kept, or is counted against the cap').toBe('1/772');
});

/**
 * A band settles a `/` only by reading the 7 at every one of them. `maschiff-female.png`'s bands read `56` under every
 * treatment and pad, losing the 7 the way the line did, and taking that would answer the 56 this exists to refuse;
 * `unown-b.png`'s second line, `cP48/7`, is the other side, its band's `487` left to the arithmetic beside 4877 rather
 * than taken. `vulpix.png`'s `cpe4/2` is what is taken: its band reads `P472` everywhere.
 */
test('a band settles a `/` only by reading a 7 at every one', () => {
  expect(rescue('56', '/56', LONGEST), 'a band losing the 7 is taken').toBeNull();
  expect(rescue('CP487', '48/7', LONGEST), 'a band reading the `/` as nothing is taken').toBeNull();
  expect(rescue('P472', '4/2', LONGEST), 'a band reading the 7 is no longer taken').toBe('472');
  expect(rescue('P4712', '4/2', LONGEST), 'a band reading more than the 7 is taken').toBeNull();
});
