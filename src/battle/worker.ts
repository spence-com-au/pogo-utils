/**
 * The battle's Worker, as `scripts/bundle.mts` builds it to `BATTLE_WORKER` and a page starts it from there. WebUSB is
 * reached here as on the page, a Worker being granted the devices its page was, and so is the WebAssembly Tesseract,
 * whose own workers a dedicated Worker can start as a page does. The demo phone is reached here too, its battle
 * fetched against the page's URL, as every path the site publishes is relative to the page.
 */

import { DEMO_BATTLE } from '../generated.js';
import { fetchOk, wasmEngine } from '../inventory/reader.js';
import { reconnect } from '../inventory/webusb.js';
import { DEMO_SERIAL } from '../phone-store.js';
import { demoConnection } from './demo.js';
import { decodeFrames } from './feed.js';
import { host } from './host.js';

host(
  self,
  async (serial, base) =>
    serial === DEMO_SERIAL
      ? demoConnection(
          new Uint8Array(await (await fetchOk(new URL(DEMO_BATTLE.clip, base).href)).arrayBuffer()),
          DEMO_BATTLE.fps,
          decodeFrames,
        )
      : reconnect(serial),
  (base) => wasmEngine(base),
);
