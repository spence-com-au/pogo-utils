/**
 * A touchscreen of `pnpm battle`'s own, made on the phone through `/dev/uhid` from the shell a `Transport` holds open:
 * each touch is a HID report written by the shell's `print` builtin, where `input tap` and `input swipe` start a Java
 * runtime on the phone for every command, about 20ms each. The phone's own touchscreen is no way in: SELinux refuses
 * the shell a write to `/dev/input/event*`, `sendevent`'s included, on a Pixel 4 XL with Android 13, but grants it
 * `/dev/uhid`, which Android's own `hid` command creates its test devices through.
 *
 * The kernel's `hid-multitouch` driver takes the device as a touchscreen, and Android maps its range over the whole
 * display, so a point is given as fractions of the screen, the same on every phone. The device lasts as long as the
 * shell holds `/dev/uhid` open: a shell gone with the connection takes it with it, along with any touch still down.
 */

import { type Transport } from './adb.mts';
import { setTimeout as sleep } from 'node:timers/promises';

/** What Android lists the device as in `dumpsys input`. */
const NAME = 'pogo-utils touch';

/** The shell's descriptor for the device's `/dev/uhid`, kept open between commands as `exec` leaves it. */
const FD = 3;

/**
 * A second descriptor for `/dev/uhid`, which makes no device and so is never given anything to read: what a swipe waits
 * on between moves, with `read -t`. The shell has no `sleep` of its own, `sleep` being a process of 14ms or so, and
 * `mkfifo` is refused it.
 */
const IDLE_FD = 4;

/** How long Android is given to take the device as a touchscreen: on a Pixel 4 XL, it had by the first look. */
const READY_MS = 3000;

/**
 * How often a swipe moves, in milliseconds: about a frame at 120Hz, so that no frame the game draws misses a move. The
 * phone keeps the time between moves, a swipe being one command and so one round trip: paced from the computer, a
 * round trip a move, a Training battle's swipes ran a p95 of 83ms over their 80ms.
 */
const MOVE_MS = 8;

/** The largest coordinate, both axes: what Android maps the right and bottom edges of the display to. */
const MAX = 0x7fff;

// One finger on a touch screen, as `hid-multitouch` reads one: its tip switch, its contact identifier and its X and Y,
// then how many contacts the report carries. No feature reports, so the driver asks the device nothing back.
// prettier-ignore
const DESCRIPTOR = [
  0x05, 0x0d, //       Usage Page (Digitizer)
  0x09, 0x04, //       Usage (Touch Screen)
  0xa1, 0x01, //       Collection (Application)
  0x85, 0x01, //         Report ID (1)
  0x09, 0x22, //         Usage (Finger)
  0xa1, 0x02, //         Collection (Logical)
  0x09, 0x42, //           Usage (Tip Switch)
  0x15, 0x00, //           Logical Minimum (0)
  0x25, 0x01, //           Logical Maximum (1)
  0x75, 0x01, //           Report Size (1)
  0x95, 0x01, //           Report Count (1)
  0x81, 0x02, //           Input (Data, Variable, Absolute)
  0x95, 0x07, //           Report Count (7)
  0x81, 0x03, //           Input (Constant): the rest of the byte
  0x09, 0x51, //           Usage (Contact Identifier)
  0x25, 0x0f, //           Logical Maximum (15)
  0x75, 0x08, //           Report Size (8)
  0x95, 0x01, //           Report Count (1)
  0x81, 0x02, //           Input (Data, Variable, Absolute)
  0x05, 0x01, //           Usage Page (Generic Desktop)
  0x26, 0xff, 0x7f, //     Logical Maximum (MAX)
  0x75, 0x10, //           Report Size (16)
  0x09, 0x30, //           Usage (X)
  0x81, 0x02, //           Input (Data, Variable, Absolute)
  0x09, 0x31, //           Usage (Y)
  0x81, 0x02, //           Input (Data, Variable, Absolute)
  0xc0, //               End Collection
  0x05, 0x0d, //         Usage Page (Digitizer)
  0x09, 0x54, //         Usage (Contact Count)
  0x25, 0x01, //         Logical Maximum (1)
  0x75, 0x08, //         Report Size (8)
  0x81, 0x02, //         Input (Data, Variable, Absolute)
  0xc0, //             End Collection
];

/** `struct uhid_event`'s types, from `linux/uhid.h`. */
const UHID_CREATE2 = 11;
const UHID_INPUT2 = 12;

/** `BUS_VIRTUAL`, from `linux/input.h`: not USB or Bluetooth, either of which Android takes for a device plugged in. */
const BUS_VIRTUAL = 0x06;

