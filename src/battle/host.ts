/**
 * The battle's Worker, apart from the global scope it runs in so that a test can stand a channel in for one. It runs
 * in a Worker because a page's timers are held to once a second while its tab is hidden, where a dedicated Worker's
 * are not: a 10ms timer measured 1000ms on the page and 10ms in the Worker, the tab hidden. The battle loop is to run
 * here too, between `started` and `stop`, telling the page what it does as it goes.
 */

import { said } from '../errors.js';
import type { Phone as Connection } from '../inventory/webusb.js';
import { battlePhone } from './phone.js';
import { type Command, type Message } from './protocol.js';

/** What the Worker posts to and hears from: its global scope, or a channel's end in a test. */
export interface Port {
  postMessage(message: Message): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<Command>) => void): void;
}

/**
 * Answers the page over `port`, reaching the phone through `reconnect` once the page has let it go. Stopped by the
 * page, by the phone being unplugged, or by the run failing, it lets the phone's USB device go before saying it has
 * stopped, the page taking the device back on hearing it, and says so once.
 */
export function host(port: Port, reconnect: (serial: string) => Promise<Connection>): void {
  let starting: Promise<void> | undefined;
  let connection: Connection | undefined;
  let phone: Awaited<ReturnType<typeof battlePhone>> | undefined;
  let stopped: Promise<void> | undefined;

  // After the start has got as far as it will, so a device it is still opening is let go of too rather than claimed
  // after the page was told it was free.
  const stop = (error?: unknown) =>
    (stopped ??= (async () => {
      await starting?.catch(() => undefined);
      phone?.close();
      await connection?.close().catch(() => undefined);
      port.postMessage({ type: 'stopped', ...(error !== undefined && { error: said(error) }) });
    })());

  const start = async (serial: string) => {
    connection = await reconnect(serial);

    // Closed by `stop` as well, which this then hears as nothing new.
    connection.disconnected.then(
      () => void stop(),
      (error: unknown) => void stop(error),
    );

    phone = await battlePhone(connection);

    // Heard as it happens rather than at the next frame the page asks for, which may not come for a while.
    void phone.failed.then((error) => stop(error));

    if (!stopped) {
      port.postMessage({ type: 'started' });
    }
  };

  port.addEventListener('message', ({ data }) => {
    switch (data.type) {
      case 'start':
        if (!starting && !stopped) {
          starting = start(data.serial);
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
