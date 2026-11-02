/**
 * `loadChunk` reloads a tab whose build a deploy has taken away, which matters only if it reloads exactly once: never
 * would leave the reader the raw "Failed to fetch dynamically imported module", and every time would reload the page
 * under them on each try at a chunk the new build cannot load either.
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const gone = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'));

/** The tab's session storage, which outlives a reload as the module instance does not. */
let stored: Map<string, string>;
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stored = new Map();
  reload = vi.fn();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  vi.stubGlobal('location', { reload });
  vi.stubGlobal('navigator', { onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fresh document's copy of the module, which reads the tab's storage as it starts. */
async function load() {
  vi.resetModules();

  return (await import('./chunks.js')).loadChunk;
}

/** Whether `promise` has settled once everything already queued has run, which a never-settled one has not. */
async function settled(promise: Promise<unknown>) {
  let done = false;

  promise.then(
    () => (done = true),
    () => (done = true),
  );
  await new Promise((resolve) => setTimeout(resolve));

  return done;
}

test('a chunk that arrives is handed over untouched', async () => {
  const loadChunk = await load();

  await expect(loadChunk(async () => ({ default: 'page' }))).resolves.toEqual({ default: 'page' });
  expect(reload).not.toHaveBeenCalled();
});

test('a chunk a deploy took away reloads the page, and the reloaded page reports it failing again', async () => {
  // The first failure reloads, and is never reported: the page is going.
  expect(await settled((await load())(gone))).toBe(false);
  expect(reload).toHaveBeenCalledTimes(1);

  // The reloaded page fetching its own page chunk is no reason to forget it is the reload. The bug this pins: clearing
  // the mark on any chunk that arrives let every later click reload the page again rather than say why it did nothing.
  const reloaded = await load();

  await reloaded(async () => 'page');
  await expect(reloaded(gone)).rejects.toThrow('Failed to fetch dynamically imported module');
  await expect(reloaded(gone)).rejects.toThrow();
  expect(reload).toHaveBeenCalledTimes(1);
});

test('a document after the reloaded one may reload for the next deploy', async () => {
  await settled((await load())(gone));
  await load();
  await settled((await load())(gone));

  expect(reload).toHaveBeenCalledTimes(2);
});

test('offline, the failure is reported rather than reloaded for', async () => {
  vi.stubGlobal('navigator', { onLine: false });

  await expect((await load())(gone)).rejects.toThrow();
  expect(reload).not.toHaveBeenCalled();
});

test('with storage blocked, the failure is reported rather than risk reloading on every try', async () => {
  vi.stubGlobal('sessionStorage', {
    getItem: () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
    setItem: () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });

  await expect((await load())(gone)).rejects.toThrow();
  expect(reload).not.toHaveBeenCalled();
});
