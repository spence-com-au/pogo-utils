/**
 * The inventory store's own wiring: that a read reaches the phone for the export at its path, hands the bytes to the
 * converter and the fetched game master, and lands the rows — that a failed read keeps the underlying reason — and
 * that each phone the phone store comes to hold is read, but not the one a battle hands back, and that the latest read
 * is kept in IndexedDB for the next visit. The converter and the game master are stood in for, since
 * `snapshot.test.mts` holds the conversion itself.
 */

import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { Phone } from './core/browser/webusb.js';
import { PhoneStore } from './phone-store.js';

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
const EXPORT = '/storage/emulated/0/Download/PGSharp/PGSStats.json';

/** A phone whose shell answers each `cat` through `shell`, recording what it was asked to read. */
function phone(shell: (args: readonly string[]) => Promise<Uint8Array>, serial = 'A') {
  const asked: string[][] = [];
  const transport = {
    state: async () => 'device' as const,

    // MediaStore and `stat` find the export where PGSharp writes it by default; what is asked of the export itself is
    // recorded.
    shell: (args: readonly string[]) =>
      args[0] === 'content'
        ? Promise.resolve(bytes(`Row: 0 _data=${EXPORT}\n`))
        : args[0] === 'stat'
          ? Promise.resolve(bytes(`1795785573 ${EXPORT}\n`))
          : (asked.push([...args]), shell(args)),
    screencap: async () => new Uint8Array(),
  };

  const device = {
    name: serial,
    serial,
    transport,
    close: () => Promise.resolve(),
    disconnected: new Promise<void>(() => {}),
  } as unknown as Phone;

  return { asked, phone: device };
}

/** A shell whose one read waits for `release`, for a test to land it when it says. */
function held() {
  let release: (bytes: Uint8Array) => void = () => {};
  const shell = () => new Promise<Uint8Array>((resolve) => (release = resolve));

  return { shell, release: (text: string) => release(bytes(text)) };
}

const bytes = (text: string) => new TextEncoder().encode(text);

/** Until the read under way lands, which a hold starts without handing back to wait on. */
const landed = (store: InstanceType<typeof InventoryStore>) =>
  vi.waitFor(() => expect(store.status.state).not.toBe('reading'));

/** Until `asked` has reached the phone, past the reader module's import, so its read can be released. */
const reached = (asked: readonly unknown[]) => vi.waitFor(() => expect(asked).toHaveLength(1));

let phones: PhoneStore;

/** Until a store started from nothing, as the next visit's is, restores the rows `rows`. */
const kept = (rows: unknown) =>
  vi.waitFor(async () => {
    const next = new InventoryStore(new PhoneStore());

    await next.restore();
    expect(next.rows).toStrictEqual(rows);

    return next;
  });

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  phones = new PhoneStore();
  mocks.parseSnapshot.mockReturnValue({});
  mocks.gameData.mockResolvedValue({});
  mocks.rowsOf.mockReturnValue([{ dex: 25 }]);
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

test('a read reaches the phone for the export, converts it, and lands the rows', async () => {
  const rows = [{ dex: 25 }, { dex: 1 }];
  const snapshot = { box: [] };

  mocks.parseSnapshot.mockReturnValue(snapshot);
  mocks.gameData.mockResolvedValue({ forms: [] });
  mocks.rowsOf.mockReturnValue(rows);

  const store = new InventoryStore(phones);
  const { asked, phone: device } = phone(async () => bytes('the export'));

  await store.read(device);

  expect(asked).toStrictEqual([['cat', `'${EXPORT}'`]]);
  expect(mocks.parseSnapshot).toHaveBeenCalledWith('the export');
  expect(mocks.rowsOf).toHaveBeenCalledWith(snapshot, { forms: [] });
  expect(store.rows).toStrictEqual(rows);
  expect(store.status).toStrictEqual({ state: 'idle' });
});

test('a read of a held phone that cannot reach the export keeps the reason and offers the export hint', async () => {
  const store = new InventoryStore(phones);
  const { phone: device } = phone(async () => {
    throw new Error('cat: No such file or directory');
  });

  await phones.hold(device);
  await landed(store);

  expect(store.status).toStrictEqual({
    state: 'failed',
    reason:
      'could not read the export off the phone: cat: No such file or directory — ' +
      "switch PGSharp's inventory export on if it is off",
  });
  expect(mocks.parseSnapshot).not.toHaveBeenCalled();
});

test('a corrupt export or a failed game master fails without the export-off hint', async () => {
  mocks.parseSnapshot.mockImplementation(() => {
    throw new Error('Unexpected token');
  });

  const store = new InventoryStore(phones);
  const { phone: device } = phone(async () => bytes('not json'));

  await phones.hold(device);
  await landed(store);

  expect(store.status).toStrictEqual({ state: 'failed', reason: 'could not read the inventory: Unexpected token' });
});

