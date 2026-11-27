/**
 * What the Map page has hidden as storage holds it: what a load trusts, what a toggle writes, and the refusal the page
 * has to say out loud. What the backup leaves out because of it is `pgsharp/favourites.test.ts`'s.
 */

import { beforeEach, expect, test } from 'vitest';

import { HIDDEN_KEYS, loadHidden, toggleHidden } from './hidden-entries.js';
import { installFakeStorage, type FakeStorage } from './testing/storage.js';

let storage: FakeStorage;

beforeEach(() => {
  storage = installFakeStorage();
});

const PIER = 'Pier 39, San Francisco, United States';

test('nothing stored, and storage that will not answer, both read as nothing hidden', () => {
  expect(loadHidden()).toEqual({ routes: new Set(), waypoints: new Set() });

  storage.throws = true;

  expect(loadHidden()).toEqual({ routes: new Set(), waypoints: new Set() });
});

/** Storage is anyone's to write, a hand-edited backup among them, so only names are kept. */
test('a stored list keeps its names and drops anything else', () => {
  storage.setItem(HIDDEN_KEYS.routes, JSON.stringify([PIER, 7, null, { name: PIER }]));
  storage.setItem(HIDDEN_KEYS.waypoints, '{"not": "a list"}');

  expect(loadHidden()).toEqual({ routes: new Set([PIER]), waypoints: new Set() });
});

/**
 * Pier 39 has a track and a waypoint under the one name, so hiding the track must leave the waypoint: each kind is
 * its own key, and a toggle writes only its own.
 */
test('a toggle hides an entry of its own kind, and a second shows it again', () => {
  expect(toggleHidden('routes', PIER)).toEqual({ routes: new Set([PIER]), waypoints: new Set() });
  expect(loadHidden()).toEqual({ routes: new Set([PIER]), waypoints: new Set() });
  expect(storage.getItem(HIDDEN_KEYS.waypoints)).toBeNull();

  expect(toggleHidden('routes', PIER)).toEqual({ routes: new Set(), waypoints: new Set() });
  expect(loadHidden().routes).toEqual(new Set());
});

/** An import from Settings lands while the Map page is open, and the next toggle must add to it rather than undo it. */
test('a toggle builds on what storage holds now', () => {
  storage.setItem(HIDDEN_KEYS.routes, JSON.stringify(['Imported, Australia']));

  expect(toggleHidden('routes', PIER)?.routes).toEqual(new Set(['Imported, Australia', PIER]));
});

/** A hide the backup would not see is worse than none, so a refused write changes nothing and says so. */
test('a refused write answers null and leaves what was stored', () => {
  storage.setItem(HIDDEN_KEYS.waypoints, JSON.stringify([PIER]));
  storage.refusesWrites = true;

  expect(toggleHidden('waypoints', PIER)).toBeNull();
  expect(loadHidden().waypoints).toEqual(new Set([PIER]));
});
