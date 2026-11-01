/**
 * How a hunt list becomes a list of species a scanner can be asked about: checked, narrowed to what the wild can turn
 * up and collapsed to one entry per dex number.
 *
 * The Sets beside this file are checklists of what is still wanted, which is not the same question as what a tool can
 * alert on. The PGSharp backup's nearby feeds are fed from them, and each wants the same narrowing and the same
 * collapse, so it is here rather than repeated per feed.
 */

import Pokemon from '../pokemon/pokemon.js';

/**
 * What `species` asks of an entry to decide whether it stays: the four flag predicates below, and whatever
 * `filterRegion` hands back. Named rather than written out at each call, so a predicate answering something other than
 * a boolean is rejected where it is declared instead of at whichever filter list first passes it along.
 */
export type Predicate = (pokemon: Pokemon) => boolean;

/**
 * A filter list as the one predicate it amounts to: every one of them has to hold. `species` keeps an entry by this,
 * and the Pokédex asks it of a single Pokémon to say whether the feed built from a list watches for it — one
 * conjunction, so the two cannot come to read a list differently.
 */
export const allOf =
  (filters: readonly Predicate[]): Predicate =>
  (pokemon) =>
    filters.every((predicate) => predicate(pokemon));

/**
 * A filter's species list, checked, narrowed and collapsed to one entry per species. A form or region the species does
 * not have has already thrown, so what is left to catch is a name `pokemon.js` does not define at all, which reads as
 * undefined and would reach the caller as a null. The constant's name is gone by then, so the error gives the position
 * to look at — and the species are taken in the order they were written, so that position means what it says.
 *
 * Every `keep` has to hold for an entry to stay, which is how a filter drops what has no shiny to find. They run before
 * the list collapses, so a species listed twice keeps the form that survives rather than whichever came first.
 *
 * A form carries the dex number of the species it belongs to, that number being all PGSharp stores, so a list
 * naming several forms names it several times. The names say which forms the list is for; the repeats say nothing, so
 * one entry per number survives: the last form listed, held where the number first appeared. That is `Map` replacing
 * the value of a key it already holds while keeping the key's place. PGSharp cannot tell, as it stores the number
 * alone, but a caller reading the surviving form gets the last one.
 */
export function species(entries: ReadonlySet<Pokemon>, ...keep: Predicate[]) {
  const list = [...entries];
  const at = list.findIndex((entry) => !(entry instanceof Pokemon));

  if (at !== -1) {
    throw new Error(`species #${at + 1} is not a POKEMON constant — check it against pokedex.js`);
  }

  const kept = list.filter(allOf(keep));

  return [...new Map(kept.map((entry) => [Number(entry), entry])).values()];
}

// Reads as filter's predicate: `species([...], filterShinyEligible)` drops the ones with no shiny to find. Only the two
// a caller names for itself are exported; the other three are reachable through the lists below.

export const filterRegional: Predicate = (pokemon) => pokemon.regional;
const filterShinyEligible: Predicate = (pokemon) => pokemon.shinyEligible;
const filterWildSpawns: Predicate = (pokemon) => pokemon.spawns;
const filterReleased: Predicate = (pokemon) => pokemon.released;

/**
 * A filter for one region's own — `filterRegion(PALDEA)` keeps the Paldean variants and drops the rest. Unlike
 * `filterRegional`, which asks whether a species is a region-locked spawn at all, this asks which region a variant
 * belongs to, so it reads the region the variant carries as data through `isFrom` rather than the adjective on its
 * name. It is a factory rather than a predicate: handed a region it returns the predicate `species` runs, so it sits in
 * a filter list beside the flag ones. A form of a regional variant inherits the region, so naming the region catches
 * its forms without naming each.
 */
export const filterRegion =
  (region: string): Predicate =>
  (pokemon) =>
    pokemon.isFrom(region);

// What a scanner can ever show: a feed reports wild spawns, so a species not in the game yet or one the wild never
// turns up is a line it would never alert on. Every narrowing built on this module starts from these. `readonly`
// because the callers spread them rather than hold them, so a `push` into either export would be an extra predicate on
// all six PGSharp feeds at once.
export const WILD_SPAWN_FILTERS: readonly Predicate[] = [filterReleased, filterWildSpawns];

// The predicates every shiny hunt shares; a region or `filterRegional` is added to these per caller. Shared as a list
// of predicates rather than a computed species list because `species` collapses to one entry per dex number: a list
// built off another's collapsed list would filter what the dedupe already dropped, losing a regional form whose dex a
// plainer form had won. Each caller therefore filters `SHINY_POKEMON` afresh, collapsing last.
export const SHINY_HUNTING_FILTERS: readonly Predicate[] = [...WILD_SPAWN_FILTERS, filterShinyEligible];
