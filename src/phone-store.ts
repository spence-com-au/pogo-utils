/**
 * The phone this document holds over WebUSB, shared by every tab rather than owned by any one of them: the settings
 * menu connects it, the Inventory page reads its screen, and the Search page types its string into storage on it.
 *
 * Held until another phone replaces it or it is unplugged, so a tab switch costs no reconnection. The phone stays
 * claimed meanwhile, which is the trade: an `adb` server on this computer cannot reach it until it is unplugged or the
 * site is closed. A battle's Worker borrows it for a run, through `lend` in `battle/client.ts`, and none is held here
 * until the run gives it back.
 *
 * Only the `Phone` type comes from `webusb.ts`, so a tab that merely asks whether a phone is held loads none of Tango.
 */

import { useEffect, useState } from 'preact/hooks';

import type { Phone } from './inventory/webusb.js';

/** A class rather than module state so a test can start from nothing; the document has the one instance below. */
export class PhoneStore {
  /** The phone held, or null before one is connected and once it is unplugged. */
  phone: Phone | null = null;

  readonly #listeners = new Set<() => void>();

  /**
   * Holds `next` in place of whatever was held, letting that one go. It may be unplugged by now and throw for it, which
   * is no reason to lose the one just connected.
   *
   * Dropped again as its connection ends, however it ends — Tango resolves `disconnected` on a close and rejects it on
   * an unplug — but only while it is still the one held: a phone already replaced ending is no news about this one.
   */
  async hold(next: Phone) {
    const was = this.phone;

    const gone = () => {
      if (this.phone === next) {
        this.phone = null;
        this.#emit();
      }
    };

    this.phone = next;
    this.#emit();
    next.disconnected.then(gone, gone);

    await was?.close().catch(() => undefined);
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  #emit() {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

/** The document's store, which outlives any one tab. */
export const phoneStore = new PhoneStore();

/** The phone held, with the calling component redrawn whenever that changes. */
export function usePhone(): Phone | null {
  const [, redraw] = useState(0);

  useEffect(() => phoneStore.subscribe(() => redraw((count) => count + 1)), []);

  return phoneStore.phone;
}
