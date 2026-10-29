/**
 * What the battle loop in `run.mts` drives the phone through rather than `adb`, so that a test can stand a scripted
 * phone in for a real one and a page one over WebUSB. On its own so that the page's, in `src/battle/phone.ts`, is held
 * to it without reaching every module the loop does, some of them still Node's.
 */

import { type Image } from '../inventory/png.mts';
import { type Point } from './play.mts';

export interface Phone {
  /** The latest frame of the stream, or `undefined` before the first. */
  frame(): Image | undefined;
  screenshot(): Promise<Image>;
  tap(at: Point): Promise<void>;
  swipe(from: Point, to: Point, ms: number): Promise<void>;
}
