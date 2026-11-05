import { beforeEach, expect, test, vi } from 'vitest';

import { fetchVendedRelease, ReleaseStore } from './release-store.js';
import { installFakeStorage, type FakeStorage } from './testing/storage.js';

import type { Release, VendedRelease } from './release.js';

const ACKNOWLEDGED_KEY = 'pogo-utils:test:acknowledged';

let storage: FakeStorage;

beforeEach(() => {
  storage = installFakeStorage();
});

const release = (version: string): VendedRelease => ({
  version,
  url: `https://dl.pgsharp.com/pgs${version}_0.431.0_XsfbL(arm64).apk`,
  firstSeen: '2026-10-12T16:00:59.536Z',
});

/** A store over a fresh document: the file as it stands at the time, read once, the way a page load reads it. */
async function visit(current: VendedRelease | null) {
  const store = new ReleaseStore(ACKNOWLEDGED_KEY, async () => current);

  await store.ensureLoaded();

  return store;
}

test('a first visit shows no notice, the version found becoming the baseline', async () => {
  const store = await visit(release('1.272.2'));

  expect(store.unacknowledged()).toBeNull();
  expect(store.release?.version).toBe('1.272.2');
  expect(JSON.parse(storage.getItem(ACKNOWLEDGED_KEY) ?? 'null')).toBe('1.272.2');
});

test('a version newer than the baseline is a notice on the next load', async () => {
  await visit(release('1.272.2'));

  expect((await visit(release('1.273.0'))).unacknowledged()).toEqual(release('1.273.0'));
});

test('once cleared it stays cleared, until the next version', async () => {
  await visit(release('1.272.2'));

  const store = await visit(release('1.273.0'));
  const listener = vi.fn();

  store.subscribe(listener);
  store.acknowledge();

  expect(store.unacknowledged()).toBeNull();
  expect(listener).toHaveBeenCalledOnce();
  expect((await visit(release('1.273.0'))).unacknowledged()).toBeNull();
  expect((await visit(release('1.274.0'))).unacknowledged()?.version).toBe('1.274.0');
});

test('a release that will not load neither notifies nor settles the baseline', async () => {
  const store = await visit(null);

  expect(store.unacknowledged()).toBeNull();
  expect(storage.getItem(ACKNOWLEDGED_KEY)).toBeNull();

  // So the first release that does load is still a first visit's, and not news.
  expect((await visit(release('1.272.2'))).unacknowledged()).toBeNull();
});

test('the file is read once, however many readers ask', async () => {
  const fetchRelease = vi.fn(async () => release('1.272.2'));
  const store = new ReleaseStore(ACKNOWLEDGED_KEY, fetchRelease);

  await Promise.all([store.ensureLoaded(), store.ensureLoaded()]);
  await store.ensureLoaded();

  expect(fetchRelease).toHaveBeenCalledOnce();
});

test('storage that will not answer reports nothing rather than failing', async () => {
  storage.throws = true;

  const store = await visit(release('1.272.2'));

  expect(store.unacknowledged()).toBeNull();
  expect(() => store.acknowledge()).not.toThrow();
});

test('storage that takes no writes reports nothing, since the reader could never clear it', async () => {
  storage.refusesWrites = true;

  expect((await visit(release('1.272.2'))).unacknowledged()).toBeNull();
  expect((await visit(release('1.273.0'))).unacknowledged()).toBeNull();
});

test('each store keeps its own acknowledgement, so clearing one app leaves the other', async () => {
  const other = 'pogo-utils:other:acknowledged';

  const visitBoth = async (version: string) => {
    const one = new ReleaseStore(ACKNOWLEDGED_KEY, async () => release(version));
    const two = new ReleaseStore(other, async () => release(version));

    await Promise.all([one.ensureLoaded(), two.ensureLoaded()]);

    return [one, two] as const;
  };

  await visitBoth('1.272.2');

  const [one, two] = await visitBoth('1.273.0');

  one.acknowledge();

  expect(one.unacknowledged()).toBeNull();
  expect(two.unacknowledged()?.version).toBe('1.273.0');
});

/** `fetchVendedRelease` over a response of `status` holding `body`, `check` taking any URL unless given another. */
async function fetchFile(
  body: object,
  {
    status = 200,
    check = (url: string) => ({ version: '1.273.0', url }),
  }: { status?: number; check?: (url: string) => Release } = {},
) {
  vi.stubGlobal('fetch', async () => Response.json(body, { status }));
  vi.spyOn(console, 'error').mockImplementation(() => {});

  try {
    return await fetchVendedRelease('data/test-release.json', check);
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
}

test('the vended file carries the day the release was first seen, which the notification shows', async () => {
  const { url, firstSeen } = release('1.273.0');

  expect(await fetchFile({ url, firstSeen })).toEqual(release('1.273.0'));
});

test('a file without a date it can read is refused, rather than failing later when the date is drawn', async () => {
  const { url } = release('1.273.0');

  expect(await fetchFile({ url })).toBeNull();
  expect(await fetchFile({ url, firstSeen: 'yesterday' })).toBeNull();
});

test('a file that cannot be fetched or has no url is refused', async () => {
  const { url, firstSeen } = release('1.273.0');

  expect(await fetchFile({ url, firstSeen }, { status: 404 })).toBeNull();
  expect(await fetchFile({ firstSeen })).toBeNull();
});

test('a url the checker refuses is never an install link, the file being refused with it', async () => {
  const { firstSeen } = release('1.273.0');

  const check = (url: string): Release => {
    throw new Error(`${url} is not where the app is served`);
  };

  expect(await fetchFile({ url: 'https://evil.example/pgs.apk', firstSeen }, { check })).toBeNull();
});
