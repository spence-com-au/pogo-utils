/**
 * How many workers the engine is given, and where it finds its worker and cores. Tesseract.js is stood in for, so these
 * are claims about the wiring and not the reading.
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { wasmEngine } from './ocr.js';

const mocks = vi.hoisted(() => ({ tesseractWasm: vi.fn() }));

vi.mock('../ocr-wasm.mts', () => ({ MODEL: 'model', tesseractWasm: mocks.tesseractWasm }));

beforeEach(() => {
  vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

test.each([
  [16, 4],
  [2, 2],
  [0, 1],
  [undefined, 1],
])('an engine on a device reporting %s cores gets %s workers: at most four, at least one', (cores, workers) => {
  vi.stubGlobal('navigator', { hardwareConcurrency: cores });
  wasmEngine('https://spence.com.au/pogo-utils/');

  expect(mocks.tesseractWasm).toHaveBeenCalledWith(expect.objectContaining({ workers }));
});

test('the engine finds its worker and cores against the base it is given, which a Worker has none of', () => {
  wasmEngine('https://worker.test/app/');

  expect(mocks.tesseractWasm).toHaveBeenCalledWith(
    expect.objectContaining({
      workerPath: expect.stringMatching(/^https:\/\/worker\.test\/app\/.+\/worker\.min\.js$/),
      corePath: expect.stringMatching(/^https:\/\/worker\.test\/app\/.+\/$/),
    }),
  );
});

test('the engine hears the model download only where it is given someone to tell', () => {
  const progress = vi.fn();

  wasmEngine('https://spence.com.au/pogo-utils/');
  wasmEngine('https://spence.com.au/pogo-utils/', progress);

  const [quiet, heard] = mocks.tesseractWasm.mock.calls.map(([options]) => options);

  expect(quiet).not.toHaveProperty('progress');
  expect(heard).toHaveProperty('progress', progress);
});
