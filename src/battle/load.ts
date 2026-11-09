/**
 * What the battle tool reads the screen against, loaded in a page as `scripts/battle.mts` loads it from `.cache`: the
 * game master the Inventory page reads, the type icons and PvPoke's meta fetched as they are upstream, and the
 * silhouettes the site publishes rather than the 40 MB of icons they are outlined from.
 */

import { said } from '../errors.js';
import { SILHOUETTES } from '../generated.js';
import { fetchBytes, gameData } from '../inventory/reader.js';
import { decodeSilhouettes, typeIcons, type Download, type Silhouettes } from '../tools/battle/assets.mts';
import { loadMeta } from '../tools/battle/meta.mts';
import { type Options } from '../tools/battle/run.mts';
import { type GameData } from '../tools/inventory/game-master.mts';

/**
 * A page has nothing to keep a copy on, so the name a cache would keep it under goes unused, but given `kept` it
 * answers a URL from there rather than fetching it again, and keeps there each body it fetches that decodes. A body
 * that will not decode is named by its URL, as `cachedAs` names it for the CLI, `fetchOk` naming it already for a
 * status.
 */
function download(kept?: Map<string, Uint8Array>): Download {
  return async (_file, url, decode) => {
    const bytes = kept?.get(url) ?? (await fetchBytes(url));

    try {
      const decoded = decode(bytes);
      kept?.set(url, bytes);

      return decoded;
    } catch (error) {
      throw new Error(`${url}: ${said(error)}`, { cause: error });
    }
  };
}

/**
 * The meta of a league as `run` asks for it, out of PvPoke's files kept in `pvpoke` by URL and fetched into it where
 * missing: the page's for `--league`, which the Worker is handed, so that a league card tapped fetches only the
 * rankings of a cup the page did not load.
 */
export const metaOf =
  (data: GameData, pvpoke: Map<string, Uint8Array>): NonNullable<Options['metaOf']> =>
  (league, warn) =>
    loadMeta(download(pvpoke), data, league, warn);

/**
 * Everything `run` reads the screen against, as its `Options` name them, for a GO Battle League `league` as `--league`
 * takes it, or null for Training, which allows for every move rather than PvPoke's. With them, PvPoke's files its meta
 * was loaded out of, by URL, for the Worker to load the meta of the league card it taps out of.
 */
export async function loadBattle(league: string | null) {
  const data = await gameData();
  const pvpoke = new Map<string, Uint8Array>();
  const [silhouettes, types, meta] = await Promise.all([
    download()(SILHOUETTES, SILHOUETTES, (bytes) =>
      decodeSilhouettes(JSON.parse(new TextDecoder().decode(bytes)) as Silhouettes),
    ),
    typeIcons(data, download()),
    league === null ? null : metaOf(data, pvpoke)(league, (line) => console.error(line)),
  ]);

  return { data, icons: [...silhouettes.values()], typeIcons: types, meta, pvpoke };
}
