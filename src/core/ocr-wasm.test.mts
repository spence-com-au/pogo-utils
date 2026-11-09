/**
 * The worker pool's two failure paths, which the corpus cannot reach: a real Tesseract neither traps on a capture nor
 * fails to load its model there. tesseract.js is stood in for, so these are claims about the pool and not the engine.
 */

import { afterEach, expect, test, vi } from 'vitest';

const { createWorker } = vi.hoisted(() => ({ createWorker: vi.fn() }));

vi.mock('tesseract.js', () => ({ createWorker, OEM: { LSTM_ONLY: 1 } }));

const { MODEL_SHA256, tesseractWasm } = await import('./ocr-wasm.mts');

/** The digest `crypto.subtle` answers for the model the check expects, or for one it does not. */
const digestOf = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16)).buffer;

/** A stand-in worker whose model hashes as asked and whose reads do as `recognize` says. */
const worker = (recognize: () => Promise<unknown>) => ({
  FS: () => Promise.resolve({ data: new Uint8Array(1) }),
  recognize,
  terminate: () => Promise.resolve(),
});

const image = { width: 1, height: 1, data: new Uint8Array(4) };

afterEach(() => {
  vi.restoreAllMocks();
  createWorker.mockReset();
});

/**
 * One worker, two reads: the second waits on the first's worker. The first traps, which replaces the worker for the
 * read waiting on it — and where that replacement cannot be made, the waiting read has to fail rather than wait on a
 * worker that will never come.
 */
test('a read waiting on a worker that traps and cannot be replaced fails rather than hangs', async () => {
  vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(digestOf(MODEL_SHA256));

  // A holder rather than a `let`, which the compiler would narrow to the `null` it starts as, the closure being opaque.
  const read: { trap?: (error: Error) => void } = {};
  createWorker
    .mockResolvedValueOnce(worker(() => new Promise((_, reject) => (read.trap = reject))))
    .mockRejectedValueOnce(new Error('the worker script did not load'));

  const engine = tesseractWasm({ langPath: '.', workers: 1, cache: false });
  const first = engine.tsv(image, 7);

  // The first read has to have reached its worker, past the model's check, before there is a read to trap.
  await vi.waitFor(() => expect(read.trap).toBeDefined());
  const second = engine.tsv(image, 7);

  read.trap?.(new Error('RuntimeError: divide by zero'));

  await expect(first, 'a trap no longer reads as nothing read').resolves.toBe('');
  await expect(second).rejects.toThrow(/the worker script did not load/);
});

test('a model that is not the pinned one is refused before anything is read with it', async () => {
  vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(digestOf('00'.repeat(32)));
  createWorker.mockResolvedValue(worker(() => Promise.resolve({ data: { tsv: 'read' } })));

  const engine = tesseractWasm({ langPath: 'somewhere', workers: 1, cache: true });

  await expect(engine.tsv(image, 7)).rejects.toThrow(/somewhere is not tessdata_fast 4.1.0's/);

  // Kept and then fetched again once, `refresh` replacing whatever was kept, before it is refused.
  expect(createWorker.mock.calls.map((call) => (call[2] as { cacheMethod: string }).cacheMethod)).toStrictEqual([
    'write',
    'refresh',
  ]);
});

/**
 * Every read queued behind a worker that cannot be had, rather than the one at the front: a first spawn that fails
 * leaves no worker alive or starting, and nothing would ever hand the rest of the queue one.
 */
test('every read queued behind a worker that cannot be started fails, not just the first', async () => {
  createWorker.mockRejectedValue(new Error('offline'));

  const engine = tesseractWasm({ langPath: '.', workers: 1, cache: false });
  const reads = [engine.tsv(image, 7), engine.tsv(image, 7), engine.tsv(image, 7)];

  for (const read of reads) {
    await expect(read).rejects.toThrow(/offline/);
  }
});

/** The same after a trap, where the read at the front of the queue gets the replacement and the rest are behind it. */
test('every read queued behind a worker that traps and cannot be replaced fails', async () => {
  vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(digestOf(MODEL_SHA256));

  const read: { trap?: (error: Error) => void } = {};
  createWorker
    .mockResolvedValueOnce(worker(() => new Promise((_, reject) => (read.trap = reject))))
    .mockRejectedValue(new Error('offline'));

  const engine = tesseractWasm({ langPath: '.', workers: 1, cache: false });
  const first = engine.tsv(image, 7);

  await vi.waitFor(() => expect(read.trap).toBeDefined());
  const queued = [engine.tsv(image, 7), engine.tsv(image, 7)];

  read.trap?.(new Error('RuntimeError: divide by zero'));

  await expect(first).resolves.toBe('');

  for (const behind of queued) {
    await expect(behind).rejects.toThrow(/offline/);
  }
});

/**
 * A read that fails for any other reason is thrown, and its worker is not handed the next read: whatever left it
 * failing may have left it broken, and telling the two apart by the error's wording is not something to rely on.
 */
test('a worker whose read fails is replaced, not handed the next read', async () => {
  vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(digestOf(MODEL_SHA256));
  createWorker
    .mockResolvedValueOnce(worker(() => Promise.reject(new Error('something unforeseen'))))
    .mockResolvedValueOnce(worker(() => Promise.resolve({ data: { tsv: 'read' } })));

  const engine = tesseractWasm({ langPath: '.', workers: 1, cache: false });

  await expect(engine.tsv(image, 7)).rejects.toThrow(/something unforeseen/);
  await expect(engine.tsv(image, 7), 'the failed worker was handed the next read').resolves.toBe('read');
  expect(createWorker).toHaveBeenCalledTimes(2);
});

/** Stopping the engine stops the worker part way through a read too, and fails the reads waiting for it. */
test('terminating stops a worker that is reading, not only the idle ones', async () => {
  vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(digestOf(MODEL_SHA256));

  const reading = { started: false };
  const busy = {
    ...worker(() => {
      reading.started = true;

      return new Promise(() => {});
    }),
    terminate: vi.fn(() => Promise.resolve()),
  };
  createWorker.mockResolvedValueOnce(busy);

  const engine = tesseractWasm({ langPath: '.', workers: 1, cache: false });
  void engine.tsv(image, 7);
  await vi.waitFor(() => expect(reading.started).toBe(true));
  const queued = engine.tsv(image, 7);

  await engine.terminate();

  expect(busy.terminate, 'the worker part way through a read was left running').toHaveBeenCalled();
  await expect(queued).rejects.toThrow(/stopped/);
});

/**
 * A worker that fails while its model is being checked is stopped, being in no pool anything else could stop it from.
 */
test('a worker whose model cannot be checked is stopped, not left running', async () => {
  vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('no digest'));

  const checked = {
    ...worker(() => Promise.resolve({ data: { tsv: 'read' } })),
    terminate: vi.fn(() => Promise.resolve()),
  };
  createWorker.mockResolvedValueOnce(checked);

  const engine = tesseractWasm({ langPath: '.', workers: 1, cache: false });

  await expect(engine.tsv(image, 7)).rejects.toThrow(/no digest/);
  expect(checked.terminate, 'the worker whose check failed was left running').toHaveBeenCalled();
});
