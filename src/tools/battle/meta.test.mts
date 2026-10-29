/**
 * The meta against a slice of PvPoke at pvpoke/pvpoke@38f7032: its formats whole, and of Great League's rankings the
 * four Marowak, Medicham, Registeel and Galarian Stunfisk, with the species and moves they name out of its game master.
 */

import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { type GameData } from '../inventory/game-master.mts';
import { type Download } from './assets.mts';
import { formatOf, loadMeta, movesetsOf, type PvPokeData, type Ranking } from './meta.mts';

const DATA = JSON.parse(
  readFileSync(new URL('../inventory/fixtures/game-master.json', import.meta.url), 'utf8'),
) as GameData;

const PVPOKE = JSON.parse(readFileSync(new URL('fixtures/pvpoke.json', import.meta.url), 'utf8')) as PvPokeData & {
  rankings: Ranking[];
};

afterEach(() => {
  vi.restoreAllMocks();
});

test.each<[string, { cup: string; cp: number } | null, string]>([
  ['great', { cup: 'all', cp: 1500 }, 'an open league by its name'],
  ['ultra league', { cup: 'all', cp: 2500 }, 'or its title'],
  ['m', { cup: 'all', cp: 10000 }, 'or the start of it, as `--league` takes it'],
  ['fantasy', { cup: 'fantasy', cp: 1500 }, 'a cup by the start of its title'],
  ['Fantasy Cup: Great League Edition', { cup: 'fantasy', cp: 1500 }, 'or by a title holding all of its own'],
  ['master league: mega', { cup: 'mega', cp: 10000 }, 'in any order: PvPoke’s Mega Master League'],
  ['little cup', { cup: 'little', cp: 500 }, 'Little Cup, rather than an open Little League'],
  ['great league remix', { cup: 'all', cp: 1500 }, 'a cup PvPoke does not list, by its league'],
  ['retro cup', null, 'nothing to go on'],
  ['', null, 'nothing at all'],
])('%j is ranked as %o: %s', (league, format) => {
  expect(formatOf(league, PVPOKE.formats)).toStrictEqual(format);
});

test('a species allows for every move PvPoke’s simulations use at least a fifth as often as the most used', () => {
  const movesets = movesetsOf(DATA, PVPOKE.rankings, PVPOKE);

  expect(movesets.get('Medicham')).toStrictEqual({
    fast: 'Psycho Cut',
    fastMoves: ['Psycho Cut', 'Counter'],
    chargedMoves: ['Dynamic Punch', 'Ice Punch', 'Psychic', 'Power-Up Punch'],
  });
  expect(movesets.get('Registeel')?.fast, 'PvPoke’s Lock On is the game’s Lock-On').toBe('Lock-On');
  expect(movesets.get('Stunfisk')?.chargedMoves, 'Galarian Stunfisk is what the HUD calls Stunfisk').toStrictEqual([
    'Rock Slide',
    'Earthquake',
    'Muddy Water',
    'Flash Cannon',
  ]);
});

test('the forms of a species are one moveset, recommended by the one ranked highest', () => {
  const marowak = movesetsOf(DATA, PVPOKE.rankings, PVPOKE).get('Marowak');

  expect(marowak?.fast, 'the Kantonian, ranked above the Alolan’s Fire Spin').toBe('Mud-Slap');
  expect(marowak?.fastMoves).toStrictEqual(['Mud-Slap', 'Rock Smash', 'Hex', 'Fire Spin']);
  expect(marowak?.chargedMoves, 'the Kantonian’s Return at 19.5% left out, the Alolan’s at 25.7% kept').toStrictEqual([
    'Bone Club',
    'Rock Slide',
    'Earthquake',
    'Shadow Bone',
    'Flame Wheel',
    'Shadow Ball',
    'Return',
  ]);
});

test('a variant is the move the screen prints, and what the game master lacks goes without', () => {
  // Medicham is left out rather than counted by Ice Punch, the one of its moves the game master has.
  const rankings: Ranking[] = [
    {
      speciesId: 'registeel',
      moves: {
        fastMoves: [{ moveId: 'HIDDEN_POWER_BUG', uses: 10 }],
        chargedMoves: [
          { moveId: 'FLASH_CANNON', uses: 10 },
          { moveId: 'NOT_A_MOVE', uses: 10 },
        ],
      },
      moveset: ['HIDDEN_POWER_BUG', 'FLASH_CANNON', 'NOT_A_MOVE'],
    },
    { speciesId: 'not_a_species', moves: { fastMoves: [], chargedMoves: [] }, moveset: ['LOCK_ON'] },
    {
      speciesId: 'medicham',
      moves: { fastMoves: [{ moveId: 'NOT_A_MOVE', uses: 10 }], chargedMoves: [{ moveId: 'ICE_PUNCH', uses: 10 }] },
      moveset: ['NOT_A_MOVE', 'ICE_PUNCH'],
    },
  ];
  const pvpoke = { ...PVPOKE, moves: [...PVPOKE.moves, { moveId: 'NOT_A_MOVE', name: 'Not A Move' }] };

  expect([...movesetsOf(DATA, rankings, pvpoke)]).toStrictEqual([
    ['Registeel', { fast: 'Hidden Power', fastMoves: ['Hidden Power'], chargedMoves: ['Flash Cannon'] }],
  ]);
});

/** PvPoke's files by the name `pnpm battle` caches each under, a file not among them answering as a 404. */
const served: Record<string, unknown> = {
  'pvpoke-gamemaster.json': PVPOKE,
  'pvpoke-fantasy-1500.json': PVPOKE.rankings,
  'pvpoke-all-10000.json': PVPOKE.rankings,
};

const download: Download = async (file, url, decode) => {
  if (!(file in served)) {
    throw new Error(`${url}: 404 Not Found`);
  }

  return decode(new TextEncoder().encode(JSON.stringify(served[file])));
};

test('the meta is read as the league’s rankings and PvPoke’s game master', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});

  const fantasy = await loadMeta(download, DATA, 'fantasy cup');

  expect(fantasy && { cup: fantasy.cup, cap: fantasy.cap, species: [...fantasy.movesets.keys()] }).toStrictEqual({
    cup: 'fantasy',
    cap: 1500,
    species: ['Marowak', 'Medicham', 'Registeel', 'Stunfisk'],
  });
  expect((await loadMeta(download, DATA, 'master'))?.cap, 'Master League has no cap').toBe(null);
  expect(await loadMeta(download, DATA, 'retro cup'), 'every move allowed for').toBe(null);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('PvPoke ranks nothing called retro cup'));
});

test('rankings that cannot be had allow for every move rather than stopping the run', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});

  expect(await loadMeta(download, DATA, 'great')).toBe(null);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('rankings-1500.json: 404 Not Found'));
});
