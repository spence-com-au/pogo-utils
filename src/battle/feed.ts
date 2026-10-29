/**
 * `screenrecord` over WebUSB as the `Screen` in `src/tools/battle/screen.mts` watches one, decoded by WebCodecs where
 * `pnpm battle` decodes with `ffmpeg`: the H.264 is cut into pictures by `Pictures`, each handed to a `VideoDecoder`
 * whole, and each frame it puts out copied into the same `Image` the CLI's readers take. On a Pixel 8 Pro that was a
 * frame 5.4ms (p50) after its picture was submitted, at the 27.5 frames a second the phone sent.
 */

import type { Phone } from '../inventory/webusb.js';
import { type Size } from '../tools/battle/layout.mts';
import { Pictures } from '../tools/battle/pictures.mts';
import { recordCommand } from '../tools/battle/record-command.mts';
import { type Feed } from '../tools/battle/screen.mts';
import { type Image } from '../tools/inventory/png.mts';

/** What `stream` says, as text, until it ends: a process's stderr, which says why it stopped where it says anything. */
export function textOf(stream: ReadableStream<Uint8Array>): () => string {
  const decoder = new TextDecoder();
  let text = '';

  void stream
    .pipeTo(new WritableStream({ write: (chunk) => void (text += decoder.decode(chunk, { stream: true })) }))
    .catch(() => undefined);

  return () => text.trim();
}

/**
 * The codec string a `VideoDecoder` is configured by, `avc1.PPCCLL`, out of the first SPS in `bytes`: its profile,
 * constraint flags and level, the three bytes after its header. `screenrecord` leads each recording with one.
 */
export function codecOf(bytes: Uint8Array): string | null {
  for (let p = 0; p + 6 < bytes.length; p++) {
    if (bytes[p] === 0 && bytes[p + 1] === 0 && bytes[p + 2] === 1 && ((bytes[p + 3] ?? 0) & 0x1f) === 7) {
      const hex = (byte: number | undefined) => (byte ?? 0).toString(16).padStart(2, '0');

      return `avc1.${hex(bytes[p + 4])}${hex(bytes[p + 5])}${hex(bytes[p + 6])}`;
    }
  }

  return null;
}

/**
 * Each frame of an H.264 stream as it is decoded, ending with the stream. Annex B with no `description`, so the SPS
 * and PPS travel in band as `screenrecord` sends them, and the decoder made at the first key picture, nothing before
 * one being decodable. `optimizeForLatency` is what has it put each frame out as it is decoded rather than holding a
 * few back to reorder, which `screenrecord`'s stream never asks of it. A frame still comes out only once the next
 * picture has begun, `Pictures` finding where one ends from the start of the one after it, as `ffmpeg` does.
 */
export async function* decodeFrames(h264: ReadableStream<Uint8Array>): AsyncGenerator<Image> {
  const ready: Image[] = [];
  let failure: unknown;
  let ended = false;
  let wake = () => {};

  // Copied out in the order they were put out, each closed once copied: an unclosed frame holds the decoder's memory.
  let copied = Promise.resolve();

  const output = (frame: VideoFrame) => {
    copied = copied.then(async () => {
      try {
        const { displayWidth: width, displayHeight: height } = frame;
        const data = new Uint8Array(width * height * 4);
        await frame.copyTo(data, { format: 'RGBA' });
        ready.push({ width, height, data });
      } catch (error) {
        failure ??= error;
      } finally {
        frame.close();
        wake();
      }
    });
  };

  let decoder: VideoDecoder | undefined;
  let count = 0;

  const pictures = new Pictures(({ bytes, key }) => {
    if (decoder === undefined) {
      const codec = key ? codecOf(bytes) : null;

      if (codec === null) {
        return;
      }

      decoder = new VideoDecoder({
        output,
        error: (error) => {
          failure ??= error;
          wake();
        },
      });
      decoder.configure({ codec, optimizeForLatency: true });
    }

    // The timestamp is required and nothing reads it back; a count keeps each picture's its own.
    decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: count++, data: bytes }));
  });

  // Aborted once nothing more is wanted, which cancels the stream: a recording's, as its process being stopped does.
  const read = new AbortController();

  void (async () => {
    await h264.pipeTo(new WritableStream({ write: (chunk) => pictures.push(chunk, performance.now()) }), read);
    pictures.end();

    if (decoder?.state === 'configured') {
      await decoder.flush();
    }

    await copied;
  })()
    .then(
      () => (ended = true),
      (error: unknown) => (failure ??= error),
    )
    .finally(() => wake());

  try {
    for (;;) {
      const image = ready.shift();

      if (image) {
        yield image;
      } else if (failure !== undefined) {
        throw failure;
      } else if (ended) {
        return;
      } else {
        await new Promise<void>((resolve) => (wake = resolve));
      }
    }
  } finally {
    read.abort();

    if (decoder && decoder.state !== 'closed') {
      decoder.close();
    }
  }
}

/** `screenrecord` at `size` on `phone`, as `Screen` watches it. */
export function feed(phone: Pick<Phone, 'spawn'>, size: Size): Feed {
  let stderr = () => '';
  let stopped = false;
  const spawned = phone.spawn(recordCommand(size));

  // Stopped before it had started, `stop` kills it once it has.
  async function* frames(): AsyncGenerator<Image> {
    const process = await spawned;

    if (stopped) {
      return;
    }

    stderr = textOf(process.stderr);
    yield* decodeFrames(process.stdout);
  }

  return {
    frames: frames(),
    reason: () => stderr() || undefined,
    stop: () => {
      stopped = true;
      void spawned.then(
        (process) => process.kill(),
        () => undefined,
      );
    },
  };
}
