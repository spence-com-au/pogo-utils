/**
 * The rows the converter makes of a made-up PGSharp export, read against the real game master so the species, forms and
 * types are the game's own. The export is `fixtures/snapshot.json`, eleven entries — ten Pokémon and an egg — chosen
 * for the fields that are worth a test rather than a real account: a form named off the suffix, a costume named off a
 * form and one stated by enum alone, a costume on a species with no ordinary form, a shadow and a purified, a Dynamax
 * and a Gigantamax, a size the game recorded and one derived from the height, a species the game master does not know,
 * and the egg, which is left out. The move table is made up here, the loader that reads the real one in the scan script.
 */

import { type GameData, type Move } from '../../core/game-master.mts';
import { rowsOf, type Snapshot } from './snapshot.mts';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const DATA = JSON.parse(readFileSync(new URL('../../../data/game-master.json', import.meta.url), 'utf8')) as GameData;

const SNAPSHOT = JSON.parse(readFileSync(new URL('./fixtures/snapshot.json', import.meta.url), 'utf8')) as Snapshot;

const MOVES = new Map<number, Move>([
  [219, { name: 'Quick Attack', fast: true }],
  [35, { name: 'Discharge', fast: false }],
  [247, { name: 'Shadow Ball', fast: false }],
  [323, { name: 'Return', fast: false }],
]);

const rows = rowsOf(SNAPSHOT, DATA, MOVES);
const byDex = (dex: number) => rows.find((row) => row.raw.pokemonId === dex);
const byForm = (formName: string) => rows.find((row) => row.raw.formName === formName);

test('an egg is left out and the rest are numbered from 1 in order', () => {
  expect(rows.map((row) => row.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(rows.some((row) => row.raw.pokemonId === 1)).toBe(false);
});

test('an ordinary Pokémon reads straight off the export', () => {
  expect(byDex(25)).toMatchObject({
    species: 'Pikachu',
    nickname: null,
    dex: 25,
    form: null,
    gender: 'male',
    favourite: true,
    tags: ['Keepers'],
    shiny: false,
    lucky: false,
    size: null,
    shadow: false,
    purified: false,
    max: null,
    cp: 764,
    hp: 86,
    levels: [20],
    iv: { attack: 1, defense: 2, stamina: 3 },
    moves: { fast: 'Quick Attack', charged: ['Discharge'] },
    weight: 6,
    height: 0.41,
    types: ['Electric'],
    notes: [],
    costume: [],
  });
});

test('a form is named off the suffix, past the species prefix', () => {
  expect(byDex(105)).toMatchObject({ species: 'Marowak', form: 'Alola', types: ['Fire', 'Ghost'] });
  expect(byDex(201)).toMatchObject({ species: 'Unown', form: 'R', gender: 'genderunknown' });
  expect(byDex(386)).toMatchObject({
    species: 'Deoxys',
    form: 'Attack',
    nickname: 'Sparky',
    lucky: true,
    levels: [25],
  });
});

test('Normal and Unset fall back to the ordinary form', () => {
  expect(byDex(3)?.form).toBeNull();
  expect(byDex(700)).toMatchObject({ species: 'Sylveon', form: null });
});

test('a second charged move is kept and a move the table does not know is left out', () => {
  expect(byDex(105)?.moves).toEqual({ fast: 'Quick Attack', charged: ['Discharge', 'Shadow Ball'] });
  expect(byDex(9999)?.moves).toEqual({ fast: 'Quick Attack', charged: [] });
});

test('shadow, purified, Dynamax and Gigantamax come off their enums', () => {
  expect(byDex(4)).toMatchObject({ shadow: true, purified: false, max: 'dynamax' });
  expect(byDex(700)).toMatchObject({ shadow: false, purified: true });
  expect(byDex(3)?.max).toBe('gigantamax');
});

test('size is the recorded enum, or the height band where the game recorded none', () => {
  expect(byDex(105)?.size).toBe('XL');
  expect(byDex(3)?.size).toBe('XXL');
  expect(byDex(700)?.size).toBe('XXS');

  // Size 0 (unrecorded) at 0.8 m falls in Charmander's XL band of [0.75, 0.9].
  expect(byDex(4)?.size).toBe('XL');
});

test('a costume named by a form is written under costume, with the base form kept, not under form', () => {
  expect(byForm('PikachuGofest2026CapRed')).toMatchObject({
    species: 'Pikachu',
    form: null,
    costume: ['Gofest 2026 Cap Red'],
    types: ['Electric'],
  });
});

test('a costume on a species with no ordinary form keeps the base its name points at', () => {
  // Sinistea has no null form, only Antique and Phony; the A Halloween costume sits on Antique, not the shorter Phony.
  expect(byDex(854)).toMatchObject({ species: 'Sinistea', form: 'Antique', costume: ['A Halloween 2026 01'] });
});

test('a costume stated by enum alone is left unnamed, not guessed', () => {
  expect(byDex(700)?.costume).toBeNull();
  expect(byDex(25)?.costume).toEqual([]);
});

test('a tag the export does not list is dropped', () => {
  expect(byDex(105)?.tags).toEqual(['Trade']);
});

test('a species the game master does not know is left null with a note, not filed under a guess', () => {
  expect(byDex(9999)).toMatchObject({ species: null, dex: null, form: null, types: [] });
  expect(byDex(9999)?.notes).toContain('species 9999 is not in the game master');
});

test('the raw game IDs are kept beside the row', () => {
  expect(byDex(105)?.raw).toEqual({
    id: '1000000000000000002',
    pokemonId: 105,
    form: 100,
    formName: 'MarowakAlola',
    costume: 0,
    gender: 2,
    size: 4,
    alignment: 0,
    breadMode: 0,
    move1: 219,
    move2: 35,
    move3: 247,
    cpMultiplier: 0.667934,
  });
});
