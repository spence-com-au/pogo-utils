/**
 * The star over a background that fooled the gold alone, which the corpus cannot hold: both are single screens from a
 * live scan on a Pixel 4 XL, and `screens.test.mts` takes stitches only. The stitches taken of the same two Pokémon
 * later read right on `master` already, the yellow bokeh behind the star having moved on, so it is these screens or
 * nothing.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { isFavourite } from './badges.mts';
import { decodePng } from './png.mts';

test.each(['axew.png', 'axew-shiny.png'])('an outline star over yellow bokeh is no favourite: %s', (file) => {
  expect(isFavourite(decodePng(readFileSync(new URL(`fixtures/favourite/${file}`, import.meta.url))))).toBe(false);
});
