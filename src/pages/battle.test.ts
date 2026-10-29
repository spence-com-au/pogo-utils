/**
 * The Battle tab's form read as `pnpm battle run` reads its flags, without a DOM around it: what each mode sends, what
 * a blank field means, and each refusal headed by the field it is about.
 */

import { expect, test } from 'vitest';

import { optionsOf, type Fields } from './battle.js';

const TRAINING: Fields = { mode: 'training', leader: 'spark', league: 'great', party: '', count: '' };
const GBL: Fields = { mode: 'gbl', leader: 'spark', league: 'ultra', party: '', count: '' };

test('plays Training with its leader and league until stopped, whatever party was typed in GO Battle League', () => {
  expect(optionsOf({ ...TRAINING, party: 'GBL' })).toEqual({
    mode: { mode: 'training', leader: 'spark', league: 'great' },
    count: Infinity,
  });
});

test('plays GO Battle League with no leader, a blank party being whichever the screen opens on', () => {
  expect(optionsOf({ ...GBL, party: '  ' })).toEqual({ mode: { mode: 'gbl', league: 'ultra' }, count: Infinity });
  expect(optionsOf({ ...GBL, league: ' Fantasy Cup ', party: ' GBL ', count: ' 3 ' })).toEqual({
    mode: { mode: 'gbl', league: 'Fantasy Cup', party: 'GBL' },
    count: 3,
  });
});

test.each<[Fields, string]>([
  [{ ...GBL, league: ' ' }, 'League is needed for GO Battle League, as ultra or fantasy cup.'],
  [{ ...TRAINING, league: 'fantasy cup' }, 'League takes one of great, ultra, master.'],
  [{ ...TRAINING, count: '0' }, 'Count takes a whole number of battles, 1 or more.'],
  [{ ...GBL, count: 'three' }, 'Count takes a whole number of battles, 1 or more.'],
  [{ ...GBL, count: '1.5' }, 'Count takes a whole number of battles, 1 or more.'],
])('refuses %j, saying which field and why', (fields, refused) => {
  expect(optionsOf(fields)).toEqual({ refused });
});
