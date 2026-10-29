/**
 * What the battle tool reads the screen against, loaded in a page as `scripts/battle.mts` loads it from `.cache`: the
 * game master the Inventory page reads, the type icons and PvPoke's meta fetched as they are upstream, and the
 * silhouettes the site publishes rather than the 40 MB of icons they are outlined from.
 */

import { SILHOUETTES } from '../generated.js';
import { fetchOk, gameData } from '../inventory/reader.js';
import { decodeSilhouettes, typeIcons, type Download, type Silhouettes } from '../tools/battle/assets.mts';
import { loadMeta } from '../tools/battle/meta.mts';

/**
 * A page has nothing to keep a copy on, so the name a cache would keep it under goes unused. A body that will not
 * decode is named by its URL, as `cachedAs` names it for the CLI, `fetchOk` naming it already for a status.
 */
const download: Download = async (_file, url, decode) => {
  const bytes = new Uint8Array(await (await fetchOk(url)).arrayBuffer());

  try {
    return decode(bytes);
  } catch (error) {
    throw new Error(`${url}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
};

/**
 * Everything `run` reads the screen against, as its `Options` name them, for a GO Battle League `league` as `--league`
 * takes it, or null for Training, which allows for every move rather than PvPoke's.
 */
export async function loadBattle(league: string | null) {
  const data = await gameData();
  const [silhouettes, types, meta] = await Promise.all([
    download(SILHOUETTES, SILHOUETTES, (bytes) =>
      decodeSilhouettes(JSON.parse(new TextDecoder().decode(bytes)) as Silhouettes),
    ),
    typeIcons(data, download),
    league === null ? null : loadMeta(download, data, league),
  ]);

  return { data, icons: [...silhouettes.values()], typeIcons: types, meta };
}
