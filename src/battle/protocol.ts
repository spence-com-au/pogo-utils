/**
 * What a page and the battle's Worker say to each other, `host.ts` being the Worker's half and `client.ts` the page's.
 * One run a Worker: started, told what it does as it goes, asked for frames to draw, and stopped, the phone's USB device
 * handed to it for the run and back to the page after.
 */

import { type Image } from '../tools/inventory/png.mts';
import { type Status } from '../tools/battle/reporter.mts';
import { type Options, type Tally } from '../tools/battle/run.mts';

/**
 * What the page starts a run with: what `run` is to play, loaded by the page, and the page's URL, which the Worker finds
 * the OCR engine's files against. Neither could be had from the Worker's own URL, which is its script's, under
 * `src/battle/`, where every path the site publishes is relative to the page. No frames are kept, there being nowhere
 * in a page to keep them.
 */
export interface Play {
  battle: Omit<Options, 'keep'>;
  base: string;
}

/** What the page says: start on the phone `serial` names, which the page has let go of; the latest frame; stop. */
export type Command = ({ type: 'start'; serial: string } & Play) | { type: 'frame' } | { type: 'stop' };

/**
 * What the Worker says: that the phone has sent its first frame, the latest frame, what the run does as `run` reports
 * it, and that the run is over and the phone let go of, with why where it failed, and how it went where it finished on
 * its own.
 */
export type Message =
  | { type: 'started' }
  | { type: 'frame'; image: Image | undefined }
  | { type: 'event'; line: string; side?: 'own' | 'opponent'; why?: string }
  | { type: 'status'; status: Status }
  | { type: 'stopped'; error?: string; tally?: Tally };
