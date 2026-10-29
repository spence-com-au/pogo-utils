/**
 * The phone's screen as a live picture, which is what a battle needs and a screenshot cannot give: `adb exec-out
 * screencap` takes 0.8–1.9s a frame on a Pixel 4 XL, against a PvP turn of 0.5s. `screenrecord` sends H.264 instead,
 * 30 frames a second, and `ffmpeg` decodes it here into the same `Image` the inventory readers take.
 *
 * `decodeFrames` is the half that knows nothing of the phone, so a test can hand it a recording off disk and exercise
 * the very decoder a battle runs on. `Screen` is the half that does: it keeps one recording going after another and
 * answers the latest frame.
 */

import { type Image } from '../inventory/png.mts';
import { type Size } from './layout.mts';
import { RECORD_LIMIT_S, recordCommand } from './record-command.mts';
import { spawn, type ChildProcess } from 'node:child_process';
import { type Readable } from 'node:stream';

/**
 * When the next recording starts, in milliseconds after the last. Short of `RECORD_LIMIT_S` by enough for it to have
 * sent its first frame before the old one stops — two at once were measured both running whole.
 */
const SEGMENT_MS = (RECORD_LIMIT_S - 10) * 1000;

/** A process writing H.264 to its stdout, and why it stopped to its stderr. */
export type Recording = ChildProcess & { stdout: Readable; stderr: Readable };

/** `adb` addressed at one phone, or at the only one plugged in. */
const adbArgs = (serial: string | undefined, ...args: string[]) => [...(serial ? ['-s', serial] : []), ...args];

/**
 * `screenrecord` writing H.264 to its stdout, for `seconds`. Its stdout carries nothing else — `exec-out` keeps stderr
 * apart, where `shell` would merge it — so whatever arrives decodes.
 */
