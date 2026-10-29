/**
 * The battle's Worker, as `scripts/bundle.mts` builds it to `BATTLE_WORKER` and a page starts it from there. WebUSB is
 * reached here as on the page, a Worker being granted the devices its page was, and so is the WebAssembly Tesseract,
 * whose own workers a dedicated Worker can start as a page does.
 */

import { reconnect } from '../inventory/webusb.js';
import { wasmEngine } from '../inventory/reader.js';
import { host } from './host.js';

host(self, reconnect, (base) => wasmEngine(base));
