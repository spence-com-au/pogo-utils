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

/** The power-up costs `loadGameData` requires, which nothing below reads. */
const POWER_UP = [
  {
    templateId: 'POKEMON_UPGRADE_SETTINGS',
    data: { pokemonUpgrades: { stardustCost: [], shadowStardustMultiplier: 1.2, purifiedStardustMultiplier: 0.9 } },
  },
  { templateId: 'LUCKY_POKEMON_SETTINGS', data: { luckyPokemonSettings: { powerUpStardustDiscountPercent: 0.5 } } },
];

/** The `playerLevel` template `loadGameData` requires, whose table runs from 0.1 up by 0.01 a level. */
const PLAYER_LEVEL = {
  templateId: 'PLAYER_LEVEL_SETTINGS',
  data: { playerLevel: { cpMultiplier: Array.from({ length: 100 }, (_, i) => 0.1 + i / 100) } },
};

interface Seed {
  /** The string table, as alternating names and texts. */
  strings?: string[];

  /** The artwork listing. */
  listing?: object;
}

/** What `loadGameData` makes of a game master of exactly `templates`, with the cache seeded so nothing is downloaded. */
async function load(templates: object[], { strings = [], listing = { tree: [] } }: Seed = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'download-'));

  writeFileSync(join(dir, GAME_MASTER_CACHE), JSON.stringify(templates));
  writeFileSync(join(dir, 'english.json'), JSON.stringify({ data: strings }));
  writeFileSync(join(dir, ICON_CACHE), JSON.stringify(listing));

  return loadGameData(dir);
}