test('a failed read keeps the rows the last one landed', async () => {
  const store = new InventoryStore(phones);
  await store.open(new Blob(['the export']));

  const { phone: device } = phone(async () => {
    throw new Error('closed');
  });

  await phones.hold(device);
  await landed(store);

  expect(store.status.state).toBe('failed');
  expect(store.rows).toStrictEqual([{ dex: 25 }]);
});

test('a read already under way is left to finish rather than started again', async () => {
  const store = new InventoryStore(phones);
  const wait = held();
  const { asked, phone: device } = phone(wait.shell);

  const first = store.read(device);
  expect(store.status.state).toBe('reading');

  await store.read(device);
  await reached(asked);
  wait.release('the export');
  await first;

  expect(asked).toHaveLength(1);
  expect(store.rows).toStrictEqual([{ dex: 25 }]);
});

test('clear forgets what was read', async () => {
  const store = new InventoryStore(phones);
  await store.read(phone(async () => bytes('the export')).phone);
  expect(store.rows).not.toBeNull();

  store.clear();
  expect(store.rows).toBeNull();
  expect(store.status).toStrictEqual({ state: 'idle' });
});

test('a read a clear overtook does not land over the cleared inventory', async () => {
  const store = new InventoryStore(phones);
  const wait = held();

  const { asked, phone: device } = phone(wait.shell);

  const reading = store.read(device);
  await reached(asked);
  store.clear();
  wait.release('the export');
  await reading;

  expect(store.rows).toBeNull();
  expect(store.status).toStrictEqual({ state: 'idle' });
});

test("a newer read lands and an older one it overtook is dropped, the phone's or a file's", async () => {
  mocks.rowsOf.mockReturnValueOnce([{ dex: 1 }]).mockReturnValue([{ dex: 25 }]);

  const store = new InventoryStore(phones);
  const wait = held();

  const { asked, phone: device } = phone(wait.shell);

  const reading = store.read(device);
  await reached(asked);
  await store.open(new Blob(['the export']));
  wait.release('the export');
  await reading;

  expect(store.rows).toStrictEqual([{ dex: 1 }]);
});

test('an opened export converts the same way as a read off a phone', async () => {
  const rows = [{ dex: 25 }];
  const snapshot = { box: [] };

  mocks.parseSnapshot.mockReturnValue(snapshot);
  mocks.gameData.mockResolvedValue({ forms: [] });
  mocks.rowsOf.mockReturnValue(rows);

  const store = new InventoryStore(phones);
  await store.open(new Blob(['the export']));

  expect(mocks.parseSnapshot).toHaveBeenCalledWith('the export');
  expect(mocks.rowsOf).toHaveBeenCalledWith(snapshot, { forms: [] });
  expect(store.rows).toStrictEqual(rows);
});

test('an opened file that is not an export fails without the export-off hint', async () => {
  mocks.parseSnapshot.mockImplementation(() => {
    throw new Error('Unexpected token');
  });

  const store = new InventoryStore(phones);
  await store.open(new Blob(['not json']));

  expect(store.status).toStrictEqual({ state: 'failed', reason: 'could not read the inventory: Unexpected token' });
});

test('each phone held is read, without being asked', async () => {
  const store = new InventoryStore(phones);
  const a = phone(async () => bytes('the export'), 'A');
  const b = phone(async () => bytes('the export'), 'B');

  await phones.hold(a.phone);
  await landed(store);
  await phones.hold(b.phone);
  await landed(store);

  expect(a.asked).toStrictEqual([['cat', `'${EXPORT}'`]]);
  expect(b.asked).toStrictEqual([['cat', `'${EXPORT}'`]]);
  expect(store.rows).toStrictEqual([{ dex: 25 }]);
});

test('the phone a battle hands back, the serial last read, is not read again', async () => {
  const store = new InventoryStore(phones);
  const lent = phone(async () => bytes('the export'), 'A');
  const back = phone(async () => bytes('the export'), 'A');

  await phones.hold(lent.phone);
  await landed(store);
  phones.release();
  await phones.hold(back.phone);
  await landed(store);

  expect(lent.asked).toHaveLength(1);
  expect(back.asked).toHaveLength(0);
});

test('a phone connected again through the phone button is read again, and a new one only once', async () => {
  const store = new InventoryStore(phones);
  const first = phone(async () => bytes('the export'), 'A');
  const again = phone(async () => bytes('the export'), 'A');

  // What `connectPhone` does: hold, then read.
  await phones.hold(first.phone);
  await store.read(first.phone);
  await landed(store);
  phones.release();
  await phones.hold(again.phone);
  await store.read(again.phone);
  await landed(store);

  expect(first.asked).toHaveLength(1);
  expect(again.asked).toHaveLength(1);
});

