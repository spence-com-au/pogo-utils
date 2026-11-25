/**
 * What the Pokédex marks against, from a read's rows: the dex numbers held for the grid's tiles, and — reconciled from
 * the game master's form name to the dex's own spelling — the forms held for an open species' table, and those an owned
 * form could not be told apart from. The form cases run against the real dex entries, so a change to how a variant is
 * named is a change this test sees.
 */

import { expect, test } from 'vitest';

import { ENTRIES } from './entries.js';
import { ownedForms, ownedSpecies } from './owned.js';
import { type Row } from '../tools/inventory/snapshot.mts';

const row = (dex: number | null, form: string | null = null) => ({ dex, form }) as unknown as Row;

const entry = (dex: number) => {
  const found = ENTRIES.find((e) => e.dex === dex);

  if (found === undefined) {
    throw new Error(`no entry for dex ${dex}`);
  }

  return found;
};

test('ownedSpecies is the dex numbers held at least one of, dropping the eggs that resolved to none', () => {
  expect(ownedSpecies([row(25), row(1), row(25), row(null)])).toStrictEqual(new Set([25, 1]));
});

test('ownedForms ticks a form the dex spells as the game master does', () => {
  // Deoxys 386: the game master's `Attack` is the dex's `Deoxys (Attack)` once squashed, and no other form's token.
  expect(ownedForms([row(386, 'Attack')], entry(386))).toStrictEqual(new Map([['Deoxys (Attack)', 'yours']]));
});

test('ownedForms ticks a regional variant the game master names shorter than the dex', () => {
  // Marowak 105: the game master's `Alola` is a prefix of the dex's region adjective `Alolan`.
  expect(ownedForms([row(105, 'Alola')], entry(105))).toStrictEqual(new Map([['Alolan Marowak', 'yours']]));
});

test('ownedForms ticks a flower form the game master names by its colour alone', () => {
  // Flabébé 669: the game master's `Blue` is a prefix of the dex's `Blue Flower`, and of no other colour's.
  expect(ownedForms([row(669, 'Blue')], entry(669))).toStrictEqual(new Map([['Flabébé (Blue Flower)', 'yours']]));
});

test('ownedForms ticks the Normal form from an ordinary-form row of a species declared as forms', () => {
  // Deoxys 386: the game master gives `DEOXYS_NORMAL` a null form, and the dex lists it as `Deoxys (Normal)`.
  expect(ownedForms([row(386, null)], entry(386))).toStrictEqual(new Map([['Deoxys (Normal)', 'yours']]));
});

test('ownedForms marks nothing from an ordinary-form row of a species whose variants are all regional', () => {
  // Marowak 105: a null form is the Kantonian Marowak, which the forms table has no row for.
  expect(ownedForms([row(105, null)], entry(105))).toStrictEqual(new Map());
});

test('ownedForms marks every form unsure from an owned form no variant claims', () => {
  // Paldean Tauros 128: the game master's `Paldea Aqua` is no prefix of the dex's `Aqua Breed` nor its region
  // `Paldean`, so it could be any of the four, and none is drawn as owned or as not.
  expect(ownedForms([row(128, 'Paldea Aqua')], entry(128))).toStrictEqual(
    new Map(entry(128).variants.map(({ name }) => [name, 'unsure'])),
  );
});

test('ownedForms marks every form unsure from an ordinary-form row of a species with no Normal form', () => {
  // Dialga 483: a null form is its Altered Forme, which the dex files as `ALTERED_FORME` rather than `NORMAL`.
  expect(ownedForms([row(483, null)], entry(483))).toStrictEqual(
    new Map([
      ['Dialga (Altered Forme)', 'unsure'],
      ['Dialga (Origin Forme)', 'unsure'],
    ]),
  );
});

test('ownedForms marks only the claimants unsure from an owned form two variants claim', () => {
  // Darmanitan 555: the game master's `Zen` is a prefix of both `Darmanitan (Zen Mode)` and the Galarian one's.
  expect(ownedForms([row(555, 'Zen')], entry(555))).toStrictEqual(
    new Map([
      ['Galarian Darmanitan (Zen Mode)', 'unsure'],
      ['Darmanitan (Zen Mode)', 'unsure'],
    ]),
  );
});

test('ownedForms keeps a matched form yours beside an unplaced one, whichever is read first', () => {
  // Unown 201: `R` is the dex's `Unown (R)` alone, where `Exclamation Point` is no variant's, so it could be any other.
  const expected = new Map(
    entry(201).variants.map(({ name }) => [name, name === 'Unown (R)' ? 'yours' : 'unsure'] as const),
  );

  expect(ownedForms([row(201, 'R'), row(201, 'Exclamation Point')], entry(201))).toStrictEqual(expected);
  expect(ownedForms([row(201, 'Exclamation Point'), row(201, 'R')], entry(201))).toStrictEqual(expected);
});

test('ownedForms marks nothing from a row of another species', () => {
  expect(ownedForms([row(105, 'Alola')], entry(386))).toStrictEqual(new Map());
});
