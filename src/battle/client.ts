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

  /** Settles once the page holds the phone again, rejecting with why the run stopped where it failed. */
  ended: Promise<void>;
}

/**
 * Hands the phone `store` holds to the Worker `start` starts, for a run, answering once the phone's screen has sent its
 * first frame, or failing with why it never did once the page holds the phone again. The Worker is ended with the run.
 */
export async function lend(
  store: PhoneStore,
  start: () => Endpoint = () => new Worker(BATTLE_WORKER, { type: 'module' }),
  reconnect: (serial: string) => Promise<Phone> = reopen,
): Promise<Run> {
  const phone = store.phone;

  if (!phone) {
    throw new Error('no phone is connected');
  }

  // Started only once the phone is let go of, which fails where it is already gone and leaves nothing to end.
  const { serial } = phone;
  await phone.close();
  const worker = start();

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

      // The run's failure is the news where there is one, with the phone failing to come back after it as well.
      reconnect(serial)
        .then((back) => store.hold(back))
        .then(
          () => (error === undefined ? resolve() : reject(new Error(error))),
          (failure: unknown) =>
            reject(
              error === undefined
                ? failure
                : new Error(
                    `${error}; the phone could not be taken back, so connect it again from the settings menu: ${said(failure)}`,
                  ),
            ),
        );
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

  // Stopped before the phone sent a frame, its connection closed under the Worker, with nothing to say why.
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
