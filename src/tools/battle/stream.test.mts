/**
 * The size a phone is streamed at, then the decoder and the hand-over between recordings, fed H.264 that `ffmpeg` makes up
 * on the spot rather than a phone. Each clip is one flat colour, so which recording a frame came from is a question of
 * its first pixel.
 */

import { rgb } from '../inventory/png.mts';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { decodeFrames, Screen, streamSize, type Recording } from './stream.mts';

/** The stream a Pixel 4 XL sends, which these clips stand in for. */
const size = streamSize({ width: 1440, height: 3040 });
const { width, height } = size;

/**
 * `seconds` of `colour` at 30 frames a second, as raw H.264 on stdout, the way `screenrecord` sends it. `zerolatency`
 * because the phone's encoder sends each frame as it is made, where x264's lookahead held the first back 1.8s — longer
 * than a test waits for the hand-over, so the first clip had ended on its own before the second took over.
 */
const clip = (colour: string, seconds: number): Recording =>
  spawn(
    'ffmpeg',
    [
      ...['-loglevel', 'error', '-re', '-f', 'lavfi', '-i', `color=${colour}:size=${width}x${height}:rate=30`],
      ...[
        '-t',
        String(seconds),
        '-c:v',
        'libx264',
        '-tune',
        'zerolatency',
        '-pix_fmt',
        'yuv420p',
        '-f',
        'h264',
        'pipe:1',
      ],
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

test.each([
  [{ width: 1440, height: 3040 }, 760],
  [{ width: 1008, height: 2244 }, 802],
  [{ width: 1080, height: 2400 }, 800],
])('streams a %o screen 360 wide by %i', (screen, tall) => {
  expect(streamSize(screen)).toEqual({ width: 360, height: tall });
});

test('decodes every frame of a stream at the stream size', async () => {
  const frames = [];

  for await (const frame of decodeFrames(clip('red', 1).stdout, size)) {
    frames.push(frame);
  }

  expect(frames).toHaveLength(30);
  expect(frames.every((frame) => frame.width === width && frame.height === height)).toBe(true);

  const [first] = frames;
  const [r, g, b] = first ? rgb(first, 10, 10) : [0, 0, 0];
  expect(r).toBeGreaterThan(200);
  expect(g + b).toBeLessThan(40);
});

test('decodes each frame once the next has begun', async () => {
  // Ten frames of a changing picture, each led by an access unit delimiter, `00 00 00 01 09`, which is where it is cut.
  const encoder = spawn(
    'ffmpeg',
    [
      ...['-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=size=${width}x${height}:rate=30`, '-frames:v', '10'],
      ...['-c:v', 'libx264', '-tune', 'zerolatency', '-x264-params', 'aud=1', '-pix_fmt', 'yuv420p', '-f', 'h264'],
      'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );

  const chunks: Buffer[] = [];

  for await (const chunk of encoder.stdout as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }

  const h264 = Buffer.concat(chunks);
  const aud = Buffer.from([0, 0, 0, 1, 9]);
  const cuts: number[] = [];

  for (let at = h264.indexOf(aud); at >= 0; at = h264.indexOf(aud, at + 1)) {
    cuts.push(at);
  }

  const pictures = cuts.map((at, n) => h264.subarray(at, cuts[n + 1]));
  expect(pictures).toHaveLength(10);

  const source = new PassThrough();
  const frames: unknown[] = [];

  const decoding = (async () => {
    for await (const frame of decodeFrames(source, size)) {
      frames.push(frame);
    }
  })();

  // A frame cannot come out before the next has begun, `ffmpeg` finding where a picture ends only from the start of
  // the one after it, which `screenrecord` gives nothing earlier to mark. Nothing else may hold one back, as the
  // `rawvideo` encoder's frame threading would, a frame more. A frame held back waits for more input, which none comes
  // while this waits, so a deadline rather than a fixed pause tells the two apart however busy the machine is.
  const reached = [];

  for (const [n, picture] of pictures.entries()) {
    source.write(picture);

    const until = performance.now() + 5000;

    while (frames.length < n && performance.now() < until) {
      await sleep(10);
    }

    reached.push(frames.length);
  }

  source.end();
  await decoding;

  expect(reached).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(frames).toHaveLength(10);
});

test('hands the screen to the next recording without going back to the last', async () => {
  const recordings: Recording[] = [];
  const colours = ['red', 'blue'];

  const screen = new Screen(
    () => {
      const recording = clip(colours[recordings.length] ?? 'blue', 3);
      recordings.push(recording);
      return recording;
    },
    size,
    1000,
  );

  try {
    expect(rgb((await screen.first()).image, 10, 10)[0]).toBeGreaterThan(200);

    await sleep(1800);

    const latest = screen.latest();

    expect(latest && rgb(latest.image, 10, 10)[2]).toBeGreaterThan(200);
    expect(recordings[0]?.killed).toBe(true);
  } finally {
    screen.close();
  }
});

test('fails when a recording ends without a later one taking over', async () => {
  const screen = new Screen(
    () => spawn('sh', ['-c', 'echo "Unable to get output buffers" >&2'], { stdio: ['ignore', 'pipe', 'pipe'] }),
    size,
  );

  try {
    await expect(screen.first(5000)).rejects.toThrow(/screen recording ended: Unable to get output buffers/);
  } finally {
    screen.close();
  }
});

test('reports an ffmpeg it cannot find rather than throwing', async () => {
  const path = process.env.PATH;
  const h264 = clip('red', 1).stdout;

  // `spawn` reads `PATH` when it is called, so emptying it around the first step is what hides `ffmpeg` from the
  // decoder alone, the clip above having already found it.
  process.env.PATH = '';

  try {
    const frames = decodeFrames(h264, size);

    await expect(frames.next()).rejects.toThrow('ffmpeg failed: spawn ffmpeg ENOENT');
  } finally {
    process.env.PATH = path;
  }
});

test('stops a recording that has started but not yet taken over when closed', async () => {
  const recordings: Recording[] = [];

  // The second never sends a frame, so it is still waiting to take over when the screen closes.
  const screen = new Screen(
    () => {
      const recording =
        recordings.length === 0 ? clip('red', 5) : spawn('sleep', ['30'], { stdio: ['ignore', 'pipe', 'pipe'] });
      recordings.push(recording);
      return recording;
    },
    size,
    500,
  );

  await screen.first();
  await sleep(700);
  screen.close();

  // At least the one that never took over, and as many more as a slow first frame let start: a fixed count failed every
  // time six copies of this file ran at once, a third recording having started before the close.
  expect(recordings.length).toBeGreaterThanOrEqual(2);
  expect(recordings.every((recording) => recording.killed)).toBe(true);
});

test('fails with the reason when a recording cannot start', async () => {
  const screen = new Screen(() => spawn('no-such-recorder', [], { stdio: ['ignore', 'pipe', 'pipe'] }), size);

  try {
    await expect(screen.first(5000)).rejects.toThrow(/screen recording ended: spawn no-such-recorder ENOENT/);
  } finally {
    screen.close();
  }
});
