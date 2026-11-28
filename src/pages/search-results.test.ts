/**
 * Which rows of cards the results grid draws for where it sits against the window: the rows in view and a few past
 * each edge, and never none while it has a row, since a grid drawing no card has none to measure itself by.
 */

import { linesInView } from './search-results.js';
import { expect, test } from 'vitest';

/** A window 900 pixels high over a grid of 1,000 rows 250 pixels apart. */
const at = (top: number, lines = 1000) => linesInView(top, 900, 250, lines);

test('draws the rows in view and four past each edge', () => {
  expect(at(100)).toEqual({ first: 0, last: 8 });
  expect(at(-25_000)).toEqual({ first: 96, last: 108 });
});

test('draws the nearest row of a grid far below the window, so it still has a card to measure', () => {
  expect(at(5000)).toEqual({ first: 0, last: 1 });
});

test('draws the last row of a grid far above the window, and of one a new search has cut short', () => {
  expect(at(-1_000_000)).toEqual({ first: 999, last: 1000 });
  expect(at(-25_000, 3)).toEqual({ first: 2, last: 3 });
});

test('draws nothing of a grid with no rows', () => {
  expect(at(0, 0)).toEqual({ first: 0, last: 0 });
});
