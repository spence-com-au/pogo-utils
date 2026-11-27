/**
 * The owned Pokémon this document holds, read from PGSharp's export rather than fetched: the whole account, decoded,
 * which the Pokédex marks against. Read off each phone the `phoneStore` comes to hold, or from a copy of the export the
 * reader opens, and kept until the next read lands or the page is closed. Never published — the export is the account
 * itself, so it stays in the browser.
 */

import { loadChunk } from './chunks.js';
import type { Phone } from './core/browser/webusb.js';
import { said } from './errors.js';
import type { Result } from './inventory-read.js';
import { phoneStore, type PhoneStore } from './phone-store.js';
import { Store, useStore } from './store.js';
import type { Row } from './tools/inventory/snapshot.mts';

/** Whether a read is under way, or why the last one failed. */
export type Status = { state: 'idle' } | { state: 'reading' } | { state: 'failed'; reason: string };

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
      this.rows = landed.rows;
      this.status = { state: 'idle' };
    } else if (source !== 'file' && this.#phones.phone !== source) {
      this.#serial = null;
      this.status = { state: 'idle' };
    } else {
      this.status = { state: 'failed', reason: landed.reason };
    }

    this.emit();
  }

  /** Forgets what was read, back to before any read, and drops a read still under way. */
  clear(): void {
    this.#token++;
    this.#serial = null;
    this.#reading = null;
    this.rows = null;
    this.status = { state: 'idle' };
    this.emit();
  }
}

/** The document's store, which outlives any one tab. */
export const inventoryStore = new InventoryStore(phoneStore);

/** The document's store, with the calling component redrawn whenever it changes. */
export function useInventory(): InventoryStore {
  return useStore(inventoryStore);
}
