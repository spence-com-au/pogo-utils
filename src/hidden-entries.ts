/**
 * The routes and waypoints a reader has hidden from the PGSharp backup the Integrations page builds, by the eye on
 * each of their rows on the Map page — which still draws them, faded in the list. Stored under `KEY_PREFIX` like every
 * other choice this app keeps, so `src/backup.ts`'s sweep carries them without being told they exist.
 *
 * An entry is kept by its `entryName` rather than by anything the map numbers it with: those numbers follow the order
 * the files load in and move whenever one gains an entry, where the name is what PGSharp itself knows a favourite by.
 * One list a kind, because a place can have both a track and a waypoint under the one name — Pier 39 has — and hiding
 * the one must leave the other.
 */

import { KEY_PREFIX } from './storage-namespace.js';
import { load, store } from './stored-list.js';

export const HIDDEN_KEYS = {
  routes: `${KEY_PREFIX}map:hidden-routes`,
  waypoints: `${KEY_PREFIX}map:hidden-waypoints`,
};

export type Kind = keyof typeof HIDDEN_KEYS;

/** Each kind's hidden entries, by `entryName`. */
export type Hidden = Readonly<Record<Kind, ReadonlySet<string>>>;

export const NOTHING_HIDDEN: Hidden = { routes: new Set(), waypoints: new Set() };

/** One kind's list as storage holds it, anything that is not a name dropped. */
const loadKind = (key: string): ReadonlySet<string> => new Set(load(key, (v): v is string => typeof v === 'string'));

export const loadHidden = (): Hidden => ({
  routes: loadKind(HIDDEN_KEYS.routes),
  waypoints: loadKind(HIDDEN_KEYS.waypoints),
});

/**
 * What is hidden once `name` is hidden if it was not, or put back if it was — or null when storage refused the write.
 * Not applied regardless, as `event-prefs.ts` applies a filter it could not save: the backup reads this from storage,
 * so a hide held only by the page would leave the Map page's rows and the backup disagreeing.
 *
 * Read from storage here rather than handed the page's copy, so a toggle after an import from Settings builds on the
 * list the import wrote instead of writing back the one the page opened with.
 */
export function toggleHidden(kind: Kind, name: string): Hidden | null {
  const hidden = loadHidden();
  const next = new Set(hidden[kind]);

  if (!next.delete(name)) {
    next.add(name);
  }

  if (!store(HIDDEN_KEYS[kind], [...next])) {
    return null;
  }

  return { ...hidden, [kind]: next };
}
