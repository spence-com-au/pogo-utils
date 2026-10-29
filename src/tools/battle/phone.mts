/**
 * What the battle loop in `run.mts` drives the phone through rather than `adb`, so that a test can stand a scripted
 * phone in for a real one and a page one over WebUSB, and the one way both build it out of what reaches the phone. On
 * its own so that the page's, in `src/battle/phone.ts`, is held to it without reaching every module the loop does, some
 * of them still Node's.
 */

import { type Device } from '../inventory/adb.mts';
import { type Image } from '../inventory/png.mts';
import { replaceSearch } from '../inventory/storage.mts';
import { type Touchscreen } from '../inventory/touchscreen.mts';
import { type Point } from './play.mts';
import { type Screen } from './screen.mts';

export interface Phone {
  /** The latest frame of the stream, or `undefined` before the first. */
  frame(): Image | undefined;
  screenshot(): Promise<Image>;
  tap(at: Point): Promise<void>;
  swipe(from: Point, to: Point, ms: number): Promise<void>;

  /** A screenshot of what shows while `at` is held, taken mid-hold, the hold let go after. */
  hold(at: Point): Promise<Image>;

  /** `text` typed into whatever has focus, in place of whatever it held, and Enter pressed. */
  search(text: string): Promise<void>;
}

/**
 * How far into a hold of a Pokémon on the selection screen its panel is screenshot, in milliseconds. The panel goes as
 * the hold is let go, so the hold lasts until the screenshot is done, however long that takes: screenshots 1.8s into a
 * hold showed it on a Pixel 8 Pro.
 */
const PANEL_MS = 1_500;

/**
 * The phone as the loop plays through it: frames off `screen`, screenshots and typing through `device`, and touches
 * through `touch`. A hold screenshots what it shows as it goes on, a screenshot being a process of its own beside the
 * shell the touchscreen is held on.
 */
export function phoneOf(screen: Screen, device: Device, touch: Touchscreen): Phone {
  return {
    frame: () => screen.latest()?.image,
    screenshot: () => device.screenshot(),
    tap: (point) => touch.tap(point),
    swipe: (from, to, ms) => touch.swipe(from, to, ms),
    hold: async (point) => {
      await touch.down(point);

      try {
        await new Promise((resolve) => setTimeout(resolve, PANEL_MS));

        return await device.screenshot();
      } finally {
        await touch.up(point);
      }
    },
    search: (text) => replaceSearch(device, text),
  };
}