test('a read cut off by the phone being lent says nothing, and the phone handed back is read', async () => {
  const store = new InventoryStore(phones);
  const lent = phone(() => Promise.reject(new Error('the transport closed')), 'A');
  const back = phone(async () => bytes('the export'), 'A');

  // Taken out of the store before the read fails, as `lend` takes it before closing it.
  await store.read(lent.phone);

  expect(store.status).toStrictEqual({ state: 'idle' });
  expect(store.rows).toBeNull();

  await phones.hold(back.phone);
  await landed(store);

  expect(back.asked).toHaveLength(1);
  expect(store.rows).toStrictEqual([{ dex: 25 }]);
});

test('the rows stay once the phone they were read off is let go', async () => {
  const store = new InventoryStore(phones);

  await phones.hold(phone(async () => bytes('the export')).phone);
  await landed(store);
  phones.release();

  expect(store.rows).toStrictEqual([{ dex: 25 }]);
});

test('the latest read is kept, and the next visit parses it again with when it was read', async () => {
  const store = new InventoryStore(phones);
  await store.read(phone(async () => bytes('the export')).phone);

  mocks.parseSnapshot.mockClear();
  const next = await kept([{ dex: 25 }]);

  expect(mocks.parseSnapshot).toHaveBeenCalledWith('the export');
  expect(next.readAt).toBe(store.readAt);
});

test('an opened export is kept the same way', async () => {
  const store = new InventoryStore(phones);
  await store.open(new Blob(['the opened export']));

  mocks.parseSnapshot.mockClear();
  await kept([{ dex: 25 }]);

  expect(mocks.parseSnapshot).toHaveBeenCalledWith('the opened export');
});

test('a clear straight after a read forgets the kept copy too', async () => {
  const store = new InventoryStore(phones);
  await store.read(phone(async () => bytes('the export')).phone);
  await store.clear();

  const next = new InventoryStore(new PhoneStore());
  await next.restore();

  expect(next.rows).toBeNull();
  expect(next.readAt).toBeNull();
});

test('a read that starts while the kept copy is parsed is not overwritten by it', async () => {
  const store = new InventoryStore(phones);
  await store.open(new Blob(['the old export']));
  await kept([{ dex: 25 }]);

  mocks.rowsOf.mockReturnValue([{ dex: 1 }]);

  const next = new InventoryStore(new PhoneStore());
  const restoring = next.restore();
  await next.read(phone(async () => bytes('the new export')).phone);
  await restoring;

  expect(next.rows).toStrictEqual([{ dex: 1 }]);
});

test('a kept export that no longer parses says why', async () => {
  const store = new InventoryStore(phones);
  await store.open(new Blob(['the export']));
  await kept([{ dex: 25 }]);

  mocks.parseSnapshot.mockImplementation(() => {
    throw new Error('Unexpected token');
  });

  const next = new InventoryStore(new PhoneStore());
  await next.restore();

  expect(next.rows).toBeNull();
  expect(next.status).toStrictEqual({ state: 'failed', reason: 'could not read the inventory: Unexpected token' });
});

test('a browser that refuses storage keeps nothing, and tells only the console', async () => {
  vi.stubGlobal('indexedDB', undefined);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

  const store = new InventoryStore(phones);
  await store.restore();
  await store.read(phone(async () => bytes('the export')).phone);

  expect(store.rows).toStrictEqual([{ dex: 25 }]);
  expect(store.status).toStrictEqual({ state: 'idle' });
  await vi.waitFor(() => expect(errors).toHaveBeenCalledOnce());
});

test('a kept export that no longer parses can still be forgotten', async () => {
  const store = new InventoryStore(phones);
  await store.open(new Blob(['the export']));
  await kept([{ dex: 25 }]);

  mocks.parseSnapshot.mockImplementation(() => {
    throw new Error('Unexpected token');
  });

  const next = new InventoryStore(new PhoneStore());
  await next.restore();
  expect(next.status.state).toBe('failed');

  await next.clear();
  expect(next.status).toStrictEqual({ state: 'idle' });

  mocks.parseSnapshot.mockClear();
  const after = new InventoryStore(new PhoneStore());
  await after.restore();

  expect(after.status).toStrictEqual({ state: 'idle' });
  expect(mocks.parseSnapshot).not.toHaveBeenCalled();
});

test('a visit with nothing kept leaves no database behind', async () => {
  await new InventoryStore(phones).restore();

  expect(await indexedDB.databases()).toEqual([]);
});
