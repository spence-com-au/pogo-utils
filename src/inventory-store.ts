/**
 * The owned Pokémon this document holds, read from PGSharp's export rather than fetched: the whole account, decoded,
 * which the Pokédex and Search pages mark and filter against. Read on demand off the phone the `phoneStore` already
 * holds or from a copy of the export the reader opens, kept until re-read or the page is closed, and never published —
 * the export is the account itself, so it stays in the browser.
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
 * Why a read off the phone failed, the reason leading and the export hint only offered: a slow link or a read too big
 * fail the same way a missing export does, so the hint is not asserted.
 */
const unread = (error: unknown) =>
  `could not read the export off the phone: ${said(error)} — switch PGSharp's inventory export on if it is off`;

type Result = { rows: readonly Row[] } | { reason: string };

/** The export's `text` parsed to rows, or why it could not be. */
async function rowsFrom(text: string): Promise<Result> {
  try {
    return { rows: rowsOf(parseSnapshot(text), await gameData()) };
  } catch (error) {
    return { reason: `could not read the inventory: ${said(error)}` };
  }
}

/**
 * The export off `phone` parsed to rows, or why it could not be. Only the read itself carries the export hint: a corrupt
 * export or a failed game-master fetch reads fine and fails after, a different cause than there being nothing to read.
 */
async function readRows(phone: Phone): Promise<Result> {
  let text: string;

  try {
    text = new TextDecoder().decode(await new Device(phone.transport).read(PGSTATS));
  } catch (error) {
    return { reason: unread(error) };
  }

  return rowsFrom(text);
}

/** A copy of the export the reader opened, parsed to rows, or why it could not be. */
async function fileRows(file: Blob): Promise<Result> {
  let text: string;

  try {
    text = await file.text();
  } catch (error) {
    return { reason: `could not open that file: ${said(error)}` };
  }

  return rowsFrom(text);
}

/** A class rather than module state so a test can start from nothing; the document has the one instance below. */
export class InventoryStore extends Store {
  inventory: Inventory = { state: 'empty' };

  /**
   * Where the inventory came from: the phone it was read off, so a read is shown only for the phone it is of rather than
   * a swapped-in one, or `file` for a copy the reader opened, which is shown whatever phone is held.
   */
  source: Phone | 'file' | null = null;

  /** Which read is current, so one a swap or a clear overtook before it returned cannot land over what replaced it. */
  #token = 0;

  /**
   * Reads PGSharp's export off `phone` and parses it to rows, fetching the game master once to resolve them against. A
   * read already under way for the same phone is left to finish rather than started again; a newly held phone's read
   * supersedes it, and the one it overtakes is dropped rather than landing over what replaced it.
   */
  async read(phone: Phone): Promise<void> {
    if (this.inventory.state === 'reading' && this.source === phone) {
      return;
    }

    await this.#land(phone, readRows(phone));
  }

  /** Reads a copy of PGSharp's export the reader opened, superseding any read under way. */
  async open(file: Blob): Promise<void> {
    await this.#land('file', fileRows(file));
  }

  /** Holds `source` as reading until `result` lands, unless a later read or a clear overtakes it first. */
  async #land(source: Phone | 'file', result: Promise<Result>): Promise<void> {
    const token = ++this.#token;

    this.source = source;
    this.inventory = { state: 'reading' };
    this.emit();

    const landed = await result;

    if (this.#token !== token) {
      return;
    }

    if ('rows' in landed) {
      this.inventory = { state: 'read', rows: landed.rows };
    } else {
      this.inventory = { state: 'failed', reason: landed.reason };
    }

    this.emit();
  }

  /**
   * The inventory, but only where it was read off `phone` or opened from a file: a swapped-in phone's is empty until its
   * own read lands.
   */
  forPhone(phone: Phone | null): Inventory {
    return this.source === phone || this.source === 'file' ? this.inventory : { state: 'empty' };
  }

  /** Forgets what was read, back to before any read, and drops a read still under way. */
  clear(): void {
    this.#token++;
    this.source = null;
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
