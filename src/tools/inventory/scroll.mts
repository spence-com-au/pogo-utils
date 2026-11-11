/**
 * The phone's screen taken as it settles and as it scrolls: a screenshot of a screen that has stopped moving, every
 * frame of a detail screen dragged down to its foot, and the drag back up by what was measured. `pnpm inventory scan`
 * takes these for the moves and `snap` for the whole screen, reaching the phone only through a `Device`.
 */

import { type Device } from '../../core/adb.mts';
import { type Config, type Point } from './config.mts';
import { difference, type Image } from '../../core/png.mts';
import { offsetBetween, scrollStep } from './stitch.mts';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The band a screen is watched for movement in: the game's own panel, since the artwork above it holds an animated
 * Pokémon that never stops and the status bar ticks with the clock.
 */
const SETTLE_BAND = { from: 0.34, to: 0.95 };
export const SETTLE_ATTEMPTS = 4;

/**
 * How still a screen has to be to count as settled: no more than `share` of `SETTLE_BAND` changing between two
 * screenshots running, a pixel changing where a channel moves by more than `by`.
 */
export interface Stillness {
  by: number;
  share: number;
}

/** A detail screen's panel, measured through one swipe: 31%, then 6.2%, then 0.54% and steady. */
const PANEL: Stillness = { by: 8, share: 0.02 };

/** How many frames one `--scroll` may take before it is a loop rather than a screen. */
const SCROLL_FRAMES = 12;

/**
 * How long one drag of a scroll takes, in milliseconds. Slow, so that the content follows the finger rather than
 * flinging on past where it stopped and out of `offsetBetween`'s reach. Measured with a `scrollStep` on a Pixel 4 XL's
 * 1440x3040, where the step is 836 pixels and the reach 1254: at `input swipe`'s own 300 the panel went on to 1484 and
 * 1697, at 1000 it moved 966 to 1032, and at 2000 it moved 847, margin this already has bought at a second a Pokémon.
 */
export const SCROLL_DRAG_MS = 1000;

/**
 * A screenshot of a screen that has stopped moving, which is what a fixed wait after a swipe can only guess at. The
 * cost is one extra screenshot where the screen was already still, and the gain is that a scan slowed down by anything
 * — a phone thinking, an animation that ran long — waits for it rather than reading through it. Still as a detail
 * screen's panel is unless told otherwise: a screen whose backdrop moves of itself never is, by that measure, and pays
 * for every attempt instead.
 */
export async function settled(device: Device, { by, share }: Stillness = PANEL): Promise<Image> {
  let previous = await device.screenshot();

  for (let attempt = 1; attempt < SETTLE_ATTEMPTS; attempt++) {
    const image = await device.screenshot();

    if (difference(previous, image, SETTLE_BAND.from, SETTLE_BAND.to, by) < share) {
      return image;
    }

    previous = image;
  }

  return previous;
}

/** What a scroll capture took, and what `stitch` and the way back up need from it. */
export interface Capture {
  frames: Image[];

  /** The shift between each consecutive pair, as `stitch` takes them, and what they sum to is the way back up. */
  offsets: number[];

  /** Whether it stopped on two frames that would not line up, rather than on reaching the end. */
  lost: boolean;
}

/**
 * Every frame of the screen from here to its bottom, dragging half the scrolling band at a time — `SCROLL_STEP`, kept
 * within what `offsetBetween` looks for — and waiting for each frame to settle. Stops on a frame that has not moved,
 * which is what reaching the end looks like; on one that will not line up, which is left out; or at `SCROLL_FRAMES`,
 * so a screen that never stops moving is a short capture rather than a scan that does not come back.
 *
 * It does not scroll back up: `scrollUp` does, by what the offsets sum to. The last drag always moved nothing, so what
 * it dragged is no part of the way back.
 *
 * `taken` stands in for the first frame, so the stitch holds the screen the caller already has rather than a second
 * photograph of it — shot twice seconds apart, the two differ over about half their rows as the artwork animates and
 * PGSharp redraws. What it buys is one identity: `crop(stitch, 0, 0, width, bandFoot)` is that screen row for row.
 *
 * **It is the one frame not waited for, so the caller owes it** still being what the phone is showing. A stale one
 * does not corrupt the stitch quietly: `offsetBetween` refuses the pair, so `lost` comes back true and the capture is
 * one frame long.
 */
export async function scrollFrames(
  device: Device,
  { scrollBand }: Pick<Config, 'scrollBand'>,
  taken?: Image,
): Promise<Capture> {
  const first = taken ?? (await settled(device));
  const [from, to] = scrollStep(scrollBand, first.width, first.height);
  const frames = [first];
  const offsets: number[] = [];

  while (frames.length < SCROLL_FRAMES) {
    await device.swipe(from, to, SCROLL_DRAG_MS);
    const next = await settled(device);
    const moved = offsetBetween(frames.at(-1) as Image, next, scrollBand);

    if (moved === null) {
      return { frames, offsets, lost: true };
    }

    if (moved === 0) {
      break;
    }

    frames.push(next);
    offsets.push(moved);
  }

  return { frames, offsets, lost: false };
}

/**
 * Back up the screen by `pixels`, which is the distance it was measured to have scrolled. `screen` is any screenshot,
 * for its size.
 *
 * **A drag longer than the screen has scrolled does not stop at the top.** Once the content is there the game reads
 * the rest of the finger's travel as a swipe to dismiss and closes the panel, so asking for more than was scrolled
 * ends on the map and the swipe to the next Pokémon lands on nothing. One drag covers 0.55 of the height where a
 * detail screen scrolls 711 pixels of 2244, so a swipe per drag asked for roughly three times too much.
 *
 * Undershooting is the safe direction, the panel resetting when the game draws the next Pokémon. That is the scan's
 * invariant and not every caller's — one with no next Pokémon has to measure what is left and ask again, as `snap`
 * does.
 */
export async function scrollUp(
  device: Device,
  { swipes, waits }: Pick<Config, 'swipes' | 'waits'>,
  screen: Image,
  pixels: number,
) {
  if (pixels <= 0) {
    return;
  }

  const [from, to] = swipes.scrollUp.map(([x, y]): Point => [x * screen.width, y * screen.height]) as [Point, Point];
  const reach = to[1] - from[1];

  // As few drags as the configured swipe reaches in, each an equal share, one drag covering only what fits on screen.
  const drags = Math.ceil(pixels / reach);
  const part = pixels / drags / reach;
  const end: Point = [from[0] + (to[0] - from[0]) * part, from[1] + reach * part];

  for (let i = 0; i < drags; i++) {
    // At the capture's own drag speed, and for its reason: a quick drag flings on past where the finger stopped, which
    // on the way back means landing above what `pixels` asked for and spending the overshoot on the dismiss gesture.
    await device.swipe(from, end, SCROLL_DRAG_MS);
    await sleep(waits.scroll);
  }
}
