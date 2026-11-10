/**
 * The bubble finder against minigames of six types, each against the game's own icon for its type: Kyogre's Hydro
 * Pump, Swampert's Hydro Cannon, Mamoswine's Avalanche, Giratina's Shadow Sneak, Tyranitar's Crunch, Mewtwo's Psychic
 * and Dedenne's Play Rough, and a Dark Pulse off a Pixel 8 Pro. Each expectation is a box the bubbles are drawn in on
 * the frame, which the first swipe has to cross; the Get Ready! that comes before them has none.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { decodePng } from '../../core/png.mts';
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
  ['playing-minigame-dedenne', 'FAIRY', [0.42, 0.55, 0.58, 0.66]],
] as const)('%s: the first swipe crosses the %s bubbles', (name, type, box) => {
  const first = bubbleSwipes(png(name), colour(type))[0]?.swipe;

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
  const first = bubbleSwipes(png(name), colour(type))[0]?.swipe;
  const across = first ? Math.abs(first[1][0] - first[0][0]) : 0;

  expect(across).toBeGreaterThan(length);
});

/**
 * Palkia's Aqua Tail at night, a bubble popped a moment before swelling paler in the middle of the frame, the biggest
 * blob on it, and three still to pop around it: at the bottom left, and at the right going up.
 */
test('a bubble popped is swiped after those still to pop', () => {
  const first = bubbleSwipes(png('playing-minigame-palkia-popped'), colour('WATER'))[0]?.swipe;
  const live = [
    [0, 0.79, 0.26, 0.91],
    [0.62, 0.37, 0.85, 0.48],
    [0.77, 0.23, 1, 0.34],
  ];

  expect(first && live.some((box) => crosses(first, box))).toBe(true);
  expect(first && crosses(first, [0.45, 0.56, 0.75, 0.68])).toBe(false);
});

/**
 * Zamazenta's Close Combat at night, its bubble at the lower right lit orange below the emblem by the fist beside it:
 * only its top agrees with Fighting's colour, which cuts the fist short in its box. Followed below the box, the fist is
 * there, and the bubble is found, marked as found so and as a bubble's top half.
 */
test('a bubble found in part is found by the emblem its box cuts short', () => {
  const swipes = bubbleSwipes(png('playing-minigame-zamazenta-glow'), colour('FIGHTING'));
  const first = swipes[0];

  expect(first && crosses(first.swipe, [0.47, 0.68, 0.65, 0.84])).toBe(true);
  expect(first?.cut).toBe(true);
  expect(first?.halved).toBe(true);
});

/**
 * Tyranitar's Crunch by day, a bubble swiped swelling pale at the middle, the swipe's trail through it: the trail's head
 * stands for its emblem, so it is kept as a bubble found in part, but swelled past a bubble's top half.
 */
test('a bubble popped found by the emblem its box cuts short is no bubble’s top half', () => {
  const cut = bubbleSwipes(png('playing-minigame-tyranitar-popped'), colour('DARK')).filter((bubble) => bubble.cut);

  expect(cut).not.toEqual([]);
  expect(cut.some((bubble) => bubble.halved)).toBe(false);
});

test('the Get Ready! before the bubbles has none to swipe', () => {
  expect(bubbleSwipes(png('playing-minigame-ready'), colour('DARK'))).toEqual([]);
});

test('a Pokémon the colour of its bubbles is not taken for them', () => {
  const swipes = bubbleSwipes(png('playing-minigame-kyogre-excellent'), colour('WATER'));

  // Kyogre's body, the same blue, fills the bottom left of the frame below y 0.6.
  expect(swipes.every(({ swipe }) => !crosses(swipe, [0, 0.65, 0.5, 1]))).toBe(true);
});

/** Mewtwo's lavender holds Psychic's share of pink in green and blue, though not in red. */
test('a Pokémon only partly the colour of its bubbles is not taken for them once they are gone', () => {
  expect(bubbleSwipes(png('playing-minigame-mewtwo-over'), colour('PSYCHIC'))).toEqual([]);
});

/**
 * Palkia's Aqua Tail bubble coming in at the right edge is swiped along its whole length as found, past where a swipe
 * may reach, for its size and middle to be matched against the frame before's; the swipe made is brought within reach.
 */
test('a bubble at an edge keeps its length', () => {
  const swipes = bubbleSwipes(png('playing-minigame-palkia-before'), colour('WATER'));

  expect(swipes.some(({ swipe: [from, to] }) => Math.max(from[0], to[0]) > 0.95)).toBe(true);
});
