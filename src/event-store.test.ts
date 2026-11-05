import { beforeEach, expect, test, vi } from 'vitest';

import { KEYS } from './event-prefs.js';
import { EventStore, NOTHING_REVEALED } from './event-store.js';
import { installFakeStorage, type FakeStorage } from './testing/storage.js';

import type { StampedEvent } from './event-feed.js';

let storage: FakeStorage;

beforeEach(() => {
  storage = installFakeStorage();
});

/** A feed entry, upcoming unless the case says otherwise, so the default reveals let it through. */
const feedEvent = (eventID: string, over: Partial<StampedEvent> = {}): StampedEvent => ({
  eventID,
  name: `Event ${eventID}`,
  eventType: 'event',
  heading: 'Events',
  link: 'https://example.invalid/',
  image: '',
  start: '2099-01-01T10:00:00.000',
  end: '2099-01-02T10:00:00.000',
  ...over,
});

/**
 * A store whose fetch answers whatever `feed` holds at the time, with the local file empty, so a case can load once,
 * change the feed and load again — the way a reader comes back to find an event added.
 */
function storeOver(initial: StampedEvent[], local: StampedEvent[] = []) {
  const source = { feed: initial, local };
  const fetchList = vi.fn(async (url: string) => (url.endsWith('events-feed.json') ? source.feed : source.local));

  return { store: new EventStore(fetchList), source, fetchList };
}

const ids = (store: EventStore) => store.newlyVisible().map((ev) => ev.eventID);

/** The seen record as this browser has it stored. */
const stored = () => JSON.parse(storage.getItem(KEYS.seen) ?? 'null');

/** A stamp `n` days into the year, so a case can say which events were vended before which. */
const day = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString();

test('a first visit has nothing new, the seen record starting from the whole feed', async () => {
  const { store } = storeOver([feedEvent('a'), feedEvent('b')]);

  await store.load();

  expect(ids(store)).toEqual([]);
  expect(stored()).toEqual({ through: null, ids: ['a', 'b'] });
});

/**
 * The case #209 is about: a feed whose events all carry stamps is recorded as seen in one instant, however long it is,
 * and an event vended after that instant is still new.
 */
test('a first visit over a stamped feed stores one instant, and an event vended after it is new', async () => {
  const feed = Array.from({ length: 74 }, (_, i) => feedEvent(`e${i}`, { added: day(1 + (i % 5)) }));
  const { store, source } = storeOver(feed);

  await store.load();

  expect(ids(store)).toEqual([]);
  expect(stored()).toEqual({ through: Date.parse(day(5)), ids: [] });

  source.feed = [...feed, feedEvent('later', { added: day(9) })];
  await store.load();

  expect(ids(store)).toEqual(['later']);
  expect(stored()).toEqual({ through: Date.parse(day(5)), ids: [] });
});

/**
 * The instant never covers an event still new, so one acknowledged past it is held by ID until the earlier one is
 * acknowledged too, and then both fold into the instant — in the same write, so **Mark all as seen** leaves no list.
 */
test('acknowledging folds into the instant once nothing earlier is still new', async () => {
  const { store, source } = storeOver([feedEvent('a', { added: day(1) })]);

  await store.load();
  source.feed = [
    feedEvent('a', { added: day(1) }),
    feedEvent('b', { added: day(2) }),
    feedEvent('c', { added: day(3) }),
  ];
  await store.load();

  store.acknowledge([{ eventID: 'c' }]);
  expect(ids(store)).toEqual(['b']);
  expect(stored()).toEqual({ through: Date.parse(day(1)), ids: ['c'] });

  store.acknowledge([{ eventID: 'b' }]);
  expect(ids(store)).toEqual([]);
  expect(stored()).toEqual({ through: Date.parse(day(3)), ids: [] });
});

