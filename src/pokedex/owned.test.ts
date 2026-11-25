/**
 * What the Pokédex marks against, from a read's rows: the dex numbers held for the grid's tiles, and — reconciled from
 * the game master's form name to the dex's own spelling — the forms held for an open species' table. The form cases
 * run against the real dex entries, so a change to how a variant is named is a change this test sees.
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
  expect(ownedForms([row(386, 'Attack')], entry(386))).toStrictEqual(new Set(['Deoxys (Attack)']));
});

test('ownedForms ticks a regional variant the game master names shorter than the dex', () => {
  // Marowak 105: the game master's `Alola` is a prefix of the dex's region adjective `Alolan`.
  expect(ownedForms([row(105, 'Alola')], entry(105))).toStrictEqual(new Set(['Alolan Marowak']));
});

test('ownedForms ticks a flower form the game master names by its colour alone', () => {
  // Flabébé 669: the game master's `Blue` is a prefix of the dex's `Blue Flower`, and of no other colour's.
  expect(ownedForms([row(669, 'Blue')], entry(669))).toStrictEqual(new Set(['Flabébé (Blue Flower)']));
});

test('ownedForms leaves a form unticked where the game master names it longer than the dex', () => {
  // Paldean Tauros 128: the game master's `Paldea Aqua` is no prefix of the dex's `Aqua Breed` nor its region
  // `Paldean`, so no confident match is made and the form stays the species-only mark rather than a guess.
  expect(ownedForms([row(128, 'Paldea Aqua')], entry(128))).toStrictEqual(new Set());
});

test('ownedForms marks nothing from an ordinary-form row or a row of another species', () => {
  // A null form is the ordinary form, which marks the species and no variant; a row of another dex is not this one's.
  expect(ownedForms([row(386, null), row(105, 'Alola')], entry(386))).toStrictEqual(new Set());
});
