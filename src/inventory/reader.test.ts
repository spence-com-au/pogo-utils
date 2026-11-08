/**
 * What the reader keeps for the page, and when it lets go of it. The game master, the engine and the icons are each
 * fetched once and held, but a fetch that failed must not be: a rejected promise kept would answer every later read
 * with the network as it was the first time, and leave the page broken until it was reloaded. The engine, the game
 * master and the readers over them are stood in for, so these are claims about the caching and not the reading.
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readScreen: vi.fn(),
  signaturesFor: vi.fn(),
  tesseractWasm: vi.fn(),
  useEngine: vi.fn(),
  wardrobeFor: vi.fn(),
}));

vi.mock('../tools/inventory/artwork.mts', () => ({
  signatureOfIcon: (image: unknown) => image,
  signaturesFor: mocks.signaturesFor,
}));
vi.mock('../tools/inventory/costume.mts', () => ({ wardrobeFor: mocks.wardrobeFor }));
vi.mock('../tools/inventory/ocr.mts', () => ({ useEngine: mocks.useEngine }));
vi.mock('../tools/inventory/ocr-wasm.mts', () => ({ MODEL: 'model', tesseractWasm: mocks.tesseractWasm }));
vi.mock('../tools/inventory/png.mts', () => ({ decodePng: (bytes: Uint8Array) => bytes }));
vi.mock('../tools/inventory/report.mts', () => ({ readScreen: mocks.readScreen }));

const data = { species: 'game master' };
const image = { width: 1, height: 1, data: new Uint8Array(4) } as never;

/** The network, answering the game master unless a test scripts its next answer. */
const fetch = vi.fn<typeof globalThis.fetch>();

beforeEach(() => {
  vi.stubGlobal('window', { isSecureContext: true });
  vi.stubGlobal('location', { href: 'https://spence.com.au/pogo-utils/' });
  vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
  vi.stubGlobal('fetch', fetch);
  fetch.mockImplementation(async () => Response.json(data));
  mocks.readScreen.mockImplementation((_image, game, icons) => ({ game, icons }));
  mocks.signaturesFor.mockResolvedValue(new Map());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

/** A fresh page's copy of the module, which holds nothing yet. */
async function load() {
  vi.resetModules();

  return import('./reader.js');
}

test('a page that is not a secure context cannot read, and says why', async () => {
  const { unreadable } = await load();

  expect(unreadable()).toBeNull();

  vi.stubGlobal('window', { isSecureContext: false });
  expect(unreadable()).toMatch(/secure context/);
});

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

test('the engine is installed and the icons read once, for every screen after the first', async () => {
  const { read } = await load();

  await Promise.all([read(image, vi.fn()), read(image, vi.fn())]);
  await read(image, vi.fn());

  expect(mocks.useEngine).toHaveBeenCalledTimes(1);
  expect(mocks.signaturesFor).toHaveBeenCalledTimes(1);
  expect(mocks.readScreen).toHaveBeenCalledTimes(3);
  expect(mocks.readScreen).toHaveBeenLastCalledWith(image, data, new Map(), undefined, expect.any(Function));
});

test('a read whose game master failed to arrive tries it again on the next, installing the engine again too', async () => {
  const { read } = await load();

  fetch.mockRejectedValueOnce(new Error('offline'));

  await expect(read(image, vi.fn())).rejects.toThrow('offline');
  await expect(read(image, vi.fn())).resolves.toBeDefined();
  expect(mocks.useEngine).toHaveBeenCalledTimes(2);
});

test('a read whose icons failed keeps the engine and the game master, and reads the icons again', async () => {
  const { read } = await load();

  mocks.signaturesFor.mockRejectedValueOnce(new Error('icons'));

  await expect(read(image, vi.fn())).rejects.toThrow('icons');
  await expect(read(image, vi.fn())).resolves.toBeDefined();
  expect(mocks.signaturesFor).toHaveBeenCalledTimes(2);
  expect(mocks.useEngine).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('a wardrobe that failed or fell short is drawn again by the next read, and a whole one is kept', async () => {
  const { read } = await load();
  const whole = { costumes: 'drawn' };

  const wardrobe = async () => {
    await read(image, vi.fn());

    const [, , , , draw] = mocks.readScreen.mock.lastCall as [
      unknown,
      unknown,
      unknown,
      unknown,
      () => Promise<unknown>,
    ];

    return draw();
  };

  mocks.wardrobeFor.mockRejectedValueOnce(new Error('icons')).mockResolvedValueOnce(null).mockResolvedValue(whole);

  await expect(wardrobe()).rejects.toThrow('icons');
  await expect(wardrobe()).resolves.toBeNull();
  await expect(wardrobe()).resolves.toBe(whole);
  await expect(wardrobe()).resolves.toBe(whole);
  expect(mocks.wardrobeFor).toHaveBeenCalledTimes(3);
});
