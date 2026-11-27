/**
 * PGSharp's export turned into rows, off a phone, from a file the reader opened or from the copy kept. Apart from
 * `inventory-store.ts`, which the phone button loads on every page, so that the parser and the game-master fetch load
 * only once a read starts.
 */

import { Device } from './core/adb.mts';
import { gameData } from './core/browser/fetch.js';
import type { Phone } from './core/browser/webusb.js';
import { said } from './errors.js';
import { PGSTATS } from './tools/inventory/pgstats.mts';
import { parseSnapshot, rowsOf, type Row } from './tools/inventory/snapshot.mts';

/** The rows an export holds and the export itself, kept to parse again on the next visit, or why there are none. */
export type Result = { rows: readonly Row[]; text: string } | { reason: string };

/**
 * Why a read off the phone failed, the reason leading and the export hint only offered: a slow link or a read too big
 * fail the same way a missing export does, so the hint is not asserted.
 */
const unread = (error: unknown) =>
  `could not read the export off the phone: ${said(error)} — switch PGSharp's inventory export on if it is off`;

/** The export's `text` parsed to rows, or why it could not be. */
export async function textRows(text: string): Promise<Result> {
  try {
    return { rows: rowsOf(parseSnapshot(text), await gameData()), text };
  } catch (error) {
    return { reason: `could not read the inventory: ${said(error)}` };
  }
}

/**
 * The export off `phone` parsed to rows, or why it could not be. Only the read itself carries the export hint: a
 * corrupt export or a failed game-master fetch reads fine and fails after, a different cause than there being nothing
 * to read.
 */
export async function phoneRows(phone: Phone): Promise<Result> {
  let text: string;

  try {
    text = new TextDecoder().decode(await new Device(phone.transport).read(PGSTATS));
  } catch (error) {
    return { reason: unread(error) };
  }

  return textRows(text);
}

/** A copy of the export the reader opened, parsed to rows, or why it could not be. */
export async function fileRows(file: Blob): Promise<Result> {
  let text: string;

  try {
    text = await file.text();
  } catch (error) {
    return { reason: `could not open that file: ${said(error)}` };
  }

  return textRows(text);
}
