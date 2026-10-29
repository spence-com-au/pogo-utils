/**
 * The page's loading end to end, against a `fetch` serving a game master of one form and one type: that each piece is
 * asked of the address the site publishes it under or upstream serves it from, and arrives as `run` takes it. Written
 * out rather than read off the vended files, which this project cannot open — `node:fs` is what the empty `types` keeps
 * out — and which `assets.test.mts` holds to the icons and the game master instead.
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { GAME_MASTER, SILHOUETTES } from '../generated.js';
import { typeIcon } from '../pokedex/icons.js';
import { encodeSilhouettes } from '../tools/battle/assets.mts';
import { GRID } from '../tools/battle/party.mts';
import { encodePng } from '../tools/inventory/png.mts';
import { loadBattle } from './load.js';

const SILHOUETTE = new Uint8Array(GRID * GRID).map((_, at) => at % 3 && 1);
const WATER = { width: 2, height: 1, data: new Uint8Array([0, 0, 255, 255, 255, 255, 255, 255]) };

/** What each address answers; anything else is a 404. */
const SERVED: Record<string, string | Uint8Array<ArrayBuffer>> = {
  [GAME_MASTER]: JSON.stringify({
    forms: [{ icon: 'pm7.icon.png', species: 'Squirtle' }],
    types: ['Water'],
    combat: {},
  }),
  [SILHOUETTES]: JSON.stringify(
    encodeSilhouettes(new Map([['pm7.icon.png', { species: 'Squirtle', silhouette: SILHOUETTE }]])),
  ),
  [typeIcon('Water')]: encodePng(WATER).slice(),
  'https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.json': JSON.stringify({
    formats: [{ title: 'Fantasy Cup', cup: 'fantasy', cp: 1500 }],
    pokemon: [],
    moves: [],
  }),
  'https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/fantasy/overall/rankings-1500.json': '[]',
};

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) =>
    url in SERVED ? new Response(SERVED[url]) : new Response(null, { status: 404 }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('a GO Battle League run loads the game master, the silhouettes, the type icons and the league’s meta', async () => {
  const { data, icons, typeIcons, meta } = await loadBattle('fantasy');

  expect(data.types).toStrictEqual(['Water']);
  expect(icons).toStrictEqual([{ species: 'Squirtle', silhouette: SILHOUETTE }]);
  expect(typeIcons).toStrictEqual({ Water: WATER });
  expect(meta && { cup: meta.cup, cap: meta.cap }).toStrictEqual({ cup: 'fantasy', cap: 1500 });
});

test('Training loads no meta, allowing for every move', async () => {
  expect((await loadBattle(null)).meta).toBe(null);
});
