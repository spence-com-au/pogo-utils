/**
 * The battle's Worker, from the page. One context at a time can claim the phone's USB device, and the page holds it in
 * `phoneStore` from the settings menu's connect on. So for a run the page lets it go and tells the Worker its serial,
 * the Worker opens it again from the devices the site was granted, and once the Worker says it has stopped, having let
 * it go in turn, the page opens it again and holds it as before. Neither open asks anything of the user, nor of the
 * phone, and other tabs see no phone held meanwhile.
 */

import { said } from '../errors.js';
import { BATTLE_WORKER } from '../generated.js';
import { reconnect as reopen, type Phone } from '../inventory/webusb.js';
import { type PhoneStore } from '../phone-store.js';
import { type Image } from '../tools/inventory/png.mts';
import { type Command, type Message } from './protocol.js';

/** What the page posts to and hears from: the Worker, or a channel's end in a test. */
export interface Endpoint {
  postMessage(command: Command): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<Message>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

export interface Run {
  /** The latest frame the phone has sent, for a canvas, or `undefined` once the run has stopped. */
  frame(): Promise<Image | undefined>;
  stop(): void;

  /**
   * Settles once the run has stopped and the phone has been taken back, rejecting with why the run failed, or with why
   * the phone could not be taken back.
   */
  ended: Promise<void>;
}

/**
 * Hands the phone `store` holds to the Worker `start` starts, for a run, answering once the phone's screen has sent its
 * first frame. Where it never does, it fails once the phone has been taken back, with why, or with why the phone could
 * not be. The Worker is ended with the run.
 */
export async function lend(
  store: PhoneStore,
  start: () => Endpoint = () => new Worker(BATTLE_WORKER, { type: 'module' }),
  reconnect: (serial: string) => Promise<Phone> = reopen,
): Promise<Run> {
  // Out of the store before anything is awaited, so that a second `lend` meanwhile finds none to lend.
  const phone = store.release();

  if (!phone) {
    throw new Error('no phone is connected');
  }

  const { serial } = phone;

  /**
   * The phone held by the page again, unless the settings menu connected another meanwhile: that one is the user's
   * choice and stays held, this one being let go of again. Failing to come back is told after `error`, the run's own
   * failure, where there is one, that being the news.
   */
  const takeBack = (error?: string) =>
    reconnect(serial)
      .then((back) => (store.phone === null ? store.hold(back) : back.close()))
      .catch((failure: unknown) => {
        throw error === undefined
          ? failure
          : new Error(`${error}; the phone could not be taken back, so connect it again in settings: ${said(failure)}`);
      });

  // Started only once the phone is let go of, which fails where it is already gone and leaves nothing to end.
  await phone.close();
  let worker: Endpoint;

  try {
    worker = start();
  } catch (error) {
    await takeBack(said(error));
    throw error;
  }

  // Frames are answered in the order they were asked for, the Worker taking each message in turn.
  const asked: ((image: Image | undefined) => void)[] = [];
  let started = false;
  let over = false;
  let running = () => {};
  const first = new Promise<void>((resolve) => (running = resolve));

  const ended = new Promise<void>((resolve, reject) => {
    const end = (error: string | undefined) => {
      if (over) {
        return;
      }

      over = true;
      worker.terminate();
      asked.splice(0).forEach((answer) => answer(undefined));

      takeBack(error).then(() => (error === undefined ? resolve() : reject(new Error(error))), reject);
    };

    worker.addEventListener('message', ({ data }) => {
      if (data.type === 'started') {
        started = true;
        running();
      } else if (data.type === 'frame') {
        asked.shift()?.(data.image);
      } else {
        end(data.error);
      }
    });

    // A Worker that failed to load, which never claimed the device, or that threw past `host`, which `terminate` ends.
    // The device goes with its context, which may not have happened by the time the page reconnects: that fails
    // `ended` with why, rather than leaving the page waiting on a device that may never come free.
    worker.addEventListener('error', (event) => end(event.message || 'the battle Worker failed'));
  });

  worker.postMessage({ type: 'start', serial });
  await Promise.race([first, ended]);

  // Stopped cleanly before the phone sent a frame, which the Worker does not do today: every stop of its own before then
  // carries why, and the page cannot ask for one before `lend` returns. Kept so that a `Run` is never one already over.
  if (!started) {
    throw new Error('the run stopped before the phone sent a frame');
  }

  return {
    frame: () =>
      over
        ? Promise.resolve(undefined)
        : new Promise((answer) => {
            asked.push(answer);
            worker.postMessage({ type: 'frame' });
          }),
    stop: () => worker.postMessage({ type: 'stop' }),
    ended,
  };
}
