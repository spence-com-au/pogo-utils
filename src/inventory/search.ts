/**
 * The Search page's walk to Pokémon storage on the phone: a term typed into the game's search box, and the count the
 * game's own counter answers with. It runs `storage` over the browser's WebAssembly Tesseract and the vended game
 * master rather than the Node ones the CLI installs, so the page reads the screen no differently for any reason but the
 * engine.
 *
 * **Nothing read leaves the page.** What is fetched is the model and the game master, neither carrying anything about
 * the screen; the screenshot and the count stay in memory here, and leave only as the message the page shows.
 */

import { Device, type Transport } from '../core/adb.mts';
import { gameData, once } from '../core/browser/fetch.js';
import { wasmEngine } from '../core/browser/ocr.js';
import { type GameData } from '../core/game-master.mts';
import { useEngine } from '../core/ocr.mts';
import { DEFAULTS } from '../tools/inventory/config.mts';
import { storage, unsearchable } from '../tools/inventory/storage.mts';

/**
 * The engine installed and the game master loaded, once: all a storage search needs, the game master being what tells a
 * detail screen from the map. `onModel` hears how far the model's first download has got — 4 MB, and the one wait worth
 * a progress bar.
 */
const ready = once(async (onModel: (fraction: number) => void): Promise<GameData> => {
  useEngine(wasmEngine(location.href, onModel));

  return gameData();
});

/**
 * `term` typed into storage's search box on the phone, from wherever the game is — and how many Pokémon the game's own
 * counter says it matched, or null where the counter did not read.
 *
 * The taps and waits are `DEFAULTS`, a page having no `--config` to lay over them. `say` hears whether the game had to
 * be launched, which is the thirty seconds of the wait worth saying.
 */
export async function searchStorage(
  transport: Transport,
  term: string,
  onModel: (fraction: number) => void,
  say: (message: string) => void,
): Promise<number | null> {
  const unsent = unsearchable(term);

  if (unsent !== null) {
    throw new Error(`this search ${unsent}`);
  }

  const device = new Device(transport);
  const data = await ready(onModel);
  const { search, matches } = storage(device, DEFAULTS, data, await device.screenshot(), say);

  return matches(await search(term));
}
