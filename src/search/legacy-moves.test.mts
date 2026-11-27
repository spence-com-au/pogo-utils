/**
 * `LEGACY_MOVES` held to the game master. A vend that teaches a listed species a new move can turn one of its rows into
 * a prefix of that move too, as Acid Spray did to `@acid` on Muk, and the search goes on running with nothing to say it
 * now finds more than legacy movesets.
 *
 * Beside `terms.test.ts` rather than in it because reading the game master off disk needs Node, which the browser half
 * of the type-check does not see.
 */

import { type GameData } from '../core/game-master.mts';
import { LEGACY_MOVES } from './terms.ts';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const DATA = JSON.parse(readFileSync(new URL('../../data/game-master.json', import.meta.url), 'utf8')) as GameData;

test('every legacy move names a move and takes in no other its species learns', () => {
  const names = new Set(DATA.moves.map((move) => move.name.toLowerCase()));

  const faults = LEGACY_MOVES.flatMap(([pokemon, term]) => {
    const [, slot, name] = /^@([12]?)(.+)$/.exec(term) ?? [];

    if (name === undefined || !names.has(name)) {
      return [`${term}: no such move`];
    }

    // The game completes a move's name, so the term reaches every move it starts, in the slot it names if any.
    const reached = new Set(
      DATA.forms
        .filter((form) => form.dex === pokemon.dex)
        .flatMap((form) => form.moves)
        .filter((move) => slot === '' || move.fast === (slot === '1'))
        .map((move) => move.name.toLowerCase())
        .filter((move) => move.startsWith(name) && move !== name),
    );
    return [...reached].map((move) => `${term} on #${pokemon.dex}: also ${move}`);
  });

  // The rows qualified by slot are the other half: without them this would pass just as quietly over `@acid`.
  expect({
    faults,
    qualified: LEGACY_MOVES.some(([, term]) => /^@[12]/.test(term)),
  }).toEqual({ faults: [], qualified: true });
});
