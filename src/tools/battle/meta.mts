/**
 * What GO Battle League's players run, out of PvPoke's rankings: for each species, the moves a battle against it should
 * allow for, and the one fast move its energy is counted by. The HUD names the opponent and never its moves, so where
 * `strategy.mts` and `damage.mts` take every move a species can hold, a league PvPoke ranks narrows them to the ones
 * its simulations actually use — Medicham's Psycho Cut and Counter rather than every fast move it can learn.
 *
 * Training keeps every move: a Team Leader's party is the game's own, and nothing says it is built as a player's is.
 *
 * PvPoke names a species and a move by an id of its own, `marowak_alolan` and `MUD_SLAP`. A species is matched to the
 * game master's by its dex number out of PvPoke's game master, since 31 of the names differ — `Greattusk` for Great
 * Tusk, `Nidoran Female` for Nidoran♀ — and a move by its name folded, with a variant's `(Bug)` dropped: `Lock On` is
 * the game's `Lock-On`, and every `Hidden Power (…)` the one Hidden Power the screen prints.
 */

import { type GameData } from '../inventory/game-master.mts';
import { fold } from '../inventory/ocr.mts';
import { type Download } from './assets.mts';

const PVPOKE = 'https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data';

/**
 * How often a move must turn up in PvPoke's simulations of a species, against the most used move of its kind, to be
 * allowed for: a fifth. In Great League, Galarian Stunfisk keeps Rock Slide, Earthquake, Muddy Water and Flash Cannon,
 * all at 52% or more of Rock Slide's uses, and Marowak drops Return at 19.5% of Bone Club's. A starting point, to be
 * tuned against what logged battles show opponents throwing.
 */
export const PLAUSIBLE = 0.2;

/** What a species is allowed for having in a league, by the game master's names. */
export interface Moveset {
  /** PvPoke's recommended fast move, which the opponent's energy is counted by until its hits say otherwise. */
  fast: string;

  /** Every fast move plausible, the recommended one first. */
  fastMoves: readonly string[];

  /** Every charged move plausible, most used first. */
  chargedMoves: readonly string[];
}

export interface Meta {
  /** PvPoke's id for the cup ranked, `all` for an open league. */
  cup: string;

  /** The league's CP cap, null for Master League's none. */
  cap: number | null;

  /** By species, as the game master names it. */
  movesets: ReadonlyMap<string, Moveset>;
}

/** A league or cup as PvPoke's `formats` lists it, `cp` being 10000 for no cap. */
export interface Format {
  title: string;
  cup: string;
  cp: number;
}

/** One species' entry in a rankings file, as much of it as is read. */
export interface Ranking {
  speciesId: string;
  moves: { fastMoves: readonly RankedMove[]; chargedMoves: readonly RankedMove[] };
  moveset: readonly string[];
}

interface RankedMove {
  moveId: string;
  uses: number;
}

/** As much of PvPoke's game master as matches its ids to the game's. */
export interface PvPokeData {
  formats: readonly Format[];
  pokemon: readonly { speciesId: string; dex: number }[];
  moves: readonly { moveId: string; name: string }[];
}

/** The open leagues, which PvPoke ranks under the cup `all` and which its formats leave out. */
const OPEN: Record<string, number> = { little: 500, great: 1500, ultra: 2500, master: 10000 };

/** What PvPoke's CP of 10000 stands for: no cap. */
const NO_CAP = 10000;

const words = (text: string) => fold(text).split(' ').filter(Boolean);

/**
 * Which of PvPoke's rankings a league is, from `--league` as given or a title as the game prints it: the cup and its
 * CP, or null where neither a format nor an open league fits it, which leaves every move allowed for.
 *
 * An open league by its name, `ultra` or `master league`, each word as the start of the title's own. A cup by its
 * title's words in any order, since the game's `Master League: Mega` is PvPoke's `Mega Master League`: a format fits
 * where every word given starts a word of its title, so `fantasy` is Fantasy Cup, or where every word of its title is
 * among those given, so the game's `Fantasy Cup: Great League Edition` is too. Of several, the one sharing most words.
 * A cup PvPoke does not list falls back on its league's open rankings, by the league named in it.
 */
