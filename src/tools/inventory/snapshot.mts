/**
 * PGSharp's `PGSStats.json` export turned into the rows `pnpm inventory scan` writes, one per stored Pokémon. The export
 * is the account the game itself holds, decoded: every field is read straight off it rather than off the screen, so the
 * IVs, moves, form and shininess the OCR walk has to recover — or cannot get at all — are here exactly, and a box that
 * took the walk a day comes over in the time it takes to parse.
 *
 * The output row is the one the walk produced, field for field, so nothing downstream has to know where it came from,
 * with the raw game IDs each field was derived from kept beside it under `raw` — the species, form, move and costume
 * enums as the export states them — so a resolution that went wrong is visible and nothing from the export is lost.
 *
 * This is a pure function of the export, the game master and a move table: the loader that reaches the phone and reads
 * the raw game master lives apart, in the scan script, so the suite can hold the conversion to a made-up export without
 * a phone or a 23 MB game master. The export's 64-bit IDs — a Pokémon's own and the IDs it names its tags by — arrive
 * as strings, `JSON.parse` losing the low digits of a number that large, so `parseSnapshot` below keeps them exact as
 * strings, and taking them as strings is this function's contract.
 */

import { type Gender } from './badges.mts';
import { type Max } from './detail.mts';
import { BANDS, type Form, type GameData, type IVs, type Size } from '../../core/game-master.mts';
import { type Moves } from '../../core/moves.mts';
import { fold } from '../../core/ocr.mts';

/** A Pokémon's `pokemonDisplay`, the enums the game draws it by. Null on an egg, which carries none. */
export interface Display {
  form: number;
  formName: string;
  costume: number;

  /** 1 male, 2 female, 3 genderless, 0 unset. */
  gender: number;

  shiny: boolean;

  /** 0 none, 1 shadow, 2 purified. */
  alignment: number;

  /** 0 none, 1 Dynamax, 2 Gigantamax; 4 on the Crowned and Eternatus forms, which show no Max row. */
  breadModeEnum: number;
}

/** The fields this reads of one Pokémon in the export. `id` and `pokemonTagIds` are the 64-bit IDs kept as strings. */
export interface Mon {
  id: string;

  /** The species, which is its National Pokédex number. */
  pokemonId: number;

  nickname: string;
  cp: number;

  /**
   * The CP multiplier the Pokémon's level sits at, and the remainder the game adds to it: a best buddy's boost and
   * whatever else the export splits off, 0 for most. The level is the two together — the export stores a Pokémon the
   * user has tagged `Level 50` at `cpMultiplier` 0.597 (level 20 on its own) with the rest in `additionalCpMultiplier`,
   * and its CP comes out right only on the sum.
   */
  cpMultiplier: number;
  additionalCpMultiplier: number;

  individualAttack: number;
  individualDefense: number;
  individualStamina: number;

  /** The maximum HP, which the detail screen shows and the walk reads. */
  maxStamina: number;

  /** The fast move, then the first and second charged, a charged slot 0 where there is none. */
  move1: number;
  move2: number;
  move3: number;

  weightKg: number;
  heightM: number;

  /** 0 unset, 1 XXS, 2 XS, 3 normal, 4 XL, 5 XXL. */
  size: number;

  favorite: boolean;
  isLucky: boolean;
  isEgg: boolean;
  pokemonTagIds: string[];
  pokemonDisplay: Display | null;
}

/** A tag the account named, which a Pokémon points at by `id`. */
export interface Tag {
  id: string;
  name: string;
}

/** The parts of `PGSStats.json` this reads. */
export interface Snapshot {
  pokemons: Mon[];
  tags: Tag[];
}

/** The raw game IDs a row was derived from, kept beside it so a resolution gone wrong is visible. */
export interface Raw {
  id: string;
  pokemonId: number;
  form: number;
  formName: string;
  costume: number;
  gender: number;
  size: number;
  alignment: number;
  breadMode: number;
  move1: number;
  move2: number;
  move3: number;
  cpMultiplier: number;
  additionalCpMultiplier: number;
}

/** The row for one stored Pokémon, the schema `pnpm inventory scan` has always written, with `raw` added. */
export interface Row {
  index: number;
  species: string | null;
  nickname: string | null;
  dex: number | null;
  form: string | null;
  gender: Gender | null;
  favourite: boolean;
  tags: string[];
  shiny: boolean;
  lucky: boolean;
  size: Size | null;
  shadow: boolean;
  purified: boolean;
  max: Max | null;
  cp: number | null;
  hp: number | null;
  levels: number[];
  iv: IVs | null;
  moves: Moves;
  weight: number | null;
  height: number | null;
  types: string[];
  notes: string[];
  costume: string[] | null;
  raw: Raw;
}

/**
 * Drop everything two form names differ by but the letters and digits: the spaces, case, punctuation and the accents
 * `fold` folds, so `AdventureHat2020` meets `Adventure Hat 2020` and the export's ASCII `Flabebe` meets the game
 * master's `Flabébé`, whose prefix would otherwise never strip. Exported for the Pokédex's owned-form reconciliation,
 * which squashes a resolved form name the same way to match it against the dex's own spelling.
 */
