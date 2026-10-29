/**
 * Stand-ins for what a page's battle reaches and a test cannot: the WebCodecs decoder, which Node has none of, and the
 * phone over WebUSB, as a `Connection` whose shell answers the commands the touchscreen sends and whose `screenrecord`
 * sends the H.264 it is given.
 */

import type { Phone as Connection, Process } from '../inventory/webusb.js';
import { encodePng } from '../tools/inventory/png.mts';

/**
 * A `VideoDecoder` that puts out one frame for each picture it is handed, the frame's first byte its count, and keeps
 * what it was configured with, what it was handed and whether each frame was closed. Installed in place of the global
 * by a test, with `FakeChunk` for `EncodedVideoChunk`.
 */
export class FakeDecoder {
  static made: FakeDecoder[] = [];

  /** Whether each picture handed over fails, as a decoder fails on a stream it cannot read. */
  static failing = false;

  readonly #output: (frame: VideoFrame) => void;
  readonly #error: (error: DOMException) => void;
  config: VideoDecoderConfig | undefined;
  chunks: string[] = [];
  frames: { closed: boolean }[] = [];
  state = 'unconfigured';

  constructor({ output, error }: VideoDecoderInit) {
    this.#output = output;
    this.#error = error;
    FakeDecoder.made.push(this);
  }

  configure(config: VideoDecoderConfig): void {
    this.config = config;
    this.state = 'configured';
  }

  decode({ type }: FakeChunk): void {
    const count = this.chunks.push(type);

    if (FakeDecoder.failing) {
      queueMicrotask(() => this.#error(new DOMException('cannot decode this', 'EncodingError')));
      return;
    }

    const frame = { closed: false };
    this.frames.push(frame);

    queueMicrotask(() =>
      this.#output({
        displayWidth: 360,
        displayHeight: 760,
        copyTo: (data: Uint8Array) => {
          data[0] = count & 0xff;
          return Promise.resolve([]);
        },
        close: () => (frame.closed = true),
      } as unknown as VideoFrame),
    );
  }

  flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  close(): void {
    this.state = 'closed';
  }
}

export class FakeChunk {
  readonly type: string;

  constructor({ type }: { type: string }) {
    this.type = type;
  }
}

/** A stream that sends what `send` is handed, until `end`, and nothing after: a process gone answers nothing. */
function stream() {
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
 * A phone reached as over WebUSB, named `name`: its screen the shape of a Pixel 4 XL's, its `screenrecord` sending
 * `h264` and then nothing until killed, and its held `sh` answering each command as a phone's shell would — `dumpsys
 * input` with the touchscreen listed, anything else with nothing — keeping each command it was sent, each write that
 * carried one and each process it started. A command run as a process of its own, as the settings are, is kept in
 * `ran`, and `settings get` answers `settings` holds, which `settings put` changes. Its connection being let go is
 * told to `log`.
 */
export function fakeConnection(name: string, h264: Uint8Array, log: string[] = []) {
  const commands: string[] = [];
  const ran: string[] = [];
  const settings = new Map([['stay_on_while_plugged_in', '0']]);
  const writes: string[] = [];
  const spawned: string[] = [];
  const killed: string[] = [];
  const processes: Process[] = [];
  let closed = () => {};
  let unplugged: (error: Error) => void = () => {};

  const disconnected = new Promise<void>((resolve, reject) => {
    closed = resolve;
    unplugged = reject;
  });

  const shell = (): Process => {
    const out = stream();
    const decoder = new TextDecoder();
    let pending = '';

    // A command, then the marker `holdShell` has the shell echo with its status, answered once both have come.
    const stdin = new WritableStream<Uint8Array>({
      write(chunk) {
        const text = decoder.decode(chunk);
        writes.push(text);
        pending += text;

        for (let match; (match = /([^\n]*)\ns=\$\?; echo "\n(\S+) \$s"\n/.exec(pending));) {
          const [whole, command = '', marker = ''] = match;
          pending = pending.slice(match.index + whole.length);
          commands.push(command);
          out.send(new TextEncoder().encode(`${command === 'dumpsys input' ? LISTED : ''}\n${marker} 0\n`));
        }
      },
    });

    return {
      stdin,
      stdout: out.readable,
      stderr: stream().readable,
      kill: () => {
        killed.push('sh');
        out.end();
      },
    };
  };

  const recording = (): Process => {
    const out = stream();
    const err = stream();
    out.send(h264);

    return {
      stdin: new WritableStream(),
      stdout: out.readable,
      stderr: err.readable,
      kill: () => {
        killed.push('screenrecord');
        out.end();
        err.end();
      },
    };
  };

  const connection: Connection = {
    name,
    serial: name,
    transport: {
      state: () => Promise.resolve('device'),
      shell: (command) => {
        const [verb, action, , key = '', value = ''] = command;
        ran.push(command.join(' '));

        if (verb === 'settings' && action === 'put') {
          settings.set(key, value);
        }

        return Promise.resolve(
          new TextEncoder().encode(verb === 'settings' && action === 'get' ? `${settings.get(key) ?? 'null'}\n` : ''),
        );
      },
      screencap: () => Promise.resolve(encodePng({ width: 144, height: 304, data: new Uint8Array(144 * 304 * 4) })),
    },
    spawn: (command) => {
      const process = command[0] === 'sh' ? shell() : recording();
      spawned.push(command.join(' '));
      processes.push(process);

      return Promise.resolve(process);
    },
    close: () => {
      log.push(`${name} let go`);
      closed();

      return Promise.resolve();
    },
    disconnected,
  };

  return {
    connection,
    commands,
    ran,
    settings,
    writes,
    spawned,
    processes,
    killed,
    unplug: (error: Error) => unplugged(error),
  };
}
