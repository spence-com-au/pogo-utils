/**
 * The storage search the Search page runs: that it refuses a term the phone cannot be sent before touching the phone,
 * engine or network, types a sendable one and answers the game's count, and installs the engine and loads the game
 * master once however many searches run. The engine, the game master and the storage walk are stood in for, so these
 * are claims about the wiring, not the reading.
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { DEFAULTS } from '../tools/inventory/config.mts';

const mocks = vi.hoisted(() => ({
  storage: vi.fn(),
  tesseractWasm: vi.fn(),
  unsearchable: vi.fn(),
  useEngine: vi.fn(),
}));

vi.mock('../core/ocr.mts', () => ({ useEngine: mocks.useEngine }));
vi.mock('../core/ocr-wasm.mts', () => ({ MODEL: 'model', tesseractWasm: mocks.tesseractWasm }));
vi.mock('../core/png.mts', () => ({
  decodePng: (bytes: Uint8Array) => bytes,
  decodeScreencap: (bytes: Uint8Array) => bytes,
}));
vi.mock('../tools/inventory/storage.mts', () => ({ storage: mocks.storage, unsearchable: mocks.unsearchable }));

const data = { species: 'game master' };
const screen = Uint8Array.of(1, 2, 3);

/** The network, answering the game master unless a test scripts its next answer. */
const fetch = vi.fn<typeof globalThis.fetch>();

/** The phone's transport, which answers a screenshot and nothing else. */
const transport = () => ({
  state: async () => 'device',
  shell: async () => new Uint8Array(),
  screencap: vi.fn(async () => screen),
});

beforeEach(() => {
  vi.stubGlobal('window', { isSecureContext: true });
  vi.stubGlobal('location', { href: 'https://spence.com.au/pogo-utils/' });
  vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
  vi.stubGlobal('fetch', fetch);
  fetch.mockImplementation(async () => Response.json(data));
  mocks.unsearchable.mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

/** A fresh page's copy of the module, which holds nothing yet. */
async function load() {
  vi.resetModules();

  return import('./search.js');
}

test('a search the phone cannot be sent is refused before the phone, engine or network is touched', async () => {
  const { searchStorage } = await load();
  const phone = transport();

  mocks.unsearchable.mockReturnValue('has characters the phone cannot be sent: ?');

  await expect(searchStorage(phone, 'what?', vi.fn(), vi.fn())).rejects.toThrow(
    /^this search has characters the phone cannot be sent: \?$/,
  );
  expect(phone.screencap).not.toHaveBeenCalled();
  expect(mocks.useEngine).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(mocks.storage).not.toHaveBeenCalled();
});

test('a search is typed into storage on the phone, and the count the game gave is what is answered', async () => {
  const { searchStorage } = await load();
  const { Device } = await import('../core/adb.mts');
  const lines = ['a screen read'];
  const search = vi.fn(async () => lines);
  const matches = vi.fn(() => 3);
  const say = vi.fn();

  mocks.storage.mockReturnValue({ search, matches });

  await expect(searchStorage(transport(), 'shiny', vi.fn(), say)).resolves.toBe(3);
  expect(mocks.storage).toHaveBeenCalledWith(expect.any(Device), DEFAULTS, data, screen, say);
  expect(search).toHaveBeenCalledWith('shiny');
  expect(matches).toHaveBeenCalledWith(lines);
});

test('the engine is installed and the game master fetched once however many searches run', async () => {
  const { searchStorage } = await load();

  mocks.storage.mockReturnValue({ search: vi.fn(), matches: vi.fn(() => null) });

  await searchStorage(transport(), 'pikachu', vi.fn(), vi.fn());
  await searchStorage(transport(), 'ditto', vi.fn(), vi.fn());

  expect(mocks.useEngine).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});
