/**
 * What the battle tool reads the screen against, loaded in a page as `scripts/battle.mts` loads it from `.cache`: the
 * game master the Inventory page reads, the type icons and PvPoke's meta fetched as they are upstream, and the
 * silhouettes the site publishes rather than the 40 MB of icons they are outlined from.
 */

import { SILHOUETTES } from '../generated.js';
import { fetchOk, gameData } from '../inventory/reader.js';
import { decodeSilhouettes, typeIcons, type Download, type Silhouettes } from '../tools/battle/assets.mts';
import { loadMeta } from '../tools/battle/meta.mts';

/** A page has nothing to keep a copy on, so the name a cache would keep it under goes unused. */
const download: Download = async (_file, url, decode) =>
  decode(new Uint8Array(await (await fetchOk(url)).arrayBuffer()));

/**
 * Everything `run` reads the screen against, as its `Options` name them, for a GO Battle League `league` as `--league`
 * takes it, or null for Training, which allows for every move rather than PvPoke's.
 */
export async function loadBattle(league: string | null) {
  const data = await gameData();
  const [silhouettes, types, meta] = await Promise.all([
    fetchOk(SILHOUETTES).then(async (response) => decodeSilhouettes((await response.json()) as Silhouettes)),
    typeIcons(data, download),
    league === null ? null : loadMeta(download, data, league),
  ]);

  return { data, icons: [...silhouettes.values()], typeIcons: types, meta };
}
