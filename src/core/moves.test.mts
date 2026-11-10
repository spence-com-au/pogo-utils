import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { type GameData } from './game-master.mts';
import { readMoves } from './moves.mts';
import { type Line } from './ocr.mts';
import { type Image } from './png.mts';

const DATA = JSON.parse(readFileSync(new URL('../../data/game-master.json', import.meta.url), 'utf8')) as GameData;

/** Rows reading `texts` top to bottom, and an image no rescue read reaches: with no pool to answer to, none is made. */
const rows = (...texts: string[]): Line[] =>
  texts.map((text, i) => ({ text, left: 0, top: i * 40, width: 300, height: 30 }));
const image: Image = { width: 1, height: 1, data: new Uint8Array(4) };

// An unidentified Pokémon's detail screen with Surf's row read twice: with no mega moves to match, as `parseMoves` asks
// on the detail screen, the reading stops at two charged moves, and Surf's second row is never Surf+.
test('reads two charged moves at most where no mega move is asked for', async () => {
  const read = rows('Water Gun 5', 'Hydro Pump 130', 'Surf 65', 'Surf 65');
  const surfPlus = DATA.moves.filter((move) => move.name === 'Surf+');

  expect(await readMoves(read, DATA, [], image)).toEqual({ fast: 'Water Gun', charged: ['Hydro Pump', 'Surf'] });
  expect(await readMoves(read, DATA, [], image, surfPlus)).toEqual({
    fast: 'Water Gun',
    charged: ['Hydro Pump', 'Surf', 'Surf+'],
  });
});
