/**
 * What `--keep-video` tells of its file once the run is over, for every way a write or a close can go. Pictures are the
 * smallest H.264 `Pictures` cuts — an IDR slice's NAL unit apiece — handed over as `screenrecord`'s would be, and the
 * file is a real one, but for a disk that cannot be made full on demand: `writeSync` and `closeSync` fail when
 * `failing` says so, and are the real ones otherwise.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { beforeEach, expect, test, vi } from 'vitest';
import { keepVideo } from './keep-video.mts';
import { type Recording } from './stream.mts';

/** The one `writeSync` that fails, counting from 1 (none if 0), and whether `closeSync` fails after it has closed. */
const failing = vi.hoisted(() => ({ write: 0, writes: 0, close: false }));

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();

  return {
    ...fs,
    writeSync: (fd: number, bytes: Uint8Array) => {
      if (++failing.writes === failing.write) {
        throw new Error('ENOSPC: no space left on device, write');
      }

      return fs.writeSync(fd, bytes);
    },
    closeSync: (fd: number) => {
      fs.closeSync(fd);

      if (failing.close) {
        throw new Error('EIO: i/o error, close');
      }
    },
  };
});

/** An IDR slice's NAL unit, whose first macroblock is the picture's first. */
const PICTURE = Uint8Array.of(0, 0, 0, 1, 0x65, 0x88, 0x84, 0);

const told = vi.spyOn(console, 'error').mockImplementation(() => undefined);

beforeEach(() => {
  Object.assign(failing, { write: 0, writes: 0, close: false });
  told.mockClear();
});

/** A video kept at `file` in a directory of its own, the run having begun at 1000 and the clock reading 12345. */
function keep(file = 'video.ts') {
  const path = join(mkdtempSync(join(tmpdir(), 'keep-video-')), file);

  return { path, kept: keepVideo(path, 1000, () => 12_345) };
}

/** Hands the video one recording, which sends `pictures` pictures of the screen in one go. */
async function send(kept: ReturnType<typeof keepVideo>, pictures: number) {
  const stdout = new PassThrough();

  kept.watch({ stdout } as unknown as Recording);
  stdout.write(Buffer.concat(Array.from({ length: pictures }, () => PICTURE)));
  await new Promise(setImmediate);
}

test('keeps the screen as whole packets and says so once, however often it is closed', async () => {
  const { path, kept } = keep('nested/video.ts');

  await send(kept, 3);
  kept.close();
  kept.close();

  const bytes = readFileSync(path);

  expect(bytes.length).toBeGreaterThan(0);
  expect(bytes.length % 188).toBe(0);
  expect(bytes[0]).toBe(0x47);
  expect(told.mock.calls).toEqual([[`kept the screen in ${path}`]]);
});

test('tells a video no picture reached is empty', () => {
  const { path, kept } = keep();

  kept.close();

  expect(readFileSync(path)).toHaveLength(0);
  expect(told.mock.calls).toEqual([[`no picture of the screen came, so ${path} is empty`]]);
});

test('tells that nothing was kept where the first write failed', async () => {
  failing.write = 1;

  const { path, kept } = keep();

  await send(kept, 3);
  kept.close();

  // The first failure ends the writing: the other two pictures are never tried.
  expect(failing.writes).toBe(1);
  expect(readFileSync(path)).toHaveLength(0);
  expect(told.mock.calls).toEqual([
    [`nothing kept in ${path}: a write failed 11.3s in: ENOSPC: no space left on device, write`],
  ]);
});

test('tells how far it kept the screen where a later write failed', async () => {
  failing.write = 2;

  const { path, kept } = keep();

  await send(kept, 3);
  kept.close();

  expect(failing.writes).toBe(2);
  expect(readFileSync(path).length).toBeGreaterThan(0);
  expect(told.mock.calls).toEqual([
    [`kept the screen in ${path} only until a write failed 11.3s in: ENOSPC: no space left on device, write`],
  ]);
});

test('tells a close that failed after what was kept, and still closes the video', async () => {
  failing.close = true;

  const { path, kept } = keep();

  await send(kept, 2);
  kept.close();

  expect(told.mock.calls).toEqual([[`kept the screen in ${path}`], [`closing ${path} failed: EIO: i/o error, close`]]);
});

test('tells a failed write and a failed close apart', async () => {
  failing.write = 1;
  failing.close = true;

  const { path, kept } = keep();

  await send(kept, 2);
  kept.close();

  expect(told.mock.calls).toEqual([
    [`nothing kept in ${path}: a write failed 11.3s in: ENOSPC: no space left on device, write`],
    [`closing ${path} failed: EIO: i/o error, close`],
  ]);
});

test('throws for a file that cannot be opened, before anything is kept', () => {
  const dir = mkdtempSync(join(tmpdir(), 'keep-video-'));
  writeFileSync(join(dir, 'file'), '');

  expect(() => keepVideo(join(dir, 'file', 'video.ts'), 1000, () => 12_345)).toThrow(/ENOTDIR|EEXIST/);
  expect(told).not.toHaveBeenCalled();
});
