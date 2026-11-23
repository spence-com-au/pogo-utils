/**
 * The owned species the Pokédex marks against, from a read's rows: the dex numbers held, deduped, with a row that
 * resolved to no dex left out.
 */

import { expect, test } from 'vitest';

import { ownedSpecies } from './owned.js';
import { type Row } from '../tools/inventory/snapshot.mts';

const row = (dex: number | null) => ({ dex }) as unknown as Row;

test('ownedSpecies is the dex numbers held at least one of, dropping the eggs that resolved to none', () => {
  expect(ownedSpecies([row(25), row(1), row(25), row(null)])).toStrictEqual(new Set([25, 1]));
});
