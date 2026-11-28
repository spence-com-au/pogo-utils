/**
 * What the Search page draws under the query: the reader's own Pokémon the search finds, the ones it might, and the
 * pills it could not check, sorted the way the game's storage screen sorts.
 *
 * The verdicts are `judge.ts`'s, and the split follows them: a `yes` is a match, a `no` is left out, and an `unsure` is
 * drawn after the matches as one that might be. The pills named under them are the ones that left some Pokémon unsure,
 * which is the reader's cue that the answer is the export's limit and not the search's.
 */

import type { GameData } from '../core/game-master.mts';
import { ICON_BASE, spriteOf } from '../pokedex/icons.js';
import { KEY_PREFIX } from '../storage-namespace.js';
import type { Row } from '../tools/inventory/snapshot.mts';
import type { Verdict } from './judge.js';
import { isGroup, leafText, type Leaf, type Node } from './tree.js';

/** The game's six orders, as its sort button lists them. */
export const SORTS = [
  { id: 'recent', label: 'Recent' },
  { id: 'favourite', label: 'Favourite' },
  { id: 'number', label: 'Number' },
  { id: 'hp', label: 'HP' },
  { id: 'cp', label: 'CP' },
  { id: 'name', label: 'Name' },
] as const;

export type Sort = (typeof SORTS)[number]['id'];

/** The order the reader last picked, a choice of how they look rather than part of what they searched for. */
export const SORT_KEY = `${KEY_PREFIX}search:sort`;

const isSort = (value: unknown): value is Sort => SORTS.some(({ id }) => id === value);

/** The order last picked, or Recent, the game's own default, where storage holds none or will not answer. */
export function loadSort(): Sort {
  try {
    const stored = localStorage.getItem(SORT_KEY);

    return isSort(stored) ? stored : 'recent';
  } catch {
    return 'recent';
  }
}

/** Keeps the order for the next visit. A refusal costs only that, so it is not reported. */
export function storeSort(sort: Sort): void {
  try {
    localStorage.setItem(SORT_KEY, sort);
  } catch {
    // Nothing to tell: the page sorts by it either way, and only the next visit goes back to Recent.
  }
}

/** The name the game shows on a Pokémon: its nickname, else its species. */
export const shownName = (row: Row) => row.nickname ?? row.species ?? 'Unknown';

/** A missing number sorts after every number, as a species the game data does not know sorts last by dex. */
const last = (value: number | null) => value ?? Infinity;

/** Newest catch first, a Pokémon with no catch time after them in the export's own order. */
function recent(one: Row, two: Row) {
  if (one.caught === two.caught) {
    return one.index - two.index;
  }

  return one.caught === null ? 1 : two.caught === null ? -1 : two.caught - one.caught;
}

const ORDERS: Record<Sort, (one: Row, two: Row) => number> = {
  recent,
  favourite: (one, two) => Number(two.favourite) - Number(one.favourite),
  number: (one, two) => last(one.dex) - last(two.dex),
  hp: (one, two) => (two.hp ?? 0) - (one.hp ?? 0),
  cp: (one, two) => (two.cp ?? 0) - (one.cp ?? 0),
  name: (one, two) => shownName(one).localeCompare(shownName(two)),
};

/** `rows` in the order `sort` puts them, ties falling to Recent. */
export const sorted = (rows: readonly Row[], sort: Sort): Row[] =>
  rows.toSorted((one, two) => ORDERS[sort](one, two) || recent(one, two));

/** The matches, the Pokémon that might match, and the pills that could not be checked. */
export interface Results {
  sure: Row[];
  unsure: Row[];
  unchecked: string[];
}

function leavesOf(node: Node): Leaf[] {
  return isGroup(node) ? node.parts.flatMap(leavesOf) : [node];
}

/** `rows` split by what `judge` makes of `tree`. */
export function resultsOf(tree: Node, rows: readonly Row[], judge: (node: Node, row: Row) => Verdict): Results {
  const sure: Row[] = [];
  const unsure: Row[] = [];

  for (const row of rows) {
    const verdict = judge(tree, row);

    if (verdict === 'yes') {
      sure.push(row);
    } else if (verdict === 'unsure') {
      unsure.push(row);
    }
  }

  const unchecked = new Set<string>();

  for (const leaf of leavesOf(tree)) {
    const text = leafText(leaf);

    if (text !== null && !unchecked.has(text) && unsure.some((row) => judge(leaf, row) === 'unsure')) {
      unchecked.add(text);
    }
  }

  return { sure, unsure, unchecked: [...unchecked] };
}

/**
 * Each Pokémon's picture: its own form's, or its costume's, in its shiny colouring where it is shiny and the game has
 * one, and the species' where the game data has no such form. Null for a species the game data does not know.
 */
export function sprites(forms: GameData['forms']): (row: Row) => string | null {
  const byName = new Map<string, GameData['forms'][number]>();

  for (const form of forms) {
    const key = `${form.dex} ${form.form ?? ''}`;

    if (!byName.has(key)) {
      byName.set(key, form);
    }
  }

  return (row) => {
    if (row.dex === null) {
      return null;
    }

    const costume = row.costume?.length === 1 ? row.costume[0] : undefined;
    const form =
      (costume === undefined ? undefined : byName.get(`${row.dex} ${costume}`)) ??
      byName.get(`${row.dex} ${row.form ?? ''}`);

    if (form === undefined) {
      return spriteOf(row.dex, row.shiny, {});
    }

    if (form.icon === null) {
      return spriteOf(row.dex, row.shiny, { [row.dex]: null });
    }

    return ICON_BASE + (row.shiny && form.shiny !== null ? form.shiny : form.icon);
  };
}