/** `UHID_CREATE2`: the name, physical path and unique ID, then the bus, IDs and the descriptor. */
export function create(): Uint8Array {
  const event = new Uint8Array(280 + DESCRIPTOR.length);
  const view = new DataView(event.buffer);

  view.setUint32(0, UHID_CREATE2, true);
  event.set(new TextEncoder().encode(NAME), 4);
  view.setUint16(260, DESCRIPTOR.length, true);
  view.setUint16(262, BUS_VIRTUAL, true);

  // pid.codes' test IDs, which are for exactly this: a device nobody sells.
  view.setUint32(264, 0x1209, true);
  view.setUint32(268, 0x0001, true);
  event.set(DESCRIPTOR, 280);

  return event;
}

/** `UHID_INPUT2` with the one report the descriptor describes: the finger `down` or not, at `[x, y]` in fractions. */
export function report(down: boolean, [x, y]: readonly [number, number]): Uint8Array {
  const event = new Uint8Array(14);
  const view = new DataView(event.buffer);
  const axis = (fraction: number) => Math.min(MAX, Math.max(0, Math.round(fraction * (MAX + 1))));

  view.setUint32(0, UHID_INPUT2, true);
  view.setUint16(4, 8, true);
  event.set([1, down ? 1 : 0, 0], 6);
  view.setUint16(9, axis(x), true);
  view.setUint16(11, axis(y), true);
  event[13] = 1;

  return event;
}

/**
 * A command writing `bytes` to the device in one `write`, as `/dev/uhid` takes an event: `print`'s `\0nnn` escapes for
 * every byte, single-quoted so that the shell passes them to it untouched.
 */
export function write(bytes: Uint8Array): string {
  return `print -nu${FD} '${[...bytes].map((byte) => `\\0${byte.toString(8).padStart(3, '0')}`).join('')}'`;
}

/**
 * A swipe as one command: down at `from`, then a move every `MOVE_MS` or so along the line to `to`, the last at `to`
 * once `ms` has passed, and up. Its status is that of the last write, which fails as every other would.
 */
export function swipe(from: readonly [number, number], to: readonly [number, number], ms: number): string {
  const steps = Math.max(1, Math.round(ms / MOVE_MS));
  const wait = `read -t ${(ms / steps / 1000).toFixed(4)} -u${IDLE_FD}`;
  const along = (done: number): [number, number] => [
    from[0] + (to[0] - from[0]) * done,
    from[1] + (to[1] - from[1]) * done,
  ];
  const moves = Array.from({ length: steps }, (_, step) => [wait, write(report(true, along((step + 1) / steps)))]);

  return [write(report(true, from)), ...moves.flat(), write(report(false, to))].join('; ');
}

/** Whether `dumpsys input` lists the device as a touchscreen, `AINPUT_SOURCE_TOUCHSCREEN` among its sources. */
export function listed(dump: string): boolean {
  const sources = new RegExp(`Device \\d+: ${NAME}\\n(?:[ \\t]+.*\\n)*?[ \\t]+Sources: 0x([0-9a-f]+)`).exec(dump)?.[1];

  return sources !== undefined && (parseInt(sources, 16) & 0x1002) === 0x1002;
}

export interface Touchscreen {
  /** Down and up at `at`, fractions of the screen across and down. */
  tap(at: readonly [number, number]): Promise<void>;

  /** Down at `from`, moved towards `to` over `ms`, and up there. */
  swipe(from: readonly [number, number], to: readonly [number, number], ms: number): Promise<void>;
}

/**
 * The touchscreen, made through `transport`'s shell, once Android has taken it as one. It is made on a shell held open
 * — on a process per command it would be gone as soon as made.
 */
export async function touchscreen(transport: Transport): Promise<Touchscreen> {
  const send = async (command: string) => void (await transport.shell([command]));

  // Behind `command`, so that a refused open leaves the shell to answer with why: a special builtin's failed
  // redirection ends a shell that isn't interactive, which would blame the cable.
  await send(`command exec ${FD}<>/dev/uhid ${IDLE_FD}<>/dev/uhid`).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);

    throw new Error(`the phone's shell could not open /dev/uhid for a touchscreen: ${reason}`);
  });

  await send(write(create()));

  for (const deadline = performance.now() + READY_MS; ;) {
    if (listed(new TextDecoder().decode(await transport.shell(['dumpsys', 'input'])))) {
      break;
    }

    if (performance.now() > deadline) {
      throw new Error(`Android has not taken ${NAME} as a touchscreen after ${READY_MS / 1000}s`);
    }

    await sleep(50);
  }

  return {
    tap: (at) => send(`${write(report(true, at))}; ${write(report(false, at))}`),
    swipe: (from, to, ms) => send(swipe(from, to, ms)),
  };
}
