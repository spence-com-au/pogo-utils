/**
 * A phone that is not there, for a reader with none to see what the phone tabs do: held in `phoneStore` like one
 * connected over WebUSB, so the Inventory and Search pages run their real readers against it and know nothing of the
 * difference. Its screen is `demoTransport`'s, the recordings fetched as each is first shown.
 *
 * Fetched by the settings menu only once the demo is asked for, bringing the readers with it, which the pages fetch
 * for themselves the first time they read a phone anyway.
 */

import { DEMO_SERIAL } from '../phone-store.js';
import { demoTransport } from '../tools/inventory/demo.mts';
import { fetchOk } from './reader.js';
import type { Phone } from './webusb.js';

export function demoPhone(): Phone {
  let hangUp = () => {};
  const disconnected = new Promise<void>((resolve) => (hangUp = resolve));

  return {
    name: 'Demo phone',
    serial: DEMO_SERIAL,
    transport: demoTransport(async (path) => new Uint8Array(await (await fetchOk(path)).arrayBuffer())),
    spawn: () => Promise.reject(new Error('the demo phone plays no battles')),
    close: () => {
      hangUp();

      return Promise.resolve();
    },
    disconnected,
  };
}
