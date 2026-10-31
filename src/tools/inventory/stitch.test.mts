/**
 * What the stitcher does to frames it is handed, built here rather than captured: a scroll capture is a pure function
 * of a list of images, so a test of it needs no phone.
 *
 * **Every case starts from a tall image and cuts frames out of it**, which is what makes the assertion strong — the
 * stitch has to reproduce the source it was sliced from pixel for pixel, where a test of dimensions would pass on an
 * image assembled at entirely the wrong offsets.
 *
 * The fixed furniture is in every fixture on purpose: a ticking status bar, an overlay and the floating buttons are
 * what a naive concatenation repeats once per frame and what makes a whole-screen correlation answer zero, so a band
 * that excludes them is as much under test as the stitching.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { offsetBetween, scrollStep, stitch, SCREEN_BAND, type Band } from './stitch.mts';
import { crop, decodePng, rgb, screenIn, type Image } from './png.mts';

/**
 * Where the frames below put their furniture, which is a fact about the screen rather than about any band. The band is
 * derived from it and not the other way round, because whether a band stays clear of the furniture is the question
 * these frames exist to pose: a fixture that painted its furniture at the edges of whatever band it was handed would
 * answer yes for every band, including one that reached into the buttons.
 */
const FURNITURE = { above: 0.2, below: 0.9 };
const BAND: Band = { from: FURNITURE.above, to: FURNITURE.below };
const WIDTH = 120;
const FRAME = 400;

const blank = (width: number, height: number): Image => ({
  width,
  height,
  data: new Uint8Array(width * height * 4),
});

/**
 * A deterministic hash, because the obvious thing does not work: a row painted `(37 * y + 3 * x) % 256` repeats every
 * 256 rows, and `profile` and `pixelCost` read the red channel alone, so the difference between two frames becomes a
 * function of the shift and nothing else — deep minima at shifts that line nothing up, a scroll of 100 reading as 190.
 * Real screen content is not periodic like that, but a fixture has to be built not to be.
 */
const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;

  return h ^ (h >>> 16);
};

/** A pixel whose value is a function of where it is, so a row placed wrongly reads as the wrong number. */
const paint = (image: Image, y: number, seed: number) => {
  for (let x = 0; x < image.width; x++) {
    const i = (y * image.width + x) * 4;
    const h = hash(x, seed);
    image.data[i] = h & 255;
    image.data[i + 1] = (h >>> 8) & 255;
    image.data[i + 2] = (h >>> 16) & 255;
    image.data[i + 3] = 255;
  }
};

/** The content a screen would scroll through, each row distinguishable from every other. */
const content = (height: number): Image => {
  const image = blank(WIDTH, height);

  for (let y = 0; y < height; y++) {
    paint(image, y, y + 1000);
  }

  return image;
};

/**
 * One frame of a scroll: the content from `source` starting at `scrolled`, with furniture above and below it that is
 * identical on every frame, which is what a correlation over the whole frame would lock on to.
 *
 * Each row of furniture is seeded by where it is rather than which end it belongs to, so a row placed twice can be
 * found twice — seeded alike, a stitch repeating the whole furniture would read the same as one that took it once. The
 * seeds stay clear of `content`'s, so a furniture row standing where a content row belongs is wrong rather than
 * unlucky.
 */
const frameAt = (source: Image, scrolled: number): Image => {
  const image = blank(WIDTH, FRAME);
  const top = Math.round(FRAME * FURNITURE.above);
  const bottom = Math.round(FRAME * FURNITURE.below);

  for (let y = 0; y < top; y++) {
    paint(image, y, y);
  }

  for (let y = top; y < bottom; y++) {
    const from = scrolled + (y - top);
    image.data.set(source.data.subarray(from * WIDTH * 4, (from + 1) * WIDTH * 4), y * WIDTH * 4);
  }

  for (let y = bottom; y < FRAME; y++) {
    paint(image, y, y);
  }

  return image;
};

test('the shift between two frames is the number of pixels the content moved', () => {
  const source = content(2000);

  for (const shift of [1, 17, 100, 193]) {
    expect(offsetBetween(frameAt(source, 0), frameAt(source, shift), BAND), `a scroll of ${shift}`).toBe(shift);
  }
});

/**
 * A screen that did not move, which is how a scroll says it has reached the end. **Zero** rather than null, and the
 * difference is the point: zero is a measurement where null is this reader saying it cannot tell.
 *
 * It might be expected to be refused, identical frames seeming to score alike everywhere. They do not — a shift of
 * zero scores exactly nought and everything else the full width of the content — so it stands out further than any
 * real scroll.
 */
