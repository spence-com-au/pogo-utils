/**
 * The owned Pokémon this document holds, read off the connected phone's PGSharp export rather than fetched: the whole
 * account, decoded, which the Pokédex and Search pages mark and filter against. Read on demand from the phone the
 * `phoneStore` already holds, kept until re-read or the page is closed, and never published — the export is the account
 * itself, so it stays in the browser.
 */

import { Device } from './core/adb.mts';
import { gameData } from './core/browser/fetch.js';
import type { Phone } from './core/browser/webusb.js';
import { said } from './errors.js';
import { Store, useStore } from './store.js';
import { PGSTATS, parseSnapshot, rowsOf, type Row } from './tools/inventory/snapshot.mts';

/** What the store holds: nothing read yet, a read under way, the rows a read produced, or why the last read failed. */
export type Inventory =
  | { state: 'empty' }
  | { state: 'reading' }
  | { state: 'read'; rows: readonly Row[] }
  | { state: 'failed'; reason: string };

/**
 * Why a read failed, the underlying reason leading and the export hint only offered: a slow link or a read too big fail
 * the same way a missing export does, so the hint is not asserted.
 */
const failure = (error: unknown) =>
  `could not read the export off the phone: ${said(error)} — switch PGSharp's inventory export on if it is off`;

/** A class rather than module state so a test can start from nothing; the document has the one instance below. */
export class InventoryStore extends Store {
  inventory: Inventory = { state: 'empty' };

  /** The phone the inventory was read off, so a read is shown only for the phone it is of, not a swapped-in one. */
  phone: Phone | null = null;

  /** Which read is current, so one a swap or a clear overtook before it returned cannot land over what replaced it. */
  #token = 0;

  /**
   * Reads PGSharp's export off `phone` and parses it to rows, fetching the game master once to resolve them against. A
   * read already under way is left to finish rather than started again, and one overtaken before it returns is dropped.
   */
  async read(phone: Phone): Promise<void> {
    if (this.inventory.state === 'reading') {
      return;
    }

    const token = ++this.#token;

    this.phone = phone;
    this.inventory = { state: 'reading' };
    this.emit();

    try {
      const text = new TextDecoder().decode(await new Device(phone.transport).read(PGSTATS));
      const rows = rowsOf(parseSnapshot(text), await gameData());

      if (this.#token !== token) {
        return;
      }

      this.inventory = { state: 'read', rows };
    } catch (error) {
      if (this.#token !== token) {
        return;
      }

      this.inventory = { state: 'failed', reason: failure(error) };
    }

    this.emit();
  }

  /** The inventory, but only where it was read off `phone`: a swapped-in phone's is empty until its own read lands. */
  forPhone(phone: Phone | null): Inventory {
    return this.phone === phone ? this.inventory : { state: 'empty' };
  }

  /** Forgets what was read, back to before any read, and drops a read still under way. */
  clear(): void {
    this.#token++;
    this.phone = null;
    this.inventory = { state: 'empty' };
    this.emit();
  }
}

/** The document's store, which outlives any one tab. */
export const inventoryStore = new InventoryStore();

/** What the store holds for `phone`, with the calling component redrawn whenever that changes. */
export function useInventory(phone: Phone | null): Inventory {
  return useStore(inventoryStore).forPhone(phone);
}
