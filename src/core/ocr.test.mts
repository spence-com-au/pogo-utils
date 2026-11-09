/**
 * The helpers callers find text with, and how `ocr` runs the Tesseract CLI and what it does when the CLI cannot start.
 * Reading real captures is left to the readers that have them; `findLine` and `centre` have no reader below the CLI, so
 * they are pinned here.
 */

import { tesseractCli } from './node/ocr-cli.mts';
import { centre, findLine, fold, ocr, ocrLine, useEngine, type Line } from './ocr.mts';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { expect, test, vi } from 'vitest';

// The CLI's own failure modes are what most of this file pins, so it is the engine here whatever `INVENTORY_OCR` says.
useEngine(tesseractCli);

const line = (text: string, left = 0, top = 0): Line => ({ text, left, top, width: 100, height: 20 });

test('a pattern is matched against folded text, so it is written in lowercase and without punctuation', () => {
  const lines = [line('Pokémon'), line('CP 1,234'), line('Search')];

  expect(findLine(lines, /^search\b/)?.text).toBe('Search');
  expect(findLine(lines, /\bcp \d/)?.text).toBe('CP 1,234');
  expect(findLine(lines, /pokemon/)?.text).toBe('Pokémon');
  expect(findLine(lines, /Search/), 'a pattern with capitals can never match').toBeUndefined();
});

test('the first match is the one returned', () => {
  expect(findLine([line('eggs', 0, 10), line('eggs', 0, 20)], /eggs/)?.top).toBe(10);
});

test('a centre is the middle of the box', () => {
  expect(centre({ text: '', left: 10, top: 20, width: 30, height: 40 })).toStrictEqual([25, 40]);
});

test('a move keeps its pluses through a fold', () => {
  expect(fold('Aeroblast++')).toBe('aeroblast++');
  expect(fold('Aeroblast')).not.toBe(fold('Aeroblast+'));
});

/**
 * A Tesseract that cannot load its model exits before it reads its input, and an image bigger than a pipe holds then
 * fails to write. Without a guard on stdin that EPIPE is an unhandled error that kills the whole process rather than a
 * rejection the caller can catch, so the image here is noise: incompressible, it encodes to far more than 64 KiB.
 */
test('a Tesseract that fails to start is a rejection naming why, however large the image', async () => {
  const data = new Uint8Array(400 * 400 * 4).map(() => Math.floor(Math.random() * 256));
  const previous = process.env['TESSDATA_PREFIX'];

  // A folder that exists but is empty: Tesseract 5.5 ignores one that does not exist and falls back to its own.
  const empty = mkdtempSync(join(tmpdir(), 'tessdata-'));
  process.env['TESSDATA_PREFIX'] = empty;

  try {
    await expect(ocr({ width: 400, height: 400, data })).rejects.toThrow(/tesseract exited 1: .*eng/s);
  } finally {
    if (previous === undefined) {
      delete process.env['TESSDATA_PREFIX'];
    } else {
      process.env['TESSDATA_PREFIX'] = previous;
    }

    rmSync(empty, { recursive: true });
  }
});

/** A stand-in `tesseract` that fails with the limit it was given, which is the one thing a real one would not say. */
test('Tesseract is held to one thread, whatever limit the shell exports', async () => {
  const bin = mkdtempSync(join(tmpdir(), 'tesseract-'));
  writeFileSync(join(bin, 'tesseract'), '#!/bin/sh\necho "OMP_THREAD_LIMIT=$OMP_THREAD_LIMIT" >&2\nexit 1\n', {
    mode: 0o755,
  });
  vi.stubEnv('PATH', `${bin}${delimiter}${process.env['PATH']}`);
  vi.stubEnv('OMP_THREAD_LIMIT', '8');

  try {
    await expect(ocr({ width: 1, height: 1, data: new Uint8Array(4) })).rejects.toThrow(
      /^tesseract exited 1: OMP_THREAD_LIMIT=1$/,
    );
  } finally {
    vi.unstubAllEnvs();
    rmSync(bin, { recursive: true });
  }
});

test('an empty image holds no text, rather than being a PNG Tesseract refuses', async () => {
  for (const [width, height] of [
    [0, 0],
    [0, 5],
    [5, 0],
  ] as [number, number][]) {
    const empty = { width, height, data: new Uint8Array(0) };

    expect(await ocr(empty), `${width}×${height}`).toStrictEqual([]);
    expect(await ocrLine(empty), `${width}×${height}`).toBeNull();
  }
});

test('nothing is read before an engine is installed', async () => {
  vi.resetModules();
  const fresh = await import('./ocr.mts');

  await expect(fresh.ocr({ width: 1, height: 1, data: new Uint8Array(4) })).rejects.toThrow(/no OCR engine/);
});