export const squash = (text: string): string => fold(text).replace(/[^a-z0-9]/g, '');

/** A suffix the export spells for the ordinary form, which the game master gives a null `form`. */
const ORDINARY = new Set(['', 'normal', 'unset']);

/** What `formName` resolved to: the Pokédex form, the costume worn over it, and a note where a form went unmatched. */
interface Resolved {
  form: Form | null;
  costume: string | null;
  note: string | null;
}

/**
 * The plainest form among a dex's that is not a costume: the ordinary form where there is one, the shortest-named
 * otherwise. Sinistea and Polteageist have no ordinary form, only `Antique` and `Phony`, and their costumes are named
 * for the base they sit on — `A Halloween 2026 01`, `P Halloween 2026 01` — so where a costume is given its base is the
 * form whose name shares its first letter.
 */
function baseForm(candidates: readonly Form[], costume: string | null): Form | null {
  const plain = candidates.filter((form) => !form.costume);
  const ordinary = plain.find((form) => form.form === null);

  if (ordinary) {
    return ordinary;
  }

  const letter = costume === null ? null : squash(costume).charAt(0);
  const shared = letter === null ? undefined : plain.find((form) => squash(form.form ?? '').charAt(0) === letter);

  return shared ?? [...plain].sort((a, b) => (a.form?.length ?? 0) - (b.form?.length ?? 0))[0] ?? null;
}

/**
 * The form and costume the export's `formName` names. The species prefix is dropped — `UnownR` to `R`, `MarowakAlola`
 * to `Alola` — and what is left is matched against the dex's forms with the spaces and case squashed out.
 *
 * A costume is a form in the game master but not in the Pokédex, so it is written under `costume` and `form` is left
 * the base form, as the walk writes it: `PikachuGofest2026CapRed` is `form: null, costume: ['Gofest 2026 Cap Red']`.
 * The base is the plainest form that is not a costume — the shortest-named, the ordinary form where there is one and a
 * costume's base where there is not, costumes sorted last so a costume never stands in for the base.
 *
 * `Unset` and `Normal` are the export's ordinary form; a suffix that matches nothing and is neither is a form the game
 * master does not have, noted rather than filed silently under the base. Megas are left out, as the walk leaves them
 * out: a Pokémon sits in storage as its base form.
 */
function resolveForm(data: GameData, mon: Mon): Resolved {
  const candidates = data.forms.filter((form) => form.dex === mon.pokemonId);

  if (candidates.length === 0) {
    return { form: null, costume: null, note: `species ${mon.pokemonId} is not in the game master` };
  }

  const species = squash(candidates[0]?.species ?? '');
  const spelt = squash(mon.pokemonDisplay?.formName ?? '');
  const suffix = spelt.startsWith(species) ? spelt.slice(species.length) : spelt;

  const match = candidates.find((form) => squash(form.form ?? '') === suffix);

  if (match?.costume) {
    return { form: baseForm(candidates, match.form), costume: match.form, note: null };
  }

  if (match) {
    return { form: match, costume: null, note: null };
  }

  return ORDINARY.has(suffix)
    ? { form: baseForm(candidates, null), costume: null, note: null }
    : {
        form: baseForm(candidates, null),
        costume: null,
        note: `form ${mon.pokemonDisplay?.formName ?? ''} is not in the game master`,
      };
}

/** The size badge the game draws: its own `size` enum, or the height band for the Pokémon caught before it recorded one. */
function sizeOf(form: Form | null, mon: Mon): Size | null {
  if (mon.size >= 1 && mon.size <= 5) {
    return BANDS[mon.size - 1] ?? null;
  }

  const heights = form?.heights;

  if (!heights) {
    return null;
  }

  const band = BANDS.findIndex((_, index) => {
    const low = heights[index];
    const high = heights[index + 1];

    return low !== undefined && high !== undefined && mon.heightM >= low && mon.heightM <= high;
  });

  return band === -1 ? null : (BANDS[band] ?? null);
}

/**
 * The level a CP multiplier puts the Pokémon at: the nearest the game master has, which for any real CPM is exact. The
 * caller passes the whole multiplier — `cpMultiplier` plus `additionalCpMultiplier` — since the game stores a boosted
 * Pokémon's base and boost apart and the level is the two together.
 */
function levelsOf(data: GameData, multiplier: number): number[] {
  let nearest: number | null = null;
  let closest = Infinity;

  for (const [level, cpm] of data.cpm) {
    const gap = Math.abs(cpm - multiplier);

    if (gap < closest) {
      closest = gap;
      nearest = level;
    }
  }

  return nearest === null ? [] : [nearest];
}

/** The gender the game draws, or null where the export states none. */
function genderOf(code: number): Gender | null {
  return code === 1 ? 'male' : code === 2 ? 'female' : code === 3 ? 'genderunknown' : null;
}

/** The fast move and the charged moves, by name, a move the game master does not number left out. */
function movesOf(moveNumbers: GameData['moveNumbers'], mon: Mon): Moves {
  const charged = [mon.move2, mon.move3].flatMap((id) => {
    const name = id ? moveNumbers[id] : undefined;

    return name === undefined ? [] : [name];
  });

  return { fast: (mon.move1 ? moveNumbers[mon.move1] : undefined) ?? null, charged };
}

