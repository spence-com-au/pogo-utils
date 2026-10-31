/**
 * What `rescue` takes off a treated CP band and what it turns down — the rule every pass of `wholeCp` is run through,
 * asserted on its own because the corpus cannot isolate it. `screens.test.mts` states the CP each capture ends with,
 * and this rule against three different band readings can all arrive at the same one.
 *
 * The readings quoted below are dumped off the real loop over every fixture, except in the last test, which constructs
 * its inputs: that one is a claim about the rule's whole domain rather than about a capture.
 *
 * What this still cannot pin is *which* treatment earned a rescue. The readings are quoted, so a change that had a
 * cheaper pass start reading `738` would leave this file and all 44 rows green with the third treatment dead. Only a
 * live read per treatment would say, and that wants the band's own crop rather than a second copy of it here.
 */

import { cpOn, figureIn, joined, pills, rescue } from './detail.mts';
import { type Line } from './ocr.mts';
import { type Image } from './png.mts';
import { expect, test } from 'vitest';

/** How many digits the longest CP any form can show runs to, which is what `cpDigits` answers off the vended master. */
const LONGEST = 4;

/**
 * `growlithe-nickname.png` is the capture brightness exists for, and its band's three readings at pad 0.35 are the
 * whole case for a third treatment: the two cheaper passes read the line's own `38` back, and only the brightened one
 * finds the digit the line lost. Asserted as the readings rather than as the final CP, that being the part no row says.
 */
test('only the brightened band offers growlithe-nickname its lost digit', () => {
  expect(rescue('P38', '38', LONGEST), 'the plain band has started offering more than the line read').toBeNull();
  expect(rescue('38', '38', LONGEST), 'the near-white band has started offering more than the line read').toBeNull();

  expect(rescue('P738', '38', LONGEST), 'the brightened band no longer rescues the 738 on this screen').toBe('738');
});

/**
 * The acceptance rule's two directions, on the bands that exercise them: `unown-b.png` is extended off the front and
 * `unown-question.png` off the back — the second wrongly, off a band that had cut its `6` in half. That band is no
 * longer read, `CP_ACROSS` getting the capture its `486` at the pad before, but the rule still takes what it offered.
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

type Rgb = [number, number, number];

/** A white card with every rectangle painted on it, each `[left, top, width, height, colour]`. */
function card(width: number, height: number, ...rects: [number, number, number, number, Rgb][]): Image {
  const data = new Uint8Array(width * height * 4).fill(255);

  for (const [left, top, w, h, [r, g, b]] of rects) {
    for (let y = top; y < top + h; y++) {
      for (let x = left; x < left + w; x++) {
        data.set([r, g, b, 255], (y * width + x) * 4);
      }
    }
  }

  return { width, height, data };
}

const GREEN: Rgb = [180, 219, 164];
const PANEL: Rgb = [236, 242, 228];
const INK: Rgb = [75, 105, 110];

/**
 * A button row as a 1008-wide phone draws it, measured off `burmy-plant.png`: the pill from 70 to 474 and 88 tall, the
 * panel on to 939, and in it a candy 41 wide ending 12 short of a figure of two digits 21 wide with a 3 between them.
 * What the panel holds is `glyphs`, each `[left, width, colour]` and 48 tall.
 */
const row = (...glyphs: [number, number, Rgb][]) =>
  card(
    1008,
    300,
    [70, 100, 404, 88, GREEN],
    [474, 100, 465, 88, PANEL],
    ...glyphs.map(([left, w, colour]): [number, number, number, number, Rgb] => [left, 120, w, 48, colour]),
  );

const PILL = { top: 100, height: 88 };
const CANDY: [number, number, Rgb] = [699, 41, [200, 80, 80]];
const FIFTY: [number, number, Rgb][] = [
  [752, 21, INK],
  [776, 21, INK],
];

/** Two pills below where the search starts, one above it, and between them a move's type icon 49 tall. */
test('the pills are the runs of a pill’s height down the column, below where the search starts', () => {
  const image = card(
    1008,
    600,
    [70, 50, 404, 88, GREEN],
    [70, 200, 404, 88, GREEN],
    [70, 350, 404, 49, GREEN],
    [70, 450, 404, 88, GREEN],
  );

  expect(pills(image, 100), 'a run other than a pill was taken, or a pill was missed').toStrictEqual([
    { top: 200, height: 88 },
    { top: 450, height: 88 },
  ]);
});

test('the figure is the narrow glyphs after the candy, whatever colour they are drawn in', () => {
  expect(figureIn(row(CANDY, ...FIFTY), PILL)).toStrictEqual({ left: 752, right: 797 });

  const red = FIFTY.map(([left, w]): [number, number, Rgb] => [left, w, [230, 80, 80]]);

  expect(figureIn(row(CANDY, ...red), PILL), 'red digits, a candy short of the cost, no longer read').toStrictEqual({
    left: 752,
    right: 797,
  });
});

/** The menu button over the lowest rows is wider than any digit, so the figure is found left of it and not in it. */
test('a wide glyph right of the figure is passed over', () => {
  expect(figureIn(row(CANDY, ...FIFTY, [860, 73, [69, 137, 151]]), PILL)).toStrictEqual({ left: 752, right: 797 });
});

/** A pale candy is ink only in its stripes, glyphs as narrow as a digit, so the gap before the figure has to end it. */
test('a narrow glyph a gap away from the figure is no part of it, and one nearer is', () => {
  expect(figureIn(row([720, 20, INK], ...FIFTY), PILL), 'a glyph 12 short was taken').toStrictEqual({
    left: 752,
    right: 797,
  });
  expect(figureIn(row([738, 10, INK], ...FIFTY), PILL), 'a glyph 4 short was left off').toStrictEqual({
    left: 738,
    right: 797,
  });
});

test('a row with no narrow glyph has no figure', () => {
  expect(figureIn(row(CANDY), PILL)).toBeNull();
  expect(figureIn(row(), PILL)).toBeNull();
});
