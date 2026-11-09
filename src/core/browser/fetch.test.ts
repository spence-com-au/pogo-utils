/**
 * What a failed fetch says, and when the game master is let go of. It is fetched once and held, but a fetch that failed
 * must not be: a rejected promise kept would answer every later call with the network as it was the first time, and
 * leave the page broken until it was reloaded.
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const data = { species: 'game master' };

/** The network, answering the game master unless a test scripts its next answer. */
const fetch = vi.fn<typeof globalThis.fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetch);
  fetch.mockImplementation(async () => Response.json(data));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

/** A fresh page's copy of the module, which holds nothing yet. */
async function load() {
  vi.resetModules();

  return import('./fetch.js');
}

test('a response that is not ok fails, naming the URL and the status', async () => {
  const { fetchOk } = await load();

  fetch.mockResolvedValueOnce(new Response('', { status: 404, statusText: 'Not Found' }));

  await expect(fetchOk('https://example.test/icon.png')).rejects.toThrow(
    /^https:\/\/example\.test\/icon\.png: 404 Not Found$/,
  );
});

/** HTTP/2 sends no reason phrase, and the status then ends the message rather than a space after it. */
test('a status without a reason phrase is named as the bare number', async () => {
  const { fetchOk } = await load();

  fetch.mockResolvedValueOnce(new Response('', { status: 404 }));

  await expect(fetchOk('https://example.test/icon.png')).rejects.toThrow(/^https:\/\/example\.test\/icon\.png: 404$/);
});

test('the bytes of a response are read whole', async () => {
  const { fetchBytes } = await load();

  fetch.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));

  expect(await fetchBytes('https://example.test/icon.png')).toEqual(new Uint8Array([1, 2, 3]));
});

test('the game master is fetched once, however many ask', async () => {
  const { gameData } = await load();

  expect(await Promise.all([gameData(), gameData()])).toEqual([data, data]);
  expect(await gameData()).toEqual(data);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('a game master that failed to arrive is fetched again by the next call', async () => {
  const { gameData } = await load();

  fetch.mockRejectedValueOnce(new Error('offline'));

  await expect(gameData()).rejects.toThrow('offline');
  await expect(gameData()).resolves.toEqual(data);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('a game master the server refused is fetched again by the next call', async () => {
  const { gameData } = await load();

  fetch.mockResolvedValueOnce(new Response('', { status: 503, statusText: 'Service Unavailable' }));

  await expect(gameData()).rejects.toThrow(/503 Service Unavailable/);
  await expect(gameData()).resolves.toEqual(data);
});
