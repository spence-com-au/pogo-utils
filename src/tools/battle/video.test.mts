/**
 * A run's video, out of H.264 `ffmpeg` makes up on the spot and handed over as `screenrecord`'s would be, chunk by
 * chunk, and read back by `ffprobe` and `ffmpeg` as a player would read it. Each clip is one flat colour, so which
 * recording a picture came from is a question of its first pixel.
 */

import { execFile, spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { Pictures } from './pictures.mts';
import { type Recording } from './stream.mts';
import { HELD_MS, Video } from './video.mts';

const width = 64;
const height = 128;

/** `frames` of `colour`, as raw H.264 the way `screenrecord` sends it: no delimiters, the first picture a key one. */
async function clip(colour: string, frames: number): Promise<Buffer> {
  const { stdout } = await promisify(execFile)(
    'ffmpeg',
    [
      ...['-loglevel', 'error', '-f', 'lavfi', '-i', `color=${colour}:size=${width}x${height}:rate=30`],
      ...['-frames:v', String(frames), '-c:v', 'libx264', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p'],
      ...['-f', 'h264', 'pipe:1'],
    ],
    { encoding: 'buffer' },
  );

  return stdout;
}

/** A recording that sends nothing until a test writes to it, and ends when the test ends it. */
function recording(): { recording: Recording; stdout: PassThrough } {
  const stdout = new PassThrough();
  const recording = Object.assign(new PassThrough(), { stdout, stderr: new PassThrough() });

  return { recording: recording as unknown as Recording, stdout };
}

/** Each picture of a video as a player shows it: when, and the red and blue of its first pixel. */
async function watch(ts: Buffer): Promise<{ time: number; red: number; blue: number }[]> {
  const run = (command: string, args: string[]) =>
    new Promise<Buffer>((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
      const chunks: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.once('error', reject);
      child.once('close', (code) =>
        code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${command} ${code}`)),
      );
      child.stdin.end(ts);
    });

  const [times, pixels] = await Promise.all([
    run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', '-']),
    run('ffmpeg', [
      '-v',
      'error',
      '-i',
      'pipe:0',
      '-fps_mode',
      'passthrough',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ]),
  ]);

  const size = width * height * 3;

  return times
    .toString()
    .trim()
    .split('\n')
    .map((line, i) => ({
      time: Number.parseFloat(line),
      red: pixels[i * size] ?? -1,
      blue: pixels[i * size + 2] ?? -1,
    }));
}

test('cuts a stream into its pictures however it arrives', async () => {
  const h264 = await clip('red', 10);

  for (const size of [1, 7, 188, h264.length]) {
    const pictures: { bytes: Uint8Array; key: boolean }[] = [];
    const cutter = new Pictures((picture) => pictures.push(picture));

    for (let at = 0; at < h264.length; at += size) {
      cutter.push(h264.subarray(at, at + size), at);
    }

    cutter.end();

    expect(pictures).toHaveLength(10);
    expect(pictures.map(({ key }) => key)).toEqual([true, ...Array<boolean>(9).fill(false)]);
    expect(Buffer.concat(pictures.map(({ bytes }) => bytes))).toEqual(h264);
  }
});

test('times each picture by when it arrived since the run began, the first from the start', async () => {
  const h264 = await clip('red', 5);
  const pictures: Uint8Array[] = [];
  const cutter = new Pictures(({ bytes }) => pictures.push(bytes));
  cutter.push(h264, 0);
  cutter.end();

  const written: Uint8Array[] = [];
  let now = 0;
  const video = new Video(
    (bytes) => written.push(bytes),
    1000,
    () => now,
  );
  const { recording: one, stdout } = recording();
  video.watch(one);

  // The run began at 1000; the phone's first picture came 1.5s in, and the rest 2s apart.
  for (const [i, picture] of pictures.entries()) {
    now = 2500 + 2000 * i;
    stdout.write(picture);
    await new Promise(setImmediate);
  }

  video.close();

  const shown = await watch(Buffer.concat(written));
  const start = shown[0]?.time ?? NaN;

  expect(shown.map(({ time }) => Math.round((time - start) * 1000))).toEqual([0, 3500, 5500, 7500, 9500]);
});

test('goes over to the next recording before its first byte, by as long as its first pictures were held', async () => {
  const [red, blue] = await Promise.all([clip('red', 20), clip('blue', 20)]);

  const cut = (h264: Buffer) => {
    const pictures: Uint8Array[] = [];
    const cutter = new Pictures(({ bytes }) => pictures.push(bytes));
    cutter.push(h264, 0);
    cutter.end();
    return pictures;
  };

  const [reds, blues] = [cut(red), cut(blue)];
  const written: Uint8Array[] = [];
  let now = 0;
  const video = new Video(
    (bytes) => written.push(bytes),
    0,
    () => now,
  );
  const first = recording();
  const second = recording();

  const send = async (stdout: PassThrough, pictures: Uint8Array[], times: number[]) => {
    for (const [i, picture] of pictures.entries()) {
      now = times[i] ?? NaN;
      stdout.write(picture);
      await new Promise(setImmediate);
    }
  };

  // Red thirty a second from 1000. The next recording's first byte comes at 1350, its first five pictures in a rush,
  // as the phone's held ones do, and the last goes on sending through the hand-over before it is stopped.
  const next = 1350;
  video.watch(first.recording);
  await send(
    first.stdout,
    reds.slice(0, 11),
    reds.slice(0, 11).map((_, i) => 1000 + 33 * i),
  );
  video.watch(second.recording);
  await send(
    second.stdout,
    blues.slice(0, 5),
    [0, 1, 2, 3, 4].map((i) => next + i),
  );
  await send(
    first.stdout,
    reds.slice(11),
    reds.slice(11).map((_, i) => next + 10 + 33 * i),
  );
  first.stdout.destroy();
  await new Promise(setImmediate);
  await send(
    second.stdout,
    blues.slice(5),
    blues.slice(5).map((_, i) => next + 33 * (i + 1)),
  );
  video.close();

  const shown = await watch(Buffer.concat(written));
  const colours = shown.map(({ red, blue }) =>
    red > 200 && blue < 40 ? 'red' : blue > 200 && red < 40 ? 'blue' : '?',
  );
  const over = colours.indexOf('blue');
  const start = shown[0]?.time ?? NaN;

  // The reds that came within `HELD_MS` of the next's first byte are what its first pictures show again.
  const kept = reds.slice(0, 11).filter((_, i) => 1000 + 33 * i < next - HELD_MS).length;
  expect(colours).toEqual([...Array<string>(kept).fill('red'), ...Array<string>(20).fill('blue')]);
  expect(shown.every(({ time }, i) => i === 0 || time > (shown[i - 1]?.time ?? Infinity))).toBe(true);
  expect((shown[over]?.time ?? NaN) - start).toBeCloseTo(next / 1000, 2);
});

test('writes a picture only once the next recording could no longer cut it', async () => {
  const pictures: Uint8Array[] = [];
  const cutter = new Pictures(({ bytes }) => pictures.push(bytes));
  cutter.push(await clip('red', 5), 0);
  cutter.end();

  const written: Uint8Array[] = [];
  let now = 0;
  const video = new Video(
    (bytes) => written.push(bytes),
    0,
    () => now,
  );
  const { recording: one, stdout } = recording();
  video.watch(one);

  // Each picture is whole once the next begins: the first at 33, the second at 66.
  for (const [i, picture] of pictures.slice(0, 3).entries()) {
    now = 33 * i;
    stdout.write(picture);
    await new Promise(setImmediate);
  }

  expect(written).toHaveLength(0);

  now = HELD_MS + 40;
  stdout.write(pictures[3] ?? new Uint8Array());
  await new Promise(setImmediate);

  // One write a picture: the two from more than `HELD_MS` ago.
  expect(written).toHaveLength(2);
  video.close();
});

test('writes a held picture once its time is up, with nothing else arriving', async () => {
  const pictures: Uint8Array[] = [];
  const cutter = new Pictures(({ bytes }) => pictures.push(bytes));
  cutter.push(await clip('red', 3), 0);
  cutter.end();

  const written: Uint8Array[] = [];
  const video = new Video((bytes) => written.push(bytes), performance.now());
  const { recording: one, stdout } = recording();
  video.watch(one);

  // A screen gone still: the first two are whole once the third begins, and nothing follows it.
  for (const picture of pictures) {
    stdout.write(picture);
  }

  await new Promise(setImmediate);
  expect(written).toHaveLength(0);

  const until = performance.now() + 5000;

  while (written.length < 2 && performance.now() < until) {
    await sleep(10);
  }

  expect(written).toHaveLength(2);
  video.close();
});

test('keeps the last pictures of a recording that ends before the next has begun', async () => {
  const [red, blue] = await Promise.all([clip('red', 5), clip('blue', 5)]);
  const written: Uint8Array[] = [];
  let now = 0;
  const video = new Video(
    (bytes) => written.push(bytes),
    0,
    () => now,
  );
  const first = recording();
  const second = recording();

  video.watch(first.recording);
  now = 1000;
  first.stdout.write(red);
  await new Promise(setImmediate);

  // The last ends at once, its every picture within `HELD_MS`; the next has started but sent nothing.
  video.watch(second.recording);
  first.stdout.destroy();
  await new Promise(setImmediate);

  now = 3000;
  second.stdout.write(blue);
  await new Promise(setImmediate);
  video.close();

  const shown = await watch(Buffer.concat(written));
  const colours = shown.map(({ red, blue }) =>
    red > 200 && blue < 40 ? 'red' : blue > 200 && red < 40 ? 'blue' : '?',
  );

  expect(colours).toEqual([...Array<string>(5).fill('red'), ...Array<string>(5).fill('blue')]);
});