test('two identical frames have not moved, which is a shift of zero', () => {
  const frame = frameAt(content(2000), 40);

  expect(offsetBetween(frame, frame, BAND)).toBe(0);
});

/**
 * Content with nothing in it to line up, which is the failure mode a real screen has and a hashed fixture does not: a
 * band of flat colour matches itself at every shift equally well, so no candidate stands out and the honest answer is
 * that this cannot be told. A reader that picked the least-bad of an indistinguishable field would assemble a capture
 * of something that was never on the screen.
 */
test('a band with nothing to line up on is refused', () => {
  const flat = blank(WIDTH, 2000);
  flat.data.fill(200);

  expect(offsetBetween(frameAt(flat, 0), frameAt(flat, 60), BAND)).toBe(null);
});

/**
 * Frames sharing too little of the band to be sure. A scroll that moved most of a screen leaves a sliver to correlate,
 * and the least-bad candidate of a bad field is a guess — so this refuses rather than answering it.
 */
test('frames that barely overlap are refused rather than guessed at', () => {
  const source = content(2000);
  const band = Math.round(FRAME * BAND.to) - Math.round(FRAME * BAND.from);

  expect(offsetBetween(frameAt(source, 0), frameAt(source, band), BAND), 'no overlap at all').toBe(null);
  expect(offsetBetween(frameAt(source, 0), frameAt(source, band - 10), BAND), 'ten rows of overlap').toBe(null);
});

test('frames of different sizes cannot be lined up', () => {
  expect(offsetBetween(blank(WIDTH, FRAME), blank(WIDTH + 1, FRAME), BAND)).toBe(null);
});

/** The shifts between each consecutive pair, as a capture measures them while it scrolls. */
const offsetsOf = (frames: readonly Image[]) =>
  frames.slice(1).map((frame, i) => offsetBetween(frames[i] as Image, frame, BAND));

/**
 * The round trip, and the assertion the rest of this file exists to set up: frames cut from a tall image at known
 * offsets must be measured at those offsets and stitch back into exactly the rows they were cut from, with the
 * furniture appearing once.
 */
test('frames cut from a tall image stitch back into it', () => {
  const source = content(2000);
  const shifts = [150, 150, 150];
  const frames = shifts.reduce<number[]>((at, s) => [...at, (at.at(-1) ?? 0) + s], [0]).map((s) => frameAt(source, s));

  expect(offsetsOf(frames)).toStrictEqual(shifts);

  const image = stitch(frames, shifts, BAND);

  const top = Math.round(FRAME * BAND.from);
  const bottom = Math.round(FRAME * BAND.to);
  expect(image.height, 'the stitch is not as tall as the rows it was given').toBe(
    FRAME + shifts.reduce((a, b) => a + b, 0),
  );

  // The scrolled content, row for row against the image the frames were cut from.
  const wrong: string[] = [];

  for (let y = 0; y < bottom - top + shifts.reduce((a, b) => a + b, 0); y++) {
    for (const x of [0, 37, WIDTH - 1]) {
      const got = rgb(image, x, top + y);
      const want = rgb(source, x, y);

      if (got.join() !== want.join()) {
        wrong.push(`row ${y} column ${x}: ${got.join()} is not ${want.join()}`);
      }
    }
  }

  expect(wrong.slice(0, 5), 'the stitched content is not the content it was cut from').toStrictEqual([]);
});

/**
 * That the furniture appears once rather than once per frame, which is the failure a concatenation would have and the
 * one that is invisible in a height check — four frames concatenated are exactly as tall as this when the shifts happen
 * to be the band's height.
 */
test('the fixed furniture is taken once, from the first frame and the last', () => {
  const source = content(2000);
  const frames = [0, 120, 240].map((s) => frameAt(source, s));
  const image = stitch(frames, [120, 120], BAND);
  const top = Math.round(FRAME * BAND.from);
  const bottom = Math.round(FRAME * BAND.to);

  // Above the band: the status bar, once, and immediately against the scrolled content rather than repeated.
  expect(rgb(image, 10, 0), 'the row above the band is not the furniture').toStrictEqual(
    rgb(frames[0] as Image, 10, 0),
  );
  expect(rgb(image, 10, top - 1)).toStrictEqual(rgb(frames[0] as Image, 10, top - 1));
  expect(rgb(image, 10, top), 'the band does not start where the furniture ends').toStrictEqual(rgb(source, 10, 0));

  // Below it: the floating buttons, once, at the very bottom.
  const tail = image.height - (FRAME - bottom);
  expect(rgb(image, 10, tail)).toStrictEqual(rgb(frames[2] as Image, 10, bottom));
  expect(rgb(image, 10, image.height - 1)).toStrictEqual(rgb(frames[2] as Image, 10, FRAME - 1));

  // And the row before the furniture is still content, which is what says it was not appended early.
  expect(rgb(image, 10, tail - 1), 'the furniture starts before the content ends').toStrictEqual(
    rgb(source, 10, bottom - top + 240 - 1),
  );
});

