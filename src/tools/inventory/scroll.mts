/**
 * The phone's screen taken as it settles: a screenshot of a screen that has stopped moving, which a fixed wait after a
 * swipe can only guess at. `dex` takes one for each Pokédex entry, reaching the phone only through a `Device`.
 */

import { type Device } from '../../core/adb.mts';
import { difference, type Image } from '../../core/png.mts';

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

/**
 * How long one drag of a scroll takes, in milliseconds. Slow, so that the content follows the finger rather than
 * flinging on past where it stopped. Measured on a Pixel 4 XL's 1440x3040, where one drag of the band is 836 pixels: at
 * `input swipe`'s own 300 the panel went on to 1484 and 1697, at 1000 it moved 966 to 1032, and at 2000 it moved 847,
 * margin this already has bought at a second a Pokémon.
 */
export const SCROLL_DRAG_MS = 1000;

/**
 * The column every scroll of a detail screen is dragged down, as a fraction of the screen's width: the panel's empty
 * left margin, which scrolls exactly as its middle does and holds no control at all.
 *
 * **A drag the phone drops arrives as a tap where it started.** Down the middle, that is the POWER UP or EVOLVE row on
 * most screens and on a scrolled panel, and a walk of 130 Pokémon opened the power-up dialog four times — one tap on
 * its own button from spending stardust, and an evolve prompt has a YES. Measured on the committed captures, at 1008
 * and 1440 wide alike, the panel's edge is at 0.026 of the width and every button, card and move row starts at 0.07 or
 * later; this sits between the two, at the 62 of 1440 a Pixel 4 XL was walked with. Not the right margin, which looks
 * the same but does not scroll at all.
 */
export const SCROLL_STRIP = 0.043;

/**
 * A screenshot of a screen that has stopped moving, which is what a fixed wait after a swipe can only guess at. The
 * cost is one extra screenshot where the screen was already still, and the gain is that a walk slowed down by anything
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
