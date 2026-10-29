/**
 * The `Phone` the battle loop in `src/tools/battle/run.mts` plays through, over WebUSB, as `scripts/battle.mts` builds
 * one over the `adb` binary: screenshots through a `Device`, taps and swipes through the uhid touchscreen made on one
 * shell held open, and frames from `Screen` over `screenrecord`, decoded by WebCodecs.
 */

import { said } from '../errors.js';
import type { Phone as Connection } from '../inventory/webusb.js';
import { type Phone } from '../tools/battle/phone.mts';
import { streamSize } from '../tools/battle/record-command.mts';
import { Screen } from '../tools/battle/screen.mts';
import { Device } from '../tools/inventory/adb.mts';
import { holdShell, type HeldShell } from '../tools/inventory/held-shell.mts';
import { touchscreen } from '../tools/inventory/touchscreen.mts';
import { feed, textOf } from './feed.js';

/**
 * `sh` held open on the phone, as `adbHeld` holds `adb shell`: one write a command, which is what the touchscreen's
 * swipes come too fast to start a process for. Through it, on a Pixel 8 Pro, `echo` came back in 3.0ms (p50) and the
 * touchscreen was made in 79ms. `ended` settles once the shell has, however it ended, with why where anything said.
 */
export async function heldShell(
  connection: Pick<Connection, 'spawn'>,
): Promise<HeldShell & { ended: Promise<string | undefined> }> {
  const process = await connection.spawn(['sh']);
  const writer = process.stdin.getWriter();
  const encoder = new TextEncoder();
  const lost = (error: unknown) => new Error(`adb shell: ${said(error)}; is the phone still connected?`);

  const held = holdShell({
    write: (text) => void writer.write(encoder.encode(text)).catch((error: unknown) => held.fail(lost(error))),

    // Killed rather than left to exit on its stdin ending: it is closed only once a run is over and nothing more is to
    // be sent, and the touchscreen goes with it either way.
    end: () => process.kill(),
    kill: () => process.kill(),
  });

  // The phone's own stderr comes on stdout, `holdShell` having sent it there; what comes here is from before that.
  const errors = textOf(process.stderr);

  const ended = process.stdout.pipeTo(new WritableStream({ write: held.output })).then(
    () => {
      held.exited(errors());
      return errors() || undefined;
    },
    (error: unknown) => {
      held.fail(lost(error));
      return said(error);
    },
  );

  return { ...held, ended };
}

/**
 * The phone `connection` reaches, as the battle loop plays through it, once its screen has sent a frame. `close` stops
 * the recording and the shell, the touchscreen going with the shell, and leaves the connection to whoever opened it.
 *
 * `failed` settles with why the phone stopped answering, where it did before `close`: its screen's recording failing or
 * its shell ending. The loop would hear of either from its next frame or touch, but a Worker that is asked for nothing
 * meanwhile would hold the phone until it was.
 */
export async function battlePhone(
  connection: Pick<Connection, 'transport' | 'spawn'>,
): Promise<Phone & { close(): void; failed: Promise<Error> }> {
  const device = new Device(connection.transport);

  // A screenshot for the screen's size, which the stream takes its shape from.
  const size = streamSize(await device.screenshot());
  const held = await heldShell(connection);
  const screen = new Screen(() => feed(connection, size));
  let closed = false;

  const close = () => {
    closed = true;
    screen.close();
    held.close();
  };

  const shellEnded = held.ended.then((why) =>
    closed
      ? new Promise<never>(() => {})
      : new Error(`the phone's shell ended${why ? `: ${why}` : ''}; is the phone still connected?`),
  );

  try {
    const touch = await touchscreen({ ...connection.transport, shell: held.shell });
    await screen.first();

    return {
      frame: () => screen.latest()?.image,
      screenshot: () => device.screenshot(),
      tap: (point) => touch.tap(point),
      swipe: (from, to, ms) => touch.swipe(from, to, ms),
      close,
      failed: Promise.race([screen.failed, shellEnded]),
    };
  } catch (error) {
    close();
    throw error;
  }
}
