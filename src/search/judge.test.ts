/**
 * Searches asked of the made-up PGSharp export the converter is tested on, `fixtures/snapshot.json`, typed the way a
 * reader types them and read through `parse.js` into the tree the page holds.
 */

import { type GameData } from '../core/game-master.mts';
import { all, any, assignments, holds, no, yes } from '../testing/search.js';
import { fixture } from '../testing/fixture.js';
import { parseSnapshot, rowsOf, type Row } from '../tools/inventory/snapshot.mts';
import { judging, type Verdict } from './judge.js';
import { read } from './parse.js';
import { type Node } from './tree.js';
import { expect, test } from 'vitest';

const text = (path: string) => new TextDecoder().decode(fixture(new URL(path, import.meta.url)));
const DATA = JSON.parse(text('../../data/game-master.json')) as GameData;
const ROWS = rowsOf(parseSnapshot(text('../tools/inventory/fixtures/snapshot.json')), DATA);

/** Noon on 1 December 2026, where the suite runs. */
const NOW = new Date(2026, 11, 1, 12).getTime();

const judge = judging({ rows: ROWS, data: DATA, now: NOW });

const byForm = (formName: string) => {
  const row = ROWS.find((one) => one.raw.formName === formName);

  if (!row) {
    throw new Error(`the fixture has no ${formName}`);
  }

  return row;
};

const PIKACHU = byForm('PikachuNormal');
const MAROWAK = byForm('MarowakAlola');
const VENUSAUR = byForm('VenusaurNormal');
const CHARMANDER = byForm('CharmanderNormal');
const UNKNOWN = byForm('MysterymonNormal');

/** A typed search's verdict on one Pokémon. */
function ask(query: string, row: Row): Verdict {
  const { tree, error } = read(query);

  if (tree === null) {
    throw new Error(error ?? `${query} read as nothing`);
  }

  return judge(tree, row);
}

test('a pill nothing here can judge is unsure, and turning it round leaves it unsure', () => {
  expect(ask('evolve', PIKACHU)).toBe('unsure');
  expect(ask('!evolve', PIKACHU)).toBe('unsure');
  expect(ask('+pikachu', PIKACHU)).toBe('unsure');
  expect(ask('legendary', PIKACHU)).toBe('unsure');
});

test('an unsure pill is settled by a no beside it in an all, and by a yes beside it in an any', () => {
  expect(ask('evolve & shiny', PIKACHU)).toBe('no');
  expect(ask('evolve & favorite', PIKACHU)).toBe('unsure');
  expect(ask('evolve, favorite', PIKACHU)).toBe('yes');
  expect(ask('evolve, shiny', PIKACHU)).toBe('unsure');
});

test('an empty group and a pill that writes nothing ask nothing', () => {
  expect(judge(all(), PIKACHU)).toBe('yes');
  expect(judge(any(), PIKACHU)).toBe('yes');
  expect(judge({ kind: 'range', id: 'cp', from: null, to: null, negated: true }, PIKACHU)).toBe('yes');
});

test('where every pill can be judged the verdict is the truth table’s', () => {
  const terms = ['shiny', 'lucky', 'favorite'];
  const trees: Node[] = [
    all(yes('shiny'), no('lucky')),
    any(all(yes('shiny'), yes('favorite')), no('lucky')),
    all(any(no('shiny'), yes('lucky')), any(yes('favorite'), yes('shiny'))),
  ];

  for (const on of assignments(terms)) {
    const row: Row = { ...PIKACHU, shiny: on.has('shiny'), lucky: on.has('lucky'), favourite: on.has('favorite') };

    for (const tree of trees) {
      expect(judge(tree, row)).toBe(holds(tree, on) ? 'yes' : 'no');
    }
  }
});

test('a Pokémon is judged on what the export says of it', () => {
  expect(ask('pika & favorite & #keepers & male & 0*', PIKACHU)).toBe('yes');

  // IVs of 1, 2 and 3 each draw the bar's first segment, which the next fills at 6.
  expect(ask('cp700-800 & 1attack & 1defense & 1hp & !2attack', PIKACHU)).toBe('yes');
  expect(ask('@1quick & !@2quick & @discharge & @3move', PIKACHU)).toBe('yes');
  expect(ask('traded, hatched, party, defender, background', PIKACHU)).toBe('no');
  expect(ask('char', PIKACHU)).toBe('no');
});

test('how it was got and what it shows are the export’s own fields', () => {
  expect(ask('traded & party & #trade', MAROWAK)).toBe('yes');
  expect(ask('hatched & defender', VENUSAUR)).toBe('yes');

  // A background is one or the other, and the export does not say which.
  expect(ask('background', MAROWAK)).toBe('yes');
  expect(ask('locationbackground', MAROWAK)).toBe('unsure');
  expect(ask('locationbackground, specialbackground', PIKACHU)).toBe('no');

  // The origins the export numbers without saying what each number is.
  expect(ask('raid, research, rocket', MAROWAK)).toBe('unsure');
});

test('the catch date is counted in days where the reader is, and in the year it fell in', () => {
  // Caught on 14 November 2023 (UTC), which is 1,113 days or so before the clock above, depending on the zone.
  expect(ask('age1000-1200 & year2023', PIKACHU)).toBe('yes');
  expect(ask('age0', PIKACHU)).toBe('no');
  expect(ask('age0', byForm('UnownR'))).toBe('unsure');
});

test('a regional form is its region and not Kanto’s', () => {
  expect(ask('alola & !kanto & !galar', MAROWAK)).toBe('yes');
  expect(ask('kanto', PIKACHU)).toBe('yes');
});

test('types, what hurts them and what the moves hit are read off the game data', () => {
  // Marowak's Alolan form is Fire and Ghost: Water hurts the Fire and leaves the Ghost alone, Fighting cannot touch it.
  expect(ask('fire & ghost & <water & !<fighting', MAROWAK)).toBe('yes');

  // Quick Attack and Discharge, Normal and Electric, of which Electric hits Water hard and Normal hits nothing so.
  expect(ask('>water & !>rock & @electric & @normal & !@fire', PIKACHU)).toBe('yes');
});

test('Mega and Max read the species where the Pokémon itself says nothing', () => {
  expect(ask('megaevolve & mega2', VENUSAUR)).toBe('yes');
  expect(ask('mega1', VENUSAUR)).toBe('no');
  expect(ask('megaevolve', CHARMANDER)).toBe('no');

  // A species with no Mega holds no Mega level at all.
  expect(ask('mega0-', CHARMANDER)).toBe('no');

  // The export says this Charmander is Dynamax, so its species can Dynamax; it cannot say whether Pikachu's can.
  expect(ask('dynamax', CHARMANDER)).toBe('yes');
  expect(ask('gigantamax', PIKACHU)).toBe('unsure');
});

test('a buddy that has walked has a buddy level, and one that has not may still have one', () => {
  expect(ask('buddy1-', MAROWAK)).toBe('yes');
  expect(ask('buddy0', MAROWAK)).toBe('no');
  expect(ask('buddy0', PIKACHU)).toBe('unsure');
});

test('a count is how many of the species the collection holds', () => {
  expect(ask('count2-', PIKACHU)).toBe('yes');
  expect(ask('count2-', MAROWAK)).toBe('no');
});

test('a species the game data does not know is unsure on a name, settled on its nickname', () => {
  expect(ask('pika', UNKNOWN)).toBe('unsure');
  expect(ask('fire', UNKNOWN)).toBe('unsure');
  expect(ask('sparky', byForm('DeoxysAttack'))).toBe('yes');
});
