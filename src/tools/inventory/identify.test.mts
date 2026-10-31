/**
 * What `identify` makes of a reading built here rather than read off a capture, for the cases a capture cannot state:
 * the same screen with its height taken away, or misread.
 *
 * The reading is `pumpkaboo-large.png`'s, a level 1 Pumpkaboo at 2/0/6, where a Large and a Super both show 14 HP and
 * CP 14 and only the height tells them apart.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { type Detail } from './detail.mts';
import { type GameData } from './game-master.mts';
import { identify, label } from './identify.mts';

const DATA = JSON.parse(readFileSync(new URL('fixtures/game-master.json', import.meta.url), 'utf8')) as GameData;

const OVERLAY = { iv: { attack: 2, defense: 0, stamina: 6 }, levels: [1], form: null };

const pumpkaboo = (height: number | null, size: Detail['size']): Detail => ({
  cp: 14,
  cps: [],
  name: 'Pumpkaboo',
  hp: 14,
  weight: 11.07,
  height,
  types: ['Ghost', 'Grass'],
  gender: 'male',
  favourite: false,
  size,
  tags: [],
});

const answer = (detail: Detail) => {
  const identity = identify(DATA, detail, OVERLAY);

  return { form: identity.form && label(identity.form), alternatives: identity.alternatives.map(label) };
};

test('a height under its badge settles the forms the numbers leave together', () => {
  expect(answer(pumpkaboo(0.57, 'XL'))).toStrictEqual({ form: 'Pumpkaboo (Large)', alternatives: [] });
  expect(answer(pumpkaboo(0.7, 'XXL'))).toStrictEqual({ form: 'Pumpkaboo (Super)', alternatives: [] });
});

/**
 * 0.6m is the edge between a Large and a Super, and is both: the top of a Large's XL band and every band of a Super's
 * but XXL. A centimetre either side is one or the other, which is what the half centimetre allowed for rounding leaves.
 */
test('a centimetre either side of the edge between two forms is one of them', () => {
  expect(answer(pumpkaboo(0.59, 'XL'))).toStrictEqual({ form: 'Pumpkaboo (Large)', alternatives: [] });
  expect(answer(pumpkaboo(0.61, 'XXL'))).toStrictEqual({ form: 'Pumpkaboo (Super)', alternatives: [] });
});

test('with no height read, the forms the numbers leave are all still answered', () => {
  expect(answer(pumpkaboo(null, 'XL'))).toStrictEqual({
    form: 'Pumpkaboo (Large)',
    alternatives: ['Pumpkaboo (Super)'],
  });
});

/**
 * A height no form fits is a misread rather than a Pumpkaboo of no size, so it narrows nothing: 0.57m with no badge is
 * in no Pumpkaboo's middle band, a Large's being 0.5m exactly, and the forms the numbers left are answered as before.
 */
test('a height no form fits leaves the forms the numbers left', () => {
  expect(answer(pumpkaboo(0.57, null))).toStrictEqual({
    form: 'Pumpkaboo (Large)',
    alternatives: ['Pumpkaboo (Super)'],
  });
  expect(answer(pumpkaboo(5.7, 'XL'))).toStrictEqual({
    form: 'Pumpkaboo (Large)',
    alternatives: ['Pumpkaboo (Super)'],
  });
});
