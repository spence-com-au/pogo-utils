/**
 * A query asked of the reader's own Pokémon, read off PGSharp's export rather than typed into the game.
 *
 * **Three answers, not two.** The export and the bundled game data know most of what a search asks but not all of it:
 * nothing here knows a species' family or what it evolves into, which raid or research a Pokémon came from, its buddy
 * level past having walked at all, or the weather where the reader is. A pill asked one of those is `unsure`, and it
 * stays unsure only where it could change the answer — Kleene's logic, so a `no` anywhere in an `all` is a `no` and a
 * `yes` anywhere in an `any` is a `yes` whatever sits beside it. Turning a pill round swaps `yes` and `no` and leaves
 * `unsure` as it is, which is why a pill that cannot be judged is not simply dropped: `!evolve` dropped would match
 * everything, where every Pokémon it touches is one this cannot answer for.
 *
 * Where the game's own matching is not written down this takes the reading that is likeliest and says so beside it: a
 * name matches the start of a species or a nickname, `@move` the start of a move's name, and `>type` counts the fast
 * move and the first charged move only, as the community phrase list reports.
 */

import { type GameData } from '../core/game-master.mts';
import { fold } from '../core/ocr.mts';
import { GENERATIONS } from '../pokemon/generations.js';
import POKEMON from '../pokemon/pokedex.js';
import { type Row } from '../tools/inventory/snapshot.mts';
import { RANGES_BY_ID } from './terms.js';
import { isGroup, leafText, whole, type Leaf, type Node } from './tree.js';

export type Verdict = 'yes' | 'no' | 'unsure';

/** What a search is judged against: every Pokémon the reader has, the game data and the time it is asked at. */
export interface Collection {
  rows: readonly Row[];
  data: Pick<GameData, 'combat' | 'cpm' | 'effectiveness' | 'megas'>;
  now: number;
}

/** True or false where the export settles it, null where it does not. */
type Answer = boolean | null;

const verdict = (answer: Answer): Verdict => (answer === null ? 'unsure' : answer ? 'yes' : 'no');

/** Each species by its dex number, for the categories the game data does not carry. */
const SPECIES = new Map(Object.values(POKEMON).map((pokemon) => [pokemon.dex, pokemon]));

const REGIONS = ['alola', 'galar', 'hisui', 'paldea'];

/** A regional form's region, from a form name such as `Galarian Zen` or `Paldea Aqua`. */
const regionOf = (form: string | null) => REGIONS.find((region) => fold(form ?? '').startsWith(region)) ?? null;

/** The appraisal's star rating: 4 ★ is 45 points in all, 3 ★ is 37 or more, 2 ★ 30, 1 ★ 23, and 0 ★ the rest. */
const STARS = [0, 23, 30, 37, 45];

const starsOf = (total: number) => STARS.findLastIndex((floor) => total >= floor);

/** An IV as the appraisal's bar draws it: empty at 0, then a segment for each 5 points, and full only at 15. */
const barOf = (iv: number) => (iv === 0 ? 0 : iv === 15 ? 4 : Math.min(Math.ceil(iv / 5), 3));

/** The calendar day a moment falls on where the reader is, so a Pokémon caught yesterday evening is a day old. */
const dayOf = (time: number) => Math.floor((time - new Date(time).getTimezoneOffset() * 60_000) / 86_400_000);

/** How strongly a move of this type hits a Pokémon of these types, every type counted. */
function effect(data: Collection['data'], attacking: string, defending: readonly string[]) {
  return defending.reduce((product, type) => product * (data.effectiveness[attacking]?.[type] ?? 1), 1);
}

const capitalise = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * Whether any of these moves is one `test` holds of, by its type. A move the game data has no type for is unknown, so
 * it leaves the answer unsure unless another move settles it.
 */
function anyMove(data: Collection['data'], moves: readonly (string | null)[], test: (type: string) => boolean): Answer {
  let unknown = false;

  for (const move of moves) {
    const type = move === null ? undefined : data.combat[move]?.type;

    if (type === undefined) {
      unknown ||= move !== null;
    } else if (test(type)) {
      return true;
    }
  }

  return unknown ? null : false;
}

