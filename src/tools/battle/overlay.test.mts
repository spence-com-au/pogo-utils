/**
 * PGSharp's overlay off `uiautomator dump`s of a Pixel 4 XL on the map: the star dragged in over the screen with the
 * timer where it starts, the same with the star's toolbar open down from it, the star halfway down the left edge with
 * the timer dragged up beside the clock, and the star two thirds down with the timer hidden. And of a Pixel 8 Pro, its
 * star near the top of the left edge and its timer where it starts.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { areas, checkOverlay, covered, Covered, GAME_ALONE, panelsOf, swipeAround, type Panel } from './overlay.mts';

const views = (name: string) => readFileSync(new URL(`fixtures/views-${name}.xml`, import.meta.url), 'utf8');

const PIXEL_4_XL = { width: 1440, height: 3040 };
const PIXEL_8_PRO = { width: 1008, height: 2244 };

test('finds the star, the timer and the open toolbar, as fractions of the screen', () => {
  const star = panelsOf(views('pixel4xl-star'), PIXEL_4_XL);
  const toolbar = panelsOf(views('pixel4xl-toolbar'), PIXEL_4_XL);

  expect(star.map(({ name }) => name)).toEqual(['star', 'timer', 'timer']);
  expect(star[0]?.box).toEqual([231 / 1440, 1091 / 3040, 357 / 1440, 1217 / 3040]);
  expect(toolbar.filter(({ name }) => name === 'toolbar')).toHaveLength(12);
  expect(toolbar.filter(({ name }) => name !== 'toolbar')).toEqual(star);
});

test('finds nothing over the game alone', () => {
  expect(panelsOf(GAME_ALONE, PIXEL_4_XL)).toEqual([]);
});

test('says so where uiautomator dump answers with no views', () => {
  expect(() => panelsOf('ERROR: could not get idle state.\n', PIXEL_4_XL)).toThrow(
    /^PGSharp's overlay could not be looked for: uiautomator dump said "ERROR: could not get idle state."$/,
  );
});

// #564's case: the open toolbar over the selection grid's left column, where the card searched for is held.
test('refuses the open toolbar, naming what it covers and how to clear it', () => {
  expect(() => checkOverlay(views('pixel4xl-toolbar'), PIXEL_4_XL)).toThrow(Covered);
  expect(() => checkOverlay(views('pixel4xl-toolbar'), PIXEL_4_XL)).toThrow(
    /PGSharp's toolbar covers .*the party screen's left card, the selection grid's left column, .*: collapse it to its star or hide the overlay\./,
  );
});

// Dragged in over the screen, the star lies across Blanche's portrait on the Battle tab and where our HP bar is drawn,
// and the timer where it starts lies across a held Pokémon's panel, which a tall one's types are read off.
test('refuses the star and the timer where they cover what is read', () => {
  expect(Object.fromEntries(covered(panelsOf(views('pixel4xl-star'), PIXEL_4_XL), areas(PIXEL_4_XL)))).toEqual({
    star: [
      "the Battle tab's leaders",
      'the league chooser',
      "the party's league and title",
      "the result's verdict",
      'our HP bar',
    ],
    timer: ["a held Pokémon's panel"],
  });
});

// Halfway down the left edge the star is clear of every menu but lies where our HP bar is drawn as the camera moves,
// and beside the clock the timer lies over our type icons.
test('refuses the star halfway down the left edge and the timer beside the clock in battle', () => {
  expect(() => checkOverlay(views('pixel4xl-edge'), PIXEL_4_XL)).toThrow(
    "PGSharp's star covers our HP bar: drag it clear or hide the overlay. PGSharp's timer covers each side's types: " +
      'drag it clear or hide the overlay.',
  );
});

// Two thirds of the way down the left edge, the star is clear of the menus and of where the HP bars are drawn, and with
// the timer hidden there is nothing else.
test('lets the star low on the left edge be, the timer hidden', () => {
  expect(checkOverlay(views('pixel4xl-allowed'), PIXEL_4_XL).map(({ name }) => name)).toEqual(['star']);
});

// A Pixel 8 Pro's star near the top of the left edge lies over the opponent's banner, read with OCR, and where our HP
// bar is drawn; its timer, where it starts, over a held Pokémon's panel.
test('refuses a Pixel 8 Pro’s star over the banner and our HP bar', () => {
  expect(Object.fromEntries(covered(panelsOf(views('pixel8pro-star'), PIXEL_8_PRO), areas(PIXEL_8_PRO)))).toEqual({
    star: ["a held Pokémon's panel", 'our HP bar', "the opponent's charged move banner"],
    timer: ["a held Pokémon's panel"],
  });
});

// The star at the left edge, over where the minigame's rows are swept from when its bubbles go unfound.
const STAR: Panel = { name: 'star', box: [0, 0.7, 0.0875, 0.74] };

test('turns a swipe begun on PGSharp’s overlay round', () => {
  expect(
    swipeAround(
      [
        [0.05, 0.72],
        [0.95, 0.76],
      ],
      [STAR],
      PIXEL_4_XL,
    ),
  ).toEqual([
    [0.95, 0.76],
    [0.05, 0.72],
  ]);
});

test('leaves a swipe begun clear of PGSharp’s overlay as it is, however far across it it runs', () => {
  const swipe = [
    [0.95, 0.72],
    [0.05, 0.72],
  ] as const;

  expect(swipeAround(swipe, [STAR], PIXEL_4_XL)).toEqual(swipe);
});

test('makes no swipe with both ends on PGSharp’s overlay', () => {
  expect(
    swipeAround(
      [
        [0.05, 0.7],
        [0.06, 0.74],
      ],
      [STAR],
      PIXEL_4_XL,
    ),
  ).toBeUndefined();
});
