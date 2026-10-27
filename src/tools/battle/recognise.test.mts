/**
 * The recogniser against frames of real Team Leader battles, recorded off a Pixel 4 XL and scaled to the stream's
 * 360×760. Each still is named for the state it shows, so the expectation is the name's first word; among them are
 * the near misses that set the thresholds — the map's notification, the fade into a battle, the shield going up —
 * which is what keeps a loosened threshold from passing unnoticed.
 *
 * `charge.h264` is five seconds of one battle re-encoded at the stream's size, run through the decoder a battle runs
 * on rather than a still: a fight, a charged move coming ready, and its throw — the button going dark for a third of a
 * second before the screen gives way to the throw, 12 frames that half-second samples of the same footage stepped over.
 */

import { decodePng } from '../inventory/png.mts';
import { createReadStream, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  countdown,
  opponentShields,
  ownShields,
  pokemonLeft,
  readyButtons,
  recognise,
  type State,
} from './recognise.mts';
import { decodeFrames, streamSize } from './stream.mts';

const FIXTURES = fileURLToPath(new URL('fixtures/', import.meta.url));

const pngs = readdirSync(FIXTURES).filter((name) => name.endsWith('.png'));

// The screens between battles, which `menus.test.mts` reads, are `other` to the stream: none may be taken for a battle,
// which would have them swiped at.
const menus = pngs.filter((name) => name.startsWith('menu-'));
const stills = pngs.filter((name) => !menus.includes(name));

test.each(stills)('%s', (name) => {
  const expected = name.split('-')[0];

  expect(recognise(decodePng(readFileSync(FIXTURES + name)))).toBe(expected);
});

test.each(menus)('%s is other', (name) => {
  expect(recognise(decodePng(readFileSync(FIXTURES + name)))).toBe('other');
});

test('covers every state', () => {
  const states: State[] = ['battle', 'charged', 'shield', 'switch', 'other'];

  expect(new Set(stills.map((name) => name.split('-')[0]))).toEqual(new Set(states));
});

// Which buttons are lit, by x: one move's centred, two moves' either side. The Kyogre frames are its belly behind the
// centred button's place, white on the rim and inside and outside it alike, which the rim alone read as ready.
test.each([
  ['charged-shadow-sneak', [0.499]],
  ['charged-avalanche', [0.499]],
  ['charged-two-right', [0.69]],
  ['charged-two-both', [0.31, 0.69]],
  ['charged-deep-sky', [0.69]],
  ['charged-pixel8', [0.499]],
  ['battle-pixel8', []],
  ['battle-two-unlit', []],
  ['battle-minigame-kyogre-great', []],
  ['battle-minigame-kyogre-excellent', []],
])('%s has buttons lit at %j', (name, xs) => {
  const lit = readyButtons(decodePng(readFileSync(`${FIXTURES}${name}.png`)));

  expect(lit.map(([x]) => x)).toEqual(xs);
});

/**
 * The opponent's countdown, which every shield prompt carries on both phones, and a throw made with none of our shields
 * left shows on its own: `other-pixel8-countdown-wing` with Galarian Moltres's wing behind part of it. No other still
 * has it. The switch prompt carries one too and is left out, `recognise` reading it first and the countdown being asked
 * of `other` alone.
 */
const countdowns = pngs.filter((name) => name.startsWith('shield-') || name.startsWith('other-pixel8-countdown'));

test.each(pngs.filter((name) => !name.startsWith('switch-')))('%s shows the countdown only where it is up', (name) => {
  expect(countdown(decodePng(readFileSync(FIXTURES + name)))).toBe(countdowns.includes(name));
});

test('follows a charged move coming ready and being thrown through the decoder', async () => {
  const runs: State[] = [];

  for await (const frame of decodeFrames(
    createReadStream(FIXTURES + 'charge.h264'),
    streamSize({ width: 1440, height: 3040 }),
  )) {
    const state = recognise(frame);

    if (runs.at(-1) !== state) {
      runs.push(state);
    }
  }

  expect(runs).toEqual(['battle', 'charged', 'battle', 'other']);
});

test.each([
  ['battle-latias', 2],
  ['battle-night', 2],
  ['battle-shield-blocked', 1],
  ['battle-two-unlit', 0],
  ['charged-two-both', 2],
  ['battle-pixel8', 2],
])('%s: the opponent has %i shields left', (name, shields) => {
  expect(opponentShields(decodePng(readFileSync(`${FIXTURES}${name}.png`)))).toBe(shields);
});

test.each([
  ['battle-latias', 2],
  ['battle-pixel8', 2],
  ['battle-banner', 1],
  ['battle-two-unlit', 1],
  ['battle-one-shield', 1],
  ['charged-shadow-sneak', 0],
  ['battle-shields-spent', 0],
])('%s: we have %i shields left', (name, shields) => {
  expect(ownShields(decodePng(readFileSync(`${FIXTURES}${name}.png`)))).toBe(shields);
});

test('our shields go unread where the shield prompt hides the HUD', () => {
  expect(ownShields(decodePng(readFileSync(`${FIXTURES}shield-glaceon.png`)))).toBeNull();
});

test.each<[string, number | null, number | null]>([
  ['battle-latias', 3, 3],
  ['battle-one-shield', 2, 3],
  ['battle-crunch-salamence', 3, 2],
  ['charged-shadow-sneak', 2, 1],
  ['battle-pixel8', 3, 3],
  ['switch-pixel8', 2, 3],
  ['battle-slate-night', 3, 3],
  ['battle-banner-pixel8-groudon', 3, 3],
  ['shield-glaceon', null, null],
  ['shield-pixel8', null, null],
])('%s: we have %s Pokémon left and the opponent %s', (name, own, opponent) => {
  expect(pokemonLeft(decodePng(readFileSync(`${FIXTURES}${name}.png`)))).toEqual({ own, opponent });
});