/** An event the vend has yet to stamp is seen by its ID, the way every event was before there were stamps. */
test('an unstamped event is recorded by ID, and folds once it is stamped', async () => {
  const { store, source } = storeOver([feedEvent('a', { added: day(1) })], [feedEvent('local')]);

  await store.load();
  expect(stored()).toEqual({ through: Date.parse(day(1)), ids: ['local'] });

  source.local = [feedEvent('local', { added: day(2) })];
  await store.load();

  expect(ids(store)).toEqual([]);
  expect(stored()).toEqual({ through: Date.parse(day(2)), ids: [] });
});

/** A record stored before stamps, a list of IDs, keeps every mark its reader cleared and folds on the next load. */
test('a list of IDs from before stamps folds into an instant', async () => {
  storage.setItem(KEYS.seen, JSON.stringify(['a', 'b']));

  const { store } = storeOver([
    feedEvent('a', { added: day(1) }),
    feedEvent('b', { added: day(1) }),
    feedEvent('c', { added: day(1) }),
  ]);

  await store.load();

  expect(ids(store)).toEqual(['c']);
  expect(stored()).toEqual({ through: null, ids: ['a', 'b'] });

  store.acknowledge([{ eventID: 'c' }]);
  expect(stored()).toEqual({ through: Date.parse(day(1)), ids: [] });
});

/**
 * A load that found one file and not the other settles nothing. Settled against the feed alone, the instant would
 * climb past a new event the local file carries, and the prune would forget what the reader had acknowledged there.
 */
test('a load missing one of its files leaves the seen record as it was', async () => {
  const { store, source, fetchList } = storeOver(
    [feedEvent('a', { added: day(1) })],
    [feedEvent('l', { added: day(1) })],
  );

  await store.load();
  source.feed = [feedEvent('a', { added: day(1) }), feedEvent('b', { added: day(3) })];
  source.local = [feedEvent('l', { added: day(1) }), feedEvent('m', { added: day(2) })];

  // m is new, and stamped before b: settling against the feed alone would move the instant past it.
  fetchList.mockImplementation(async (url: string) => {
    if (url.endsWith('events-feed.json')) {
      return source.feed;
    }

    throw new Error('offline');
  });
  await store.load();
  store.acknowledge([{ eventID: 'b' }]);

  expect(stored()).toEqual({ through: Date.parse(day(1)), ids: ['b'] });

  fetchList.mockImplementation(async (url: string) => (url.endsWith('events-feed.json') ? source.feed : source.local));
  await store.load();

  expect(ids(store)).toEqual(['m']);
  expect(stored()).toEqual({ through: Date.parse(day(1)), ids: ['b'] });
});

test('an event this browser has not seen is new, on any tab', async () => {
  const { store, source } = storeOver([feedEvent('a')]);

  await store.load();
  source.feed = [feedEvent('a'), feedEvent('b')];
  await store.load();

  expect(ids(store)).toEqual(['b']);
});

test('a recurring type is never new', async () => {
  const { store, source } = storeOver([feedEvent('a')]);

  await store.load();
  source.feed = [feedEvent('a'), feedEvent('raidhour', { heading: 'Raid Hour', eventType: 'raid-hour' })];
  await store.load();

  expect(ids(store)).toEqual([]);
});

test("only what the cards view's type filters and reveals let through is new", async () => {
  const { store, source } = storeOver([feedEvent('a')]);

  await store.load();
  source.feed = [
    feedEvent('a'),
    feedEvent('hidden', { heading: 'GO Pass', eventType: 'go-pass' }),
    feedEvent('dismissed'),
    feedEvent('over', { start: '2000-01-01T10:00:00.000', end: '2000-01-02T10:00:00.000' }),
    feedEvent('undated', { start: null, end: null }),
  ];
  await store.load();
  store.prefs.dismissed.add('dismissed');

  expect(ids(store)).toEqual([]);

  store.publish({ reveals: { showPast: true, showUndated: true, showHidden: true }, search: '', now: new Date() });

  expect(ids(store).sort()).toEqual(['dismissed', 'over', 'undated']);
});

