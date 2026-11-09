/**
 * The demo battle the site publishes, played as the battle's Worker plays it — the demo phone, `battlePhone` over it,
 * the battle loop and the WebAssembly Tesseract — with `ffmpeg` decoding where WebCodecs would: what passes here is the
 * Training battle a reader with no phone watches, won, as it was when recorded.
 *
 * It is played on a clock of its own, which moves only as the loop sleeps or waits on the phone, rather than at the 30
 * pictures a second it was recorded at: the battle goes the same on a machine busy with other work as on an idle one,
 * and as fast as the machine can decode and read it.
 *
 * Its clip is checked too: small enough to publish, at the stream's size, and with what a decoder joining at any key
 * picture needs, the demo phone's screen joining wherever the recording has got to.
 */

import { afterAll, expect, test } from 'vitest';

import { DEMO_BATTLE } from '../generated.js';
import type { Phone as Connection } from '../inventory/webusb.js';
import { fixture } from '../testing/fixture.js';
import { type GameData } from '../tools/inventory/game-master.mts';
import { useEngine } from '../tools/inventory/ocr.mts';
import { tesseractWasm } from '../tools/inventory/ocr-wasm.mts';
import { type Image } from '../tools/inventory/png.mts';
import { type Size } from '../tools/battle/layout.mts';
import { type Phone } from '../tools/battle/phone.mts';
import { Pictures, type Picture } from '../tools/battle/pictures.mts';
import { decodeArgs, recordCommand } from '../tools/battle/record-command.mts';
import { run, type Clock } from '../tools/battle/run.mts';
import { type Feed } from '../tools/battle/screen.mts';
import { demoConnection } from './demo.js';
import { codecOf } from './feed.js';
import { battlePhone } from './phone.js';

/** What of `node:child_process` is used. */
interface ChildProcess {
  execFileSync(command: string, args: readonly string[]): Uint8Array;
  spawn(
    command: string,
    args: readonly string[],
  ): {
    stdin: { write(bytes: Uint8Array): boolean; end(): void };
    stdout: AsyncIterable<Uint8Array>;
    kill(): boolean;
  };
}

/** What of Node is used, had from `process` as `fixture` has `node:fs`, this project having no Node. */
interface Node {
  getBuiltinModule(id: 'node:child_process'): ChildProcess;
  getBuiltinModule(id: 'node:timers/promises'): { setImmediate(): Promise<void> };
}

const node = (globalThis as unknown as { process: Node }).process;
const { execFileSync, spawn } = node.getBuiltinModule('node:child_process');
const { setImmediate } = node.getBuiltinModule('node:timers/promises');

/**
 * How long what the demo phone does takes on the battle's clock, in milliseconds, which is all the loop sees however
 * long the machine takes. An OCR read takes as long as `run.test.mts` gives one, about what a band of a battle's frame
 * took here, 29 to 42ms on average by its size. A screenshot takes a second, as there, though here one took 180ms:
 * each is decoded and read for real, so the fewer the loop takes, the sooner the battle is done. A touch takes as long
 * as `heldShell`'s `echo` on a Pixel 8 Pro, and a swipe as long as it is, as a phone's shell waits it out.
 */
const OCR_MS = 35;
const SCREENSHOT_MS = 1000;
const TOUCH_MS = 3;

const output = (command: string, ...args: string[]) => new TextDecoder().decode(execFileSync(command, args)).trim();

const CLIP = new URL(`../../${DEMO_BATTLE.clip}`, import.meta.url);
const H264 = fixture(CLIP);

const DATA = JSON.parse(
  new TextDecoder().decode(fixture(new URL('../tools/inventory/fixtures/game-master.json', import.meta.url))),
) as GameData;

/** The clip's picture size, which `ffmpeg` puts its frames out at. */
const SIZE = ((): Size => {
  const [width = 0, height = 0] = output(
    'ffprobe',
    ...['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0'],
    decodeURIComponent(CLIP.pathname),
  )
    .split(',')
    .map(Number);

  return { width, height };
})();

/** What `decode` tells of how far it has got: each picture handed to `ffmpeg`, each frame taken off it, and its end. */
interface Progress {
  wrote(): void;
  took(): void;
  ended(): void;
}

