import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { keepFrames } from './keep-frames.mts';

const frame = { width: 2, height: 2, data: new Uint8Array(2 * 2 * 4) };

test('names a frame by when it was seen and says how many it kept once, however often it is flushed', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'keep-frames-')), 'frames');
  const told = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const { keep, flush } = keepFrames(dir, 1000);

  keep(frame, 13437, 'shield');
  keep(frame, 14000, 'faint');
  flush();
  flush();

  expect(readdirSync(dir).sort()).toEqual(['0012.437s-shield.png', '0013.000s-faint.png']);
  expect(told.mock.calls).toEqual([[`kept 2 frames around faints and shield prompts in ${dir}`]]);

  told.mockRestore();
});
