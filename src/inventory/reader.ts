/**
 * What the pages read the phone's screen with: the WebAssembly Tesseract, the vended game master and the form icons,
 * each fetched the first time it is wanted and held for every read after. The Inventory page's reading is `readScreen`,
 * the very function `pnpm inventory parse` prints, and the Search page's walk to storage is `storage`, the one
 * `snap --search` drives — so neither can answer differently from the CLI for any reason but the engine.
 *
 * **Nothing read leaves the page.** What is fetched is the model, the game master and the icons, none of which carries
 * anything about the screen; the screenshot and what it reads as stay in memory here, and leave only as a download.
 */

import { Device, type Transport } from '../core/adb.mts';
import { fetchBytes, gameData, once } from '../core/browser/fetch.js';
import { wasmEngine } from '../core/browser/ocr.js';
import { type Form, type GameData } from '../core/game-master.mts';
import { useEngine } from '../core/ocr.mts';
import { decodePng, type Image } from '../core/png.mts';
import { ICON_BASE } from '../pokedex/icons.js';
import { signatureOfIcon, signaturesFor, type Colourings } from '../tools/inventory/artwork.mts';
import { DEFAULTS } from '../tools/inventory/config.mts';
import { wardrobeFor } from '../tools/inventory/costume.mts';
import { showProgress } from '../tools/inventory/progress.mts';
import { readScreen, type Reading } from '../tools/inventory/report.mts';
import { storage, unsearchable } from '../tools/inventory/storage.mts';

/** Everything a read needs that is the same for every screen. */
interface Kit {
  data: GameData;
  icons: ReadonlyMap<Form, Colourings>;
}

/**
 * Why this page cannot read a screenshot, or null where it can. The OCR model is checked against its hash before it
 * reads anything, and the hash is Web Crypto's, which a browser offers only to a secure context — `localhost` and the
 * published site, but not the LAN address `pnpm serve` prints.
 */
export function unreadable(): string | null {
  return window.isSecureContext
    ? null
    : 'Reading a screenshot needs a secure context: open this page from localhost or the published site.';
}

/**
 * The engine installed and the game master loaded, once: all a storage search needs, the game master being what tells
 * a detail screen from the map, and the first half of a read.
 *
 * `onModel` hears how far the model's first download has got — 4 MB, and the one wait worth a progress bar.
 */
const ready = once(async (onModel: (fraction: number) => void): Promise<GameData> => {
  // The CLI narrates the icons it is about to read, which a page has no terminal for.
  showProgress(false);

  useEngine(wasmEngine(location.href, onModel));

  return gameData();
});

/** And the icons a read picks a form by, once and on the same terms. */
const prepare = once(async (onModel: (fraction: number) => void): Promise<Kit> => {
  const data = await ready(onModel);
  const icons = await signaturesFor(data, async (file) =>
    signatureOfIcon(decodePng(await fetchBytes(ICON_BASE + file))),
  );

  return { data, icons };
});

/**
 * Pikachu's icons drawn into one frame for its costume, fetched the first time a Pikachu is read rather than with the
 * kit: some 200 icons that no other screen wants. One that could not be had leaves its costume out, and a wardrobe
 * short of the plain icon is not kept.
 */
const wardrobeOn = once(
  (data: GameData) => wardrobeFor(data, async (file) => decodePng(await fetchBytes(ICON_BASE + file))),
  (drawn) => drawn !== null,
);

/** Every reader over one screenshot, as `parse` would read it. */
export async function read(image: Image, onModel: (fraction: number) => void): Promise<Reading> {
  const { data, icons } = await prepare(onModel);

  return readScreen(image, data, icons, undefined, () => wardrobeOn(data));
}

/**
 * `term` typed into storage's search box on the phone, from wherever the game is, as `snap --search` types it — and
 * how many Pokémon the game's own counter says it matched, or null where the counter did not read.
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