export function formatOf(league: string, formats: readonly Format[]): { cup: string; cp: number } | null {
  const given = words(league);

  if (given.length === 0) {
    return null;
  }

  for (const [name, cp] of Object.entries(OPEN)) {
    if (given.length <= 2 && given.every((word, i) => [name, 'league'][i]?.startsWith(word))) {
      return { cup: 'all', cp };
    }
  }

  const fits = formats.flatMap((format) => {
    const title = words(format.title);
    const shared = given.filter((word) => title.some((w) => w.startsWith(word))).length;
    const fit = shared === given.length || title.every((word) => given.includes(word));

    return fit ? [{ format, shared }] : [];
  });

  const [best] = fits.sort((a, b) => b.shared - a.shared);

  if (best) {
    return { cup: best.format.cup, cp: best.format.cp };
  }

  const open = given.find((word) => word in OPEN);

  return open === undefined ? null : { cup: 'all', cp: OPEN[open] ?? NO_CAP };
}

/**
 * Each species' moveset out of a rankings file, a species PvPoke ranks several forms of — Alolan Marowak beside
 * Kantonian, any shadow beside its ordinary one — allowing for whatever any of them holds, the HUD naming only the
 * species. Its recommended fast move is that of its form ranked highest, the file being in ranked order. A form whose
 * id or recommended fast move does not match the game master's is left out, its energy having nothing to be counted
 * by, and any other move that does not, as one PvPoke ranks ahead of its release can, goes without.
 */
export function movesetsOf(data: GameData, rankings: readonly Ranking[], pvpoke: PvPokeData): Map<string, Moveset> {
  const species = new Map<number, string>();

  for (const form of data.forms) {
    if (!species.has(form.dex)) {
      species.set(form.dex, form.species);
    }
  }

  const dexOf = new Map(pvpoke.pokemon.map((p) => [p.speciesId, p.dex]));
  const ours = new Map(Object.keys(data.combat).map((name) => [fold(name), name]));
  const names = new Map(
    pvpoke.moves.flatMap((move) => {
      const name = ours.get(fold(move.name.replace(/\s*\(.*\)$/, '')));

      return name === undefined ? [] : [[move.moveId, name] as const];
    }),
  );

  const plausible = (moves: readonly RankedMove[]) => {
    const most = Math.max(0, ...moves.map((move) => move.uses));

    return [...moves]
      .sort((a, b) => b.uses - a.uses)
      .filter((move) => move.uses >= PLAUSIBLE * most)
      .flatMap((move) => names.get(move.moveId) ?? []);
  };

  const movesets = new Map<string, Moveset>();

  for (const ranking of rankings) {
    const dex = dexOf.get(ranking.speciesId);
    const name = dex === undefined ? undefined : species.get(dex);
    const recommended = names.get(ranking.moveset[0] ?? '');

    if (name === undefined || recommended === undefined) {
      continue;
    }

    const known = movesets.get(name);
    const fast = known?.fast ?? recommended;

    movesets.set(name, {
      fast,
      fastMoves: [...new Set([fast, ...(known?.fastMoves ?? []), ...plausible(ranking.moves.fastMoves)])],
      chargedMoves: [...new Set([...(known?.chargedMoves ?? []), ...plausible(ranking.moves.chargedMoves)])],
    });
  }

  return movesets;
}

/**
 * The meta of the league named, out of PvPoke's game master and the league's rankings, fetched by `download`: cached
 * for a week as the game master is by `pnpm battle`, and fetched afresh by a page. Null where no ranking fits the
 * league, or where PvPoke cannot be reached and nothing is cached, either of which leaves every move allowed for
 * rather than stopping the run.
 */
export async function loadMeta(download: Download, data: GameData, league: string): Promise<Meta | null> {
  const json = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes));

  try {
    const pvpoke = (await download('pvpoke-gamemaster.json', `${PVPOKE}/gamemaster.json`, json)) as PvPokeData;
    const format = formatOf(league, pvpoke.formats);

    if (!format) {
      console.error(`  PvPoke ranks nothing called ${league}; every move its species can hold is allowed for`);

      return null;
    }

    const { cup, cp } = format;
    const rankings = (await download(
      `pvpoke-${cup}-${cp}.json`,
      `${PVPOKE}/rankings/${cup}/overall/rankings-${cp}.json`,
      json,
    )) as Ranking[];

    return { cup, cap: cp >= NO_CAP ? null : cp, movesets: movesetsOf(data, rankings, pvpoke) };
  } catch (error) {
    console.error(`  ${error instanceof Error ? error.message : String(error)}; every move is allowed for`);

    return null;
  }
}
