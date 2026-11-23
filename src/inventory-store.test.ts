/**
 * The inventory store's own wiring: that a read reaches the phone for the export at its path, hands the bytes to the
 * converter and the fetched game master, and lands the rows — and that a failed read keeps the underlying reason. The
 * converter and the game master are stood in for, since `snapshot.test.mts` holds the conversion itself.
 */

import { afterEach, expect, test, vi } from 'vitest';

import type { Phone } from './core/browser/webusb.js';

const mocks = vi.hoisted(() => ({
  gameData: vi.fn(),
  parseSnapshot: vi.fn(),
  rowsOf: vi.fn(),
}));

vi.mock('./core/browser/fetch.js', () => ({ gameData: mocks.gameData }));
vi.mock('./tools/inventory/snapshot.mts', async (actual) => ({
  ...(await actual<typeof import('./tools/inventory/snapshot.mts')>()),
  parseSnapshot: mocks.parseSnapshot,
  rowsOf: mocks.rowsOf,
}));

const { InventoryStore } = await import('./inventory-store.js');
const { PGSTATS } = await import('./tools/inventory/snapshot.mts');

/** A phone whose shell answers one `cat` with `bytes`, recording what it was asked to read. */
function phone(shell: (args: readonly string[]) => Promise<Uint8Array>) {
  const asked: string[][] = [];
  const transport = {
    state: async () => 'device' as const,
    shell: (args: readonly string[]) => (asked.push([...args]), shell(args)),
    screencap: async () => new Uint8Array(),
  };

  return { asked, phone: { transport } as unknown as Phone };
}

const bytes = (text: string) => new TextEncoder().encode(text);

afterEach(() => vi.resetAllMocks());

test('a read reaches the phone for the export, converts it, and lands the rows', async () => {
  const rows = [{ dex: 25 }, { dex: 1 }];
  const snapshot = { box: [] };

  mocks.parseSnapshot.mockReturnValue(snapshot);
  mocks.gameData.mockResolvedValue({ forms: [] });
  mocks.rowsOf.mockReturnValue(rows);

  const store = new InventoryStore();
  const { asked, phone: device } = phone(async () => bytes('the export'));

  await store.read(device);

  expect(asked).toStrictEqual([['cat', PGSTATS]]);
  expect(mocks.parseSnapshot).toHaveBeenCalledWith('the export');
  expect(mocks.rowsOf).toHaveBeenCalledWith(snapshot, { forms: [] });
  expect(store.inventory).toStrictEqual({ state: 'read', rows });
});

test('a read that cannot reach the export keeps the reason and offers the export hint', async () => {
  const store = new InventoryStore();
  const { phone: device } = phone(async () => {
    throw new Error('cat: No such file or directory');
  });

  await store.read(device);

  expect(store.inventory).toStrictEqual({
    state: 'failed',
    reason:
      'could not read the export off the phone: cat: No such file or directory — ' +
      "switch PGSharp's inventory export on if it is off",
  });
  expect(mocks.parseSnapshot).not.toHaveBeenCalled();
});

test('a read already under way is left to finish rather than started again', async () => {
  mocks.parseSnapshot.mockReturnValue({});
  mocks.gameData.mockResolvedValue({});
  mocks.rowsOf.mockReturnValue([]);

  const store = new InventoryStore();
  let release: (bytes: Uint8Array) => void = () => {};
  const { asked, phone: device } = phone(() => new Promise((resolve) => (release = resolve)));

  const first = store.read(device);
  expect(store.inventory.state).toBe('reading');

  await store.read(device);
  release(bytes('the export'));
  await first;

  expect(asked).toHaveLength(1);
  expect(store.inventory.state).toBe('read');
});

test('clear forgets what was read', async () => {
  mocks.parseSnapshot.mockReturnValue({});
  mocks.gameData.mockResolvedValue({});
  mocks.rowsOf.mockReturnValue([{ dex: 25 }]);

  const store = new InventoryStore();
  await store.read(phone(async () => bytes('the export')).phone);
  expect(store.inventory.state).toBe('read');

  store.clear();
  expect(store.inventory).toStrictEqual({ state: 'empty' });
});