export function screenrecord(serial: string | undefined, size: Size, seconds = RECORD_LIMIT_S): Recording {
  return spawn('adb', adbArgs(serial, 'exec-out', ...recordCommand(size, seconds)), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Each frame of an H.264 stream as it is decoded, ending with the stream. The flags are for latency: by default
 * `ffmpeg` probes a few seconds of input before it decodes any, and frame threading holds frames back to decode them
 * side by side, either of which puts the picture behind the battle it shows. Threading is turned off twice, since
 * `-threads` before `-i` reaches only the decoder, and the `rawvideo` encoder's threading would hold each frame until
 * the next. `-fflags nobuffer` is the one that reads as if it belongs with them and does not: it dropped 28 of the
 * first 30 frames of a recording off the phone. A frame still comes out only once the next has begun, `ffmpeg` finding
 * where a picture ends from the start of the one after it.
 */
export async function* decodeFrames(h264: Readable, { width, height }: Size): AsyncGenerator<Image> {
  const ffmpeg = spawn(
    'ffmpeg',
    [
      ...['-loglevel', 'error', '-flags', 'low_delay', '-probesize', '32', '-threads', '1'],
      ...['-f', 'h264', '-i', 'pipe:0'],
      ...['-threads', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, 'pipe:1'],
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );

  let stderr = '';
  ffmpeg.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

  // Resolved with the error rather than rejected: nothing awaits this until the frames stop, and a rejection waiting
  // that long — `ffmpeg` missing from `PATH` rejects at once — is unhandled, and ends the process before it is heard.
  const exited = new Promise<number | null | Error>((resolve) => {
    ffmpeg.once('error', resolve);
    ffmpeg.once('close', resolve);
  });

  // Ended rather than piped through `pipe`'s own `end`, so that a source destroyed mid-stream — a recording `Screen`
  // has stopped — still lets `ffmpeg` flush what it has and exit, rather than leaving it waiting on a stdin nobody ends.
  h264.on('error', () => ffmpeg.stdin.end());
  h264.on('close', () => ffmpeg.stdin.end());
  ffmpeg.stdin.on('error', () => {});
  h264.pipe(ffmpeg.stdin);

  const size = width * height * 4;

  // Each chunk is copied straight into its frame, so a frame costs one allocation and one copy. Memory allocated outside
  // V8's heap is what brings on its full collections, about one for each 64 MB, so at thirty frames a second every
  // further megabyte a frame is another full collection every two seconds.
  let frame = new Uint8Array(size);
  let filled = 0;

  try {
    for await (const chunk of ffmpeg.stdout as AsyncIterable<Buffer>) {
      for (let at = 0; at < chunk.length;) {
        const taken = Math.min(size - filled, chunk.length - at);
        frame.set(chunk.subarray(at, at + taken), filled);
        filled += taken;
        at += taken;

        if (filled === size) {
          yield { width, height, data: frame };
          frame = new Uint8Array(size);
          filled = 0;
        }
      }
    }
  } finally {
    ffmpeg.kill();
  }

  const code = await exited;

  if (code instanceof Error) {
    throw new Error(`ffmpeg failed: ${code.message}`);
  }

  // A signal is `null`, and is `ffmpeg` being stopped rather than failing.
  if (code !== 0 && code !== null) {
    throw new Error(`ffmpeg exited ${code}: ${stderr.trim() || 'no output'}`);
  }
}

/** The latest frame and when it arrived, by `performance.now()`. */
export interface Frame {
  image: Image;
  at: number;
}

/**
 * The phone's screen, kept current. One recording runs at a time but for the moment the next takes over, which starts
 * `SEGMENT_MS` after the last and stops it on its first frame, so a battle longer than `RECORD_LIMIT_S` — a Team Leader
 * fight can run to four minutes — is watched without a gap.
 *
 * `latest` is the frame most recently decoded, and can be old: `screenrecord` encodes a frame only when the screen has
 * changed, so a screen standing still sends nothing. A caller asks whether what it shows has changed, not how long
 * since a frame came.
 */
export class Screen {
  readonly #record: () => Recording;
  readonly #size: Size;
  readonly #segmentMs: number;
  #latest: Frame | undefined;
  #failure: Error | undefined;
  #current: Recording | undefined;
  #timer: NodeJS.Timeout | undefined;
  #closed = false;

  /**
   * Every recording still running, which `close` stops. The one `latest` answers from is not enough: through a
   * hand-over its successor is running too, unadopted until its first frame.
   */
  readonly #running = new Set<Recording>();

  /** How many recordings have started, and which of them is the one `latest` answers from. */
  #started = 0;
  #live = 0;

  /**
   * `record` is `screenrecord` in a battle, and anything else that writes H.264 to its stdout in a test, at `size`.
   */
  constructor(record: () => Recording, size: Size, segmentMs = SEGMENT_MS) {
    this.#record = record;
    this.#size = size;
    this.#segmentMs = segmentMs;
    this.#start();
  }

  /** The most recent frame, or `undefined` before the first. Throws once a recording has failed. */
  latest(): Frame | undefined {
    if (this.#failure) {
      throw this.#failure;
    }

    return this.#latest;
  }

  /** The first frame, which a recording that will not start never sends. */
  async first(timeoutMs = 10_000): Promise<Frame> {
    const until = performance.now() + timeoutMs;

    while (performance.now() < until) {
      const frame = this.latest();

      if (frame) {
        return frame;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(`no frame from the phone in ${timeoutMs / 1000}s`);
  }

  close(): void {
    this.#closed = true;
    clearTimeout(this.#timer);

    for (const recording of this.#running) {
      recording.kill();
    }
  }

  #start(): void {
    const recording = this.#record();
    const generation = ++this.#started;
    let stderr = '';

    // A process that could not start — `adb` missing from `PATH` — says so only through `error`, which unheard is an
    // uncaught exception. Heard, it is the reason the recording ended, its streams having closed empty.
    let unstarted: Error | undefined;
    recording.once('error', (error) => (unstarted = error));

    this.#running.add(recording);
    recording.once('close', () => this.#running.delete(recording));
    recording.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    this.#timer = setTimeout(() => this.#start(), this.#segmentMs);

    // Taking over only ever forwards, by `generation`: the old recording goes on sending frames for as long as its kill
    // takes, and one of those must not hand the screen back to it.
    const decoded = (async () => {
      for await (const image of decodeFrames(recording.stdout, this.#size)) {
        if (this.#closed) {
          recording.kill();
          break;
        }

        if (generation > this.#live) {
          this.#current?.kill();
          this.#current = recording;
          this.#live = generation;
        }

        if (generation === this.#live) {
          this.#latest = { image, at: performance.now() };
        }
      }
    })();

    // The newest recording ending is a failure: the phone unplugged, `adb` gone, or `screenrecord` refusing, which it
    // does with exit 0 and the reason on stderr. An older one ending is not, a successor having started — it is the
    // limit, met while the successor is still starting. What the recording itself said is the reason before `ffmpeg`'s,
    // which for a recording that sent nothing only says that there was nothing to decode.
    decoded
      .catch((error: unknown) => error)
      .then((error) => {
        if (!this.#closed && generation === this.#started) {
          const reason =
            unstarted?.message ||
            stderr.trim() ||
            (error instanceof Error ? error.message : 'it stopped sending frames');
          this.#failure = new Error(`screen recording ended: ${reason}`);
          this.close();
        }
      });

    if (!this.#current) {
      this.#current = recording;
      this.#live = generation;
    }
  }
}
