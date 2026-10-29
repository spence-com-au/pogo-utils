/**
 * The battle's Worker, as `scripts/bundle.mts` builds it to `BATTLE_WORKER` and a page starts it from there. WebUSB is
 * reached here as on the page, a Worker being granted the devices its page was.
 */

import { reconnect } from '../inventory/webusb.js';
import { host } from './host.js';

host(self, reconnect);