/** The forms `loadGameData` makes of a game master of `templates`, beside the tables it requires and nothing else. */
async function formsOf(templates: object[], seed?: Seed) {
  return (await load([PLAYER_LEVEL, ...POWER_UP, ...templates], seed)).forms;
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

  expect(forms.map(({ species: name, form, costume }) => ({ species: name, form, costume }))).toStrictEqual([
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

/** A Pokémon template of `templateId` with `settings` over the few a form needs. */
function species(templateId: string, settings: object) {
  return {
    templateId,
    data: {
      pokemonSettings: { pokemonId: 'FOO', form: 'FOO_NORMAL', type: 'POKEMON_TYPE_NORMAL', stats: {}, ...settings },
    },
  };
}

test('a half level holds the root mean square of the whole levels either side', async () => {
  const table = [0.1, 0.3, ...Array.from({ length: 49 }, () => 0.5)];
  const { cpm } = await load([
    { templateId: 'PLAYER_LEVEL_SETTINGS', data: { playerLevel: { cpMultiplier: table } } },
    ...POWER_UP,
  ]);

  expect(cpm).toHaveLength(101);
  expect(cpm.slice(0, 3)).toStrictEqual([
    [1, 0.1],
    [1.5, Math.sqrt(0.05)],
    [2, 0.3],
  ]);
  expect(cpm.at(-1)).toStrictEqual([51, 0.5]);
});

test('a level without a multiplier is refused', async () => {
  await expect(
    load([{ templateId: 'PLAYER_LEVEL_SETTINGS', data: { playerLevel: { cpMultiplier: [0.1, 0.2] } } }, ...POWER_UP]),
  ).rejects.toThrow('no CP multiplier for level 3');
});

test('a game master without the power-up costs is refused', async () => {
  for (const kept of POWER_UP) {
    await expect(load([PLAYER_LEVEL, kept])).rejects.toThrow('no power-up costs');
  }
});

test("the type chart reads the scalars in the order of the game's type enum", async () => {
  const scalars = Array.from({ length: 18 }, (_, i) => 1 + i / 10);
  const { effectiveness } = await load([
    PLAYER_LEVEL,
    ...POWER_UP,
    { templateId: 'TYPE_FIRE', data: { typeEffective: { attackType: 'POKEMON_TYPE_FIRE', attackScalar: scalars } } },
    { templateId: 'TYPE_ICE', data: { typeEffective: { attackType: 'POKEMON_TYPE_ICE', attackScalar: [0.5] } } },
  ]);

  expect(effectiveness.Fire).toStrictEqual({
    Normal: scalars[0],
    Fighting: scalars[1],
    Flying: scalars[2],
    Poison: scalars[3],
    Ground: scalars[4],
    Rock: scalars[5],
    Bug: scalars[6],
    Ghost: scalars[7],
    Steel: scalars[8],
    Fire: scalars[9],
    Water: scalars[10],
    Grass: scalars[11],
    Electric: scalars[12],
    Psychic: scalars[13],
    Ice: scalars[14],
    Dragon: scalars[15],
    Dark: scalars[16],
    Fairy: scalars[17],
  });
  expect(effectiveness.Ice).toMatchObject({ Normal: 0.5, Fighting: 1, Fairy: 1 });
});

test('a combat move is read from the first template of its name, and its buffs only where it has some', async () => {
  const combat = (templateId: string, combatMove: object) => ({ templateId, data: { combatMove } });
  const data = await load(
    [
      PLAYER_LEVEL,
      ...POWER_UP,
      combat('COMBAT_V0001_MOVE_HYDRO_PUMP', {
        type: 'POKEMON_TYPE_WATER',
        power: 90,
        energyDelta: -75,
        durationTurns: 2,
      }),
      combat('COMBAT_V0001_MOVE_HYDRO_PUMP_BLASTOISE', { type: 'POKEMON_TYPE_WATER', power: 130, durationTurns: 9 }),
      combat('COMBAT_V0002_MOVE_ICY_WIND', {
        type: 'POKEMON_TYPE_ICE',
        power: 60,
        buffs: { buffActivationChance: 1, targetAttackStatStageChange: -1 },
      }),
      combat('COMBAT_V0003_MOVE_SECRET_SWORD', { type: 'POKEMON_TYPE_FIGHTING', power: 85, buffs: {} }),
      combat('COMBAT_V0004_MOVE_TRANSFORM_FAST', { type: 'POKEMON_TYPE_NORMAL' }),
    ],
    { strings: ['move_name_0001', 'Hydro Pump', 'move_name_0003', 'Secret Sword'] },
  );

  expect(data.combat['Hydro Pump']).toStrictEqual({ type: 'Water', power: 90, energy: -75, turns: 3 });
  expect(data.combat['Icy Wind']).toStrictEqual({
    type: 'Ice',
    power: 60,
    energy: 0,
    turns: 1,
    buffs: { chance: 1, ownAttack: undefined, ownDefense: undefined, theirAttack: -1, theirDefense: undefined },
  });
  expect(data.combat['Secret Sword']).not.toHaveProperty('buffs');
  expect(data.combat.Transform).toStrictEqual({ type: 'Normal', power: 0, energy: 0, turns: 1 });
});

test('a form carries its size bands, the candy its evolutions cost and whether only a shadow has it', async () => {
  const bands = {
    xxsLowerBound: 1,
    xsLowerBound: 2,
    mLowerBound: 3,
    mUpperBound: 4,
    xlUpperBound: 5,
    xxlUpperBound: 6,
  };
  const forms = await formsOf([
    { templateId: 'EXTENDED_V0001_POKEMON_FOO_NORMAL', data: { pokemonExtendedSettings: { sizeSettings: bands } } },
    species('V0001_POKEMON_FOO_NORMAL', {
      evolutionBranch: [{ candyCost: 25 }, { candyCost: 25 }, {}, { candyCost: 100 }],
    }),
    species('V0002_POKEMON_BAR_NORMAL', { pokemonId: 'BAR', form: 'BAR_NORMAL' }),
    species('V0003_POKEMON_APEX_NORMAL', {
      pokemonId: 'APEX',
      form: 'APEX_NORMAL',
      shadow: { shadowChargeMove: 'AEROBLAST_PLUS' },
    }),
    species('V0004_POKEMON_RAIKOU_NORMAL', {
      pokemonId: 'RAIKOU',
      form: 'RAIKOU_NORMAL',
      shadow: { shadowChargeMove: 'FRUSTRATION' },
    }),
  ]);

  expect(
    forms.map(({ dex, heights, evolveCandy, shadowOnly }) => ({ dex, heights, evolveCandy, shadowOnly })),
  ).toStrictEqual([
    { dex: 1, heights: [1, 2, 3, 4, 5, 6], evolveCandy: [25, 100], shadowOnly: false },
    { dex: 2, heights: null, evolveCandy: [], shadowOnly: false },
    { dex: 3, heights: null, evolveCandy: [], shadowOnly: true },
    { dex: 4, heights: null, evolveCandy: [], shadowOnly: false },
  ]);
});

test('a form takes the artwork the listing names: trimmed, in full or, for the ordinary form only, bare', async () => {
  const listing = {
    tree: [
      'pm1.fALOLA.icon.png',
      'pm2.fFOO_ALOLA.icon.png',
      'pm3.icon.png',
      'pm4.icon.png',
      'pm5.fNORMAL.icon.png',
      'pm5.icon.png',
    ].map((path) => ({ path })),
  };
  const form = (dex: number, name: string) => species(`V000${dex}_POKEMON_${name}`, { form: name });

  const forms = await formsOf(
    [
      form(1, 'FOO_ALOLA'),
      form(2, 'FOO_ALOLA'),
      form(3, 'FOO_NORMAL'),
      form(4, 'FOO_GALAR'),
      form(5, 'FOO_NORMAL'),
      species('V0006_POKEMON_FOO', { form: undefined }),
    ],
    { listing },
  );

  expect(forms.map(({ dex, icon }) => [dex, icon])).toStrictEqual([
    [1, 'pm1.fALOLA.icon.png'],
    [2, 'pm2.fFOO_ALOLA.icon.png'],
    [3, 'pm3.icon.png'],
    [4, null],
    [5, 'pm5.fNORMAL.icon.png'],
    [6, null],
  ]);
});

test('a truncated artwork listing narrows no form', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});

  const forms = await formsOf([species('V0001_POKEMON_FOO_NORMAL', {})], {
    listing: { tree: [{ path: 'pm1.fNORMAL.icon.png' }], truncated: true },
  });

  expect(forms.map(({ icon }) => icon)).toStrictEqual([null]);
  expect(error).toHaveBeenCalledWith(expect.stringContaining('the listing is truncated'));
});

