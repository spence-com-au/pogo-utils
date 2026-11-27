/**
 * The owned Pokémon this document holds, read from PGSharp's export rather than fetched: the whole account, decoded,
 * which the Pokédex marks against. Read off each phone the `phoneStore` comes to hold, or from a copy of the export the
 * reader opens. The export itself is kept in IndexedDB, the latest read alone, and parsed again as the next visit
 * starts, so the Pokédex is marked before a phone is connected; Forget drops it. Never published — the export is the
 * account itself, so it stays in the browser.
 */

import { loadChunk } from './chunks.js';
import type { Phone } from './core/browser/webusb.js';
import { said } from './errors.js';
import { databaseNames, inStore } from './indexed-db.js';
import type { Result } from './inventory-read.js';
import { phoneStore, type PhoneStore } from './phone-store.js';
import { KEY_PREFIX } from './storage-namespace.js';
import { Store, useStore } from './store.js';
import type { Row } from './tools/inventory/snapshot.mts';

/** Whether a read is under way, or why the last one failed. */
export type Status = { state: 'idle' } | { state: 'reading' } | { state: 'failed'; reason: string };

/** Where the export is kept: a database of the namespace's own, its one store holding the latest read under one key. */
const DATABASE = `${KEY_PREFIX}inventory`;
const STORE = 'export';
const LATEST = 'latest';

/** What is kept: the export as it was read, and when, in milliseconds since the epoch. */
interface Kept {
  text: string;
  at: number;
}

const isKept = (value: unknown): value is Kept =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Kept).text === 'string' &&
  typeof (value as Kept).at === 'number';

/** `inventory-read.ts`, fetched once a read starts, and what a failure to fetch it says in place of a read's result. */
const reader = (read: (module: typeof import('./inventory-read.js')) => Promise<Result>): Promise<Result> =>
  loadChunk(() => import('./inventory-read.js'))
    .then(read)
    .catch((error: unknown) => ({ reason: `could not read the inventory: ${said(error)}` }));

/** A class rather than module state so a test can start from nothing; the document has the one instance below. */
export class InventoryStore extends Store {
  status: Status = { state: 'idle' };
  readonly #phones: PhoneStore;

  /** The rows the last read that landed produced, kept through a read after it and after its phone is let go. */
  rows: readonly Row[] | null = null;

  /** When the read the rows came from was made, in milliseconds since the epoch, or null with no rows. */
  readAt: number | null = null;

  /**
   * The serial of the phone last read, so a phone held again with it is not read again: a battle hands the phone it
   * borrowed back as a new connection to the same serial.
   */
  #serial: string | null = null;

  /** What the read under way is of, so a second read of the same phone is left to the first. */
  #reading: Phone | 'file' | null = null;

  /** Which read is current, so one a newer read or a clear overtook cannot land over what replaced it. */
  #token = 0;

  /** Reads each phone `phones` comes to hold, unless it is the one last read. */
  constructor(phones: PhoneStore) {
    super();
    this.#phones = phones;

    phones.subscribe(() => {
      const { phone } = phones;

      if (phone !== null && phone.serial !== this.#serial) {
        void this.read(phone);
      }
    });
  }

  /**
   * Reads PGSharp's export off `phone` and parses it to rows, fetching the game master once to resolve them against. A
   * read already under way for the same phone is left to finish rather than started again.
   */
  async read(phone: Phone): Promise<void> {
    if (this.status.state === 'reading' && this.#reading === phone) {
      return;
    }

    this.#serial = phone.serial;
    await this.#land(
      phone,
      reader((module) => module.phoneRows(phone)),
    );
  }

  /**
   * Parses the export kept from an earlier visit, unless a read has started since this was asked. Storage the browser
   * refuses, as in a private window, keeps nothing, so finding nothing is all it says. The database is looked for
   * before it is opened, since opening one makes it: every visit would leave an empty one behind for a backup to carry.
   */
  async restore(): Promise<void> {
    const token = this.#token;
    let kept: unknown;

    try {
      if (!(await databaseNames()).includes(DATABASE)) {
        return;
      }

      kept = await inStore(DATABASE, STORE, 'readonly', (store) => store.get(LATEST));
    } catch {
      return;
    }

    if (!isKept(kept) || this.#token !== token) {
      return;
    }

    const { text, at } = kept;
    const landed = await reader((module) => module.textRows(text));

    if (this.#token !== token) {
      return;
    }

    if ('rows' in landed) {
      this.rows = landed.rows;
      this.readAt = at;
    } else {
      this.status = { state: 'failed', reason: landed.reason };
    }

    this.emit();
  }

  /** Reads a copy of PGSharp's export the reader opened, superseding any read under way. */
  async open(file: Blob): Promise<void> {
    await this.#land(
      'file',
      reader((module) => module.fileRows(file)),
    );
  }

  /**
   * Holds the status at reading until `result` lands, unless a later read or a clear overtakes it first. A phone read
   * that fails once the phone is no longer held was cut off — lent to a battle or unplugged — rather than refused, so
   * it says nothing and leaves the phone to be read again when it is next held.
   */
  async #land(source: Phone | 'file', result: Promise<Result>): Promise<void> {
    const token = ++this.#token;

    this.#reading = source;
    this.status = { state: 'reading' };
    this.emit();

    const landed = await result;

    if (this.#token !== token) {
      return;
    }

    this.#reading = null;

    if ('rows' in landed) {
      const kept: Kept = { text: landed.text, at: Date.now() };

      this.rows = landed.rows;
      this.readAt = kept.at;
      this.status = { state: 'idle' };
      void this.#keep((store) => store.put(kept, LATEST));
    } else if (source !== 'file' && this.#phones.phone !== source) {
      this.#serial = null;
      this.status = { state: 'idle' };
    } else {
      this.status = { state: 'failed', reason: landed.reason };
    }

    this.emit();
  }

  /**
   * Forgets what was read, back to before any read, the kept copy included, and drops a read still under way. Answers
   * once the kept copy is gone.
   */
  clear(): Promise<void> {
    this.#token++;
    this.#serial = null;
    this.#reading = null;
    this.rows = null;
    this.readAt = null;
    this.status = { state: 'idle' };
    this.emit();

    return this.#keep((store) => store.delete(LATEST));
  }

  /**
   * Changes the kept copy. IndexedDB commits writes to one store in the order they were started, so a Forget straight
   * after a read deletes what the read put. A change that fails is told on the console rather than the panel: the rows
   * read are still shown, and only the next visit goes without them.
   */
  #keep(act: (store: IDBObjectStore) => IDBRequest): Promise<void> {
    return inStore(DATABASE, STORE, 'readwrite', act).then(
      () => undefined,
      (error: unknown) => console.error(`${DATABASE}: ${said(error)} — the next visit will not have this read`),
    );
  }
}

/** The document's store, which outlives any one tab. */
export const inventoryStore = new InventoryStore(phoneStore);

void inventoryStore.restore();

/** The document's store, with the calling component redrawn whenever it changes. */
export function useInventory(): InventoryStore {
  return useStore(inventoryStore);
}
