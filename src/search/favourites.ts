/**
 * The searches a reader has saved on the Search page, and which of the presets `terms.js` carries they have hidden.
 * Stored under `KEY_PREFIX` like every other choice this app keeps, so `src/backup.ts`'s sweep carries them without
 * being told they exist.
 *
 * **A favourite is the link fragment, not a tree in a shape of its own.** `toFragment` and `fromFragment` in
 * `query.js` are already the one encoding of an arrangement, and the reader of it already checks every token against
 * the tables: a favourite saved before a term was renamed loads as a bookmark from then would, keeping what still means
 * something. A second encoding here would be a second reader to keep in step with the first, and nothing would fail
 * when the two disagreed.
 */

import { KEY_PREFIX } from '../storage-namespace.js';
import { load, store } from '../stored-list.js';
import type { Preset } from './terms.js';

export const FAVOURITES_KEY = `${KEY_PREFIX}search:favourites`;

/**
 * The presets stored as the *hidden* set, by `id`, rather than as the shown one, as `event-prefs.ts` stores the event
 * types: a preset added later shows up rather than being left out by a list written before it existed.
 */
export const HIDDEN_KEY = `${KEY_PREFIX}search:hidden-presets`;

/** One saved search: what the reader called it, and the arrangement as `toFragment` writes it. */
export interface Favourite {
  label: string;
  fragment: string;
}

const isFavourite = (value: unknown): value is Favourite => {
  const { label, fragment } = (value ?? {}) as Record<string, unknown>;

  return typeof label === 'string' && typeof fragment === 'string';
};

/** The saved favourites, oldest first. */
export const loadFavourites = (): Favourite[] => load(FAVOURITES_KEY, isFavourite);

/**
 * Whether the list was written. A favourite that fails to save is gone at the next load, which the reader has to be
 * told while they can still copy the link instead.
 */
export const storeFavourites = (list: readonly Favourite[]): boolean => store(FAVOURITES_KEY, list);

export const loadHidden = (): string[] => load(HIDDEN_KEY, (value) => typeof value === 'string');

/** Whether the ids were written: the panel reads them from storage as it draws, so a refused hide does nothing. */
export const storeHidden = (ids: readonly string[]): boolean => store(HIDDEN_KEY, ids);

/**
 * The list with `favourite` in it: in place of the one already under its label, so saving under a name again updates
 * that favourite rather than leaving two buttons that read the same, and otherwise on the end.
 */
export const withFavourite = (list: readonly Favourite[], favourite: Favourite): Favourite[] =>
  list.some(({ label }) => label === favourite.label)
    ? list.map((one) => (one.label === favourite.label ? favourite : one))
    : [...list, favourite];

export const withoutFavourite = (list: readonly Favourite[], label: string): Favourite[] =>
  list.filter((one) => one.label !== label);

/** The hidden presets with `id` hidden if it was shown, or shown again if it was hidden. */
export const toggled = (hidden: readonly string[], id: string): string[] =>
  hidden.includes(id) ? hidden.filter((one) => one !== id) : [...hidden, id];

/** One button in the Favourites panel: a preset `terms.js` carries, or a search the reader saved. */
export type Shelved = { label: string } & ({ preset: Preset } | { favourite: Favourite });

/**
 * The presets and the reader's own favourites as one list by name, which is how the Favourites panel lays them out: a
 * reader looks for a search by its name, whoever wrote it. `localeCompare` rather than `<`, which would put every name
 * typed in lower case after the last one starting with a capital. The sort is stable, so a favourite saved under a
 * preset's name sits after that preset.
 */
export const shelved = (presets: readonly Preset[], favourites: readonly Favourite[]): Shelved[] =>
  [
    ...presets.map((preset) => ({ label: preset.label, preset })),
    ...favourites.map((favourite) => ({ label: favourite.label, favourite })),
  ].toSorted((one, two) => one.label.localeCompare(two.label));
