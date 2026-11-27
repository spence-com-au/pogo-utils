/**
 * Where PGSharp writes its export on the phone once its inventory export is switched on: the file `scan` and the web
 * pages read off the phone with `Device.read`. A module of its own so the phone button can name the file without
 * loading the parser in `snapshot.mts` on every page.
 */
export const PGSTATS = '/sdcard/Download/PGSharp/PGSStats.json';
