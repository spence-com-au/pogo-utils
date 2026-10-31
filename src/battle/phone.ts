/**
 * The `Phone` the battle loop in `src/tools/battle/run.mts` plays through, over WebUSB, built by the same `phoneOf` as
 * `scripts/battle.mts` builds one over the `adb` binary: screenshots and typing through a `Device`, taps, swipes and
 * holds through the uhid touchscreen made on one shell held open, and frames from `Screen` over `screenrecord`, decoded
 * by WebCodecs.
 */

import { said } from '../errors.js';
import type { Phone as Connection } from '../inventory/webusb.js';
import { type Size } from '../tools/battle/layout.mts';
import { phoneOf, type Phone } from '../tools/battle/phone.mts';
import { streamSize } from '../tools/battle/record-command.mts';
import { Screen, type Feed } from '../tools/battle/screen.mts';
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
  const lost = (error: unknown) => new Error(`shell: ${said(error)}; is the phone still connected?`);

  const held = holdShell(
    {
      write: (text) => void writer.write(encoder.encode(text)).catch((error: unknown) => held.fail(lost(error))),

      // Killed rather than left to exit on its stdin ending: it is closed only once a run is over and nothing more is
      // to be sent, and the touchscreen goes with it either way.
      end: () => process.kill(),
      kill: () => process.kill(),
    },
    'shell',
  );

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
 *
 * Its screen is watched through `watch`: WebCodecs' `feed`, or in a test one decoding with `ffmpeg`, Node having none.
 */
export async function battlePhone(
  connection: Pick<Connection, 'transport' | 'spawn'>,
  watch: (connection: Pick<Connection, 'spawn'>, size: Size) => Feed = feed,
): Promise<Phone & { close(): void; failed: Promise<Error> }> {
  // Shell commands through the shell held open, as `pnpm battle` sends them, and the screenshot a process of its own.
  const held = await heldShell(connection);
  const transport = { ...connection.transport, shell: held.shell };
  const device = new Device(transport);
  let screen: Screen | undefined;
  let closed = false;

  const close = () => {
    closed = true;
    screen?.close();
    held.close();
  };

  const shellEnded = held.ended.then((why) =>
    closed
      ? new Promise<never>(() => {})
      : new Error(`the phone's shell ended${why ? `: ${why}` : ''}; is the phone still connected?`),
  );

  try {
    // A screenshot for the screen's size, which the stream takes its shape from.
    const size = streamSize(await device.screenshot());
    const shown = new Screen(() => watch(connection, size));
    screen = shown;
    const touch = await touchscreen(transport);
    await shown.first();

    return { ...phoneOf(shown, device, touch), close, failed: Promise.race([shown.failed, shellEnded]) };
  } catch (error) {
    close();
    throw error;
  }
}
