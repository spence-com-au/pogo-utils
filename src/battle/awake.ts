/**
 * The phone kept awake for a battle, as `pnpm battle` keeps it: a screen gone dark mid-battle reads as nothing
 * recognised and ends the run. So `stay_on_while_plugged_in` is read, set, and put back as found on every way out the
 * battle's Worker sees. The one it cannot see is its tab being closed, which ends the Worker with it, mid-run and with
 * the phone still set. So the value found is kept per phone in IndexedDB, before the setting is changed and until it
 * has been put back, and a phone connected again with one still kept is put back then.
 *
 * IndexedDB rather than `localStorage`, which a Worker has none of; the page reads the same database.
 */

import { said } from '../errors.js';
import { type Transport } from '../tools/inventory/adb.mts';

const SETTING = ['global', 'stay_on_while_plugged_in'] as const;
const DATABASE = 'pogo-utils-battle';
const STORE = 'stay-on-while-plugged-in';

type Shell = Pick<Transport, 'shell'>;

/** What `act` asks of the store, once the transaction it was asked in has committed. */
async function inStore<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const opening = indexedDB.open(DATABASE, 1);
  opening.onupgradeneeded = () => opening.result.createObjectStore(STORE);

  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error(`${DATABASE} could not be opened`));
  });

  try {
    const transaction = database.transaction(STORE, mode);
    const request = act(transaction.objectStore(STORE));

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error(`${STORE} not written`));
    });

    return request.result;
  } finally {
    database.close();
  }
}

/**
 * The value kept for `serial`, or `undefined` where none is, or none can be read: storage this browser refuses, as in
 * a private window, is storage nothing was ever kept in either.
 */
async function kept(serial: string): Promise<string | undefined> {
  try {
    const value: unknown = await inStore('readonly', (store) => store.get(serial));

    // Checked to be the number Android stores, as it goes back through the shell.
    return typeof value === 'string' && /^\d+$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

const forget = (serial: string) => inStore('readwrite', (store) => store.delete(serial));

const put = (transport: Shell, value: string) => transport.shell(['settings', 'put', ...SETTING, value]);

/**
 * Keeps the phone `serial` names awake through `transport`, answering how to put it back as it was found, which says
 * through `say` rather than throwing where it cannot, the run's own end being the news. A value still kept from a run
 * whose tab was closed is the one put back, the setting read now being what that run left.
 */
export async function keepAwake(
  serial: string,
  transport: Shell,
  say: (line: string) => void,
): Promise<() => Promise<void>> {
  let before = await kept(serial);

  if (before === undefined) {
    const read = new TextDecoder().decode(await transport.shell(['settings', 'get', ...SETTING])).trim();
    before = /^\d+$/.test(read) ? read : '0';

    try {
      await inStore('readwrite', (store) => store.put(before, serial));
    } catch (error) {
      say(`stay_on_while_plugged_in not kept, so closing this tab mid-run leaves the phone awake: ${said(error)}`);
    }
  }

  const found = before;

  const restore = async () => {
    try {
      await put(transport, found);
    } catch (error) {
      say(`stay_on_while_plugged_in not put back to ${found} until the phone is next connected: ${said(error)}`);
      return;
    }

    // One left kept is put back again at the next connect, which does no harm.
    await forget(serial).catch(() => undefined);
  };

  try {
    await transport.shell(['svc', 'power', 'stayon', 'usb']);
  } catch (error) {
    await restore();
    throw error;
  }

  return restore;
}

/**
 * Puts back the setting a run left on `phone` where its tab was closed mid-run, now that it is connected again, and
 * forgets it once it has been. Throws where it cannot be put back, leaving it kept for the connect after.
 */
export async function putBack(phone: { serial: string; transport: Shell }): Promise<void> {
  const before = await kept(phone.serial);

  if (before !== undefined) {
    await put(phone.transport, before);
    await forget(phone.serial);
  }
}
