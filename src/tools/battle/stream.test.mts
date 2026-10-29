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
import { streamSize } from './record-command.mts';
import { Screen } from './screen.mts';
import { decodeFrames, feed, type Recording } from './stream.mts';
import { HELD_MS, Video } from './video.mts';

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

/** The screen out of each process `record` starts, decoded by `ffmpeg` as a battle's are. */
const watched = (record: () => Recording, segmentMs?: number) => new Screen(() => feed(record(), size), segmentMs);

/** What `command` writes to stdout, given `input` on stdin. */
function output(command: string, args: string[], input: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${command} exited ${code}`)),
    );
    child.stdin.end(input);
  });
}

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
  // `rawvideo` encoder's frame threading would, a frame more. A frame held back waits for more input, and none comes
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

  const screen = watched(() => {
    const recording = clip(colours[recordings.length] ?? 'blue', 3);
    recordings.push(recording);
    return recording;
  }, 1000);

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

test('keeps the whole screen as video across the hand-over, the first recording then the next, in order', async () => {
  const recordings: Recording[] = [];
  const colours = ['red', 'blue'];
  const written: Uint8Array[] = [];
  const started = performance.now();
  const video = new Video((bytes) => written.push(bytes), started);

  const screen = watched(() => {
    const recording = clip(colours[recordings.length] ?? 'blue', 3);
    recordings.push(recording);
    return video.watch(recording);
  }, 1000);

  try {
    await screen.first();
    await sleep(1800);
  } finally {
    screen.close();
    video.close();
  }

  // What a player shows: each picture's time, and whether it is the first recording's red or the second's blue.
  const ts = Buffer.concat(written);
  const [probed, pixels] = await Promise.all([
    output('ffprobe', ['-v', 'error', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', '-'], ts),
    output(
      'ffmpeg',
      ['-v', 'error', '-i', '-', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
      ts,
    ),
  ]);
  const times = probed.toString().trim().split('\n').map(Number.parseFloat);
  const frame = width * height * 3;

  // Strictly red or strictly blue, so a grey, black or broken picture at the cut is neither.
  const pictures = Array.from({ length: pixels.length / frame }, (_, i) => {
    const red = pixels[i * frame] ?? 0;
    const blue = pixels[i * frame + 2] ?? 0;

    return red > 200 && blue < 40 ? 'red' : blue > 200 && red < 40 ? 'blue' : '?';
  });

  const over = pictures.indexOf('blue');

  expect(pictures).toHaveLength(times.length);
  expect(over).toBeGreaterThan(0);
  expect(pictures.slice(0, over).every((colour) => colour === 'red')).toBe(true);
  expect(pictures.slice(over).every((colour) => colour === 'blue')).toBe(true);
  expect(times.every((time, i) => i === 0 || time > (times[i - 1] ?? Infinity))).toBe(true);

  // Thirty a second from each, but for the `HELD_MS` before the next's first byte, which the phone's next recording
  // shows again and these clips do not.
  const gaps = times.slice(2).map((time, i) => time - (times[i + 1] ?? 0));
  expect(Math.max(...gaps)).toBeLessThan((HELD_MS + 50) / 1000);
});

test('fails when a recording ends without a later one taking over', async () => {
  const screen = watched(() =>
    spawn('sh', ['-c', 'echo "Unable to get output buffers" >&2'], { stdio: ['ignore', 'pipe', 'pipe'] }),
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
  const screen = watched(() => {
    const recording =
      recordings.length === 0 ? clip('red', 5) : spawn('sleep', ['30'], { stdio: ['ignore', 'pipe', 'pipe'] });
    recordings.push(recording);
    return recording;
  }, 500);

  await screen.first();
  await sleep(700);
  screen.close();

  // At least the one that never took over, and as many more as a slow first frame let start: a fixed count failed every
  // time six copies of this file ran at once, a third recording having started before the close.
  expect(recordings.length).toBeGreaterThanOrEqual(2);
  expect(recordings.every((recording) => recording.killed)).toBe(true);
});

test('fails with the reason when a recording cannot start', async () => {
  const screen = watched(() => spawn('no-such-recorder', [], { stdio: ['ignore', 'pipe', 'pipe'] }));

  try {
    await expect(screen.first(5000)).rejects.toThrow(/screen recording ended: spawn no-such-recorder ENOENT/);
  } finally {
    screen.close();
  }
});
