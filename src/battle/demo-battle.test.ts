/**
 * The demo battle the site publishes, played as the battle's Worker plays it — the demo phone, `battlePhone` over it,
 * the battle loop and the WebAssembly Tesseract — at the pace it was recorded, with `ffmpeg` decoding where WebCodecs
 * would: what passes here is the Training battle a reader with no phone watches, won, as it was when recorded.
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
import { Pictures, type Picture } from '../tools/battle/pictures.mts';
import { recordCommand } from '../tools/battle/record-command.mts';
import { run, type Clock } from '../tools/battle/run.mts';
import { type Feed } from '../tools/battle/screen.mts';
import { demoConnection } from './demo.js';
import { codecOf } from './feed.js';
import { battlePhone } from './phone.js';

/** What of `node:child_process` is used, had from `process` as `fixture` has `node:fs`, this project having no Node. */
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

const { execFileSync, spawn } = (
  globalThis as unknown as { process: { getBuiltinModule(id: 'node:child_process'): ChildProcess } }
).process.getBuiltinModule('node:child_process');

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

/**
 * Each frame of `h264` as `ffmpeg` decodes it, with the flags `pnpm battle` decodes a recording with, so that each
 * comes out as soon as the picture after it has begun rather than once `ffmpeg` has buffered a few.
 */
async function* decode(h264: ReadableStream<Uint8Array>): AsyncGenerator<Image> {
  const ffmpeg = spawn('ffmpeg', [
    ...['-loglevel', 'error', '-flags', 'low_delay', '-probesize', '32', '-threads', '1'],
    ...['-f', 'h264', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'],
  ]);

  void (async () => {
    const reader = h264.getReader();

    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      ffmpeg.stdin.write(read.value);
    }

    ffmpeg.stdin.end();
  })().catch(() => ffmpeg.kill());

  const length = SIZE.width * SIZE.height * 4;
  let pending = new Uint8Array(0);

  try {
    for await (const chunk of ffmpeg.stdout) {
      const joined = new Uint8Array(pending.length + chunk.length);
      joined.set(pending);
      joined.set(chunk, pending.length);
      pending = joined;

      while (pending.length >= length) {
        yield { ...SIZE, data: pending.slice(0, length) };
        pending = pending.subarray(length);
      }
    }
  } finally {
    ffmpeg.kill();
  }
}

/** `screenrecord` on `connection` decoded by `ffmpeg`, as `feed` decodes it by WebCodecs. */
function watch(connection: Pick<Connection, 'spawn'>, size: Size): Feed {
  const spawned = connection.spawn(recordCommand(size));

  return {
    frames: (async function* () {
      yield* decode((await spawned).stdout);
    })(),
    reason: () => undefined,
    stop: () => void spawned.then((process) => process.kill()),
  };
}

const engine = tesseractWasm({
  langPath: /"([^"]+)"/.exec(output('tesseract', '--list-langs'))?.[1] ?? '',
  workers: 4,
  cache: false,
});

useEngine(engine);
afterAll(() => engine.terminate());

const clock: Clock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

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

test('plays a Training battle through to a win', { timeout: 300_000 }, async () => {
  const connection = demoConnection(H264, DEMO_BATTLE.fps, decode);
  const phone = await battlePhone(connection, watch);
  const told: string[] = [];

  try {
    const mode = { mode: 'training', leader: DEMO_BATTLE.leader, league: DEMO_BATTLE.league } as const;
    const tally = await run(phone, { mode, data: DATA, icons: [], typeIcons: {}, count: 1 }, clock, {
      event: (line) => told.push(line),
      status: () => {},
    });

    expect(tally, told.join('\n')).toEqual({ battles: 1, won: 1, lost: 0 });
  } finally {
    phone.close();
    await connection.close();
  }
});