test("the cards view's own type filters are the ones counted, whichever view is open", async () => {
  const { store, source } = storeOver([feedEvent('a')]);

  await store.load();
  source.feed = [feedEvent('a'), feedEvent('b')];
  await store.load();

  store.prefs.filterScope = 'view';
  store.prefs.hiddenByView['calendar'] = new Set(['event']);
  expect(ids(store)).toEqual(['b']);

  store.prefs.hiddenByView['cards'] = new Set(['event']);
  expect(ids(store)).toEqual([]);
});

/**
 * The type filters key on the `eventType` slug, so a type survives its heading being reworded upstream, and an event
 * the feed gives no heading is filtered with its own type rather than with every other headingless one.
 */
test('a hidden type is matched by its slug, whatever its heading says', async () => {
  const { store, source } = storeOver([feedEvent('a')]);

  await store.load();
  source.feed = [
    feedEvent('a'),
    feedEvent('renamed', { heading: 'Raid Hour (Reworded)', eventType: 'raid-battles' }),
    feedEvent('bare', { heading: '', eventType: 'research' }),
    feedEvent('kept', { heading: '', eventType: 'wild-area' }),
  ];
  await store.load();
  store.prefs.hiddenTypes = new Set(['raid-battles', 'research']);

  expect(ids(store)).toEqual(['kept']);
});

test('the Events page search narrows the list while it is open, and closing the page lifts it', async () => {
  const { store, source } = storeOver([feedEvent('a')]);

  await store.load();
  source.feed = [feedEvent('a'), feedEvent('b'), feedEvent('c')];
  await store.load();

  store.publish({ reveals: NOTHING_REVEALED, search: 'Event c', now: new Date() });
  expect(ids(store)).toEqual(['c']);

  store.publish(null);
  expect(ids(store)).toEqual(['b', 'c']);
});

/**
 * **Clear all** asks for no events whenever the other notices were all there was, which can be before any load has
 * settled the seen record. Nothing to record is nothing to write: a stored null would stop the read-through of the
 * record's unprefixed name.
 */
test('acknowledging no events writes nothing and tells nobody', () => {
  const { store } = storeOver([feedEvent('a')]);
  const listener = vi.fn();
  store.subscribe(listener);

  store.acknowledge([]);

  expect(storage.snapshot()).toEqual({});
  expect(listener).not.toHaveBeenCalled();
});

test('acknowledging clears the notification through the one seen set, and tells every reader', async () => {
  const { store, source } = storeOver([feedEvent('a')]);

  await store.load();
  source.feed = [feedEvent('a'), feedEvent('b'), feedEvent('c')];
  await store.load();

  const listener = vi.fn();
  store.subscribe(listener);
  store.acknowledge([{ eventID: 'b' }]);

  expect(ids(store)).toEqual(['c']);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(stored()).toEqual({ through: null, ids: ['a', 'b'] });

  // A second store reading the same storage, as the next page load would, agrees.
  const { store: next } = storeOver(source.feed);
  await next.load();
  expect(ids(next)).toEqual(['c']);
});

test('a refetch that finds neither file keeps the events already loaded, so no tab loses its count', async () => {
  const { store, source, fetchList } = storeOver([feedEvent('a')]);

  await store.load();
  source.feed = [feedEvent('a'), feedEvent('b')];
  await store.load();
  fetchList.mockRejectedValue(new Error('offline'));
  await store.load();

  expect(store.failed).toBe('offline');
  expect(ids(store)).toEqual(['b']);
});

test('the shell and the Events page opening together fetch once', async () => {
  const { store, fetchList } = storeOver([feedEvent('a')]);

  await Promise.all([store.ensureLoaded(), store.ensureLoaded()]);
  await store.ensureLoaded();

  // One call per file.
  expect(fetchList).toHaveBeenCalledTimes(2);

  await store.load();
  expect(fetchList).toHaveBeenCalledTimes(4);
});

