/**
 * Each side's HP read off committed frames, against the fill's length measured by hand on the bar's middle row as a
 * share of the distance from its start to the outline at its right. `shield-low`, `battle-one-shield` and
 * `battle-shields-spent` are screenshots of a GO Battle League run scaled down to the stream's 360 wide; the rest are
 * stream frames.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { decodePng } from '../inventory/png.mts';
import { readHealth, Steady } from './health.mts';

const read = (name: string) => readHealth(decodePng(readFileSync(new URL(`fixtures/${name}.png`, import.meta.url))));

const within = (read: number | null, expected: number) => read !== null && Math.abs(read - expected) <= 0.05;

test.each([
  // At a shield prompt, which is where the HP left is wanted: yellow, green and both sides red.
  ['shield-glaceon', 0.31, 0.59],
  ['shield-sneasel', 0.78, 0.99],
  ['shield-pixel8', 0.8, 0.91],
  ['shield-low', 0.09, 0.06],

  // Latias's cyan ring over both bars, and the opponent's yellow above Entei.
  ['battle-latias', 0.53, 0.77],
  ['battle-crunch-entei', 0.63, 0.28],
  ['battle-one-shield', 0.74, 0.51],

  // The opponent's red at 4 pixels, behind its orange trail.
  ['charged-shadow-sneak', 0.59, 0.04],
  ['charged-two-right', 0.67, 0.42],
])('%s: %f of ours left and %f of theirs', (name, own, opponent) => {
  const health = read(name);

  expect(within(health.own, own), `ours read ${health.own}`).toBe(true);
  expect(within(health.opponent, opponent), `theirs read ${health.opponent}`).toBe(true);
});

/**
 * Frames whose bars are not there to read, or not told whose: the minigame draws none, the camera on our Charizard
 * leaves both off the screen, and the shield going up centres ours where neither side's bar starts.
 */
test.each(['battle-minigame-kyogre-great', 'battle-minigame-mewtwo', 'battle-shields-spent', 'battle-shield-going-up'])(
  '%s: reads neither',
  (name) => {
    expect(read(name)).toEqual({ own: null, opponent: null });
  },
);

test('a bar whose left end is hidden goes unread rather than read short', () => {
  // The favourites star sits over our bar's left end, and the outline there that a bar is told by.
  const health = read('battle-night');

  expect(health.own).toBeNull();
  expect(within(health.opponent, 0.99)).toBe(true);
});

test('a bar whose right end is hidden goes unread rather than read short', () => {
  // The G of the "GO!" opening a battle over our full bar, which read 68% to where the letter starts.
  const health = read('battle-go');

  expect(health.own).toBeNull();
  expect(within(health.opponent, 0.98)).toBe(true);
});

test.each([
  // The countdown's 2 across the middle of the opponent's full bar, read 22% to where the digit starts, its fill
  // showing again beyond it; and its 1 over the bar's left end, read 78% from where the digit stops to the outline.
  ['battle-countdown-two', 0.98],
  ['battle-countdown-one', 0.98],
])('%s: a bar cut short by something drawn across it goes unread, ours %f', (name, own) => {
  const health = read(name);

  expect(within(health.own, own), `ours read ${health.own}`).toBe(true);
  expect(health.opponent).toBeNull();
});

/** The HP `Steady` decides on after each of `readings`, each `[own, opponent]`. */
function steadied(readings: readonly [number | null, number | null][]): [number | null, number | null][] {
  const steady = new Steady();

  return readings.map(([own, opponent]) => {
    steady.read({ own, opponent });

    return [steady.health.own, steady.health.opponent];
  });
}

test('a jump read once, between steady readings, never moves the HP decided on', () => {
  // As read live: Entei at 14% for a frame among 98–100%, and Dialga's and Charizard's bars flickering low.
  expect(
    steadied([
      [0.99, 0.8],
      [0.14, 0.04],
      [0.98, 0.8],
      [0.02, 0.04],
      [0.97, 0.8],
    ]),
  ).toEqual([
    [0.99, 0.8],
    [0.99, 0.8],
    [0.98, 0.8],
    [0.98, 0.8],
    [0.97, 0.8],
  ]);
});

test('a jump read again stands, as a charged move’s hit and a newcomer’s bar do', () => {
  expect(
    steadied([
      [0.87, 0.02],
      [0.09, 0.86],
      [0.09, 0.85],
      [0.08, 0.84],
    ]),
  ).toEqual([
    [0.87, 0.02],
    [0.87, 0.02],
    [0.09, 0.85],
    [0.08, 0.84],
  ]);
});

test('a bar not drawn keeps both the HP decided on and the jump awaiting a second reading', () => {
  expect(
    steadied([
      [0.87, null],
      [0.09, null],
      [null, null],
      [0.1, 0.5],
    ]),
  ).toEqual([
    [0.87, null],
    [0.87, null],
    [0.87, null],
    [0.1, 0.5],
  ]);
});

test('a side forgotten takes its next reading as it comes', () => {
  const steady = new Steady();

  steady.read({ own: 0.2, opponent: 0.5 });
  steady.forget('own');
  steady.read({ own: 1, opponent: 0.5 });

  expect(steady.health).toEqual({ own: 1, opponent: 0.5 });
});
