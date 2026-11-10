/**
 * The recogniser against frames of real Team Leader battles, recorded off a Pixel 4 XL and scaled to the stream's
 * 360×760. Each still is named for the state it shows, so the expectation is the name's first word; among them are
 * the near misses that set the thresholds — the map's notification, the fade into a battle, the shield going up —
 * which is what keeps a loosened threshold from passing unnoticed.
 *
 * `charge.h264` is five seconds of one battle re-encoded at the stream's size, run through the decoder a battle runs
 * on rather than a still: a fight, a charged move coming ready, and its throw — the button dimming for a tenth of a
 * second, still the fight, and then fading out with its name, a charged move under way for a third of a second before
 * the screen gives way to the throw: 13 frames that half-second samples of the same footage stepped over.
 */

import { decodePng } from '../../core/png.mts';
import { createReadStream, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  blank,
  countdown,
  fleeButton,
  opponentShields,
  ownShields,
  pokemonLeft,
  readyButtons,
  recognise,
  type State,
} from './recognise.mts';
import { streamSize } from './record-command.mts';
import { decodeFrames } from './node/stream.mts';

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
  const states: State[] = ['battle', 'charged', 'playing', 'shield', 'switch', 'other'];

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
  ['playing-minigame-kyogre-great', []],
  ['playing-minigame-kyogre-excellent', []],
])('%s has buttons lit at %j', (name, xs) => {
  const lit = readyButtons(decodePng(readFileSync(`${FIXTURES}${name}.png`)));

  expect(lit.map(([x]) => x)).toEqual(xs);
});

/**
 * The opponent's countdown, which every shield prompt carries on both phones, and a throw made with none of our shields
 * left shows on its own: `other-pixel8-countdown`, and `other-pixel8-countdown-wing` with Galarian Moltres's wing
 * behind part of it. No other still has it. The switch prompt carries one too and is left out: `recognise` reads it as
 * `switch` first, and the run asks for the countdown only of a frame `recognise` reads as `other`.
 */
const countdowns = pngs.filter((name) => name.startsWith('shield-') || name.startsWith('other-pixel8-countdown'));

test.each(pngs.filter((name) => !name.startsWith('switch-')))('%s shows the countdown only where it is up', (name) => {
  expect(countdown(decodePng(readFileSync(FIXTURES + name)))).toBe(countdowns.includes(name));
});

/**
 * The button to flee the battle, wherever it is drawn clear of PGSharp's timer, which lies over the top of it on most of
 * the Pixel 4 XL's stills and over the middle of it on every Pixel 8 Pro's: through the fight, under cloud and a night
 * sky, through `Get Ready!` and the banners, and back after Avalanche's minigame with our bar not yet back. The
 * minigame's stills hide it.
 */
const fleeing = [
  'battle-lugia-foliage-beside-split',
  'battle-lugia-foliage-split',
  'battle-overcast',
  'battle-tap-ring-start',
  'battle-tap-ring',
  'other-mewtwo-foliage-letters',
  'other-two-bars',
  'playing-banner-gardevoir',
  'playing-banner-ursaluna',
  'playing-flee-avalanche',
  'playing-ready-cloud',
  'playing-ready-zamazenta',
  'playing-slate-night',
  'playing-zamazenta-swept',
].map((name) => `${name}.png`);

test.each(pngs)('%s shows the button to flee only where it is drawn clear', (name) => {
  expect(fleeButton(decodePng(readFileSync(FIXTURES + name)))).toBe(fleeing.includes(name));
});

// The black between a battle's end and its result, and no other still, however dark.
test.each(pngs)('%s is blank only where the game draws nothing', (name) => {
  expect(blank(decodePng(readFileSync(FIXTURES + name)))).toBe(name === 'other-pixel8-black.png');
});

/** `other-pixel8-black` with a white square `side` pixels across near its foot at the left, where PGSharp's star sits. */
function starred(side: number) {
  const image = decodePng(readFileSync(`${FIXTURES}other-pixel8-black.png`));
  const top = Math.round(0.86 * image.height);

  for (let y = top; y < top + side; y++) {
    image.data.fill(255, y * image.width * 4, (y * image.width + side) * 4);
  }

  return image;
}

// The star, 126 of a Pixel 4 XL's 1440 across, is 32 of the stream's 360: black still, where twice that across is not.
test('is blank with PGSharp’s star over the black, and not with more drawn on it', () => {
  expect(blank(starred(32))).toBe(true);
  expect(blank(starred(64))).toBe(false);
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

  expect(runs).toEqual(['battle', 'charged', 'battle', 'playing', 'other']);
});

test.each([
  ['battle-latias', 2],
  ['battle-night', 2],
  ['playing-shield-blocked', 1],
  ['battle-two-unlit', 0],
  ['charged-two-both', 2],
  ['battle-pixel8', 2],
])('%s: the opponent has %i shields left', (name, shields) => {
  expect(opponentShields(decodePng(readFileSync(`${FIXTURES}${name}.png`)))).toBe(shields);
});

test.each([
  ['battle-latias', 2],
  ['battle-pixel8', 2],
  ['playing-banner', 1],
  ['battle-two-unlit', 1],
  ['battle-one-shield', 1],
  ['charged-shadow-sneak', 0],
  ['playing-shields-spent', 0],
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
  ['playing-slate-night', 3, 3],
  ['playing-banner-pixel8-groudon', 3, 3],
  ['shield-glaceon', null, null],
  ['shield-pixel8', null, null],
])('%s: we have %s Pokémon left and the opponent %s', (name, own, opponent) => {
  expect(pokemonLeft(decodePng(readFileSync(`${FIXTURES}${name}.png`)))).toEqual({ own, opponent });
});
