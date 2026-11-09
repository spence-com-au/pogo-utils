/**
 * Each side's HP read off committed frames, against the fill's length measured by hand on the bar's middle row as a
 * share of the distance from its start to the outline at its right. `shield-low`, `battle-one-shield` and
 * `playing-shields-spent` are screenshots of a GO Battle League run scaled down to the stream's 360 wide; the rest are
 * stream frames.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { decodePng, type Image } from '../../core/png.mts';
import { readHealth, Steady } from './health.mts';

const read = (name: string) => readHealth(decodePng(readFileSync(new URL(`fixtures/${name}.png`, import.meta.url))));

const within = (measured: number | null, expected: number) =>
  measured !== null && Math.abs(measured - expected) <= 0.05;

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

  // Red foliage of the autumn map just left of our bar's outline, which read as our bar at 2% beside it.
  ['charged-pixel8-xerneas-not-very-effective', 0.67, 0.52],

  // Red foliage between the letters of "NOT VERY EFFECTIVE..." just above our bar, which read as it at 3%, taking the
  // bar's outline below it for its own; and just left of the bar, where one of its 2 pixels' shading passed for the
  // outline, at 2%.
  ['other-pixel8-countdown-xerneas-foliage', 0.43, 0.24],
  ['playing-pixel8-xerneas-foliage', 0.6, 0.98],

  // Our bar swept up the screen, the left end of its fill's bottom row blurred pale, which split the fill into strips
  // too thin to read and left the foliage between the letters above it read as it at 3%.
  ['other-pixel8-xerneas-sweep', 0.43, 0.22],
])('%s: %f of ours left and %f of theirs', (name, own, opponent) => {
  const health = read(name);

  expect(within(health.own, own), `ours read ${health.own}`).toBe(true);
  expect(within(health.opponent, opponent), `theirs read ${health.opponent}`).toBe(true);
});

/**
 * Frames whose bars are not there to read, or not told whose: the minigame draws none, the camera on our Charizard
 * leaves both off the screen, and the shield going up centres ours where neither side's bar starts.
 */
test.each([
  'playing-minigame-kyogre-great',
  'playing-minigame-mewtwo',
  'playing-shields-spent',
  'playing-shield-going-up',
])('%s: reads neither', (name) => {
  expect(read(name)).toEqual({ own: null, opponent: null });
});

test('artwork inside a bar where its fill has gone leaves the bar read', () => {
  // Red painted where the opponent's 42% has gone, inside the outline, as their own artwork, PGSharp's star and the
  // orange trail's red end lie there: unlike foliage left of a bar, it starts past a fill the outline runs over.
  const image = decodePng(readFileSync(new URL('fixtures/charged-two-right.png', import.meta.url)));

  for (let y = 282; y < 288; y++) {
    for (let x = 236; x < 242; x++) {
      image.data.set([230, 100, 100], (y * image.width + x) * 4);
    }
  }

  expect(within(readHealth(image).opponent, 0.42)).toBe(true);
});

test.each([
  // The favourites star sits over our bar's left end, and the outline there that a bar is told by.
  ['battle-night', 0.99],

  // PGSharp's star over the left end of our bar at 56%, read 44% from where its fill shows past the star, beside the
  // star's edge, which passes for the outline over 1 of its 2 pixels.
  ['battle-pixel8-palkia-star', 0.66],
])('%s: a bar whose left end is hidden goes unread rather than read short, theirs %f', (name, opponent) => {
  const health = read(name);

  expect(health.own).toBeNull();
  expect(within(health.opponent, opponent), `theirs read ${health.opponent}`).toBe(true);
});

test('foliage between the letters, further above our bar, is not read as it', () => {
  // Red foliage between the letters of "NOT VERY EFFECTIVE..." near their top, 10 rows above our bar at 63%, which
  // read as it at 3%; the opponent's bar is not drawn while it sends in Garchomp.
  const health = read('charged-pixel8-xerneas-foliage-high');

  expect(within(health.own, 0.63), `ours read ${health.own}`).toBe(true);
  expect(health.opponent).toBeNull();
});

