/**
 * Whether a screen the scan scrolled to holds the moves or stops above them, read off real captures. `moves/` holds one
 * Necrozma twice: `necrozma-cut-off.png` is the screen a live scan read its moves from, one step down, with the fusion
 * panel leaving the `GYMS & RAIDS` tab at its foot and both moves below it; `necrozma-fuse.png` is a stitch of the same
 * Pokémon from `snap`, cut off above the catch details, where both moves are. Two of the corpus beside them stand for
 * every other Pokémon: `pikachu.png` a stitch with the moves whole, and `no-pgsharp.png` a screen that was never
 * scrolled, ending halfway through its charged move.
 */

import { readFileSync } from 'node:fs';
import { afterAll, expect, test } from 'vitest';
import { readLines } from './detail.mts';
import { type GameData } from './game-master.mts';
import { movesCutOff, parseMoves } from './moves.mts';
import { decodePng } from './png.mts';
import { useTestEngine } from './test-engine.mts';

const DATA = JSON.parse(readFileSync(new URL('fixtures/game-master.json', import.meta.url), 'utf8')) as GameData;
const NECROZMA = DATA.forms.find((f) => f.species === 'Necrozma' && f.form === null) ?? null;

afterAll(useTestEngine());

async function linesOf(file: string) {
  const image = decodePng(readFileSync(new URL(`fixtures/${file}`, import.meta.url)));

  return { image, lines: await readLines(image) };
}

test.for([
  ['moves/necrozma-cut-off.png', true],
  ['no-pgsharp.png', true],
  ['moves/necrozma-fuse.png', false],
  ['pikachu.png', false],
] as const)('%s says the moves can run on below it: %s', async ([file, cutOff]) => {
  const { image, lines } = await linesOf(file);

  expect(movesCutOff(lines, image)).toBe(cutOff);
});

test("the moves are read off Necrozma's stitch and not off the screen that stopped above them", async () => {
  expect(NECROZMA, 'the game master has no Necrozma').not.toBeNull();

  const cut = await linesOf('moves/necrozma-cut-off.png');
  const whole = await linesOf('moves/necrozma-fuse.png');

  expect(await parseMoves(cut.lines, DATA, NECROZMA, cut.image)).toStrictEqual({ fast: null, charged: [] });
  expect(await parseMoves(whole.lines, DATA, NECROZMA, whole.image)).toStrictEqual({
    fast: 'Psycho Cut',
    charged: ['Future Sight'],
  });
});