/**
 * What a recorded `Viewport` does and does not buy, the obvious use of it being wrong: cropping to that height does
 * **not** give the screen back. Rows down to the band's foot are the first frame verbatim, the rows after it are the
 * next frame's revealed content, and the footer was appended at the far end.
 *
 * So the only crop that is the screen row for row stops at the foot, shorter than the screen by the footer, which
 * moves every reader anchored on a fraction of the height. Pinned because a comment claiming the viewport crop *was*
 * the screen is what this replaces, and prose was what let it be wrong.
 */
test('a stitch cropped to its viewport is the screen only as far as the band foot', () => {
  const source = content(2000);
  const frames = [0, 120, 240].map((s) => frameAt(source, s));
  const image = stitch(frames, [120, 120], BAND);
  const screen = frames[0] as Image;
  const bottom = Math.round(FRAME * BAND.to);

  /** The first row at which two images disagree, over three columns, or null where they agree throughout. */
  const divergence = (a: Image, b: Image, rows: number): number | null => {
    for (let y = 0; y < rows; y++) {
      for (const x of [0, 37, WIDTH - 1]) {
        if (rgb(a, x, y).join() !== rgb(b, x, y).join()) {
          return y;
        }
      }
    }

    return null;
  };

  // Cropped to the band's foot, every row is the screen's own — which is the identity the `Viewport` is good for.
  const toFoot = crop(image, 0, 0, image.width, bottom);

  expect([toFoot.width, toFoot.height]).toStrictEqual([WIDTH, bottom]);
  expect(divergence(toFoot, screen, bottom), 'the rows down to the band foot are not the screen verbatim').toBeNull();

  // Cropped to the viewport, it stops being the screen at exactly that foot rather than running to the bottom.
  expect(
    divergence(crop(image, 0, 0, image.width, FRAME), screen, FRAME),
    'the viewport crop is the screen past the band foot, so the furniture below it would read',
  ).toBe(bottom);

  // Because the screen's own footer sits at the far end of the tall image, not at the viewport's offset.
  expect(rgb(image, 10, image.height - (FRAME - bottom))).toStrictEqual(rgb(screen, 10, bottom));
});

/**
 * The band's bottom edge against the furniture's top, which a stitch cannot recover from getting wrong. Rows above the
 * band come from the first frame and rows below from the last, each taken once — but the **tail** of the band is the
 * one part every frame contributes, so a band reaching into the floating buttons repeats their top once per frame.
 *
 * `offsetBetween` says nothing about it, which is why this is asserted here rather than left to the shifts being
 * right: the rows it lines up on are the content either way.
 */
test('a band reaching past the furniture repeats it once per frame, where one clear of it does not', () => {
  const source = content(2000);
  const frames = [0, 120, 240].map((s) => frameAt(source, s));
  const shifts = [120, 120];

  // The furniture's first row, which no frame holds anywhere else, counted wherever it stands in the stitch.
  const row = Math.round(FRAME * FURNITURE.below);
  const columns = [0, 37, WIDTH - 1];
  const at = (image: Image, y: number) => columns.map((x) => rgb(image, x, y).join()).join('|');

  const copies = (image: Image) => {
    const want = at(frames[0] as Image, row);
    let found = 0;

    for (let y = 0; y < image.height; y++) {
      if (at(image, y) === want) {
        found++;
      }
    }

    return found;
  };

  expect(copies(stitch(frames, shifts, BAND)), 'a band clear of the furniture').toBe(1);
  expect(copies(stitch(frames, shifts, { ...BAND, to: FURNITURE.below + 0.05 })), 'a band reaching 20 rows in').toBe(
    frames.length,
  );
});

test('stitching nothing, or frames without a shift between each pair, is a mistake', () => {
  const frame = frameAt(content(2000), 0);

  expect(() => stitch([], [], BAND)).toThrow(/no frames/);
  expect(() => stitch([frame, frame], [], BAND)).toThrow(/2 frames and 0 shifts/);
});

