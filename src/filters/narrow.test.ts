import { expect, test } from 'vitest';

import POKEMON, { ALOLA, GALAR } from '../pokemon/pokedex.js';
import type Pokemon from '../pokemon/pokemon.js';
import { filterRegion, species, SHINY_HUNTING_FILTERS, WILD_SPAWN_FILTERS } from './narrow.js';

/**
 * A name `pokedex.js` does not define reads as `undefined`, which is the whole reason `species` looks before it filters
 * — an undefined would reach a caller's list as a null. Nothing exercised that throw before: both callers pass the
 * curated Sets, so the error only fires on a list someone has just mistyped, which is exactly when it has to be right.
 */
test('a list holding something that is not a species says which position to look at', () => {
  const undefinedConstant = undefined as unknown as Pokemon;

  expect(() => species(new Set([POKEMON.PIKACHU, undefinedConstant]))).toThrow(
    'species #2 is not a POKEMON constant — check it against pokedex.js',
  );

  // Counted from one, and from the order the list was written in, so the position means what it says.
  expect(() => species(new Set([undefinedConstant, POKEMON.PIKACHU]))).toThrow('species #1');
});

test('a species listed twice survives once, as the dex number both forms carry', () => {
  // Two forms of one species: the names say which forms the list is for, the repeated dex number says nothing.
  const [first, second] = POKEMON.UNOWN.forms('A', 'C');

  expect(first).toBeDefined();
  expect(second).toBeDefined();
  expect(species(new Set([first as Pokemon, second as Pokemon]))).toHaveLength(1);
});

test('the form that survives a shared dex number is the last listed, at the place of the first', () => {
  // `Map` replaces a repeated key's value but keeps its place, so a caller reading the form gets the last one.
  const [a, c] = POKEMON.UNOWN.forms('A', 'C') as [Pokemon, Pokemon];
  const entries = new Set([a, POKEMON.PIKACHU, c]);

  expect(species(entries)).toEqual([c, POKEMON.PIKACHU]);
});

test('each shared list applies the predicate it adds', () => {
  /*
   * The sample is read off the dex rather than named, so it straddles each predicate by construction: one species the
   * shiny hunt can keep, one the wild turns up with no shiny to find, and one not in the game at all. A hand-named
   * sample that happened not to straddle a predicate would leave that step unexercised and still read as a pass.
   */
  const all = Object.values(POKEMON);
  const sample = [
    all.find((pokemon) => pokemon.released && pokemon.spawns && pokemon.shinyEligible),
    all.find((pokemon) => pokemon.released && pokemon.spawns && !pokemon.shinyEligible),
    all.find((pokemon) => !pokemon.released),
  ];

  expect(sample.filter(Boolean)).toHaveLength(3);

  const entries = new Set(sample as Pokemon[]);

  expect(species(entries)).toHaveLength(3);
  expect(species(entries, ...WILD_SPAWN_FILTERS)).toHaveLength(2);
  expect(species(entries, ...SHINY_HUNTING_FILTERS)).toHaveLength(1);
});

test("a region's filter keeps that region's variants and drops the base species and other regions", () => {
  // The Hisuian feed is empty while every Hisuian shiny fails a hunting predicate, so `filters.test.ts` cannot see this
  // function work; a regional variant that exists whatever the hunt list holds can.
  const galarian = POKEMON.WEEZING.region(GALAR);
  const entries = new Set([POKEMON.WEEZING, galarian, POKEMON.MEOWTH.region(ALOLA), POKEMON.PIKACHU]);

  expect(species(entries, filterRegion(GALAR))).toEqual([galarian]);
  expect(filterRegion(GALAR)(galarian)).toBe(true);
  expect(filterRegion(ALOLA)(galarian)).toBe(false);
  expect(filterRegion(GALAR)(POKEMON.WEEZING)).toBe(false);
});