/**
 * The value a range reads of one Pokémon, as the lowest and highest it could be: one number where the export settles
 * it, a span where it only narrows it, and null where the Pokémon holds no value at all — a `sparse` range's species
 * that cannot hold one.
 */
type Value = readonly [number, number] | null;

/** Every Pokémon judged against one collection. */
export function judging({ rows, data, now }: Collection) {
  const counts = new Map<number, number>();

  for (const row of rows) {
    if (row.dex !== null) {
      counts.set(row.dex, (counts.get(row.dex) ?? 0) + 1);
    }
  }

  const megas = new Set(data.megas.map((mega) => mega.dex));
  const fortieth = data.cpm.find(([level]) => level === 40)?.[1] ?? Infinity;
  const known = (exact: number | null | undefined): Value => (exact == null ? unknown : [exact, exact]);
  const unknown: Value = [-Infinity, Infinity];

  function value(id: string, row: Row): Value {
    switch (id) {
      case 'cp':
        return known(row.cp);
      case 'hp':
        return known(row.hp);
      case 'dex':
        return known(row.dex);
      case 'ivattack':
        return known(row.iv && barOf(row.iv.attack));
      case 'ivdefense':
        return known(row.iv && barOf(row.iv.defense));
      case 'ivhp':
        return known(row.iv && barOf(row.iv.stamina));
      case 'buddylevel':
        // Walking as a buddy is the one sign the export gives; one that never walked could still have been fed.
        return row.buddyKm !== null && row.buddyKm > 0 ? [1, 5] : unknown;
      case 'megalevel':
        return row.dex === null ? unknown : megas.has(row.dex) ? known(row.megaLevel) : null;
      case 'dynamaxmoves':
      case 'maxmove':
      case 'maxguard':
      case 'maxspirit':
        return row.max === null ? unknown : [1, 3];
      case 'gigantamaxmoves':
        return row.max === 'gigantamax' ? [1, 3] : unknown;
      case 'count':
        return row.dex === null ? unknown : known(counts.get(row.dex));
      case 'age':
        return row.caught === null ? unknown : known(dayOf(now) - dayOf(row.caught));
      case 'year':
        return row.caught === null ? unknown : known(new Date(row.caught).getFullYear());
      default:
        return unknown;
    }
  }

  function term(id: string, row: Row): Answer {
    const types = row.dex === null ? null : row.types.map((one) => one.toLowerCase());
    const total = row.iv && row.iv.attack + row.iv.defense + row.iv.stamina;
    const stars = total === null ? null : starsOf(total);
    const region = row.dex === null ? null : regionOf(row.form);
    const species = row.dex === null ? undefined : SPECIES.get(row.dex);
    const generation = GENERATIONS.find(({ number }) => `gen${number}` === id);

    if (generation) {
      return row.dex === null ? null : row.dex >= generation.first && row.dex <= generation.last;
    }

    const typed = /^(weak|strong|move)?([a-z]+)$/.exec(id);
    const type = typed?.[2] !== undefined && data.effectiveness[capitalise(typed[2])] ? capitalise(typed[2]) : null;

    if (type !== null) {
      const [fast, first, second] = [row.moves.fast, ...row.moves.charged];

      switch (typed?.[1]) {
        case 'weak':
          return types === null ? null : effect(data, type, row.types) > 1;
        case 'strong':
          return anyMove(data, [fast ?? null, first ?? null], (move) => effect(data, move, [type]) > 1);
        case 'move':
          return anyMove(data, [fast ?? null, first ?? null, second ?? null], (move) => move === type);
        default:
          return types === null ? null : types.includes(type.toLowerCase());
      }
    }

    switch (id) {
      case 'shiny':
        return row.shiny;
      case 'lucky':
        return row.lucky;
      case 'costume':
        // Null is a costume the export names by its enum alone, which is still a costume.
        return row.costume === null || row.costume.length > 0;
      case 'candyxl':
        // Past 40 on the Pokémon's own multiplier, a Best Buddy's boost left out as the chip's help says.
        return row.raw.cpMultiplier > fortieth + 1e-6;
      case 'legendary':
        return species?.legendary ?? null;
      case 'mythical':
        return species?.mythical ?? null;
      case 'ultrabeast':
        return species?.ultraBeast ?? null;
      case 'eggsonly':
        return species?.baby ?? null;
      case 'shadow':
        return row.shadow;
      case 'purified':
        return row.purified;
      case 'megaevolve':
        return row.dex === null ? null : megas.has(row.dex);
      case 'dynamax':
        return row.max !== null || null;
      case 'gigantamax':
        return row.max === 'gigantamax' || null;
      case 'star0':
      case 'star1':
      case 'star2':
      case 'star3':
      case 'star4':
        return stars === null ? null : `star${stars}` === id;
      case 'secondmove':
        return row.raw.move3 === 0;
      case 'traded':
        return row.traded;
      case 'hatched':
        return row.hatched;
      case 'party':
        return row.party;
      case 'defender':
        return row.defender;
      case 'background':
        return row.background;
      case 'locationbackground':
      case 'specialbackground':
        return row.background === false ? false : null;
      case 'favorite':
        return row.favourite;
      case 'tagged':
        return row.tags.length > 0;
      case 'male':
      case 'female':
      case 'genderunknown':
        return row.gender === null ? null : row.gender === id;
      case 'xxs':
      case 'xs':
      case 'xl':
      case 'xxl':
        // A size of 3 is the ordinary one, which has no badge and so no band.
        return row.size !== null ? row.size === id.toUpperCase() : row.raw.size === 3 ? false : null;
      case 'kanto':
        return row.dex === null ? null : row.dex <= 151 && region === null;
      case 'alola':
      case 'galar':
      case 'hisui':
      case 'paldea':
        return row.dex === null ? null : region === id;
      default:
        return null;
    }
  }

  function byName(text: string, row: Row): Answer {
    if (text.startsWith('+')) {
      return null;
    }

    if (text.startsWith('#')) {
      const tag = fold(text.slice(1));

      return row.tags.some((one) => fold(one) === tag);
    }

    if (text.startsWith('@')) {
      const [, slot, rest = ''] = /^@([123])?(.*)$/s.exec(text) ?? [];
      const moves = [row.moves.fast, ...row.moves.charged];
      const move = fold(rest);
      const slotted = slot === undefined ? moves : [moves[Number(slot) - 1] ?? null];
      const unnamed = [row.raw.move1, row.raw.move2, row.raw.move3].filter((id) => id !== 0).length > moves.length;

      return slotted.some((one) => one != null && fold(one).startsWith(move)) || (unnamed ? null : false);
    }

    const asked = fold(text);
    const named = [row.species, row.nickname].some((one) => one !== null && fold(one).startsWith(asked));

    return named || (row.species === null ? null : false);
  }

  function leaf(node: Leaf, row: Row): Answer {
    if (node.kind === 'term') {
      return term(node.id, row);
    }

    if (node.kind === 'name') {
      return byName(node.text.trim(), row);
    }

    if (whole(node)) {
      return true;
    }

    const read = RANGES_BY_ID.has(node.id) ? value(node.id, row) : unknown;

    if (read === null) {
      return false;
    }

    // Either end left open is open, and two ends filled the wrong way round are the span `tree.js` swaps them into.
    const { from, to } = node;
    const [low, high] =
      from == null
        ? [-Infinity, to ?? Infinity]
        : to == null
          ? [from, Infinity]
          : [Math.min(from, to), Math.max(from, to)];
    const [least, most] = read;

    return least >= low && most <= high ? true : most < low || least > high ? false : null;
  }

  return function judge(node: Node, row: Row): Verdict {
    if (!isGroup(node)) {
      // A pill that writes nothing asks nothing, which is the search for everything.
      if (leafText(node) === null) {
        return 'yes';
      }

      const answer = leaf(node, row);

      return verdict(answer === null ? null : answer !== node.negated);
    }

    const verdicts = node.parts.map((part) => judge(part, row));
    const settles = node.junction === 'all' ? 'no' : 'yes';

    if (verdicts.includes(settles)) {
      return settles;
    }

    // An empty group asks nothing, so an `any` of nothing is the search for everything as much as an `all` is.
    return verdicts.includes('unsure') ? 'unsure' : settles === 'no' || verdicts.length === 0 ? 'yes' : 'no';
  };
}
