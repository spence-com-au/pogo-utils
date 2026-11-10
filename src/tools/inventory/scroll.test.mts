/**
 * The screen taken as it settles and as it scrolls, against phones that are recordings: one whose screenshots move on
 * however often it is photographed, and one `scrolling` through a detail screen and the moves below it.
 */

import { Device } from '../../core/adb.mts';
import { DEFAULTS, type Config } from './config.mts';
import { decodePng, encodePng, type Image } from '../../core/png.mts';
import { SETTLE_ATTEMPTS, scrollFrames, scrollUp, settled } from './scroll.mts';
import { offsetBetween } from './stitch.mts';
import { scrolling } from './test-phone.mts';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

/** `DEFAULTS` with nothing waited for, a recording having no animation to let settle. */
const CONFIG: Config = { ...DEFAULTS, waits: { launch: 0, tap: 0, swipe: 0, scroll: 0, menu: 0, search: 0 } };

const capture = (file: string) => decodePng(readFileSync(new URL(`fixtures/${file}`, import.meta.url)));

const DETAIL = capture('moves/elgyem-detail.png');
const MOVES = capture('moves/elgyem-moves.png');

/** A screen of one shade all over, which differs from any other shade over the whole of the band `settled` watches. */
const shade = (grey: number): Image => ({
  width: 10,
  height: 100,
  data: new Uint8Array(10 * 100 * 4).map((_, i) => (i % 4 === 3 ? 255 : grey)),
});

/** A phone that answers each screenshot with the next of `shots`, the last again once they run out. */
function photographed(shots: readonly Image[]) {
  const pngs = shots.map((shot) => encodePng(shot));
  let taken = 0;

  const device = new Device({
    state: async () => 'device',
    shell: async () => new Uint8Array(),
    screencap: async () => pngs[Math.min(taken++, pngs.length - 1)] ?? expect.unreachable('no screens'),
  });

  return { device, taken: () => taken };
}

test('a screen is taken once it reads the same twice running', async () => {
  const still = shade(200);
  const { device, taken } = photographed([shade(0), shade(100), still, still]);

  expect(await settled(device)).toStrictEqual(still);
  expect(taken()).toBe(4);
});

test('a screen that never stops moving is taken as it last was, after `SETTLE_ATTEMPTS` screenshots', async () => {
  const shots = Array.from({ length: SETTLE_ATTEMPTS + 2 }, (_, i) => shade(i * 40));
  const { device, taken } = photographed(shots);

  expect(await settled(device)).toStrictEqual(shots[SETTLE_ATTEMPTS - 1]);
  expect(taken()).toBe(SETTLE_ATTEMPTS);
});

test('a screen that only shimmers settles by a coarser measure, and never by the panel one', async () => {
  const shimmering = Array.from({ length: SETTLE_ATTEMPTS + 2 }, (_, i) => shade(i % 2 === 0 ? 100 : 110));
  const panel = photographed(shimmering);
  const coarse = photographed(shimmering);

  await settled(panel.device);
  expect(await settled(coarse.device, { by: 32, share: 0.005 })).toStrictEqual(shimmering[1]);
  expect([panel.taken(), coarse.taken()]).toStrictEqual([SETTLE_ATTEMPTS, 2]);
});

test('a scroll capture takes each frame down to one that did not move, and does not scroll back', async () => {
  const { device, swipes } = scrolling([DETAIL, MOVES]);
  const taken = await scrollFrames(device, CONFIG, DETAIL);

  expect(taken).toStrictEqual({
    frames: [DETAIL, MOVES],
    offsets: [offsetBetween(DETAIL, MOVES, CONFIG.scrollBand)],
    lost: false,
  });

  expect(swipes.map(({ way }) => way)).toStrictEqual(['up', 'up']);
});

test('a scroll capture stops at a frame that will not line up, and leaves it out', async () => {
  const { device } = scrolling([DETAIL, capture('dialog/sableye-mega-level.png')]);

  expect(await scrollFrames(device, CONFIG, DETAIL)).toStrictEqual({ frames: [DETAIL], offsets: [], lost: true });
});

/** The drags `scrollUp` makes to go `pixels` back up a Pixel 4 XL's screen. */
async function back(pixels: number) {
  const { device, swipes } = scrolling([DETAIL]);

  await scrollUp(device, CONFIG, DETAIL, pixels);

  return swipes;
}

test.for([1000, 1672, 4000])(
  'back up %d pixels in as few equal drags as reach it, none dragging further than the configured swipe',
  async (pixels) => {
    const [from, to] = CONFIG.swipes.scrollUp;
    const reach = ((to?.[1] ?? 0) - (from?.[1] ?? 0)) * DETAIL.height;
    const swipes = await back(pixels);

    expect(swipes.length).toBe(Math.ceil(pixels / reach));
    expect(swipes.every(({ way, by }) => way === 'down' && by <= Math.ceil(reach))).toBe(true);
    expect(Math.abs(swipes.reduce((sum, { by }) => sum + by, 0) - pixels)).toBeLessThanOrEqual(swipes.length);
  },
);

test('nothing scrolled is nothing to scroll back', async () => {
  expect(await back(0)).toStrictEqual([]);
});
