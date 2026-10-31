/**
 * One tall image out of several screenshots taken while scrolling, which is the only way to see a screen longer than
 * the phone all at once.
 *
 * **Not everything on the screen scrolls, and that is the whole problem.** The status bar ticks, PGSharp draws its
 * overlay *over* the app rather than in it, and the game's round buttons float above the panel. Correlating two frames
 * over the whole screen therefore finds the shift that keeps the furniture still — zero — rather than the one that
 * lines the content up, so the caller names the band that does scroll.
 *
 * **It answers with the content once and the furniture once**: rows above the band from the first frame, rows below
 * from the last, and the band itself the first frame's worth plus whatever each later frame revealed.
 *
 * **It refuses rather than guesses.** `offsetBetween` takes the best shift only where it is clearly better than the
 * field, so frames overlapping too little answer null and the capture stops with what it has. A short capture is
 * obvious to whoever looks at it, where one silently assembled at the wrong offset is a screenshot of something that
 * was never on the screen.
 */

import { rgb, type Image } from './png.mts';

/** The fractions of a frame's height that scroll, which is the region the game draws its own content in. */
export interface Band {
  from: number;
  to: number;
}

/**
 * The band a detail screen scrolls in, measured off the captures committed beside this file — every one of them
 * 1008x2244. The panel's top edge is at row 722, and the game's floating buttons, which are drawn *over* the panel
 * rather than in it, run from row 2028 to row 2194: 0.9037 to 0.9777.
 *
 * The bottom edge clears the top of those buttons rather than meeting it. A band that reaches even a few rows into them
 * does not fail the correlation — the rows it lines up on are the content, and they line up — it repeats those rows
 * once per frame, since the tail of the band is the one part of it every frame contributes. The symptom is a copy of
 * the buttons' top cut off exactly at the band's own bottom edge, once per frame: a stitch that looks almost right.
 */
export const SCREEN_BAND: Band = { from: 0.34, to: 0.89 };

/**
 * How much of the band two frames have to share before a shift is believed. A quarter, because a scroll that moved more
 * than three-quarters of a screen has no overlap worth correlating and the answer would be the least-bad of a field of
 * equally bad ones.
 */
const MIN_OVERLAP = 0.25;

/**
 * How much of the band one step of a scroll capture should move, and the scan's one swipe to the moves, which has to
 * stay inside what `offsetBetween` will look for. Half, against the three-quarters `MIN_OVERLAP` leaves, so the step
 * can overshoot by half again before a pair is refused: a drag is not exact, and a fast one flings past where the
 * finger stopped.
 */
export const SCROLL_STEP = 0.5;

/**
 * Where one step's drag starts and ends on a screen this size, in pixels: `SCROLL_STEP` of the band, centred on it,
 * down the middle of the screen. Derived from the band rather than configured beside it, because what it has to stay
 * within is `offsetBetween`'s reach over that same band, and a drag set as a fraction of the whole screen is a fraction
 * of a different length on every phone.
 */
export function scrollStep(band: Band, width: number, height: number): [[number, number], [number, number]] {
  const y = (through: number) => height * (band.from + (band.to - band.from) * through);

  return [
    [width / 2, y(0.5 + SCROLL_STEP / 2)],
    [width / 2, y(0.5 - SCROLL_STEP / 2)],
  ];
}

/**
 * How much better than the field the best shift has to score. The same shape as the artwork match's margin and for the
 * same reason: this is a comparison and not a threshold, so what matters is whether one candidate stands out rather
 * than whether it is good in the absolute — a frame of a dark screen scores well everywhere.
 */
const MARGIN = 1.4;

/** Every nth column and row, which is what the per-row summaries and the confirmation below are built from. */
const COLUMN_STEP = 8;
const ROW_STEP = 4;

/**
 * How much two frames of one scroll may still differ where they overlap. Measured: a true scroll is 0.00 and the
 * closest two different screens come is 16.82, so this sits in the gap rather than near either end.
 */
const MATCH_CEILING = 8;

/**
 * What two frames actually cost each other at one shift, pixel against pixel rather than summary against summary.
 * Sampled, because this runs ten times and not a thousand.
 */
function pixelCost(a: Image, b: Image, band: Band, shift: number): number {
  const { top, bottom } = rows(a, band);
  const overlap = bottom - top - shift;

  if (overlap <= 0) {
    return Infinity;
  }

  let total = 0;
  let counted = 0;

  for (let y = 0; y < overlap; y += ROW_STEP) {
    for (let x = 0; x < a.width; x += COLUMN_STEP) {
      total += Math.abs(rgb(a, x, top + shift + y)[0] - rgb(b, x, top + y)[0]);
      counted++;
    }
  }

  return counted === 0 ? Infinity : total / counted;
}

const rows = (image: Image, band: Band) => ({
  top: Math.max(0, Math.round(image.height * band.from)),
  bottom: Math.min(image.height, Math.round(image.height * band.to)),
});

/**
 * Two numbers per row of the band: how bright it is on average, and how much it changes along its own length. The
 * second is what tells a row of text from a row of gap between two lines that happen to average the same.
 *
 * Summarising first is what makes searching every shift affordable, and searching every shift is not optional. A coarse
 * pass at every eighth pixel and a fine pass around its answer is the obvious economy and it does not work here: rows
 * of a screen are distinct, so the cost of a shift is a spike at the right answer and flat either side of it, and a
 * stride of eight steps over that spike seven times in eight, missing a scroll of one pixel outright. Against summaries
 * the whole range is about a million operations rather than the forty-odd million a full two-dimensional search would
 * be.
 */