test('reloading the preferences keeps the object every reader holds', () => {
  const store = new EventStore(async () => []);
  const held = store.prefs;

  held.hiddenTypes.delete('season');
  store.reloadPrefs();

  expect(store.prefs).toBe(held);
  expect(held.hiddenTypes.has('season')).toBe(true);
});

test('reloading keeps what a full store refused to save, not what was never saved, until a save lands', () => {
  const store = new EventStore(async () => []);

  storage.refusesWrites = true;
  store.prefs.dismissed.add('a');
  store.commit('dismissed');
  store.prefs.dismissed.add('unsaved');
  store.reloadPrefs();

  expect(store.prefs.dismissed).toEqual(new Set(['a']));

  storage.refusesWrites = false;
  store.commit('dismissed');
  storage.setItem(KEYS.dismissed, JSON.stringify(['b']));
  store.reloadPrefs();

  expect(store.prefs.dismissed).toEqual(new Set(['b']));
});

test('blocked storage keeps the seen record through a reload, so the next load marks nothing new', async () => {
  const { store, source } = storeOver([feedEvent('a')]);

  storage.throws = true;
  await store.load();
  store.reloadPrefs();
  source.feed = [feedEvent('a'), feedEvent('b')];
  await store.load();

  expect(ids(store)).toEqual(['b']);
});

test('an import wins over a change storage refused to save', () => {
  const store = new EventStore(async () => []);

  storage.refusesWrites = true;
  store.prefs.dismissed.add('a');
  store.commit('dismissed');
  storage.refusesWrites = false;
  storage.setItem(KEYS.dismissed, JSON.stringify(['b']));
  store.restored();

  expect(store.prefs.dismissed).toEqual(new Set(['b']));
});

test('an import re-reads storage, settles a seen set the file left out, and tells every reader', async () => {
  const { store } = storeOver([feedEvent('a'), feedEvent('b')]);

  await store.load();

  const held = store.prefs;
  const listener = vi.fn();
  store.subscribe(listener);

  // What an import writes: a file from a browser that hid Events and had not yet stored a seen set.
  storage.setItem(KEYS.hiddenTypes, JSON.stringify(['event']));
  storage.removeItem(KEYS.seen);
  store.restored();

  expect(store.prefs).toBe(held);
  expect(held.hiddenTypes.has('event')).toBe(true);
  expect(store.restores).toBe(1);
  expect(stored()).toEqual({ through: null, ids: ['a', 'b'] });
  expect(listener).toHaveBeenCalled();
});

test('a load that finds only one file keeps the seen set the other file earned', async () => {
  const source = { feed: [feedEvent('a'), feedEvent('b')], local: [feedEvent('c')], feedFails: false };
  const fetchList = vi.fn(async (url: string) => {
    if (!url.endsWith('events-feed.json')) {
      return source.local;
    }

    if (source.feedFails) {
      throw new Error('502 Bad Gateway');
    }

    return source.feed;
  });
  const store = new EventStore(fetchList);

  await store.load();
  source.feedFails = true;
  await store.load();

  expect(store.events.map((ev) => ev.eventID)).toEqual(['c']);
  expect(stored()).toEqual({ through: null, ids: ['a', 'b', 'c'] });

  source.feedFails = false;
  await store.load();

  expect(ids(store)).toEqual([]);
});

test('a first visit that finds only one file seeds nothing, so the other is not marked new when it arrives', async () => {
  const source = { local: [feedEvent('c')], feedFails: true };
  const fetchList = vi.fn(async (url: string) => {
    if (!url.endsWith('events-feed.json')) {
      return source.local;
    }

    if (source.feedFails) {
      throw new Error('502 Bad Gateway');
    }

    return [feedEvent('a')];
  });
  const store = new EventStore(fetchList);

  await store.load();
  store.settle();

  expect(storage.getItem(KEYS.seen)).toBeNull();

  source.feedFails = false;
  await store.load();

  expect(ids(store)).toEqual([]);
  expect(stored()).toEqual({ through: null, ids: ['a', 'c'] });
});
