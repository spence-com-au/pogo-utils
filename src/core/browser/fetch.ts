/**
 * What the pages fetch alike: a file's bytes, and the vended game master, fetched once for every page that reads the
 * screen against it. Apart from `ocr.ts`, so that a page wanting the game master alone brings no OCR with it: the
 * Battle page's own thread reads it, and leaves the reading to the battle's Worker.
 */

import { said } from '../../errors.js';
import { fetchOk as fetchStatus } from '../../fetch-ok.js';
import { GAME_MASTER } from '../../generated.js';
import { type GameData } from '../game-master.mts';

/** The shared `fetchOk`, naming the URL in whatever it throws: the readers that call it report a failure as thrown. */
export async function fetchOk(url: string): Promise<Response> {
  try {
    return await fetchStatus(url);
  } catch (e) {
    throw new Error(`${url}: ${said(e)}`, { cause: e });
  }
}

/** What `url` serves, the bytes of it. */
export async function fetchBytes(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetchOk(url)).arrayBuffer());
}

/**
 * `make`, run by the first call with its arguments, and the promise it made answered to every call after. A promise
 * that rejected is let go, so the next call runs `make` again rather than answering every later one with the network
 * as it was the first time, and so is one whose value `keeps` refuses.
 */
export function once<Args extends unknown[], Value>(
  make: (...args: Args) => Promise<Value>,
  keeps: (value: Value) => boolean = () => true,
): (...args: Args) => Promise<Value> {
  let kept: Promise<Value> | null = null;

  return (...args) => {
    if (kept === null) {
      const promise = (kept = make(...args));

      const forget = () => {
        if (kept === promise) {
          kept = null;
        }
      };

      promise.then((value) => {
        if (!keeps(value)) {
          forget();
        }
      }, forget);
    }

    return kept;
  };
}

/**
 * The vended game master, fetched once for every page that reads the screen against it: the Inventory page's reads and
 * the battle tool's.
 */
export const gameData = once(async (): Promise<GameData> => (await fetchOk(GAME_MASTER)).json() as Promise<GameData>);
