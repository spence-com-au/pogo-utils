/**
 * Which downloads carry `GITHUB_TOKEN`, with `fetch` stubbed to record what it was sent: the host is the point, and
 * the local server `progress.test.mts` answers from cannot be `api.github.com`. And what `loadGameData` makes of a
 * game master the cache is seeded with, the week's grace reading each file without a word.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { cached, GAME_MASTER_CACHE, ICON_CACHE, loadGameData } from './download.mts';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** The `Authorization` header `cached` sent for `url`, or null for none. */
async function authorisation(url: string): Promise<string | null> {
  const fetch = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await cached(mkdtempSync(join(tmpdir(), 'download-')), 'file', url, true);

  const [[, init]] = fetch.mock.calls as unknown as [[string, RequestInit]];

  return new Headers(init.headers).get('Authorization');
}

test('sends GITHUB_TOKEN to GitHub API', async () => {
  vi.stubEnv('GITHUB_TOKEN', 'secret');

  expect(await authorisation('https://api.github.com/repos/PokeMiners/pogo_assets/git/trees/master')).toBe(
    'Bearer secret',
  );
});

test('keeps GITHUB_TOKEN from every other host', async () => {
  vi.stubEnv('GITHUB_TOKEN', 'secret');

  expect(
    await authorisation('https://raw.githubusercontent.com/alexelgt/game_masters/master/GAME_MASTER.json'),
  ).toBeNull();
});

test('sends nothing without GITHUB_TOKEN', async () => {
  vi.stubEnv('GITHUB_TOKEN', '');

  expect(await authorisation('https://api.github.com/repos/PokeMiners/pogo_assets/git/trees/master')).toBeNull();
});

/** The forms `loadGameData` makes of a game master of `templates`, beside a level table and nothing else. */
async function formsOf(templates: object[]) {
  const dir = mkdtempSync(join(tmpdir(), 'download-'));

  writeFileSync(
    join(dir, GAME_MASTER_CACHE),
    JSON.stringify([
      {
        templateId: 'PLAYER_LEVEL_SETTINGS',
        data: { playerLevel: { cpMultiplier: Array.from({ length: 100 }, (_, i) => 0.1 + i / 100) } },
      },
      ...templates,
    ]),
  );
  writeFileSync(join(dir, 'english.json'), JSON.stringify({ data: [] }));
  writeFileSync(join(dir, ICON_CACHE), JSON.stringify({ tree: [] }));

  return (await loadGameData(dir)).forms;
}

/**
 * A form too new for the names the dump was made with, as Zubat's Halloween 2026 costume arrived the week it did:
 * `form: 3362`, in its own template and in its species' form settings alike.
 */
test('a form that arrives as its number is named by its template, and is still a costume', async () => {
  const zubat = (templateId: string, form: string | number) => ({
    templateId,
    data: {
      pokemonSettings: {
        pokemonId: 'ZUBAT',
        form,
        type: 'POKEMON_TYPE_POISON',
        type2: 'POKEMON_TYPE_FLYING',
        stats: { baseAttack: 83, baseDefense: 73, baseStamina: 120 },
      },
    },
  });

  const forms = await formsOf([
    {
      templateId: 'FORMS_V0041_POKEMON_ZUBAT',
      data: {
        formSettings: { pokemon: 'ZUBAT', forms: [{ form: 'ZUBAT_NORMAL' }, { form: 3362, isCostume: true }] },
      },
    },
    zubat('V0041_POKEMON_ZUBAT_NORMAL', 'ZUBAT_NORMAL'),
    zubat('V0041_POKEMON_ZUBAT_HALLOWEEN_2026_01', 3362),
  ]);

  expect(forms.map(({ species, form, costume }) => ({ species, form, costume }))).toStrictEqual([
    { species: 'Zubat', form: null, costume: false },
    { species: 'Zubat', form: 'Halloween 2026 01', costume: true },
  ]);
});

/**
 * Black Kyurem's Freeze Shock is in no pool, only in the `moveReassignment` of Kyurem's change into it, and Origin Forme
 * Palkia's Spacial Rend not even there: the game master gives it the Altered Forme's pools, and no change into it.
 */
test('a form holds the charged moves the change into it hands over', async () => {
  const move = (templateId: string) => ({ templateId, data: { moveSettings: {} } });
  const pokemon = (dex: string, form: string, settings: object) => ({
    templateId: `V${dex}_POKEMON_${form}`,
    data: {
      pokemonSettings: {
        pokemonId: form.replace(/_.*/, ''),
        form,
        type: 'POKEMON_TYPE_DRAGON',
        stats: {},
        ...settings,
      },
    },
  });

  const forms = await formsOf([
    move('V0058_MOVE_AQUA_TAIL'),
    move('V0374_MOVE_FUSION_BOLT'),
    move('V0388_MOVE_SPACIAL_REND'),
    move('V0466_MOVE_FREEZE_SHOCK'),
    pokemon('0484', 'PALKIA_NORMAL', { cinematicMoves: ['AQUA_TAIL'] }),
    pokemon('0484', 'PALKIA_ORIGIN', { cinematicMoves: ['AQUA_TAIL'] }),
    pokemon('0646', 'KYUREM_NORMAL', {
      formChange: [
        {
          availableForm: ['KYUREM_BLACK'],
          moveReassignment: { cinematicMoves: [{ existingMoves: ['GLACIATE'], replacementMoves: ['FREEZE_SHOCK'] }] },
        },
      ],
    }),
    pokemon('0646', 'KYUREM_BLACK', { cinematicMoves: ['FUSION_BOLT'] }),
  ]);

  expect(forms.map(({ form, moves }) => [form, moves.map((m) => m.name)])).toStrictEqual([
    [null, ['Aqua Tail']],
    ['Origin', ['Aqua Tail', 'Spacial Rend']],
    [null, []],
    ['Black', ['Fusion Bolt', 'Freeze Shock']],
  ]);
});