/**
 * Each frame of `h264` as `ffmpeg` decodes it, with the flags `pnpm battle` decodes a recording with, so that each
 * comes out as soon as the picture after it has begun rather than once `ffmpeg` has buffered a few.
 */
async function* decode(h264: ReadableStream<Uint8Array>, progress?: Progress): AsyncGenerator<Image> {
  const ffmpeg = spawn('ffmpeg', decodeArgs(SIZE));

  void (async () => {
    const reader = h264.getReader();

    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      ffmpeg.stdin.write(read.value);
      progress?.wrote();
    }

    ffmpeg.stdin.end();
  })().catch(() => ffmpeg.kill());

  // Each frame filled in place as its bytes come, so that each is copied once: a frame is 1.2 MB, which the pipe hands
  // over 64 KB at a time.
  const length = SIZE.width * SIZE.height * 4;
  let frame = new Uint8Array(length);
  let filled = 0;

  try {
    for await (const chunk of ffmpeg.stdout) {
      for (let at = 0; at < chunk.length;) {
        const part = chunk.subarray(at, at + length - filled);
        frame.set(part, filled);
        filled += part.length;
        at += part.length;

        if (filled === length) {
          yield { ...SIZE, data: frame };
          progress?.took();
          frame = new Uint8Array(length);
          filled = 0;
        }
      }
    }
  } finally {
    ffmpeg.kill();
    progress?.ended();
  }
}

/** `screenrecord` on `connection` decoded by `ffmpeg`, as `feed` decodes it by WebCodecs, telling `progress`. */
function watch(connection: Pick<Connection, 'spawn'>, size: Size, progress: Progress): Feed {
  const spawned = connection.spawn(recordCommand(size));

  return {
    frames: (async function* () {
      yield* decode((await spawned).stdout, progress);
    })(),
    reason: () => undefined,
    stop: () => void spawned.then((process) => process.kill()),
  };
}

/**
 * The clock a battle on the demo phone is played by, which moves only as the loop sleeps, or as it waits on the phone
 * with nothing else to move it. What takes time on a phone — a screenshot, an OCR read, a touch — is handed back once
 * the clock reaches when it is due, the clock waiting there for the machine to have done it, and each picture of the
 * screen is sent as its time is passed and decoded before the loop looks again. So what the loop sees, and when, is the
 * same however busy the machine is.
 *
 * `run` is the loop's clock and `screen` the demo phone's, by which its recording waits for each picture's time.
 */
