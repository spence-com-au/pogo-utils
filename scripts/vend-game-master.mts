/**
 * Writes the game master fixture the corpus tests read their forms, moves, type names and CP multipliers out of. It
 * exists because a test of a reader must not reach the network, and the two files upstream are 22 MB for the 0.85 MB
 * anything here consults.
 *
 * Nothing reads the clock, so the output is a pure function of the three things `loadGameData` downloads and
 * `git diff --quiet` after a run answers exactly "has the game master moved?". That holds only if all three are
 * upstream's as of now, so they go into an empty directory rather than `CACHE` and a failed download throws.
 *
 * Written unpruned. Dropping the per-form move pools would take it from 0.85 MB to 0.35 MB and is the one cut worth
 * refusing: a move read off the screen is matched against its form's pool.
 *
 * Re-vending is a reviewed commit rather than a refresh — the counts the test pins move when upstream releases a
 * species, and a form that shares a dex, types and stamina with one already here changes which forms an HP can tell
 * apart.
 */

import { GAME_MASTER } from '../src/generated.ts';
import { loadGameData } from '../src/tools/inventory/download.mts';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import prettier from 'prettier';

const dir = mkdtempSync(join(tmpdir(), 'game-master-'));
const data = await loadGameData(dir).finally(() => rmSync(dir, { recursive: true }));

// `loadGameData` does without the icon index rather than failing when it cannot be read, which is right for a scan and
// would vend every form's `icon` as null here.
if (data.forms.every((form) => form.icon === null)) {
  throw new Error('the icon index could not be read, so no form has an icon');
}

// Formatted here rather than by a `prettier --write` chained after this in `package.json`, so that running the script
// on its own cannot leave the tree failing `lint:prettier` — and through Prettier's own config resolution rather than a
// width written down twice, which is also what keeps the 30,000-line diff of a re-vend readable.
const options = await prettier.resolveConfig(GAME_MASTER);

writeFileSync(GAME_MASTER, await prettier.format(JSON.stringify(data), { ...options, filepath: GAME_MASTER }));

console.error(
  `${GAME_MASTER}: ${data.forms.length} forms over ${data.species.length} species, ${data.moves.length} moves, ` +
    `${data.types.length} types, ${data.cpm.length} levels`,
);
