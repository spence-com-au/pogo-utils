import { expect, test } from 'vitest';

import SHINY_POKEMON from '../filters/shiny.js';
import { HUNTS } from '../pokedex/entries.js';
import { displayFilterText, shinyHuntFilter } from './display-filter.js';
import { FILTER_DEFAULTS, readDisplayFilter } from './filter-format.js';

test("the shiny hunt reads back, through the watcher's own reader, as the filter it was written to be", () => {
  /*
   * `readDisplayFilter` is what `parseQuery` runs on a query file, so this is the writer fed to the reader. A field the
   * writer names that the reader does not know is dropped on the way in, as Live PokeMap drops it, and so fails here
   * rather than leaving the watcher on a default while both suites pass.
   */
  const written = shinyHuntFilter();

  expect(readDisplayFilter(displayFilterText(written))).toStrictEqual({ ...FILTER_DEFAULTS, ...written.config });
});

test('the allowlist is the shiny hunt narrowed to what the wild turns up', () => {
  const { config } = shinyHuntFilter();

  /*
   * The rule spelled out, rather than asked of `SHINY_HUNTING_FILTERS` the way the module asks it. Reaching for the
   * same list would assert only that the module calls what it calls; writing the three flags out means a change to that
   * list has to be meant.
   */
  const wanted = [
    ...new Set(
      [...SHINY_POKEMON].filter((pokemon) => pokemon.released && pokemon.spawns && pokemon.shinyEligible).map(Number),
    ),
  ];

  expect(config.speciesFilterList).toEqual(wanted);

  // A floor that does not go through the narrowing at all, so an empty answer on both sides cannot read as agreement.
  expect(SHINY_POKEMON.size).toBeGreaterThan(0);
  expect(config.speciesFilterList.length).toBeGreaterThan(0);
});

test('the allowlist holds one whole dex number per species', () => {
  const list = shinyHuntFilter().config.speciesFilterList;

  // A form serializes to the dex number of the species it belongs to, so a list naming several names it several times.
  expect(new Set(list).size).toBe(list.length);
  expect(list.every((dex) => Number.isInteger(dex) && dex > 0)).toBe(true);
});

test('the config says only what this collection has an opinion about', () => {
  /*
   * Pinned as a list because the importer spreads `config` over Live PokeMap's defaults rather than over the reader's
   * own values: a field added here stops being theirs to set, and `shinyOnly` in particular would hide every species
   * the hunt is for.
   */
  expect(Object.keys(shinyHuntFilter().config)).toEqual(['speciesFilterMode', 'speciesFilterList']);
  expect(shinyHuntFilter().config.speciesFilterMode).toBe('allowlist');
});

test('the clock is the only thing that moves between two exports', () => {
  const at = new Date('2026-01-02T03:04:05.678Z');

  expect(shinyHuntFilter(at).exported_at).toBe('2026-01-02T03:04:05.678Z');

  /*
   * Two exports at *different* instants, since comparing one instant against itself is `f(x)` against `f(x)` on a pure
   * function and can never go red. What is being pinned is that the timestamp is the whole of the difference — which is
   * what lets one export be diffed against the last.
   */
  const later = new Date('2026-03-04T05:06:07.890Z');
  const lines = (date: Date) => displayFilterText(shinyHuntFilter(date)).split('\n');
  const differing = lines(at)
    .map((line, index) => [line, lines(later)[index]])
    .filter(([before, after]) => before !== after);

  expect(differing).toEqual([
    ['  "exported_at": "2026-01-02T03:04:05.678Z"', '  "exported_at": "2026-03-04T05:06:07.890Z"'],
  ]);
});

test('the allowlist is the very list the Pokédex badges as a watched shiny hunt', () => {
  /*
   * Both read `SHINY_HUNTING_FILTERS`, so a predicate added there moves the two together. What this holds is the rest:
   * the export and the page each choose that list for themselves, so either picking another — a region filter on the
   * export, a plainer list on the page — would quietly drop species the page keeps badging as watched.
   */
  const hunt = HUNTS.find((entry) => entry.id === 'shiny');
  const watched = [...new Set([...(hunt?.members ?? [])].filter((pokemon) => hunt?.watched(pokemon)).map(Number))];

  expect(watched.length).toBeGreaterThan(0);
  expect(shinyHuntFilter().config.speciesFilterList).toEqual(watched);
});
