/**
 * What a page and the battle's Worker say to each other, `host.ts` being the Worker's half and `client.ts` the page's.
 * One run a Worker: started, asked for frames to draw, and stopped, the phone's USB device handed to it for the run and
 * back to the page after.
 */

import { type Image } from '../tools/inventory/png.mts';

/** What the page says: start on the phone `serial` names, which the page has let go of; the latest frame; stop. */
export type Command = { type: 'start'; serial: string } | { type: 'frame' } | { type: 'stop' };

/**
 * What the Worker says: that the phone has sent its first frame, the latest frame, and that the run is over and the
 * phone let go of, with why where it failed.
 */
export type Message =
  { type: 'started' } | { type: 'frame'; image: Image | undefined } | { type: 'stopped'; error?: string };
