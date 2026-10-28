/**
 * The names, CPs and move labels read off committed stream frames by the real Tesseract, each expectation being what
 * the frame shows. Our own name is a nickname in every one of them, so `own` is null throughout.
 */

import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { type GameData } from '../inventory/game-master.mts';
import { tesseractCli } from '../inventory/ocr-cli.mts';
import { type Line, useEngine } from '../inventory/ocr.mts';
import { decodePng } from '../inventory/png.mts';
import { merge, readBanner, readBattle, unseen } from './read.mts';

beforeAll(() => useEngine(tesseractCli));

const DATA = JSON.parse(
  readFileSync(new URL('../inventory/fixtures/game-master.json', import.meta.url), 'utf8'),
) as GameData;

const read = async (name: string) => {
  const sighting = await readBattle(decodePng(readFileSync(new URL(`fixtures/${name}.png`, import.meta.url))), DATA);

  return { ...sighting, moves: Object.fromEntries(sighting.moves) };
};

test.each([
  ['battle-two-unlit', 'Salamence', [3813, 4495], { 0.31: 'Hydro Pump', 0.69: 'Avalanche' }],
  ['charged-two-both', 'Entei', [3813, 4163], { 0.31: 'Hydro Pump', 0.69: 'Avalanche' }],
  ['charged-two-right', 'Entei', [3813, 4163], { 0.31: 'Hydro Pump', 0.69: 'Avalanche' }],
  ['battle-deoxys', 'Sneasel', [1434, 1465], { 0.499: 'Zap Cannon' }],
  ['charged-avalanche', 'Empoleon', [2336, 2486], { 0.499: 'Avalanche' }],
  ['charged-shadow-sneak', 'Mamoswine', [2392, 2472], { 0.499: 'Shadow Sneak' }],

  // Crunch's line runs on to x 0.89 behind Tyranitar, its centre nearer the right button than its own.
  ['battle-crunch-entei', 'Entei', [3796, 4163], { 0.499: 'Crunch' }],
  ['battle-crunch-salamence', 'Salamence', [3796, 4495], { 0.499: 'Crunch' }],

  // OCR runs the two CPs into one line, `cP 1387 ee CP 1487`, over the Pixel 8 Pro's darker sky.
  ['battle-pixel8', 'Combusken', [1387, 1487], { 0.499: 'Dark Pulse' }],
])('%s: against %s, at CPs %j, with %o', async (name, opponent, [ownCp, opponentCp], moves) => {
  expect(await read(name)).toEqual({ ...unseen(), opponent, ownCp, opponentCp, moves });
});

// Xerneas read as `Xemeas`, so the labels are matched among every move. OCR splits the line beneath Moonblast saying how
// effective it is, and its end, `TIVE`, is one edit from Dive: under `BLAST`, which is nearer no move, and beside the
// pair as a third.
test.each([
  ['battle-pixel8-xerneas-super-effective', { 0.69: 'Close Combat' }],
  ['charged-pixel8-xerneas-not-very-effective', { 0.31: 'Moonblast', 0.69: 'Close Combat' }],
])('%s: reads no piece of how effective a move is as a move', async (name, moves) => {
  expect((await read(name)).moves).toEqual(moves);
});

test('a frame with no labels reads none, rather than reading its artwork as moves', async () => {
  expect(await read('battle-minigame-kyogre-great')).toEqual({
    ...unseen(),
    opponent: 'Entei',
    ownCp: 3813,
    opponentCp: 4163,
    moves: {},
  });
});

test('the shield prompt, which hides the HUD, reads nothing', async () => {
  expect(await read('shield-glaceon')).toEqual({ ...unseen(), moves: {} });
});

