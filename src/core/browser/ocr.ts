/**
 * The WebAssembly Tesseract as a page or the battle's Worker starts it. Apart from `fetch.ts` because it brings
 * tesseract.js, which esbuild cannot shake out of whatever imports this.
 */

import { TESSERACT_VENDOR } from '../../generated.js';
import { MODEL, tesseractWasm } from '../ocr-wasm.mts';

/**
 * How many workers to read with at most. Each holds its own copy of the model and its own WebAssembly heap, which on a
 * phone is the thing that runs out first, and a screen's reads are a few dozen bands rather than a queue worth eight.
 */
const MAX_WORKERS = 4;

/**
 * The WebAssembly Tesseract, its worker and cores found against `base`, the page's URL. Tesseract.js resolves a
 * relative path against the page itself, but in a Worker it takes one as it is, and the worker it starts from a blob
 * has no URL of its own to resolve one against, so a battle's Worker hands its page's.
 */
export function wasmEngine(base: string, progress?: (fraction: number) => void) {
  return tesseractWasm({
    langPath: MODEL,
    workers: Math.min(navigator.hardwareConcurrency || 1, MAX_WORKERS),
    workerPath: new URL(TESSERACT_VENDOR + 'worker.min.js', base).href,
    corePath: new URL(TESSERACT_VENDOR, base).href,
    cache: true,
    ...(progress && { progress }),
  });
}
