/**
 * The game master, the string table and the icon listing, downloaded and cached on disk, which is the half of
 * `../game-master.mts` only the CLIs have: a browser has no disk to keep a week's copy on, and the pages read the
 * vended `data/game-master.json` the build publishes rather than the 23 MB it is made from.
 *
 * Every download is cached for a week, the game master being 19 MB and a scan of a few thousand Pokémon not the moment
 * to discover the network is down.
 */

import { said } from '../../errors.ts';
import { ICON_BASE, ICON_DIR, shinyIcon } from '../../pokedex/icons.ts';
import { titleise } from '../../pokemon/names.ts';
import { MAX_LEVEL, type CombatMove, type Costume, type Form, type GameData, type Move } from '../game-master.mts';
import { decodePng, type Image } from '../png.mts';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The game master as alexelgt's bot dumps it from the game, about once a day: the array of `{ templateId, data }` the
 * templates below are read from, current within a day or so of each season's rebalance of moves. How current matters
 * to `pnpm battle`, which judges every shield and throw by the power, energy and move pools in it.
 */
const GAME_MASTER = 'https://raw.githubusercontent.com/alexelgt/game_masters/master/GAME_MASTER.json';

/** The English string table, from PokeMiners' `pogo_assets`, there being none beside alexelgt's game master. */
const STRINGS =
  'https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/Texts/Latest%20APK/JSON/i18n_english.json';

/**
 * What `pogo_assets` holds under `ICON_DIR`, which is 3,792 names in 874 KB and the only thing that says whether a form
 * has artwork at all. The contents endpoint caps at 1,000 entries and would truncate silently, where this one answers
 * `truncated: false`.
 */
const ICON_INDEX =
  'https://api.github.com/repos/PokeMiners/pogo_assets/git/trees/master:' + encodeURIComponent(ICON_DIR);

/**
 * Where that listing is cached, derived from `ICON_DIR` rather than written down beside it. `cached` keys on the file
 * name and a week's grace alone, so a fixed name across a change of directory answers the new URL with the old
 * directory's listing until the week is out.
 *
 * Exported for `cli.test.mts` and `phone.test.mts`, which seed a cache to keep themselves off the network: a name
 * transcribed there would seed a file the reader no longer asks for, and the test would pass on a download it meant to
 * have prevented.
 */
export const ICON_CACHE = `icons-${ICON_DIR.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}.json`;

/**
 * Where the game master is cached, named for whose dump it is and derived from `GAME_MASTER` for the reason
 * `ICON_CACHE` is: a fixed name across a change of source answers the new one with the old one's copy until the week
 * is out. Exported for `cli.test.mts` and `phone.test.mts`, which seed it.
 */
export const GAME_MASTER_CACHE = `game-master-${new URL(GAME_MASTER).pathname.split('/')[1]?.toLowerCase()}.json`;

const WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Where the downloads are kept between runs, under the working directory and resolved against it once, as the module
 * loads. Absolute because a relative one spins a core forever once the working directory is deleted: `cached`'s
 * recursive `mkdirSync` retries a relative path's `ENOENT` without end on Node 24, which Node fixed in 26.11.0 and has
 * not backported ([nodejs/node#66268](https://github.com/nodejs/node/issues/66268)). Resolved here, a directory already
 * gone throws `ENOENT` from `process.cwd()` before anything starts, and one deleted later is made again.
 */
export const CACHE = resolve('.cache/inventory');

/** A move as trainer battles have it, which a `COMBAT_` template holds. */
interface CombatTemplate {
  type: string;
  power?: number;
  energyDelta?: number;
  durationTurns?: number;
  vfxName?: string;
  buffs?: {
    buffActivationChance?: number;
    attackerAttackStatStageChange?: number;
    attackerDefenseStatStageChange?: number;
    targetAttackStatStageChange?: number;
    targetDefenseStatStageChange?: number;
  };
}

interface Template {
  templateId: string;
  data: {
    pokemonSettings?: {
      pokemonId: string;
      type: string;
      type2?: string;
      stats: { baseAttack?: number; baseDefense?: number; baseStamina?: number };
      quickMoves?: string[];
      cinematicMoves?: string[];
      eliteQuickMove?: string[];
      eliteCinematicMove?: string[];
      nonTmCinematicMoves?: string[];
      shadow?: { shadowChargeMove?: string; purifiedChargeMove?: string };

      /** Each evolution, with the candy it costs; a mega evolution is a branch too, costing energy and no candy. */
      evolutionBranch?: { candyCost?: number }[];

      /**
       * The form's name, or its number where it is too new for the names the dump was made with: `3362` for Zubat's
       * Halloween 2026 costume, the week it arrived.
       */
      form?: string | number;

      /** The forms this one changes into, and the charged moves each change hands over: Kyurem's Freeze Shock. */
      formChange?: {
        availableForm: string[];
        moveReassignment?: { cinematicMoves?: { replacementMoves?: string[] }[] };
      }[];

      /**
       * Each Mega Evolution or Primal Reversion, `TEMP_EVOLUTION_MEGA_Y` and the like, with its own stats and types,
       * and its mega move by the id of the `COMBAT_VM_MOVE_` template that holds it.
       */
      tempEvoOverrides?: {
        tempEvoId?: string;
        stats?: { baseAttack?: number; baseDefense?: number; baseStamina?: number };
        typeOverride1?: string;
        typeOverride2?: string;
        specialMove?: string;
      }[];
    };
    formSettings?: {
      pokemon: string;
      forms?: { form: string | number; isCostume?: boolean }[];
    };

    /** The animation the move plays, which a mega move shares with the move it is a stronger copy of. */
    moveSettings?: { vfxName?: string };

    combatMove?: CombatTemplate;
    pokemonExtendedSettings?: {
      sizeSettings: {
        xxsLowerBound: number;
        xsLowerBound: number;
        mLowerBound: number;
        mUpperBound: number;
        xlUpperBound: number;
        xxlUpperBound: number;
      };
    };
    typeEffective?: { attackType: string; attackScalar: number[] };
    playerLevel?: { cpMultiplier: number[] };
    pokemonUpgrades?: {
      stardustCost: number[];
      shadowStardustMultiplier: number;
      purifiedStardustMultiplier: number;
    };
    luckyPokemonSettings?: { powerUpStardustDiscountPercent: number };
  };
}

/**
 * The order of `typeEffective.attackScalar`, which is the game's `PokemonType` enum from `NORMAL` = 1. The templates
 * themselves come alphabetically and name only the attacking type, so nothing in the game master states it.
 */
const SCALAR_ORDER = [
  'NORMAL',
  'FIGHTING',
  'FLYING',
  'POISON',
  'GROUND',
  'ROCK',
  'BUG',
  'GHOST',
  'STEEL',
  'FIRE',
  'WATER',
  'GRASS',
  'ELECTRIC',
  'PSYCHIC',
  'ICE',
  'DRAGON',
  'DARK',
  'FAIRY',
];

/** What a form has to be called to be the species' ordinary one, which decides its display name and its icon alike. */
const ORDINARY = /(^|_)NORMAL$/;

/**
 * The charged moves a form gains with the change into it where no `formChange` says so, by the form's name. The game
 * master gives Origin Forme Dialga and Palkia the Altered Forme's pools and no change into either, but they hold Roar of
 * Time and Spacial Rend: a Pixel 8 Pro showed Palkia's, and PvPoke's `dialga_origin` and `palkia_origin` list both.
 */
const GRANTED: Record<string, string[]> = {
  DIALGA_ORIGIN: ['ROAR_OF_TIME'],
  PALKIA_ORIGIN: ['SPACIAL_REND'],
};

/**
 * How the game names each kind of temporary evolution, by its `tempEvoId`. The number is the one its name has in the
 * string table, `pokemon_name_0150_0003` being Mega Mewtwo Y: the game's own enum, which the game master never states,
 * any more than it states `SCALAR_ORDER`. The name is for a Mega the table does not name yet, as 13 of the 63 went
 * unnamed on 2026-11-10, and is how it names every one of the 50 it does.
 */
const TEMPORARY: Record<string, { number: string; name: (species: string) => string }> = {
  TEMP_EVOLUTION_MEGA: { number: '0001', name: (species) => `Mega ${species}` },
  TEMP_EVOLUTION_MEGA_X: { number: '0002', name: (species) => `Mega ${species} X` },
  TEMP_EVOLUTION_MEGA_Y: { number: '0003', name: (species) => `Mega ${species} Y` },
  TEMP_EVOLUTION_PRIMAL: { number: '0004', name: (species) => `Primal ${species}` },
};

/**
 * Which file holds a form's artwork, or null where the directory holds none.
 *
 * The name is the form's own rather than a number: `assetBundleValue` is not how these assets are named and is not even
 * unique, Zygarde's 50% and Complete 50% both carrying `1`. Two candidates for a named form, the species prefix being
 * kept for some and dropped for others with nothing in the game master saying which. Measured over 1,352 non-costume
 * forms, 262 resolve trimmed and 34 full, and **none resolve both ways**, so asking the index settles it.
 *
 * The bare `pm{dex}.icon.png` is a third candidate and **only** for the ordinary form, 14 families' worth: no
 * `fNORMAL` exists for Frillish, so its male would be the one member of its pair with no icon. Only the ordinary one,
 * because offered to `RAIKOU_S` it would hand two forms one signature — the indecision `assetBundleValue` caused. And
 * a fallback rather than a replacement, `GENESECT_NORMAL` having an `fNORMAL` and no bare name at all.
 */
function iconName(index: ReadonlySet<string>, dex: number, suffix: string, form: string | undefined): string | null {
  const named = form === undefined ? [] : [`pm${dex}.f${suffix}.icon.png`, `pm${dex}.f${form}.icon.png`];
  const ordinary = form === undefined || ORDINARY.test(suffix);
  const names = ordinary ? [...named, `pm${dex}.icon.png`] : named;

  return names.find((name) => index.has(name)) ?? null;
}

/**
 * The directory listing, which makes a form's artwork addressable without probing for it: fetching the 162 files that
 * exist beats probing all 237, and it is what lets a family short of one icon be reported once ahead of the download
 * rather than discovered as a 404 per form on every scan. An improvement rather than a prerequisite, so failing to
 * read one costs the artwork narrowing and not the scan.
 */
async function iconIndex(dir: string, refresh: boolean): Promise<ReadonlySet<string>> {
  try {
    // Refused rather than read: a truncated listing is the stale directory's failure by another route — every name it
    // carries resolves, and the forms whose icon it dropped go unnarrowed with nothing to say so. Thrown from the
    // decode so `cachedAs` drops the copy, which kept would answer for the week. There is room for now, 895 KB against
    // the tree endpoint's 7 MB, but headroom is not a guard.
    const listing = await cachedAs(dir, ICON_CACHE, ICON_INDEX, refresh, (bytes) => {
      const parsed = JSON.parse(String(bytes)) as { tree?: { path: string }[]; truncated?: boolean };

      if (parsed.truncated) {
        throw new Error('the listing is truncated, so it names only some of the artwork');
      }

      return parsed;
    });

    return new Set((listing.tree ?? []).map((entry) => entry.path));
  } catch (error) {
    console.error(`  ${said(error)}; no form is narrowed by its artwork`);

    return new Set();
  }
}

export async function loadGameData(cacheDir: string, refresh = false): Promise<GameData> {
  const templates = (await cachedJson(cacheDir, GAME_MASTER_CACHE, GAME_MASTER, refresh)) as Template[];
  const index = await iconIndex(cacheDir, refresh);
  const flat = ((await cachedJson(cacheDir, 'english.json', STRINGS, refresh)) as { data: string[] }).data;
  const strings = new Map<string, string>();

  for (let i = 0; i + 1 < flat.length; i += 2) {
    strings.set(flat[i] ?? '', flat[i + 1] ?? '');
  }

  const typeName = (t: string) => {
    const key = t.replace(/^POKEMON_TYPE_/, '').toLowerCase();
    return strings.get(`pokemon_type_${key}`) ?? titleise(key);
  };

  const costumes = new Set<string | number>();

  for (const { data } of templates) {
    for (const f of data.formSettings?.forms ?? []) {
      if (f.isCostume) {
        costumes.add(f.form);
      }
    }
  }

  const moves: Move[] = [];
  const byId = new Map<string, Move>();

  // Each charged move by the animation it plays, the first-numbered where several share one: what names a mega move.
  const animations = new Map<string, Move>();

  for (const { templateId, data } of templates) {
    // `movementId` is a name for most moves and a bare number for a few, so the template's own id is the one to read.
    const match = /^V(\d{4})_MOVE_(\w+)$/.exec(templateId);
    const id = match?.[2];

    if (!data.moveSettings || !match || id === undefined) {
      continue;
    }

    const fast = id.endsWith('_FAST');
    const move = { name: strings.get(`move_name_${match[1]}`) ?? titleise(id.replace(/_FAST$/, '')), fast };
    const animation = data.moveSettings.vfxName;

    moves.push(move);
    byId.set(id, move);

    if (!fast && animation !== undefined && !animations.has(animation)) {
      animations.set(animation, move);
    }
  }

  const combatOf = ({ type, power, energyDelta, durationTurns, buffs }: CombatTemplate): CombatMove => ({
    type: typeName(type),
    power: power ?? 0,
    energy: energyDelta ?? 0,
    turns: (durationTurns ?? 0) + 1,

    // Secret Sword carries an empty `buffs`, which changes nothing.
    ...(buffs?.buffActivationChance && {
      buffs: {
        chance: buffs.buffActivationChance,
        ownAttack: buffs.attackerAttackStatStageChange,
        ownDefense: buffs.attackerDefenseStatStageChange,
        theirAttack: buffs.targetAttackStatStageChange,
        theirDefense: buffs.targetDefenseStatStageChange,
      },
    }),
  });

  const combat: GameData['combat'] = {};

  for (const { templateId, data } of templates) {
    const match = /^COMBAT_V(\d{4})_MOVE_(\w+)$/.exec(templateId);
    const name = match && (strings.get(`move_name_${match[1]}`) ?? titleise(match[2]?.replace(/_FAST$/, '') ?? ''));

    // A name can be several templates — Blastoise's own 90-power Hydro Pump beside everyone's 130, Weather Ball once
    // per type — and the screen shows only the name, so the first-numbered stands for it: the ordinary move, or for a
    // move varying by type, its first type. Splash and Transform have no power at all rather than a power of 0.
    if (data.combatMove && name && !(name in combat)) {
      combat[name] = combatOf(data.combatMove);
    }
  }

  // A mega move is a template of its own, `COMBAT_VM_MOVE_` and the id a Mega's `specialMove` names, with no name in the
  // string table: Mega Mewtwo Y's is Future Sight's animation at 130 power for 80 energy. It is named for the move whose
  // animation it plays, with the `+` the game gives Apex Lugia's Aeroblast+: `FUTURE SIGHT+` is what its button reads,
  // and how PvPoke names all 18 it lists. Each of the 19 shares its animation with exactly one charged move.
  const megaMoves = new Map<string, Move>();

  for (const { templateId, data } of templates) {
    const special = /^COMBAT_VM_MOVE_(\w+)$/.exec(templateId)?.[1];

    if (data.combatMove && special !== undefined) {
      const { vfxName = '' } = data.combatMove;
      const name = `${animations.get(vfxName)?.name ?? titleise(vfxName)}+`;
      const known = moves.find((m) => m.name === name);
      const move = known ?? { name, fast: false };

      if (!known) {
        moves.push(move);
      }

      combat[name] ??= combatOf(data.combatMove);
      megaMoves.set(special, move);
    }
  }

  const effectiveness: GameData['effectiveness'] = {};

  for (const { data } of templates) {
    if (data.typeEffective) {
      const { attackType, attackScalar } = data.typeEffective;

      effectiveness[typeName(attackType)] = Object.fromEntries(
        SCALAR_ORDER.map((type, i) => [typeName(type), attackScalar[i] ?? 1]),
      );
    }
  }

  // What a change of form hands over, by the form changed into: Black Kyurem's Freeze Shock is in neither its pools nor
  // Kyurem's, only in the `moveReassignment` of the change from one to the other, which Kyurem's bare template and its
  // `_NORMAL` one both carry. Hence a set of the pool's moves, which also holds Keldeo's Sacred Sword only once.
  const granted = new Map(Object.entries(GRANTED));

  for (const { data } of templates) {
    for (const change of data.pokemonSettings?.formChange ?? []) {
      const replacements = (change.moveReassignment?.cinematicMoves ?? []).flatMap((m) => m.replacementMoves ?? []);

      for (const form of change.availableForm) {
        granted.set(form, [...(granted.get(form) ?? []), ...replacements]);
      }
    }
  }

  // A form's size bands are in a template of their own, named for the form's with `EXTENDED_` in front: every one of
  // them but Minior's eight Meteor forms has one.
  const heights = new Map<string, Form['heights']>();

  for (const { templateId, data } of templates) {
    const size = data.pokemonExtendedSettings?.sizeSettings;

    if (size) {
      heights.set(templateId.replace(/^EXTENDED_/, ''), [
        size.xxsLowerBound,
        size.xsLowerBound,
        size.mLowerBound,
        size.mUpperBound,
        size.xlUpperBound,
        size.xxlUpperBound,
      ]);
    }
  }

  const forms: Form[] = [];
  const megas: Form[] = [];
  const bare = new Map<number, Form>();

  for (const { templateId, data } of templates) {
    const settings = data.pokemonSettings;
    const match = /^V(\d{4})_POKEMON_(.*)$/.exec(templateId);

    if (!settings || !match) {
      continue;
    }

    // A form's template is named for it after the dex — `V0034_POKEMON_NIDOKING_NORMAL` holds `NIDOKING_NORMAL`, as all
    // 1,465 named ones in the dump do — so the template names a form that arrived as its number.
    const name = typeof settings.form === 'number' ? match[2] : settings.form;
    const dex = Number(match[1]);
    const { baseAttack = 0, baseDefense = 0, baseStamina = 0 } = settings.stats;
    const prefix = `${settings.pokemonId}_`;
    const suffix = name?.startsWith(prefix) ? name.slice(prefix.length) : (name ?? '');
    const icon = iconName(index, dex, suffix, name);
    const shiny = icon === null ? null : shinyIcon(icon);
    const form: Form = {
      dex,
      species: strings.get(`pokemon_name_${match[1]}`) ?? titleise(settings.pokemonId),

      // Nidoran's is `NIDORAN_NORMAL` under a `pokemonId` of `NIDORAN_FEMALE`, so the prefix test alone misses it. A
      // species with no forms at all, as Ogerpon is upstream, has nothing to test and is ordinary too.
      form: name === undefined || ORDINARY.test(suffix) ? null : titleise(suffix),

      // By the form as the form settings give it too, which is the number where the name is missing.
      costume: settings.form !== undefined && costumes.has(settings.form),
      icon,
      shiny: shiny !== null && index.has(shiny) ? shiny : null,
      types: [settings.type, settings.type2].filter((t) => t !== undefined).map(typeName),
      attack: baseAttack,
      defense: baseDefense,
      stamina: baseStamina,
      heights: heights.get(templateId) ?? null,

      // A handful of pool entries are bare numbers where every move template is named, so some do not resolve; the
      // reader falls back on the whole list when nothing in the pool fits, which is also what covers a move the game
      // has since dropped from the pool of a Pokémon still holding it.
      moves: [
        ...new Set([
          ...(settings.quickMoves ?? []),
          ...(settings.eliteQuickMove ?? []),
          ...(settings.cinematicMoves ?? []),
          ...(settings.eliteCinematicMove ?? []),
          ...(settings.nonTmCinematicMoves ?? []),
          ...[settings.shadow?.shadowChargeMove, settings.shadow?.purifiedChargeMove].filter((m) => m !== undefined),
          ...(granted.get(name ?? '') ?? []),
        ]),
      ]
        .map((id) => byId.get(id))
        .filter((m) => m !== undefined),
      evolveCandy: [
        ...new Set((settings.evolutionBranch ?? []).flatMap((b) => (b.candyCost === undefined ? [] : [b.candyCost]))),
      ],

      // No field says a form exists only as a shadow. What says it is the move shadowing one teaches: Frustration on
      // every form that has a shadow at all but the two Apex forms, whose `shadowChargeMove` is their own Aeroblast+
      // and Sacred Fire+. `RAIKOU_S` and its kind keep Frustration, and nothing in the data says they are shadows.
      shadowOnly: (settings.shadow?.shadowChargeMove ?? 'FRUSTRATION') !== 'FRUSTRATION',
    };

    // A Mega is the ordinary form's, whose bare template and `_NORMAL` one both carry it, as some costumes do too. It
    // keeps that form's moves and adds its mega move, where it has one.
    for (const override of form.costume || form.form !== null ? [] : (settings.tempEvoOverrides ?? [])) {
      const { tempEvoId = '', stats, typeOverride1, typeOverride2, specialMove = '' } = override;
      const kind = TEMPORARY[tempEvoId];
      const species = kind && (strings.get(`pokemon_name_${match[1]}_${kind.number}`) ?? kind.name(form.species));

      if (!kind || !species || megas.some((mega) => mega.species === species)) {
        continue;
      }

      const kindName = tempEvoId.replace(/^TEMP_EVOLUTION_/, '');
      const artwork = iconName(index, dex, kindName, `${settings.pokemonId}_${kindName}`);
      const megaMove = megaMoves.get(specialMove);

      megas.push({
        dex,
        species,
        form: null,
        costume: false,
        icon: artwork,
        shiny: artwork !== null && index.has(shinyIcon(artwork)) ? shinyIcon(artwork) : null,
        types: [typeOverride1, typeOverride2].filter((t) => t !== undefined).map(typeName),
        attack: stats?.baseAttack ?? 0,
        defense: stats?.baseDefense ?? 0,
        stamina: stats?.baseStamina ?? 0,
        heights: null,
        moves: megaMove ? [...form.moves, megaMove] : form.moves,
        evolveCandy: [],
        shadowOnly: false,
        ...(megaMove && { megaMove: megaMove.name }),
      });
    }

    // A species with forms is listed once bare and once per form, the bare entry repeating the `_NORMAL` one. Keep it
    // only for species that have nothing else.
    if (name === undefined) {
      bare.set(dex, form);
    } else {
      forms.push(form);
    }
  }

  for (const [dex, form] of bare) {
    if (!forms.some((f) => f.dex === dex)) {
      forms.push(form);
    }
  }

  // The game master's costumes and the ones only the artwork knows, as `Costume` describes. `_NOEVOLVE` is a second
  // icon for a costume the game also hands out unable to evolve, which is nothing the column says.
  const shinyOf = (icon: string) => (index.has(shinyIcon(icon)) ? shinyIcon(icon) : null);
  const costumed: Costume[] = forms.flatMap((f) =>
    f.costume && f.form !== null && f.icon !== null ? [{ dex: f.dex, name: f.form, icon: f.icon, shiny: f.shiny }] : [],
  );

  for (const icon of index) {
    const match = /^pm(\d+)\.c([A-Z0-9_]+?)(?:_NOEVOLVE)?\.icon\.png$/.exec(icon);

    if (match) {
      costumed.push({ dex: Number(match[1]), name: titleise(match[2] ?? ''), icon, shiny: shinyOf(icon) });
    }
  }

  const table = templates.find((t) => t.data.playerLevel)?.data.playerLevel?.cpMultiplier ?? [];
  const cpm: [number, number][] = [];

  for (let level = 1; level <= MAX_LEVEL; level++) {
    const here = table[level - 1];
    const next = table[level];

    if (here === undefined) {
      throw new Error(`the game master has no CP multiplier for level ${level}`);
    }

    cpm.push([level, here]);

    // A half level's multiplier is the root mean square of the two either side of it; the table only holds whole ones.
    if (level < MAX_LEVEL && next !== undefined) {
      cpm.push([level + 0.5, Math.sqrt((here * here + next * next) / 2)]);
    }
  }

  const upgrades = templates.find((t) => t.data.pokemonUpgrades)?.data.pokemonUpgrades;
  const lucky = templates.find((t) => t.data.luckyPokemonSettings)?.data.luckyPokemonSettings;

  if (upgrades === undefined || lucky === undefined) {
    throw new Error('the game master states no power-up costs, for a lucky Pokémon or at all');
  }

  return {
    forms: forms.sort((a, b) => a.dex - b.dex),
    costumes: costumed.sort((a, b) => a.dex - b.dex || a.icon.localeCompare(b.icon)),
    moves,
    species: [...new Set(forms.map((f) => f.species))],
    types: [...new Set(forms.flatMap((f) => f.types))],
    megas: megas.sort((a, b) => a.dex - b.dex),
    cpm,
    combat,
    effectiveness,
    powerUp: {
      stardust: upgrades.stardustCost,
      shadow: upgrades.shadowStardustMultiplier,
      purified: upgrades.purifiedStardustMultiplier,
      lucky: lucky.powerUpStardustDiscountPercent,
    },
  };
}

/**
 * `GITHUB_TOKEN` for GitHub's API, and for nowhere else: the artwork listing is the one download it answers, and with no
 * token it answers an address only 60 times an hour, which a few cold runs and anything else on the network can spend.
 */
function authorised(url: string): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;

  return token && new URL(url).host === 'api.github.com' ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * A download kept under `dir` for a week, or the copy from before where the network fails. Throws where there is
 * neither.
 */
export async function cached(dir: string, file: string, url: string, refresh: boolean): Promise<Buffer> {
  const path = join(dir, file);

  if (!refresh && existsSync(path) && Date.now() - statSync(path).mtimeMs < WEEK) {
    return readFileSync(path);
  }

  // Ungated, because the week's grace above already gates it: this line is reached only where the copy is missing or
  // out of date, so it prints on the cold or stale run and never on the warm one `--verbose` was added to quieten. That
  // is also the run that has minutes of silence to account for, and a flag cannot be added once the wait has started.
  console.error(`Downloading ${url}`);

  let bytes: Buffer;

  try {
    // `fetch` rejects rather than answering when there is no network at all, which is the case a stale copy is most
    // wanted for, so the fallback has to cover a throw as well as a status.
    const response = await fetch(url, { headers: authorised(url) });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    const reason = said(error);

    // Naming the URL rather than leaning on the line above it. `iconsFor` keeps 16 downloads in flight, so the
    // `Downloading` this reads as a continuation of is rarely the line printed before it, and a bare `fetch failed;
    // using the copy from before` cannot say which of the three files or which of ~162 icons went stale.
    if (existsSync(path)) {
      console.error(`  ${url}: ${reason}; using the copy from before`);
      return readFileSync(path);
    }

    throw new Error(`${url}: ${reason}`, { cause: error });
  }

  // Written beside the copy and renamed over it, because the week's grace above trusts any file it finds: one cut short
  // by a scan killed mid-write or a full disk would otherwise be read back, and fail to parse, until the week was out.
  const partial = `${path}.${process.pid}`;

  mkdirSync(dir, { recursive: true });
  writeFileSync(partial, bytes);
  renameSync(partial, path);

  return bytes;
}

/**
 * A download read into whatever it holds, with the URL named whichever step failed. `response.ok` passes a 200
 * carrying an error page in place of JSON or a PNG, so the bytes that will not decode are the ones already cached and
 * the download that fetched them is over.
 *
 * Named here rather than at the two callers, because they are the ones that cannot: each relays a failure as a
 * two-space continuation rather than a crash, and a message naming nothing says neither which of the three files nor
 * which of ~162 icons went unread.
 *
 * The copy is dropped rather than kept, this being the only place that knows it is no good — `cached` would read it
 * back for the rest of the week, past its own `Downloading` line. Dropped whether it was downloaded here or read off
 * disk, bytes that do not decode being no more use on a second reading than a first.
 */
export async function cachedAs<T>(
  dir: string,
  file: string,
  url: string,
  refresh: boolean,
  decode: (bytes: Buffer) => T,
): Promise<T> {
  const bytes = await cached(dir, file, url, refresh);

  try {
    return decode(bytes);
  } catch (error) {
    rmSync(join(dir, file), { force: true });

    throw new Error(`${url}: ${said(error)}`, { cause: error });
  }
}

async function cachedJson(dir: string, file: string, url: string, refresh: boolean): Promise<unknown> {
  return cachedAs(dir, file, url, refresh, (bytes) => JSON.parse(String(bytes)));
}

/** An icon out of the cache beside the game master, downloaded the first time it is asked for. */
export const cachedIcon =
  (dir: string, refresh = false) =>
  (file: string): Promise<Image> =>
    cachedAs(join(dir, 'icons'), file, ICON_BASE + file, refresh, decodePng);
