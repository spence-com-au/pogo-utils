/**
 * The phone this document holds over WebUSB, shared by every tab rather than owned by any one of them: the phone
 * button connects it, the Inventory page reads its screen, and the Search page types its string into storage on it.
 *
 * Held until another phone replaces it or it is unplugged, so a tab switch costs no reconnection. The phone stays
 * claimed meanwhile, which is the trade: an `adb` server on this computer cannot reach it until it is unplugged or the
 * site is closed. A battle's Worker borrows it for a run, through `lend` in `battle/client.ts`, and none is held here
 * meanwhile, unless the phone button connects another, which then stays held in place of the lent one.
 *
 * Only the `Phone` type comes from `webusb.ts`, so a tab that merely asks whether a phone is held loads none of Tango.
 */

import type { Phone } from './inventory/webusb.js';
import { Store, useStore } from './store.js';

/**
 * What the demo phone in `inventory/demo.ts` is found by, which no USB serial is. Here rather than there so the Battle
 * page can refuse it without fetching the readers that module brings.
 */
export const DEMO_SERIAL = 'demo';

/** A class rather than module state so a test can start from nothing; the document has the one instance below. */
export class PhoneStore extends Store {
  /** The phone held, or null before one is connected, once it is unplugged and while it is lent to a battle. */
  phone: Phone | null = null;

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
        this.emit();
      }
    };

    this.phone = next;
    this.emit();
    next.disconnected.then(gone, gone);

    await was?.close().catch(() => undefined);
  }

  /**
   * The phone held, taken out at once rather than once its connection has ended, for whoever is to close it and use it
   * elsewhere: until then it would still be handed to a tab, or lent twice.
   */
  release(): Phone | null {
    const was = this.phone;

    if (was) {
      this.phone = null;
      this.emit();
    }

    return was;
  }
}

/** The document's store, which outlives any one tab. */
export const phoneStore = new PhoneStore();

/** The phone held, with the calling component redrawn whenever that changes. */
export function usePhone(): Phone | null {
  return useStore(phoneStore).phone;
}
