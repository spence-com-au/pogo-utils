/**
 * A run's video, out of H.264 `ffmpeg` makes up on the spot and handed over as `screenrecord`'s would be, chunk by
 * chunk, and read back by `ffprobe` and `ffmpeg` as a player would read it. Each clip is one flat colour, so which
 * recording a picture came from is a question of its first pixel.
 */

import { execFile, spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { type Recording } from './stream.mts';
import { Pictures, Video } from './video.mts';

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

test('goes over to the next recording at its first picture, without a gap or a picture twice', async () => {
  const [red, blue] = await Promise.all([clip('red', 20), clip('blue', 20)]);
  const written: Uint8Array[] = [];
  let now = 0;
  const video = new Video(
    (bytes) => written.push(bytes),
    0,
    () => now,
  );
  const first = recording();
  const second = recording();

  const send = async (stdout: PassThrough, h264: Buffer, from: number, until: number, at: number) => {
    for (let i = from; i < until; i += 500) {
      now = at + i / 10;
      stdout.write(h264.subarray(i, Math.min(i + 500, until)));
      await new Promise(setImmediate);
    }
  };

  video.watch(first.recording);
  await send(first.stdout, red, 0, red.length / 2, 1000);

  // The next starts, sends half of what it has, and the last goes on sending through the hand-over before it is
  // stopped: what it sends from there is not shown.
  video.watch(second.recording);
  await send(second.stdout, blue, 0, blue.length / 2, 1000 + red.length / 20);
  await send(first.stdout, red, red.length / 2, red.length, 1000 + red.length / 10);
  first.stdout.destroy();
  await new Promise(setImmediate);
  await send(second.stdout, blue, blue.length / 2, blue.length, 1000 + red.length / 10 + blue.length / 20);
  video.close();

  const shown = await watch(Buffer.concat(written));
  const colours = shown.map(({ red, blue }) =>
    red > 200 && blue < 40 ? 'red' : blue > 200 && red < 40 ? 'blue' : '?',
  );
  const over = colours.indexOf('blue');

  expect(over).toBeGreaterThan(0);
  expect(colours.slice(0, over).every((colour) => colour === 'red')).toBe(true);
  expect(colours.slice(over)).toEqual(Array(20).fill('blue'));
  expect(shown.every(({ time }, i) => i === 0 || time > (shown[i - 1]?.time ?? Infinity))).toBe(true);
  expect((shown[over]?.time ?? 0) - (shown[0]?.time ?? 0)).toBeCloseTo((1000 + red.length / 20) / 1000, 2);
});
