/**
 * The screen taken as it settles, against a phone that is recordings: its screenshots move on however often it is
 * photographed, so `settled` has to read the same one twice to take it.
 */

import { Device } from '../../core/adb.mts';
import { encodePng, type Image } from '../../core/png.mts';
import { SETTLE_ATTEMPTS, settled } from './scroll.mts';
import { expect, test } from 'vitest';

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
