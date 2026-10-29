/**
 * What a battle reads the screen against beyond the game master and PvPoke's meta, and how each is read: the type icons
 * and the forms' silhouettes. The type icons are fetched through a `Download` the caller hands over, as `meta.mts`
 * fetches PvPoke's files, because the two callers fetch differently: `pnpm battle` keeps a week's copy under `.cache`
 * as `pnpm inventory` does, and a page has `fetch` and nothing to keep a copy on.
 *
 * The silhouettes are the exception. A page would have to fetch some 1,300 form icons and 40 MB to outline them, so
 * `scripts/vend-silhouettes.mts` outlines them once into `data/silhouettes.json`, which is what `encodeSilhouettes`
 * writes and `decodeSilhouettes` reads.
 */

import { typeIcon, typeIconFile } from '../../pokedex/icons.ts';
import { type GameData } from '../inventory/game-master.mts';
import { decodePng, type Image } from '../inventory/png.mts';
import { GRID, type Icon } from './party.mts';

/**
 * `url` fetched and read by `decode`, `file` being the name a cache keeps it under. Decoded inside rather than after,
 * so the CLI's `cachedAs` can drop a copy that will not decode rather than read it back for the rest of the week.
 */
export type Download = <T>(file: string, url: string, decode: (bytes: Uint8Array) => T) => Promise<T>;

/**
 * The game's own icon for each type, which the minigame's bubbles and the HUD's type icons are told by. A type whose
 * icon cannot be had is swiped at in rows, as before the bubbles were aimed at, and its icon in the HUD is read as no
 * type.
 */
export async function typeIcons(data: GameData, download: Download): Promise<Record<string, Image>> {
  const read = await Promise.all(
    data.types.map(async (type) => {
      try {
        return [[type, await download(typeIconFile(type), typeIcon(type), decodePng)] as const];
      } catch {
        return [];
      }
    }),
  );

  return Object.fromEntries(read.flat());
}

/**
 * Every form icon the game master names, with the species it belongs to: the icons a party card is read against. An
 * icon several forms share is outlined once, for the species of the last of them, which is the same species for every
 * icon shared today.
 */
export function formIcons(data: GameData): Map<string, string> {
  return new Map(data.forms.flatMap((form) => (form.icon ? [[form.icon, form.species] as const] : [])));
}

/**
 * The silhouettes as the site publishes them: by form icon, its species and its cells packed eight to a byte, the
 * first cell in the top bit, in base64. A cell is a bit, so a form is `GRID²/8` bytes, 288 at a grid of 48, where its
 * icon is some 30 KB of PNG. JSON rather than bytes of its own, so a page reads it with `response.json()`, the base64
 * costs a third that the server's gzip mostly takes back, and a re-vend's diff is one line per form that changed.
 */
export type Silhouettes = Record<string, [species: string, cells: string]>;

/** How many bytes a silhouette packs into, eight cells to each. */
const PACKED = Math.ceil((GRID * GRID) / 8);

export function encodeSilhouettes(icons: ReadonlyMap<string, Icon>): Silhouettes {
  return Object.fromEntries(
    [...icons].map(([icon, { species, silhouette }]) => {
      const packed = new Uint8Array(PACKED);

      silhouette.forEach((cell, at) => {
        packed[at >> 3] = (packed[at >> 3] ?? 0) | (cell << (7 - (at & 7)));
      });

      return [icon, [species, btoa(String.fromCharCode(...packed))]];
    }),
  );
}

/**
 * The silhouettes `encodeSilhouettes` packed, by form icon. Refused where one is not the size this grid packs into,
 * which is the asset vended for a grid since changed: read anyway, every card would be laid over the wrong cells.
 */
export function decodeSilhouettes(asset: Silhouettes): Map<string, Icon> {
  return new Map(
    Object.entries(asset).map(([icon, [species, cells]]) => {
      const packed = Uint8Array.from(atob(cells), (char) => char.charCodeAt(0));

      if (packed.length !== PACKED) {
        throw new Error(`${icon} packs into ${packed.length} bytes, not ${PACKED}: run \`pnpm vend:silhouettes\``);
      }

      const silhouette = new Uint8Array(GRID * GRID).map((_, at) => ((packed[at >> 3] ?? 0) >> (7 - (at & 7))) & 1);

      return [icon, { species, silhouette }];
    }),
  );
}
