/**
 * The phone's screen kept current out of one `screenrecord` after another, however each is run and decoded: `pnpm
 * battle` runs it under the `adb` binary and decodes with `ffmpeg`, in `stream.mts`, and a page runs it over WebUSB and
 * decodes with WebCodecs, in `src/battle/feed.ts`. Each hands `Screen` a `Feed`, which is all it knows of either.
 */

import { type Image } from '../inventory/png.mts';
import { RECORD_LIMIT_S } from './record-command.mts';

/**
 * When the next recording starts, in milliseconds after the last. Short of `RECORD_LIMIT_S` by enough for it to have
 * sent its first frame before the old one stops — two at once were measured both running whole.
 */
const SEGMENT_MS = (RECORD_LIMIT_S - 10) * 1000;

/** One recording, as `Screen` watches it. */
export interface Feed {
  /** Each frame as it is decoded, ending with the recording, or throwing where decoding it failed. */
  frames: AsyncIterable<Image>;

  /** Why the recording ended, in its own words — `screenrecord`'s stderr, or why it never started — where it gave any. */
  reason(): string | undefined;
  stop(): void;
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
  readonly #record: () => Feed;
  readonly #segmentMs: number;
  #latest: Frame | undefined;
  #failure: Error | undefined;
  #current: Feed | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;

  /**
   * Every recording still running, which `close` stops. The one `latest` answers from is not enough: through a
   * hand-over its successor is running too, unadopted until its first frame.
   */
  readonly #running = new Set<Feed>();

  /** How many recordings have started, and which of them is the one `latest` answers from. */
  #started = 0;
  #live = 0;

  /** `record` starts a recording: `screenrecord` in a battle, and anything else that sends frames in a test. */
  constructor(record: () => Feed, segmentMs = SEGMENT_MS) {
    this.#record = record;
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

    for (const feed of this.#running) {
      feed.stop();
    }
  }

  #start(): void {
    const feed = this.#record();
    const generation = ++this.#started;

    this.#running.add(feed);
    this.#timer = setTimeout(() => this.#start(), this.#segmentMs);

    // Taking over only ever forwards, by `generation`: the old recording goes on sending frames for as long as its stop
    // takes, and one of those must not hand the screen back to it.
    const decoded = (async () => {
      for await (const image of feed.frames) {
        if (this.#closed) {
          feed.stop();
          break;
        }

        if (generation > this.#live) {
          this.#current?.stop();
          this.#current = feed;
          this.#live = generation;
        }

        if (generation === this.#live) {
          this.#latest = { image, at: performance.now() };
        }
      }
    })();

    // The newest recording ending is a failure: the phone unplugged, `adb` gone, or `screenrecord` refusing, which it
    // does with exit 0 and the reason on stderr. An older one ending is not, a successor having started — it is the
    // limit, met while the successor is still starting. What the recording itself said is the reason before the
    // decoder's, which for a recording that sent nothing only says that there was nothing to decode. Stopped either way,
    // since a decoder that failed can leave its recording still sending into nothing.
    decoded
      .catch((error: unknown) => error)
      .then((error) => {
        feed.stop();
        this.#running.delete(feed);

        if (!this.#closed && generation === this.#started) {
          const reason = feed.reason() || (error instanceof Error ? error.message : 'it stopped sending frames');
          this.#failure = new Error(`screen recording ended: ${reason}`);
          this.close();
        }
      });

    if (!this.#current) {
      this.#current = feed;
      this.#live = generation;
    }
  }
}
