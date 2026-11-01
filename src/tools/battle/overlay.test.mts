/**
 * PGSharp's overlay off `uiautomator dump`s of a Pixel 4 XL on the map: the star dragged in over the screen with the
 * timer where it starts, the same with the star's toolbar open down from it, and the star at the left edge with the
 * timer dragged up beside the clock.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { areas, checkOverlay, covered, Covered, GAME_ALONE, panelsOf } from './overlay.mts';

const views = (name: string) => readFileSync(new URL(`fixtures/views-${name}.xml`, import.meta.url), 'utf8');

const PIXEL_4_XL = { width: 1440, height: 3040 };

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
    /PGSharp's toolbar covers .*the party screen's left card and the selection grid's left column: collapse it to its star or hide the overlay\./,
  );
});

// Dragged in over the screen, the star lies across Blanche's portrait on the Battle tab, and the timer where it starts
// lies across a held Pokémon's panel, which a tall one's types are read off.
test('refuses the star and the timer where they cover what is read', () => {
  expect(Object.fromEntries(covered(panelsOf(views('pixel4xl-star'), PIXEL_4_XL), areas(PIXEL_4_XL)))).toEqual({
    star: ["the Battle tab's leaders", 'the league chooser', "the party's league and title", "the result's verdict"],
    timer: ["a held Pokémon's panel"],
  });
});

test('lets the star at the left edge and the timer beside the clock be', () => {
  expect(() => checkOverlay(views('pixel4xl-edge'), PIXEL_4_XL)).not.toThrow();
});
