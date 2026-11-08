import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { keepFrames } from './keep-frames.mts';

const frame = { width: 2, height: 2, data: new Uint8Array(2 * 2 * 4) };

const made: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();

  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A `keepFrames` into a directory of its own, removed after the test, started at 1s on a clock reading 15s. */
function keeper() {
  const root = mkdtempSync(join(tmpdir(), 'keep-frames-'));
  made.push(root);

  const dir = join(root, 'frames');
  const told = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  return { dir, told, ...keepFrames(dir, 1000, () => 15000) };
}

/** What `flush` says of a write that failed, `ENOENT` being what one into a removed directory fails with. */
const stopped = (dir: string, name: string) =>
  `stopped keeping frames in ${dir}: a write failed 14.0s in: ENOENT: no such file or directory, open '${join(dir, name)}'`;

test('names a frame by when it was seen and says how many it kept once, however often it is flushed', () => {
  const { dir, told, keep, flush } = keeper();

  keep(frame, 13437, 'shield');
  keep(frame, 14000, 'faint');
  flush();
  flush();

  expect(readdirSync(dir).sort()).toEqual(['0012.437s-shield.png', '0013.000s-faint.png']);
  expect(told.mock.calls).toEqual([[`kept 2 frames around faints and shield prompts in ${dir}`]]);
});

test('stops keeping frames at a write that fails, throwing nothing from the event loop and saying so once', () => {
  vi.useFakeTimers({ toFake: ['setImmediate'] });

  const { dir, told, keep, save, flush } = keeper();

  keep(frame, 2000, 'shield');
  vi.runAllTimers();
  rmSync(dir, { recursive: true });
  keep(frame, 3000, 'faint');
  keep(frame, 4000, 'faint');

  expect(() => vi.runAllTimers()).not.toThrow();

  // With `dir` back, only the stop keeps a later frame out.
  mkdirSync(dir);

  expect(save('later.png', frame)).toBe(false);
  expect(readdirSync(dir)).toEqual([]);

  flush();
  flush();

  expect(told.mock.calls).toEqual([
    [`kept 1 frames around faints and shield prompts in ${dir}`],
    [stopped(dir, '0002.000s-faint.png')],
  ]);
});

test('throws nothing from a flush that writes what is still queued into a directory that is gone', () => {
  const { dir, told, keep, save, flush } = keeper();

  keep(frame, 2000, 'shield');
  rmSync(dir, { recursive: true });

  expect(() => flush()).not.toThrow();
  expect(save('later.png', frame)).toBe(false);
  expect(told.mock.calls).toEqual([[stopped(dir, '0001.000s-shield.png')]]);
});