test('a read keeps what earlier reads found, bar labels of the other layout', () => {
  const seen = {
    ...unseen(),
    opponent: 'Entei',
    opponentCp: 4163,
    opponentTypes: ['Fire'],
    moves: new Map([[0.499, 'Crunch']]),
  };

  expect(merge(seen, { ...unseen(), ownCp: 3796, moves: new Map([[0.31, 'Crunch']]) })).toEqual({
    ...unseen(),
    opponent: 'Entei',
    ownCp: 3796,
    opponentCp: 4163,
    opponentTypes: ['Fire'],
    moves: new Map([[0.31, 'Crunch']]),
  });
  expect(merge(seen, { ...unseen(), opponent: 'Moltres' }).moves, 'a read of no labels').toEqual(seen.moves);
});

const banner = (name: string, sides: { own: string | null; opponent: string | null }) =>
  readBanner(decodePng(readFileSync(new URL(`fixtures/${name}.png`, import.meta.url))), DATA, sides);

// Swampert against Quaquaval: Quaquaval's banner names its move, Swampert's is our own, and a mirror says nothing of
// whose it was. Golem's Stone Edge read as `Golem usedlistras`, which is no move of Golem's. Groudon's is on a Pixel 8
// Pro at night, its band placed by the banner's own anchor: pinned to the top, it missed the lettering.
test.each([
  ['battle-banner-quaquaval', { own: 'Swampert', opponent: 'Quaquaval' }, 'Aqua Jet'],
  ['battle-banner-swampert', { own: 'Swampert', opponent: 'Quaquaval' }, null],
  ['battle-banner-quaquaval', { own: 'Quaquaval', opponent: 'Quaquaval' }, null],
  ['battle-banner-quaquaval', { own: 'Swampert', opponent: null }, null],
  ['other-banner-golem', { own: 'Gengar', opponent: 'Golem' }, null],
  ['battle-banner-pixel8-groudon', { own: 'Moltres', opponent: 'Groudon' }, 'Solar Beam'],
])('reads the move %s names, against %j', async (name, sides, move) => {
  expect(await banner(name, sides)).toBe(move);
});

/**
 * A label line read off the labels' band of `image`, centred under the button at `x` across the screen: the band starts
 * 0.05 in and is scaled up three times, and a label is placed by its left edge and a letter of 0.022 a character.
 */
const label = (image: { width: number }, text: string, x: number): Line => {
  const width = text.length * 0.022;

  return { text, left: (x - width / 2 - 0.05) * image.width * 3, top: 0, width: width * image.width * 3, height: 30 };
};

// The labels a Pixel 8 Pro showed under Palkia in Origin Forme, whose Spacial Rend comes with the form rather than from
// its pools: unmatched, Palkia was weighed as having Aqua Tail alone against a Dragonite.
test("reads a move the species' form change hands over", async () => {
  const image = decodePng(readFileSync(new URL('fixtures/battle-pixel8.png', import.meta.url)));
  const bands = [[], [label(image, 'SPACIAL REND', 0.31), label(image, 'AQUA TAIL', 0.69)]];
  const sighting = await readBattle(image, DATA, () => Promise.resolve(bands.shift() ?? []), 'Palkia');

  expect(Object.fromEntries(sighting.moves)).toEqual({ 0.31: 'Spacial Rend', 0.69: 'Aqua Tail' });
});

// Gengar's `SLUDGE BOMB` read short as `SLUDGE B`, which was nearer Sludge than Sludge Bomb among every charged move.
// Among Gengar's own it is nearer none, and so leaves the label read before it standing.
test("matches a label among our species' moves only, where it is known", async () => {
  const image = decodePng(readFileSync(new URL('fixtures/battle-gengar-label-short.png', import.meta.url)));
  const short = await readBattle(image, DATA);
  const before = { ...unseen(), own: 'Gengar', moves: new Map([[0.499, 'Sludge Bomb']]) };

  expect(short.own).toBe('Gengar');
  expect(short.moves).toEqual(new Map());
  expect(merge(before, short).moves).toEqual(new Map([[0.499, 'Sludge Bomb']]));
});
