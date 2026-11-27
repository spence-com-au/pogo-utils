/**
 * The Tesseract a test of the readers runs under: the CLI, unless `INVENTORY_OCR=wasm` asks for the WebAssembly build
 * the pages read with. The captures are the same either way and CI runs the suite both ways, so a reading that
 * moves under one engine fails the same row it would under the other. What the two do not share is which route a CP
 * took to its reading, so the tests that pin that hold an expectation for each, and `ON_WASM` is what picks one.
 *
 * This is the one module that reads `INVENTORY_OCR`, so the tests importing it are the ones the WebAssembly leg in
 * `test.yaml` runs, found by `vitest related` on this file: every other test reads the same under either.
 */

import { tesseractCli } from './ocr-cli.mts';
import { useWasmEngine } from './test-wasm.mts';
import { useEngine } from '../ocr.mts';

/** Whether the environment asks for the WebAssembly build rather than the CLI. */
export const ON_WASM = process.env['INVENTORY_OCR'] === 'wasm';

/** Installs the engine the environment asks for, and answers what to call once the file's reads are done. */
export function useTestEngine(): () => Promise<void> {
  if (!ON_WASM) {
    useEngine(tesseractCli);

    return () => Promise.resolve();
  }

  return useWasmEngine();
}
