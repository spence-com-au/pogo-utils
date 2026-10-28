/**
 * The Pokémon selection screen and the panel a held Pokémon shows, off full-size screenshots of a Pixel 8 Pro's Master
 * League party: an Origin Forme Palkia nicknamed `98%`, a Metagross and a Xerneas. Tesseract has to be installed, as
 * for the inventory readers.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, test } from 'vitest';
import { type GameData } from '../inventory/game-master.mts';
import { ocr, useEngine } from '../inventory/ocr.mts';
import { tesseractCli } from '../inventory/ocr-cli.mts';
import { decodePng } from '../inventory/png.mts';
import { isSelection, pinkCell, query, readPanel, searched } from './selection.mts';

beforeAll(() => useEngine(tesseractCli));

const DATA = JSON.parse(
  readFileSync(new URL('../inventory/fixtures/game-master.json', import.meta.url), 'utf8'),
) as GameData;

const fixture = (name: string) =>
  decodePng(readFileSync(fileURLToPath(new URL(`fixtures/${name}.png`, import.meta.url))));

test.each([
  ['menu-pixel8-selection', true, false],
  ['menu-pixel8-selection-searched', true, true],
  ['menu-pixel8-search-metagross', true, true],
  ['menu-pixel8-party-master', false, false],
])('%s is the selection screen: %s, searched: %s', async (name, selection, search) => {
  const lines = await ocr(fixture(name));

  expect(isSelection(lines)).toBe(selection);
  expect(searched(lines)).toBe(search);
});

test('searches by dex number and CP, or by the CP alone where the species is unread', () => {
  expect(query(376, 3986)).toBe('376&cp3986');
  expect(query(undefined, 4673)).toBe('cp4673');
});

// Palkia tapped, unsearched, at the top of storage in the second row; each searched for, alone in the first cell; and
// Xerneas tapped with a search finding the whole party and a Yveltal of Xerneas's CP: pink past green and white.
test.each([
  ['menu-pixel8-selection', [0.5, 0.559]],
  ['menu-pixel8-search-palkia', [0.185, 0.397]],
  ['menu-pixel8-search-metagross', [0.185, 0.397]],
  ['menu-pixel8-search-party', [0.815, 0.397]],
] as const)('holds the pink cell of %s at %o', (name, [x, y]) => {
  const [hx, hy] = pinkCell(fixture(name)) ?? [NaN, NaN];

  expect(hx).toBeCloseTo(x, 2);
  expect(hy).toBeCloseTo(y, 2);
});

// With the search left from another card, Metagross's, the card tapped is out of view; and the party screen has no grid.
test.each(['menu-pixel8-selection-searched', 'menu-pixel8-party-master'])('%s has no pink cell', (name) => {
  expect(pinkCell(fixture(name))).toBeUndefined();
});

// Palkia's card is nicknamed and its silhouette went unread, so its species is the panel's: of the forms that are Water
// and Dragon, the Origin Forme's alone holds Dragon Breath, Spacial Rend and Aqua Tail. Xerneas's Geomancy is half
// hidden behind PGSharp's toolbar, and read among Xerneas's own moves.
test.each([
  [
    'menu-pixel8-held-palkia',
    null,
    { species: 'Palkia', fast: 'Dragon Breath', charged: ['Spacial Rend', 'Aqua Tail'] },
  ],
  [
    'menu-pixel8-held-palkia-low',
    null,
    { species: 'Palkia', fast: 'Dragon Breath', charged: ['Spacial Rend', 'Aqua Tail'] },
  ],
  [
    'menu-pixel8-held-metagross',
    'Metagross',
    { species: 'Metagross', fast: 'Shadow Claw', charged: ['Meteor Mash', 'Earthquake'] },
  ],
  [
    'menu-pixel8-held-xerneas',
    'Xerneas',
    { species: 'Xerneas', fast: 'Geomancy', charged: ['Moonblast', 'Close Combat'] },
  ],
])('reads the panel %s, the card read as %s', async (name, species, panel) => {
  expect(await readPanel(fixture(name), DATA, species)).toEqual(panel);
});

test('reads no panel where none is held', async () => {
  expect(await readPanel(fixture('menu-pixel8-search-metagross'), DATA, 'Metagross')).toBeUndefined();
});
