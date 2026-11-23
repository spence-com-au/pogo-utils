/**
 * The star over a background that fooled the gold alone: both are single screens from a live walk on a Pixel 4 XL
 * rather than stitches. The stitches taken of the same two Pokémon
 * later read right on `master` already, the yellow bokeh behind the star having moved on, so it is these screens or
 * nothing.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { isFavourite } from './badges.mts';
import { decodePng } from '../../core/png.mts';

test.each(['axew.png', 'axew-shiny.png'])('an outline star over yellow bokeh is no favourite: %s', (file) => {
  expect(isFavourite(decodePng(readFileSync(new URL(`fixtures/favourite/${file}`, import.meta.url))))).toBe(false);
});