/**
 * Captures of real detail screens, against `SCREEN_BAND` itself rather than a band written out again — the half the
 * built fixtures cannot reach, because what they lack is a **layout**. Every detail screen has the same panel, labels
 * and buttons, which is enough for one screen's row summaries to line up against another's.
 *
 * `pikachu.png` against `smoliv.png` is that case: their summaries line up at a shift of 114, which would be two
 * Pokémon assembled into one image. It is refused by how **close** the match is rather than how far it stands out — a
 * true scroll costs 0.00 where these two cost 16.82 at their best, the band being 70% flat panel grey.
 *
 * Read out of the stitch each is committed as. `screenIn` crops to the recorded `Viewport`, and the band this
 * exercises lies entirely in the rows `stitch` keeps from its first frame verbatim, so these frames are the screens
 * the phone drew to the pixel over every row anything below reads.
 */
const capture = (file: string) => screenIn(decodePng(readFileSync(new URL(`fixtures/${file}`, import.meta.url))));

/**
 * Where the game's floating buttons are, measured on `pikachu.png` and `smoliv.png` — which agree exactly, the buttons
 * being drawn over the panel rather than in it: rows 2028 to 2194 of 2244. The band has to end above them, and nothing
 * else here can say so, the frames above having no buttons to measure.
 */
const BUTTONS = 2028 / 2244;

test('the band a real detail screen scrolls in ends above the floating buttons', () => {
  expect(SCREEN_BAND.to).toBeLessThan(BUTTONS);
});

/** A real capture with its band slid up, which is what a scroll does while the status bar and overlay stay put. */
const slid = (image: Image, by: number): Image => {
  const out: Image = { width: image.width, height: image.height, data: new Uint8Array(image.data) };
  const stride = image.width * 4;
  const top = Math.round(image.height * SCREEN_BAND.from);
  const bottom = Math.round(image.height * SCREEN_BAND.to);

  for (let y = top; y < bottom; y++) {
    const from = Math.min(image.height - 1, y + by);
    out.data.set(image.data.subarray(from * stride, (from + 1) * stride), y * stride);
  }

  return out;
};

test('a real capture slid by a known amount reads back as that amount', () => {
  const screen = capture('pikachu.png');

  for (const by of [7, 60, 300, 700]) {
    expect(offsetBetween(screen, slid(screen, by), SCREEN_BAND), `slid ${by}`).toBe(by);
  }
});

test('a step is half the band, centred on it, down the middle of the screen', () => {
  expect(scrollStep({ from: 0.25, to: 0.75 }, 100, 1000)).toStrictEqual([
    [50, 625],
    [50, 375],
  ]);
});

/**
 * How far one step may move and still be lined up, on a real screen. The step reads back exactly, and so does the step
 * flung on past the finger as far as a Pixel 4 XL flung it at `SCROLL_DRAG_MS`, 1032 pixels for a drag of 836; half
 * the whole screen, which the scan once dragged to its moves, is past what `offsetBetween` looks for at all.
 */
test('a step is within reach even flung, and a swipe of half the screen is not', () => {
  const screen = capture('pikachu.png');
  const [from, to] = scrollStep(SCREEN_BAND, screen.width, screen.height);
  const step = Math.round(from[1] - to[1]);
  const flung = Math.round((step * 1032) / 836);

  expect(offsetBetween(screen, slid(screen, step), SCREEN_BAND), 'a step').toBe(step);
  expect(offsetBetween(screen, slid(screen, flung), SCREEN_BAND), 'a step flung').toBe(flung);
  expect(offsetBetween(screen, slid(screen, Math.round(screen.height / 2)), SCREEN_BAND), 'the swipe').toBe(null);
});

test('two different detail screens are refused rather than lined up', () => {
  expect(
    offsetBetween(capture('pikachu.png'), capture('smoliv.png'), SCREEN_BAND),
    'two Pokémon were lined up into one image',
  ).toBe(null);
});

/**
 * Two captures of the same species and layout, differing only in a glyph and some numbers. They have not scrolled, so
 * zero is the right answer — and it is what stops a walk that wandered onto another Pokémon from being stitched as a
 * scroll, the capture ending at the last frame that moved.
 */
test('two captures that share a screen but have not scrolled answer zero', () => {
  expect(offsetBetween(capture('unown-b.png'), capture('unown-m.png'), SCREEN_BAND)).toBe(0);
});
