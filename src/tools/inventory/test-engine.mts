/**
 * The Tesseract a test of the readers runs under: the CLI, unless `INVENTORY_OCR=wasm` asks for the WebAssembly build
 * the Inventory page reads with. The corpus is the same corpus either way, so running it both ways is what holds the
 * page to the CLI's answers — a reading that moves under one engine fails the same row it would under the other.
 *
 * The WebAssembly build is handed the CLI's own model rather than a download, so a test reaches no network. The two
 * engines are comparable only where they hold the same file, and `tesseractWasm` refuses any but the one the page
 * fetches, so a CLI installed with another model fails here rather than comparing two different readers.
 */

import { tesseractCli } from './ocr-cli.mts';
import { useEngine } from './ocr.mts';
import { tesseractWasm } from './ocr-wasm.mts';
import { execFileSync } from 'node:child_process';
import { availableParallelism } from 'node:os';

/** Where the CLI keeps its models, as it says itself, which follows `TESSDATA_PREFIX` the way a read would. */
function tessdata(): string {
  const listing = execFileSync('tesseract', ['--list-langs'], { encoding: 'utf8' });
  const dir = /"([^"]+)"/.exec(listing)?.[1];

  if (dir === undefined) {
    throw new Error(`could not find the Tesseract models in: ${listing}`);
  }

  return dir;
}

/** Installs the engine the environment asks for, and answers what to call once the file's reads are done. */
export function useTestEngine(): () => Promise<void> {
  if (process.env['INVENTORY_OCR'] !== 'wasm') {
    useEngine(tesseractCli);

    return () => Promise.resolve();
  }

  return useWasmEngine();
}

/**
 * The WebAssembly build whatever the environment asks for, which is what the battle readers' tests run under: `pnpm
 * battle` and the Battle tab both read with it, so the CLI's answers are no reader's to keep.
 */
export const wasmEngine = () => tesseractWasm({ langPath: tessdata(), workers: availableParallelism(), cache: false });

/** Installs `wasmEngine`, and answers what to call once the file's reads are done. */
export function useWasmEngine(): () => Promise<void> {
  const engine = wasmEngine();
  useEngine(engine);

  return () => engine.terminate();
}
