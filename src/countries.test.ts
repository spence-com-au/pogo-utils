/**
 * The country table, whose row *set* `validate-gpx.mts` already checks against the files. What nothing checks is the
 * two fields on each row, and both fail silently: the flag is derived from the code, so one that is not alpha-2 draws
 * the wrong flag or none, and a continent is validated nowhere — the sidebar files an unknown one under "Other", so a
 * `Euorpe` is a country that vanishes from its own continent on a page that renders perfectly.
 */

import { expect, test } from 'vitest';

import COUNTRIES from './countries.js';

/** Every row as a `[name, code]` pair, so a failure names the country rather than reporting a bare string. */
const CODES = Object.entries(COUNTRIES).map(([name, { code }]): [string, string] => [name, code]);

test('every code is the alpha-2 pair a flag is derived from, England being the one subdivision', () => {
  // Two upper-case ASCII letters, because the flag is those two letters shifted into the regional-indicator block: a
  // lower-case `au` or a three-letter `AUS` lands outside it and renders as the letters themselves.
  expect(CODES.filter(([, code]) => !/^[A-Z]{2}$/.test(code))).toEqual([['England', 'GB-ENG']]);

  // England is a subdivision rather than a country, so Unicode gives it a tag sequence instead of a pair of indicators
  // — asserted by name so the exception above is one row rather than a hole the regex happens to leave.
  expect(COUNTRIES['England']?.code).toBe('GB-ENG');

  // No two rows share a code, which would draw one flag against two names in the sidebar and read as a duplicate entry.
  expect(new Set(CODES.map(([, code]) => code)).size).toBe(CODES.length);
});

test('every continent is one the sidebar already groups by, an unknown one being filed under Other in silence', () => {
  // Five values rather than six: nothing here is in Africa yet. The assertion is the set, so a misspelling is a new
  // value and fails, and a sixth continent arriving is a deliberate edit to this line — which is the whole check.
  expect([...new Set(Object.values(COUNTRIES).map(({ continent }) => continent))].sort()).toEqual([
    'Asia',
    'Europe',
    'North America',
    'Oceania',
    'South America',
  ]);

  // A missing continent needs no assertion of its own: `''` is a value like any other, so it joins the set and sorts to
  // the front of it. There is no edit to this table that an emptiness check would catch and the set above would not.
});
