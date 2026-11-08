import { afterEach, expect, test, vi } from 'vitest';

import { fetchOk } from './fetch-ok.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('a response that is ok is answered as it came', async () => {
  const response = Response.json([]);

  vi.stubGlobal('fetch', async () => response);
  await expect(fetchOk('data/gpx-paths.json')).resolves.toBe(response);
});

/** The options go through to `fetch` as given, which is how the feeds ask for the browser's cache. */
test('what the caller asks of the request reaches it', async () => {
  const fetch = vi.fn(async () => Response.json([]));

  vi.stubGlobal('fetch', fetch);
  await fetchOk('data/events-feed.json', { cache: 'default' });
  expect(fetch).toHaveBeenCalledWith('data/events-feed.json', { cache: 'default' });
});

/** HTTP/1.1 says why as well as what, and the reason reads better than the number alone. */
test('a status the server refused on names itself', async () => {
  vi.stubGlobal('fetch', async () => new Response(null, { status: 503, statusText: 'Service Unavailable' }));
  await expect(fetchOk('data/gpx-paths.json')).rejects.toThrow(/^503 Service Unavailable$/);
});

/**
 * HTTP/2 has no reason phrase, which is how GitHub Pages answers a browser — so this is the 404 a reader actually sees,
 * and a trailing space would put a gap before the full stop of the map's banner.
 */
test('a status without a reason phrase is the bare number', async () => {
  vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }));
  await expect(fetchOk('data/gpx-paths.json')).rejects.toThrow(/^404$/);
});
