/**
 * The routes and waypoints a reader has hidden on the Map page, which the PGSharp backup on the Integrations page
 * leaves out as well. Stored under `KEY_PREFIX` like every other choice this app keeps, so `src/backup.ts`'s sweep
 * carries them without being told they exist.
 *
 * An entry is kept by its `entryName` rather than by anything the map numbers it with: those numbers follow the order
 * the files load in and move whenever one gains an entry, where the name is what PGSharp itself knows a favourite by.
 * One list a kind, because a place can have both a track and a waypoint under the one name — Pier 39 has — and hiding
 * the one must leave the other.
 */

import { KEY_PREFIX } from './storage-namespace.js';

export const HIDDEN_KEYS = {
  routes: `${KEY_PREFIX}map:hidden-routes`,
  waypoints: `${KEY_PREFIX}map:hidden-waypoints`,
};

export type Kind = keyof typeof HIDDEN_KEYS;

/** Each kind's hidden entries, by `entryName`. */
export type Hidden = Readonly<Record<Kind, ReadonlySet<string>>>;

export const NOTHING_HIDDEN: Hidden = { routes: new Set(), waypoints: new Set() };

/**
 * One kind's list as storage holds it. Storage is a channel anything can write to, an import from a backup someone
 * edited by hand among them, so whatever is not a name is dropped rather than trusted, and storage that will not
 * answer reads as nothing hidden.
 */
function load(key: string): ReadonlySet<string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');

    return new Set(Array.isArray(stored) ? stored.filter((name) => typeof name === 'string') : []);
  } catch {
    return new Set();
  }
}

export const loadHidden = (): Hidden => ({ routes: load(HIDDEN_KEYS.routes), waypoints: load(HIDDEN_KEYS.waypoints) });

/**
 * What is hidden once `name` is hidden if it was shown, or shown again if it was hidden — or null when storage refused
 * the write. Not applied regardless, as `event-prefs.ts` applies a filter it could not save: the backup reads this from
 * storage, so a hide held only by the page would leave the map and the backup disagreeing.
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

  try {
    localStorage.setItem(HIDDEN_KEYS[kind], JSON.stringify([...next]));
  } catch {
    return null;
  }

  return { ...hidden, [kind]: next };
}
