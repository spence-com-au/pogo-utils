/**
 * Writes `data/silhouettes.json`, every form's outline that `pnpm battle` reads a party card against, for a page to
 * fetch once rather than fetching some 1,300 form icons and 40 MB to outline them itself. The forms are the vended game
 * master's, which is the one a page reads, and `assets.test.mts` fails where the two have drifted apart, so a re-vend
 * of the game master that adds a form is followed by this.
 *
 * Vended rather than built, for the reason `build-ics.mts` gives: the build touches nothing on the network, and this
 * would be 1,300 downloads on every deploy and on every pull request's `lint:types`. As with the game master, the icons
 * go into an empty directory rather than `CACHE`, so the output is a function of upstream as it is now and `git diff`
 * after a run says whether any outline has moved.
 */

import { GAME_MASTER, SILHOUETTES } from '../src/generated.ts';
import { encodeSilhouettes, formIcons, silhouettesFor, type Download } from '../src/tools/battle/assets.mts';
import { cachedAs } from '../src/tools/inventory/download.mts';
import { type GameData } from '../src/tools/inventory/game-master.mts';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import prettier from 'prettier';

const data = JSON.parse(readFileSync(GAME_MASTER, 'utf8')) as GameData;
const wanted = formIcons(data).size;
const dir = mkdtempSync(join(tmpdir(), 'silhouettes-'));
const download: Download = (file, url, decode) => cachedAs(dir, file, url, false, decode);
let icons;

/*
 * `silhouettesFor` leaves out an icon it could not have, and a form left out here is one a page can never match. A few
 * of the 1,300 downloads time out on most cold runs — 1 to 5 in each of four, a different few each time, each
 * `ETIMEDOUT` and each there when asked again — so a second pass over the same directory fetches only those, and
 * anything still missing after it is refused.
 */
try {
  icons = await silhouettesFor(data, download);

  if (icons.size < wanted) {
    console.error(`${wanted - icons.size} of ${wanted} form icons could not be had; asking for them again`);
    icons = await silhouettesFor(data, download);
  }
} finally {
  rmSync(dir, { recursive: true });
}

if (icons.size < wanted) {
  throw new Error(`only ${icons.size} of ${wanted} form icons could be had, so nothing is written`);
}

// Through Prettier, as `vend-game-master.mts` writes its own, which puts each form's entry on lines of its own.
const options = await prettier.resolveConfig(SILHOUETTES);
const text = await prettier.format(JSON.stringify(encodeSilhouettes(icons)), { ...options, filepath: SILHOUETTES });

writeFileSync(SILHOUETTES, text);

console.error(`${SILHOUETTES}: ${icons.size} silhouettes in ${Math.round(Buffer.byteLength(text) / 1024)} KB`);
