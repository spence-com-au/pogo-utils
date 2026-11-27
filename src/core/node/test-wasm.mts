/**
 * The WebAssembly build of Tesseract as a test runs it, whatever `INVENTORY_OCR` asks for: `pnpm battle` and the
 * Battle tab both read with it, so the battle readers' tests hold no CLI answers to keep. A test whose engine follows
 * the environment takes it from `test-engine.mts` instead.
 *
 * The build is handed the CLI's own model rather than a download, so a test reaches no network. The two engines are
 * comparable only where they hold the same file, and `tesseractWasm` refuses any but the one the page fetches, so a CLI
 * installed with another model fails here rather than comparing two different readers.
 */

import { useEngine } from '../ocr.mts';
import { tesseractWasm } from '../ocr-wasm.mts';
import { execFileSync } from 'node:child_process';
import { availableParallelism } from 'node:os';

/** Where the CLI keeps its models, as it says itself, which follows `TESSDATA_PREFIX` the way a read would. */
export function tessdata(): string {
  const listing = execFileSync('tesseract', ['--list-langs'], { encoding: 'utf8' });
  const dir = /"([^"]+)"/.exec(listing)?.[1];

  if (dir === undefined) {
    throw new Error(`could not find the Tesseract models in: ${listing}`);
  }

  return dir;
}

export const wasmEngine = () => tesseractWasm({ langPath: tessdata(), workers: availableParallelism(), cache: false });

/** Installs `wasmEngine`, and answers what to call once the file's reads are done. */
export function useWasmEngine(): () => Promise<void> {
  const engine = wasmEngine();
  useEngine(engine);

  return () => engine.terminate();
}
