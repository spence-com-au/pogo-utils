/**
 * The battle's Worker, apart from the global scope it runs in so that a test can stand a channel in for one. It runs
 * in a Worker because a page's timers are held to once a second while its tab is hidden, where a dedicated Worker's
 * are not: a 10ms timer measured 1000ms on the page and 10ms in the Worker, the tab hidden. The battle loop runs here,
 * between `started` and `stopped`, telling the page what it does as it goes.
 */

import { said } from '../errors.js';
import type { Phone as Connection } from '../inventory/webusb.js';
import { type Reporter } from '../tools/battle/reporter.mts';
import { run, type Clock, type Tally } from '../tools/battle/run.mts';
import { useEngine, type Engine } from '../tools/inventory/ocr.mts';
import { keepAwake } from './awake.js';
import { battlePhone } from './phone.js';
import { type Command, type Message, type Play } from './protocol.js';

/** What the Worker posts to and hears from: its global scope, or a channel's end in a test. */
export interface Port {
  postMessage(message: Message): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<Command>) => void): void;
}

/**
 * Answers the page over `port`, reaching the phone through `reconnect` once the page has let it go and reading the
 * menus with the OCR `engine` makes. Both are given the page's URL as `base`, to find their files against. Stopped
 * by the page, by the phone being unplugged, by the run failing or by its finishing, it puts back the setting that kept
 * the phone awake and lets the phone's USB device go before saying it has stopped, the page taking the device back on
 * hearing it, and says so once.
 */
export function host(
  port: Port,
  reconnect: (serial: string, base: string) => Promise<Connection>,
  engine: (base: string) => Engine & { terminate(): Promise<void> },
): void {
  let starting: Promise<void> | undefined;
  let connection: Connection | undefined;
  let phone: Awaited<ReturnType<typeof battlePhone>> | undefined;
  let ocr: ReturnType<typeof engine> | undefined;
  let restore: (() => Promise<void>) | undefined;
  let stopped: Promise<void> | undefined;
  let over = false;

  // Nothing told once the page has heard the run is over, which a loop still winding down after its stop would tell.
  const tell = (message: Message) => over || port.postMessage(message);

  const report: Reporter = {
    event: (line, side, why) => tell({ type: 'event', line, ...(side && { side }), ...(why && { why }) }),
    status: (status) => tell({ type: 'status', status }),
  };

  // `run` stops for nothing but a throw, and sleeps every turn of its loop, so its sleeps end with the run: one asleep
  // when it is stopped throws at once, and any after it.
  const halted = new AbortController();

  const clock: Clock = {
    now: () => performance.now(),
    sleep: (ms) =>
      new Promise((resolve, reject) => {
        const { signal } = halted;

        const wake = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };

        const timer = setTimeout(() => {
          signal.removeEventListener('abort', wake);
          resolve();
        }, ms);

        if (signal.aborted) {
          wake();
        } else {
          signal.addEventListener('abort', wake, { once: true });
        }
      }),
  };

  // After the start has got as far as it will, so a device it is still opening is let go of too rather than claimed
  // after the page was told it was free. The setting goes back through the connection before it is closed.
  const stop = (error?: unknown, tally?: Tally) =>
    (stopped ??= (async () => {
      halted.abort(new Error('stopped'));
      await starting?.catch(() => undefined);
      phone?.close();
      await restore?.();
      await ocr?.terminate().catch(() => undefined);
      await connection?.close().catch(() => undefined);
      tell({ type: 'stopped', ...(error !== undefined && { error: said(error) }), ...(tally && { tally }) });
      over = true;
    })());

  const start = async (serial: string, { battle, base }: Play) => {
    connection = await reconnect(serial, base);

    // Closed unasked as well as unplugged, by the phone dropping USB debugging, and so a failure either way. Closed by
    // `stop`, it is heard once the stop is under way, which keeps its own reason.
    connection.disconnected.then(
      () => void stop(new Error('the connection to the phone closed; is it still plugged in?')),
      (error: unknown) => void stop(error),
    );

    restore = await keepAwake(serial, connection.transport, (line) => report.event(line));
    phone = await battlePhone(connection);

    // Heard as it happens rather than at the next frame the page asks for, which may not come for a while.
    void phone.failed.then((error) => stop(error));

    ocr = engine(base);
    useEngine(ocr);

    if (!stopped) {
      port.postMessage({ type: 'started' });

      // A run stopped by the page throws as it is, which the stop already under way leaves unsaid.
      run(phone, battle, clock, report).then(
        (tally) => void stop(undefined, tally),
        (error: unknown) => void stop(error),
      );
    }
  };

  port.addEventListener('message', ({ data }) => {
    switch (data.type) {
      case 'start':
        if (!starting && !stopped) {
          starting = start(data.serial, data);
          starting.catch((error: unknown) => void stop(error));
        }

        break;

      case 'frame':
        try {
          port.postMessage({ type: 'frame', image: stopped ? undefined : phone?.frame() });
        } catch (error) {
          // The recording has failed, which ends the run as it would end `run`.
          port.postMessage({ type: 'frame', image: undefined });
          void stop(error);
        }

        break;

      case 'stop':
        void stop();
    }
  });
}
