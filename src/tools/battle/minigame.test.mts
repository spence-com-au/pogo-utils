/**
 * The bubble finder against minigames of five types, each against the game's own icon for its type: Kyogre's Hydro
 * Pump, Swampert's Hydro Cannon, Mamoswine's Avalanche, Giratina's Shadow Sneak, Tyranitar's Crunch and Mewtwo's
 * Psychic, and a Dark Pulse off a Pixel 8 Pro. Each expectation is a box the bubbles are drawn in on the frame, which
 * the first swipe has to cross; the Get Ready! that comes before them has none.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { decodePng } from '../inventory/png.mts';
import { bubbleSwipes, typeColour } from './minigame.mts';
import { type Point } from './layout.mts';

const png = (path: string) => decodePng(readFileSync(new URL(`fixtures/${path}.png`, import.meta.url)));

const colour = (type: string) => typeColour(png(`types/POKEMON_TYPE_${type}`));

/** Whether a swipe passes through a box, sampled along its length. */
const crosses = ([from, to]: readonly [Point, Point], [left, top, right, bottom]: readonly number[]) =>
  Array.from({ length: 21 }, (_, i) => i / 20).some((t) => {
    const x = from[0] + (to[0] - from[0]) * t;
    const y = from[1] + (to[1] - from[1]) * t;

    return x >= (left ?? 0) && x <= (right ?? 1) && y >= (top ?? 0) && y <= (bottom ?? 1);
  });

test('a type’s bubbles are the commonest colour of its icon, the white emblem aside', () => {
  expect(colour('DARK')).toEqual([106, 102, 119]);
  expect(colour('WATER')).toEqual([78, 144, 214]);
});

test.each([
  ['playing-minigame-kyogre-excellent', 'WATER', [0.68, 0.33, 0.95, 0.4]],
  ['playing-minigame-swampert', 'WATER', [0.45, 0.6, 0.6, 0.68]],
  ['playing-minigame-mamoswine', 'ICE', [0.45, 0.53, 0.72, 0.6]],
  ['playing-minigame-giratina', 'GHOST', [0.4, 0.8, 0.5, 0.84]],
  ['playing-minigame-tyranitar', 'DARK', [0.2, 0.5, 0.56, 0.6]],
  ['playing-minigame-mewtwo', 'PSYCHIC', [0.65, 0.6, 0.9, 0.8]],
  ['playing-minigame-pixel8-dark', 'DARK', [0.11, 0.59, 0.44, 0.81]],
] as const)('%s: the first swipe crosses the %s bubbles', (name, type, box) => {
  const [first] = bubbleSwipes(png(name), colour(type));

  expect(first).toBeDefined();
  expect(first && crosses(first, box)).toBe(true);
});

/**
 * Tyranitar's chain of five, overlapping into one blob, is one swipe along it rather than five across it, and so is
 * Swampert's of six, shaded so that under full white its blue does not agree with its red and green.
 */
test.each([
  ['playing-minigame-tyranitar', 'DARK', 0.35],
  ['playing-minigame-swampert', 'WATER', 0.6],
] as const)('%s: a chain is swiped along its length', (name, type, length) => {
  const [first] = bubbleSwipes(png(name), colour(type));
  const across = first ? Math.abs(first[1][0] - first[0][0]) : 0;

  expect(across).toBeGreaterThan(length);
});

test('the Get Ready! before the bubbles has none to swipe', () => {
  expect(bubbleSwipes(png('playing-minigame-ready'), colour('DARK'))).toEqual([]);
});

test('a Pokémon the colour of its bubbles is not taken for them', () => {
  const swipes = bubbleSwipes(png('playing-minigame-kyogre-excellent'), colour('WATER'));

  // Kyogre's body, the same blue, fills the bottom left of the frame below y 0.6.
  expect(swipes.every(([from, to]) => !crosses([from, to], [0, 0.65, 0.5, 1]))).toBe(true);
});

/** Mewtwo's lavender holds Psychic's share of pink in green and blue, though not in red. */
test('a Pokémon only partly the colour of its bubbles is not taken for them once they are gone', () => {
  expect(bubbleSwipes(png('playing-minigame-mewtwo-over'), colour('PSYCHIC'))).toEqual([]);
});

test('no swipe starts or ends on an edge Android takes for its own gestures', () => {
  const swipes = bubbleSwipes(png('playing-minigame-mewtwo'), colour('PSYCHIC'));

  expect(swipes.length).toBeGreaterThan(0);
  expect(swipes.flat().every(([x, y]) => x >= 0.05 && x <= 0.95 && y <= 0.92)).toBe(true);
});
