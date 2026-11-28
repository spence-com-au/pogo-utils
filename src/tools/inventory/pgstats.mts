/**
 * PGSharp's inventory export, as `pnpm inventory scan` and the web pages read it off the phone. A module of its own so
 * the phone button can name the file without loading the parser in `snapshot.mts` on every page.
 */

import type { Device } from '../../core/adb.mts';

/** What PGSharp names the export, in whichever folder of shared storage its settings point it at. */
export const PGSTATS = 'PGSStats.json';

/**
 * The export off the phone as text, found wherever PGSharp was told to write it: `Download/PGSharp` unless the user
 * picked another folder, which PGSharp keeps in its own storage where `adb` cannot read it, so the file is looked for
 * by name instead. Throws where there is none, or it cannot be read.
 */
export async function readExport(device: Pick<Device, 'locate' | 'read'>): Promise<string> {
  const path = await device.locate(PGSTATS);

  if (path === null) {
    throw new Error(`found no ${PGSTATS} on the phone`);
  }

  return new TextDecoder().decode(await device.read(path));
}
