/**
 * A phone that is not there, for a reader with none to see what the phone tabs do: held in `phoneStore` like one
 * connected over WebUSB, so the Inventory and Search pages run their real readers against it and know nothing of the
 * difference. Its screen is `demoTransport`'s, the recordings fetched as each is first shown.
 *
 * Fetched by the phone button only once the demo is asked for, behind `?demo`.
 */

import { fetchBytes } from './core/browser/fetch.js';
import type { Phone } from './core/browser/webusb.js';
import { DEMO_SERIAL } from './phone-store.js';
import { demoTransport } from './tools/inventory/demo.mts';

export function demoPhone(): Phone {
  let hangUp = () => {};
  const disconnected = new Promise<void>((resolve) => (hangUp = resolve));

  return {
    name: 'Demo phone',
    serial: DEMO_SERIAL,
    transport: demoTransport(fetchBytes),
    spawn: () => Promise.reject(new Error('the demo phone plays its battle in the battle Worker alone')),
    close: () => {
      hangUp();

      return Promise.resolve();
    },
    disconnected,
  };
}