function paced() {
  let time = 0;

  // What is due, handed back in order of when and then of asking. A picture is never what the clock moves on to of
  // itself, there being always another after it: the recording would play through as fast as it decoded.
  const due: { at: number; picture: boolean; deliver: () => unknown }[] = [];

  // Each recording's decoding: a frame comes out of `ffmpeg` once the picture after it has gone in, so it has caught up
  // at one frame taken fewer than the pictures written.
  const decoders = new Set<{ written: number; taken: number; wake: () => void }>();

  // The moves under way or waiting their turn, one at a time, and how many have been asked for.
  let moving = Promise.resolve();
  let queued = 0;
  let moves = 0;

  const first = (until: number, picture: boolean) =>
    due.filter((work) => work.at <= until && (picture || !work.picture)).sort((a, b) => a.at - b.at)[0];

  async function caughtUp() {
    await setImmediate();

    for (const decoder of decoders) {
      while (decoders.has(decoder) && decoder.taken < decoder.written - 1) {
        await new Promise<void>((resolve) => (decoder.wake = resolve));
      }
    }
  }

  // Each thing due by then, in turn, and whatever follows on from it before the next. What is waiting on something
  // other than a picture goes on as soon as that is handed back, and may look at the screen, so the screen has caught
  // up first.
  function advance(ms: number): Promise<void> {
    moves++;
    queued++;

    moving = moving.then(async () => {
      const until = time + ms;

      for (let work = first(until, true); work; work = first(until, true)) {
        due.splice(due.indexOf(work), 1);
        time = Math.max(time, work.at);

        if (!work.picture) {
          await caughtUp();
        }

        await work.deliver();
        await setImmediate();
      }

      time = until;
      await caughtUp();
      queued--;
      idle();
    });

    return moving;
  }

  // A loop waiting on the phone, with nothing else to move the clock, has it move on to the next thing due.
  function idle() {
    const at = moves;

    void setImmediate().then(() => {
      const next = first(Infinity, false);

      if (moves === at && queued === 0 && next) {
        void advance(next.at - time);
      }
    });
  }

  return {
    run: { now: () => time, sleep: advance } satisfies Clock,
    screen: {
      now: () => time,
      sleep: (ms: number) =>
        new Promise<void>((resolve) => due.push({ at: time + ms, picture: true, deliver: resolve })),
    } satisfies Clock,

    /** `work`, handed back `ms` from now. */
    takes<T>(ms: number, work: Promise<T>): Promise<T> {
      // Failing before it is due, it fails where it is handed back rather than as a rejection nothing handles.
      work.catch(() => {});

      return new Promise((resolve, reject) => {
        due.push({ at: time + ms, picture: false, deliver: () => work.then(resolve, reject) });
        idle();
      });
    },

    /** The `Progress` of a recording's decoding, which the clock waits on to have caught up. */
    decoding(): Progress {
      const decoder = { written: 0, taken: 0, wake: () => {} };
      decoders.add(decoder);

      return {
        wrote: () => void decoder.written++,
        took: () => {
          decoder.taken++;
          decoder.wake();
        },
        ended: () => {
          decoders.delete(decoder);
          decoder.wake();
        },
      };
    },
  };
}

const engine = tesseractWasm({
  langPath: /"([^"]+)"/.exec(output('tesseract', '--list-langs'))?.[1] ?? '',
  workers: 4,
  cache: false,
});

afterAll(() => engine.terminate());

test('is no more than 5 MB at the stream size, each key picture with what a decoder joining there needs', () => {
  const pictures: Picture[] = [];
  const cut = new Pictures((picture) => pictures.push(picture));
  cut.push(H264, 0);
  cut.end();

  expect(H264.length).toBeLessThanOrEqual(5_000_000);
  expect(SIZE.width).toBe(360);
  expect(pictures[0]?.key).toBe(true);
  expect(pictures.filter(({ key }) => key).every(({ bytes }) => codecOf(bytes) !== null)).toBe(true);
});

// However long it takes, the battle is the same, so the timeout is only for one that hangs: it took some 20s on an idle
// machine, and 160s beside twice as many busy processes as the machine had cores.
test('plays a Training battle through to a win', { timeout: 300_000 }, async () => {
  const clock = paced();
  useEngine({ tsv: (...read) => clock.takes(OCR_MS, engine.tsv(...read)) });

  const demo = demoConnection(H264, DEMO_BATTLE.fps, decode, clock.screen);
  const connection: Connection = {
    ...demo,
    transport: { ...demo.transport, screencap: () => clock.takes(SCREENSHOT_MS, demo.transport.screencap()) },
  };

  // A hold is left as `battlePhone` makes it, waiting out its panel by the machine's clock: the demo battle makes none.
  const held = await battlePhone(connection, (reached, size) => watch(reached, size, clock.decoding()));
  const phone: Phone = {
    ...held,
    tap: (at) => clock.takes(TOUCH_MS, held.tap(at)),
    swipe: (from, to, ms) => clock.takes(ms, held.swipe(from, to, ms)),
    search: (text) => clock.takes(TOUCH_MS, held.search(text)),
    views: () => clock.takes(TOUCH_MS, held.views()),
  };
  const told: string[] = [];

  try {
    const mode = { mode: 'training', leader: DEMO_BATTLE.leader, league: DEMO_BATTLE.league } as const;
    const tally = await run(phone, { mode, data: DATA, icons: [], typeIcons: {}, count: 1 }, clock.run, {
      event: (line) => told.push(line),
      status: () => {},
    });

    expect(tally, told.join('\n')).toEqual({ battles: 1, won: 1, lost: 0 });
  } finally {
    held.close();
    await connection.close();
  }
});
