/**
 * The results the Search page draws, from the made-up PGSharp export the converter is tested on: which Pokémon a search
 * finds, which it might, in the game's orders, with the picture each is drawn with.
 */

import { type GameData } from '../core/game-master.mts';
import { ICON_BASE } from '../pokedex/icons.js';
import { fixture } from '../testing/fixture.js';
import { installFakeStorage } from '../testing/storage.js';
import { parseSnapshot, rowsOf, type Row } from '../tools/inventory/snapshot.mts';
import { judging } from './judge.js';
import { read } from './parse.js';
import { loadSort, resultsOf, shownName, SORT_KEY, sorted, sprites, storeSort, type Sort } from './results.js';
import { expect, test } from 'vitest';

const text = (path: string) => new TextDecoder().decode(fixture(new URL(path, import.meta.url)));
const DATA = JSON.parse(text('../../data/game-master.json')) as GameData;
const ROWS = rowsOf(parseSnapshot(text('../tools/inventory/fixtures/snapshot.json')), DATA);
const judge = judging({ rows: ROWS, data: DATA, now: new Date(2026, 11, 1, 12).getTime() });

/** A typed search's results, by the names the grid shows. */
function results(query: string) {
  const { tree } = read(query);

  if (tree === null) {
    throw new Error(`${query} read as nothing`);
  }

  const { sure, unsure, unchecked } = resultsOf(tree, ROWS, judge);

  return { sure: sure.map(shownName), unsure: unsure.map(shownName), unchecked };
}

const names = (sort: Sort) => sorted(ROWS, sort).map(shownName);

test('a match is drawn as one, a Pokémon the search cannot settle as one that might be, the rest not', () => {
  expect(results('cp1000- , evolve')).toEqual({
    sure: ['Marowak', 'Sparky', 'Venusaur', 'Sylveon', 'Dragonite'],
    unsure: ['Pikachu', 'Unown', 'Charmander', 'Pikachu', 'Sinistea', 'Flabébé', 'Unknown'],
    unchecked: ['evolve'],
  });

  expect(results('shiny')).toEqual({ sure: ['Marowak'], unsure: [], unchecked: [] });
});

test('a pill is named as unchecked only where it left a Pokémon unsure', () => {
  // `evolve` cannot be judged of anything, but beside `shiny` only the one shiny Pokémon is left waiting on it.
  expect(results('evolve & shiny')).toEqual({ sure: [], unsure: ['Marowak'], unchecked: ['evolve'] });
  expect(results('evolve, shiny').unchecked).toEqual(['evolve']);
  expect(results('legendary, shiny').unchecked).toEqual(['legendary']);
});

test('sorts as the game does, ties falling to the newest catch', () => {
  expect(names('recent').slice(0, 3)).toEqual(['Pikachu', 'Marowak', 'Venusaur']);
  expect(names('favourite')[0]).toBe('Pikachu');
  expect(names('number').slice(0, 3)).toEqual(['Venusaur', 'Charmander', 'Pikachu']);
  expect(names('number').at(-1)).toBe('Unknown');
  expect(names('cp').slice(0, 2)).toEqual(['Dragonite', 'Venusaur']);
  const hp = (rows: readonly Row[]) => rows.map((row) => row.hp ?? 0);

  expect(hp(sorted(ROWS, 'hp'))).toEqual(hp(ROWS).toSorted((one, two) => two - one));
  expect(names('name').slice(0, 2)).toEqual(['Charmander', 'Dragonite']);
});

test('the order picked is kept, Recent standing in where storage holds none or will not answer', () => {
  const storage = installFakeStorage();

  expect(loadSort()).toBe('recent');
  storeSort('cp');
  expect(loadSort()).toBe('cp');

  // JSON, as the backup carries only what parses, and writes it back through `JSON.stringify`.
  expect(storage.getItem(SORT_KEY)).toBe('"cp"');

  storage.setItem(SORT_KEY, '"sideways"');
  expect(loadSort()).toBe('recent');
  storage.setItem(SORT_KEY, 'cp');
  expect(loadSort()).toBe('recent');

  storage.throws = true;
  expect(() => storeSort('hp')).not.toThrow();
  expect(loadSort()).toBe('recent');
});

test('a Pokémon is drawn in its own form, costume and colouring, else as its species', () => {
  const spriteOf = sprites(DATA);

  const byName = (name: string) => {
    const row = ROWS.find((one) => shownName(one) === name);

    if (!row) {
      throw new Error(`the fixture has no ${name}`);
    }

    return row;
  };

  const pikachu = byName('Pikachu');
  const hat: Row = { ...pikachu, costume: ['Adventure Hat 2020'] };

  expect(spriteOf(byName('Marowak'))).toBe(`${ICON_BASE}pm105.fALOLA.s.icon.png`);
  expect(spriteOf(byName('Sparky'))).toBe(`${ICON_BASE}pm386.fATTACK.icon.png`);
  expect(spriteOf(pikachu)).toBe(`${ICON_BASE}pm25.icon.png`);
  expect(spriteOf(hat)).toBe(`${ICON_BASE}${DATA.forms.find((form) => form.form === 'Adventure Hat 2020')?.icon}`);
  expect(spriteOf({ ...pikachu, dex: 104, species: 'Cubone', costume: ['Fall 2023'], shiny: true })).toBe(
    `${ICON_BASE}pm104.cFALL_2023.s.icon.png`,
  );
  expect(spriteOf({ ...pikachu, form: 'Nowhere' })).toBe(`${ICON_BASE}pm25.icon.png`);
  expect(spriteOf(byName('Unknown'))).toBeNull();
});
