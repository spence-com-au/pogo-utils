/**
 * The demo phone as the battle's Worker reaches it, in place of one over WebUSB: its screen a recorded Training battle
 * played round and round from the moment it is reached, and its shell answering what `battlePhone` and `keepAwake` ask
 * while touching nothing. The battle loop plays it as it would a phone, its taps landing nowhere, and the recording,
 * being of the loop's own battle, goes on as if they had landed.
 *
 * The recording is H.264 at a constant `fps`, which raw H.264 has no way to say, so each picture is sent when its
 * place in the recording comes round. A screenshot is the picture showing then, decoded from the key picture before
 * it: the screen at the stream's size, which the menus read as they read a full-size screenshot.
 */

import type { Phone as Connection, Process } from '../inventory/webusb.js';
import { DEMO_SERIAL } from '../phone-store.js';
import { Pictures, type Picture } from '../tools/battle/pictures.mts';
import { encodePng, type Image } from '../tools/inventory/png.mts';

/** A stream that sends what `send` is handed, until `end`, and nothing after: a process gone answers nothing. */
export function stream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let ended = false;
  const readable = new ReadableStream<Uint8Array>({ start: (started) => void (controller = started) });

  return {
    readable,
    send: (bytes: Uint8Array) => ended || controller.enqueue(bytes),
    end: () => {
      if (!ended) {
        ended = true;
        controller.close();
      }
    },
  };
}

/** `dumpsys input` listing the touchscreen as one, which is all `touchscreen` reads of it. */
const LISTED = '  Device 5: pogo-utils touch\n    Sources: 0x00001002\n';

/**
 * `sh` as `heldShell` holds it open, answering each command as a phone's shell would — `dumpsys input` with the
 * touchscreen listed, anything else with nothing and a clean exit — and telling `heard` of each write and each
 * command it carried. Killed, it ends.
 *
 * Each answer comes a turn of the event loop later, as a phone's comes back over USB. Answered at once, a tap would
 * settle on promises alone, and the battle loop, which taps on frame after frame with no sleep between, would never
 * let a timer run: the demo's screen, sent by timers, stood still on the battle's first frame, and so did the loop.
 */
export function answeringShell(heard: { write?(text: string): void; command?(command: string): void } = {}): Process {
  const out = stream();
  const decoder = new TextDecoder();
  let pending = '';

  // A command, then the marker `holdShell` has the shell echo with its status, answered once both have come.
  const stdin = new WritableStream<Uint8Array>({
    write(chunk) {
      const text = decoder.decode(chunk);
      heard.write?.(text);
      pending += text;

      for (let match; (match = /([^\n]*)\ns=\$\?; echo "\n(\S+) \$s"\n/.exec(pending));) {
        const [whole, command = '', marker = ''] = match;
        pending = pending.slice(match.index + whole.length);
        heard.command?.(command);
        const answer = new TextEncoder().encode(`${command === 'dumpsys input' ? LISTED : ''}\n${marker} 0\n`);
        setTimeout(() => out.send(answer), 0);
      }
    },
  });

  return { stdin, stdout: out.readable, stderr: stream().readable, kill: () => out.end() };
}

/**
 * A command run as a process of its own, answered from `settings` as Android answers `settings get` and `put`, and
 * anything else with nothing.
 */
export function settingsShell(settings: Map<string, string>) {
  return (command: readonly string[]): Promise<Uint8Array> => {
    const [verb, action, , key = '', value = ''] = command;

    if (verb === 'settings' && action === 'put') {
      settings.set(key, value);
    }

    return Promise.resolve(
      new TextEncoder().encode(verb === 'settings' && action === 'get' ? `${settings.get(key) ?? 'null'}\n` : ''),
    );
  };
}

/**
 * The demo phone, its screen `clip` played at `fps` from now, by `now`, and its screenshots decoded by `decode`:
 * WebCodecs in the Worker, `ffmpeg` in a test.
 */
export function demoConnection(
  clip: Uint8Array,
  fps: number,
  decode: (h264: ReadableStream<Uint8Array>) => AsyncIterable<Image>,
  now: () => number = () => performance.now(),
): Connection {
  const pictures: Picture[] = [];
  const cut = new Pictures((picture) => pictures.push(picture));
  cut.push(clip, 0);
  cut.end();

  // Played round from its first picture, which a decoder starting there has to be able to start from.
  if (!pictures[0]?.key) {
    throw new Error('the demo battle does not open on a key picture');
  }

  const period = 1000 / fps;
  const start = now();
  const tick = () => Math.floor((now() - start) / period);

  /** The pictures a decoder joining at `tick` needs, from the key picture before it, sent at once as a phone's are. */
  const joining = (at: number) => {
    let key = at % pictures.length;

    while (!pictures[key]?.key) {
      key--;
    }

    return pictures.slice(key, (at % pictures.length) + 1);
  };

  const recordings = new Set<() => void>();

  /** `screenrecord`, from the picture showing now, then each as its time comes, until killed. */
  const recording = (): Process => {
    const out = stream();
    let at = tick();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const send = () => {
      out.send(pictures[at % pictures.length]?.bytes ?? new Uint8Array());
      at++;
      timer = setTimeout(send, start + at * period - now());
    };

    joining(at++).forEach(({ bytes }) => out.send(bytes));
    timer = setTimeout(send, start + at * period - now());

    const kill = () => {
      clearTimeout(timer);
      out.end();
      recordings.delete(kill);
    };

    recordings.add(kill);

    return { stdin: new WritableStream(), stdout: out.readable, stderr: stream().readable, kill };
  };

  let hangUp = () => {};
  const disconnected = new Promise<void>((resolve) => (hangUp = resolve));

  return {
    name: 'Demo phone',
    serial: DEMO_SERIAL,
    transport: {
      state: () => Promise.resolve('device'),
      shell: settingsShell(new Map([['stay_on_while_plugged_in', '0']])),
      screencap: async () => {
        const shown = joining(tick());
        let last: Image | undefined;

        const h264 = new ReadableStream<Uint8Array>({
          start: (controller) => {
            shown.forEach(({ bytes }) => controller.enqueue(bytes));
            controller.close();
          },
        });

        for await (const image of decode(h264)) {
          last = image;
        }

        if (last === undefined) {
          throw new Error('the demo battle decoded to nothing');
        }

        return encodePng(last);
      },
    },
    spawn: (command) =>
      command[0] === 'sh'
        ? Promise.resolve(answeringShell())
        : command[0] === 'screenrecord'
          ? Promise.resolve(recording())
          : Promise.reject(new Error(`the demo phone runs no ${command[0]}`)),
    close: () => {
      recordings.forEach((kill) => kill());
      hangUp();

      return Promise.resolve();
    },
    disconnected,
  };
}