function profile(image: Image, band: Band): { mean: Float64Array; rough: Float64Array } {
  const { top, bottom } = rows(image, band);
  const mean = new Float64Array(bottom - top);
  const rough = new Float64Array(bottom - top);

  for (let y = top; y < bottom; y++) {
    let total = 0;
    let change = 0;
    let counted = 0;
    let last: number | null = null;

    for (let x = 0; x < image.width; x += COLUMN_STEP) {
      const value = rgb(image, x, y)[0];
      total += value;
      change += last === null ? 0 : Math.abs(value - last);
      last = value;
      counted++;
    }

    mean[y - top] = total / Math.max(1, counted);
    rough[y - top] = change / Math.max(1, counted);
  }

  return { mean, rough };
}

/**
 * How far `b` has scrolled past `a`, in pixels, or null where no shift stands out. Positive, because the content moves
 * **up** as a finger drags the screen down: what sat at row `y + shift` in `a` sits at row `y` in `b`.
 */
export function offsetBetween(a: Image, b: Image, band: Band): number | null {
  if (a.width !== b.width || a.height !== b.height) {
    return null;
  }

  const first = profile(a, band);
  const second = profile(b, band);
  const height = first.mean.length;
  const furthest = Math.floor(height * (1 - MIN_OVERLAP));

  if (furthest < 1) {
    return null;
  }

  const scores: number[] = [];
  let best = 0;

  for (let shift = 0; shift <= furthest; shift++) {
    const overlap = height - shift;
    let total = 0;

    for (let y = 0; y < overlap; y++) {
      total +=
        Math.abs((first.mean[y + shift] ?? 0) - (second.mean[y] ?? 0)) +
        Math.abs((first.rough[y + shift] ?? 0) - (second.rough[y] ?? 0));
    }

    const value = total / overlap;
    scores.push(value);

    if (value < (scores[best] ?? Infinity)) {
      best = shift;
    }
  }

  // The field this has to stand out from, taken as the median of every shift scored rather than as the runner-up: on a
  // real screen the shifts either side of the right answer are nearly as good as it is, so a runner-up margin would
  // reject every correct answer.
  //
  // A band of flat colour is what this refuses: every shift matches it equally well, so the best is the median and
  // nothing stands out. A screen that has not moved at all is the opposite case and answers zero, which is a
  // measurement rather than a refusal — a capture stops on both, but only one of them is a fact about the screen.
  const sorted = [...scores].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)] ?? Infinity;

  if ((scores[best] ?? Infinity) * MARGIN >= median) {
    return null;
  }

  // And then the pixels, because the summaries above are not evidence enough on their own. Two **different** detail
  // screens share a layout — the same panel, the same rows of labels, the same buttons — so one's row summaries line up
  // against the other's at some shift and nothing in the search above can tell that from a scroll.
  //
  // What separates them is not how far the winner stands out but how **close** it is, and this is the one place here an
  // absolute figure is the right tool: two frames of a scroll are two screenshots of the same pixels, so where they
  // correspond they are identical rather than merely similar. Measured over a real 1008x2244 capture, with the band 70%
  // flat panel grey: a true scroll costs **0.00** at its shift and about 30 at any other, where `pikachu.png` against
  // `smoliv.png` costs **16.82** at its best, a shift of 114 that the search above alone would accept. The ceiling sits
  // in that gap, far below the 16 and well above the 0.
  //
  // What would move it is a screenshot that is not lossless or an animation reaching inside the band, and the symptom
  // would be a scroll that refuses rather than one that assembles the wrong rows. That is the direction to fail in.
  return pixelCost(a, b, band, best) <= MATCH_CEILING ? best : null;
}

/**
 * The frames joined into one tall image, given the shift between each consecutive pair as the capture measured it —
 * taken rather than worked out again, so the capture's rule for which frames count is the only one. The first frame
 * contributes everything above the band and its whole band; the ones after it contribute only the rows they revealed;
 * the last contributes everything below.
 */
export function stitch(frames: readonly Image[], offsets: readonly number[], band: Band): Image {
  const [first] = frames;

  if (!first) {
    throw new Error('stitch was given no frames');
  }

  if (offsets.length !== frames.length - 1) {
    throw new Error(`stitch was given ${frames.length} frames and ${offsets.length} shifts between them`);
  }

  const { top, bottom } = rows(first, band);
  const last = frames.at(-1) as Image;
  const height = first.height + offsets.reduce((a, b) => a + b, 0);
  const data = new Uint8Array(first.width * height * 4);
  const image: Image = { width: first.width, height, data };

  const place = (source: Image, from: number, rowCount: number, at: number) => {
    const stride = source.width * 4;
    data.set(source.data.subarray(from * stride, (from + rowCount) * stride), at * stride);
  };

  // Everything above the band, which is the status bar and whatever is drawn over the app rather than in it, taken from
  // the first frame alone.
  place(first, 0, top, 0);
  place(first, top, bottom - top, top);

  let at = bottom;

  for (const [i, shift] of offsets.entries()) {
    place(frames[i + 1] as Image, bottom - shift, shift, at);
    at += shift;
  }

  // And everything below the band, from the last frame — the game's floating buttons, which would otherwise be repeated
  // once per frame.
  place(last, bottom, first.height - bottom, at);

  return image;
}