test('foliage split as a bar sweeping by is, beside a bar found whole, is not read as it', () => {
  // Red foliage slanting across four rows just left of Lugia's bar at 76%, split in two and joined again, which read as
  // the bar at 6%.
  const health = read('battle-lugia-foliage-split');

  expect(within(health.opponent, 0.76), `theirs read ${health.opponent}`).toBe(true);
});

test('a bar just above another is read rather than taken for artwork', () => {
  // As our Avalanche starts, Sylveon's bar at 22% above our Kyogre's at 53%, both where the opponent's bar starts.
  const health = read('other-two-bars');

  expect(within(health.opponent, 0.22), `theirs read ${health.opponent}`).toBe(true);
});

test('a bar as short as the map between letters, just above another, is read rather than taken for artwork', () => {
  // Sylveon's bar emptied to 6%, its own emptied part copied over the rest of its fill: the outline runs along all of
  // where the fill has gone, which letters break above a strip of the map.
  const image = decodePng(readFileSync(new URL('fixtures/other-two-bars.png', import.meta.url)));

  for (let y = 396; y < 402; y++) {
    for (let x = 246; x < 264; x++) {
      const at = (y * image.width + x) * 4;

      image.data.copyWithin(at, at + 40 * 4, at + 41 * 4);
    }
  }

  const health = readHealth(image);

  expect(within(health.opponent, 0.06), `theirs read ${health.opponent}`).toBe(true);
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

test.each([
  // The "Go, Magmar!" bubble over the end of our full bar, read 93% to where the bubble starts, the fill dimmed under it.
  'battle-charizard-magmar',

  // The backdrop of a Pixel 8 Pro's "Attack incoming!" over the right of our bar, read 45% where it is 87%.
  'playing-pixel8-attack-incoming',
])('%s: a bar whose fill runs on dimmed under something translucent goes unread', (name) => {
  expect(read(name).own).toBeNull();
});

test.each([
  // The rings drawn where the fight's swipe touched, over our Kyogre's bar at 63%, read 24% to where a ring crosses it,
  // the fill showing again beyond; and over the start of our Tyranitar's at 60%, read 4%, too short to sample.
  ['battle-tap-ring', 0.51],
  ['battle-tap-ring-start', 0.7],
])('%s: a bar split by a ring drawn across it goes unread, theirs %f', (name, opponent) => {
  const health = read(name);

  expect(health.own).toBeNull();
  expect(within(health.opponent, opponent), `theirs read ${health.opponent}`).toBe(true);
});

/** A frame of its own, which is all `Steady` asks of one: its bars are handed over with it. */
const frame = (): Image => ({ width: 0, height: 0, data: new Uint8Array() });

/** The HP `Steady` decides on after each of `readings`, each `[own, opponent]` off a frame of its own. */
function steadied(readings: readonly [number | null, number | null][]): [number | null, number | null][] {
  const steady = new Steady();

  return readings.map(([own, opponent]) => {
    steady.read(frame(), { own, opponent });

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

test('a jump read again off the same frame does not stand', () => {
  // The loop reading the latest frame again before the next comes, as it does every turn while the screen stands still.
  const steady = new Steady();
  const misread = frame();

  steady.read(frame(), { own: 0.8, opponent: 0.9 });
  steady.read(misread, { own: 0.3, opponent: 0.9 });
  steady.read(misread, { own: 0.3, opponent: 0.9 });

  expect(steady.health).toEqual({ own: 0.8, opponent: 0.9 });
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

  steady.read(frame(), { own: 0.2, opponent: 0.5 });
  steady.forget('own');
  steady.read(frame(), { own: 1, opponent: 0.5 });

  expect(steady.health).toEqual({ own: 1, opponent: 0.5 });
});

test('a side forgotten is read again off the same frame, while the other’s jump awaits another', () => {
  // A newcomer of ours named while the screen stands still: the frame it was named on is all there is to read it off.
  const steady = new Steady();
  const still = frame();

  steady.read(frame(), { own: 0.2, opponent: 0.9 });
  steady.read(still, { own: 1, opponent: 0.3 });
  steady.forget('own');
  steady.read(still, { own: 1, opponent: 0.3 });

  expect(steady.health).toEqual({ own: 1, opponent: 0.9 });
});