/**
 * The costumes a dex could be wearing when the export gives one only by its enum, which has no name of its own: the
 * game master's costumes for the dex, minus the ones that are costume forms, since `formName` would have named those.
 * Null where that leaves nothing, the schema's "nothing answered" — not the empty list, which says a costume was worn
 * and none of them fit.
 */
function enumCostumes(data: GameData, dex: number | null): string[] | null {
  if (dex === null) {
    return null;
  }

  const forms = new Set(data.forms.filter((form) => form.dex === dex && form.costume).map((form) => form.form));
  const names = [
    ...new Set(data.costumes.filter((costume) => costume.dex === dex && !forms.has(costume.name)).map((c) => c.name)),
  ];

  return names.length > 0 ? names : null;
}

/** The row for one stored Pokémon. */
function rowOf(mon: Mon, index: number, data: GameData, tags: ReadonlyMap<string, string>): Row {
  const display = mon.pokemonDisplay;
  const { form, costume: worn, note } = resolveForm(data, mon);

  // A form-named costume (`worn`) is exact, one named only by an enum is every costume the dex could be wearing, as the
  // walk lists it, and the empty list is a Pokémon wearing none.
  const costume = worn !== null ? [worn] : (display?.costume ?? 0) !== 0 ? enumCostumes(data, form?.dex ?? null) : [];

  return {
    index,
    species: form?.species ?? null,
    nickname: mon.nickname === '' ? null : mon.nickname,
    dex: form?.dex ?? null,
    form: form?.form ?? null,
    gender: genderOf(display?.gender ?? 0),
    favourite: mon.favorite,
    tags: mon.pokemonTagIds.flatMap((id) => {
      const name = tags.get(id);

      return name === undefined ? [] : [name];
    }),

    costume,
    shiny: display?.shiny ?? false,
    lucky: mon.isLucky,
    size: sizeOf(form, mon),
    shadow: display?.alignment === 1,
    purified: display?.alignment === 2,
    max: display?.breadModeEnum === 1 ? 'dynamax' : display?.breadModeEnum === 2 ? 'gigantamax' : null,
    cp: mon.cp,
    hp: mon.maxStamina,
    levels: levelsOf(data, mon.cpMultiplier + mon.additionalCpMultiplier),
    iv: { attack: mon.individualAttack, defense: mon.individualDefense, stamina: mon.individualStamina },
    moves: movesOf(data.moveNumbers, mon),
    weight: mon.weightKg,
    height: mon.heightM,
    types: form?.types ?? [],
    notes: note === null ? [] : [note],
    raw: {
      id: mon.id,
      pokemonId: mon.pokemonId,
      form: display?.form ?? 0,
      formName: display?.formName ?? '',
      costume: display?.costume ?? 0,
      gender: display?.gender ?? 0,
      size: mon.size,
      alignment: display?.alignment ?? 0,
      breadMode: display?.breadModeEnum ?? 0,
      move1: mon.move1,
      move2: mon.move2,
      move3: mon.move3,
      cpMultiplier: mon.cpMultiplier,
      additionalCpMultiplier: mon.additionalCpMultiplier,
    },
  };
}

/**
 * Every stored Pokémon in the export as a row, in the order the export lists them, numbered from 1. Eggs are left out:
 * they are not Pokémon in storage, and the export gives them no `pokemonDisplay` to read.
 */
export function rowsOf(snapshot: Snapshot, data: GameData): Row[] {
  const tags = new Map(snapshot.tags.map((tag) => [tag.id, tag.name]));
  const rows: Row[] = [];

  for (const mon of snapshot.pokemons) {
    if (mon.isEgg || mon.pokemonDisplay === null) {
      continue;
    }

    rows.push(rowOf(mon, rows.length + 1, data, tags));
  }

  return rows;
}

/**
 * The export's text as a `Snapshot`, with its IDs kept as the strings `Mon` and `Tag` declare. A Pokémon's `id` and the
 * IDs it names its tags by are 64-bit, past what a double holds, which `JSON.parse` rounds to the nearest it can —
 * enough to break the match between a Pokémon and its tag. So an `id` and a `pokemonTagIds` entry are read back as
 * strings whatever their length, since a short one looked up in a `Map` of strings would miss its tag just the same,
 * and any other number too long for a double is taken from its exact source text, which the reviver is handed in
 * `context.source` on the pinned runtime. Only a real JSON number is read this way; a digit run inside a string is a
 * string value, never a number, so it is never touched.
 */
export function parseSnapshot(text: string): Snapshot {
  return JSON.parse(text, (key, value, context?: { source: string }) => {
    if (key === 'pokemonTagIds' && Array.isArray(value)) {
      return (value as unknown[]).map(String);
    }

    if (typeof value !== 'number' || context === undefined) {
      return value;
    }

    return key === 'id' || /^-?\d{16,}$/.test(context.source) ? context.source : value;
  }) as Snapshot;
}