test('a form takes the shiny the listing names beside its artwork, and none where it names none', async () => {
  const listing = {
    tree: ['pm1.fALOLA.icon.png', 'pm1.fALOLA.s.icon.png', 'pm2.fALOLA.icon.png', 'pm3.fALOLA.s.icon.png'].map(
      (path) => ({ path }),
    ),
  };
  const form = (dex: number) => species(`V000${dex}_POKEMON_FOO_ALOLA`, { form: 'FOO_ALOLA' });

  const forms = await formsOf([form(1), form(2), form(3), form(4)], { listing });

  // Dex 3 is listed with a shiny and no icon: the shiny follows from the form's own icon, not from the listing alone.
  expect(forms.map(({ dex, icon, shiny }) => [dex, icon, shiny])).toStrictEqual([
    [1, 'pm1.fALOLA.icon.png', 'pm1.fALOLA.s.icon.png'],
    [2, 'pm2.fALOLA.icon.png', null],
    [3, null, null],
    [4, null, null],
  ]);
});

/**
 * The `isCostume` forms that have artwork, beside the costumes only the artwork knows (`pm25.cHOLIDAY_2016.icon.png`).
 * `costume.test.mts` reads the vended fixture, which is this function's own output, so a change here would move the two
 * together and pass.
 */
test('a costume is a marked form with artwork or artwork alone, sorted by dex and then icon', async () => {
  const pikachu = (name: string) =>
    species(`V0025_POKEMON_PIKACHU_${name}`, { pokemonId: 'PIKACHU', form: `PIKACHU_${name}` });

  const listing = {
    tree: [
      // Out of order, and the marked form's costume is made before the artwork-only ones: only the sort orders them.
      'pm172.cWINTER_2020_NOEVOLVE.icon.png',
      'pm25.cHOLIDAY_2016.icon.png',
      'pm25.cHOLIDAY_2016.s.icon.png',
      'pm10.cFLOWER_CROWN.icon.png',
      'pm25.fGOFEST_2026_CAP_RED.icon.png',
      'pm25.fGOFEST_2026_CAP_RED.s.icon.png',
      'pm25.fNORMAL.icon.png',
    ].map((path) => ({ path })),
  };

  const { costumes } = await load(
    [
      PLAYER_LEVEL,
      ...POWER_UP,
      {
        templateId: 'FORMS_V0025_POKEMON_PIKACHU',
        data: {
          formSettings: {
            pokemon: 'PIKACHU',
            forms: [
              { form: 'PIKACHU_NORMAL' },
              { form: 'PIKACHU_GOFEST_2026_CAP_RED', isCostume: true },
              { form: 'PIKACHU_NO_ARTWORK', isCostume: true },
            ],
          },
        },
      },
      pikachu('NORMAL'),
      pikachu('GOFEST_2026_CAP_RED'),
      pikachu('NO_ARTWORK'),
    ],
    { listing },
  );

  expect(costumes).toStrictEqual([
    { dex: 10, name: 'Flower Crown', icon: 'pm10.cFLOWER_CROWN.icon.png', shiny: null },
    { dex: 25, name: 'Holiday 2016', icon: 'pm25.cHOLIDAY_2016.icon.png', shiny: 'pm25.cHOLIDAY_2016.s.icon.png' },
    {
      dex: 25,
      name: 'Gofest 2026 Cap Red',
      icon: 'pm25.fGOFEST_2026_CAP_RED.icon.png',
      shiny: 'pm25.fGOFEST_2026_CAP_RED.s.icon.png',
    },
    { dex: 172, name: 'Winter 2020', icon: 'pm172.cWINTER_2020_NOEVOLVE.icon.png', shiny: null },
  ]);
});
