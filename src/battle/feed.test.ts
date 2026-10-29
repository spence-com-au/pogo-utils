/**
 * The page's decoding of `screenrecord`'s H.264, with `FakeDecoder` in place of WebCodecs, which Node has none of: what
 * reaches the decoder out of `charge.h264` — a recording off a phone — and what comes back out of it. Whether Chrome's
 * own decoder reads those pictures is for the phone; nothing here runs a browser.
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { fixture } from '../testing/fixture.js';
import { type Image } from '../tools/inventory/png.mts';
import { codecOf, decodeFrames, feed } from './feed.js';
import { FakeChunk, FakeDecoder } from './test-phone.js';

const H264 = fixture(new URL('../tools/battle/fixtures/charge.h264', import.meta.url));

beforeEach(() => {
  FakeDecoder.made = [];
  FakeDecoder.failing = false;
  vi.stubGlobal('VideoDecoder', FakeDecoder);
  vi.stubGlobal('EncodedVideoChunk', FakeChunk);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** `bytes` as a stream, in chunks of `size` as USB would hand them over, ended after the last. */
function chunked(bytes: Uint8Array, size = 16_384): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (let at = 0; at < bytes.length; at += size) {
        controller.enqueue(bytes.subarray(at, at + size));
      }

      controller.close();
    },
  });
}

/** Every frame `frames` answers, once it has ended. `Array.fromAsync` is past the lib this project is checked with. */
async function all(frames: AsyncIterable<Image>): Promise<Image[]> {
  const taken = [];

  for await (const frame of frames) {
    taken.push(frame);
  }

  return taken;
}

test("reads the codec off the recording's SPS", () => {
  // Constrained Baseline at level 3.0, as `ffprobe` reads this recording.
  expect(codecOf(H264)).toBe('avc1.42c01e');
  expect(codecOf(H264.subarray(40))).toBeNull();
});

test('hands the decoder every picture whole, the key one first, and answers a frame for each', async () => {
  const frames = await all(decodeFrames(chunked(H264)));

  // The 151 frames `ffprobe -count_frames` counts, one of them key.
  const [decoder] = FakeDecoder.made;
  expect(FakeDecoder.made).toHaveLength(1);
  expect(decoder?.config).toEqual({ codec: 'avc1.42c01e', optimizeForLatency: true });
  expect(decoder?.chunks).toEqual(['key', ...Array<string>(150).fill('delta')]);
  expect(frames.map(({ width, height }) => `${width}×${height}`)).toEqual(Array<string>(151).fill('360×760'));
  expect(frames.map(({ data }) => data[0])).toEqual(Array.from({ length: 151 }, (_, i) => (i + 1) & 0xff));
  expect(decoder?.frames.every(({ closed }) => closed)).toBe(true);
  expect(decoder?.state).toBe('closed');
});

test('waits for a key picture before making a decoder, nothing before one being decodable', async () => {
  // From the first picture that is not a key one, as a recording joined part way through would be: a start code and a
  // slice of type 1.
  const delta = H264.findIndex(
    (byte, p) => byte === 0 && H264[p + 1] === 0 && H264[p + 2] === 1 && ((H264[p + 3] ?? 0) & 0x1f) === 1,
  );

  expect(delta).toBeGreaterThan(0);
  expect(await all(decodeFrames(chunked(H264.subarray(delta))))).toEqual([]);
  expect(FakeDecoder.made).toEqual([]);
});

test("throws the decoder's error rather than ending as if the recording had", async () => {
  FakeDecoder.failing = true;

  await expect(all(decodeFrames(chunked(H264)))).rejects.toThrow('cannot decode this');
});

test("runs `screenrecord` at the size asked, and says why it stopped in the recording's own words", async () => {
  const stderr = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('Unable to get output buffers\n'));
      controller.close();
    },
  });
  const kill = vi.fn();
  const spawn = vi.fn(() => Promise.resolve({ stdin: new WritableStream(), stdout: chunked(H264), stderr, kill }));
  const recording = feed({ spawn }, { width: 360, height: 760 });

  expect(await all(recording.frames)).toHaveLength(151);
  expect(spawn).toHaveBeenCalledWith([
    'screenrecord',
    '--output-format=h264',
    '--size=360x760',
    '--bit-rate=2000000',
    '--time-limit=180',
    '-',
  ]);
  expect(recording.reason()).toBe('Unable to get output buffers');

  recording.stop();
  await vi.waitFor(() => expect(kill).toHaveBeenCalledOnce());
});
