/**
 * Tesseract compiled to WebAssembly, as an `Engine`: what the Inventory page reads with, there being no CLI to shell
 * out to in a browser. [tesseract.js](https://github.com/naptha/tesseract.js) is the build, Apache-2.0, run in Node for
 * the corpus as well as in the page, so the two can be held to the same answers.
 *
 * **The model is the CLI's**, `eng.traineddata` from `tessdata_fast` 4.1.0 — what both `apt install tesseract-ocr` and
 * `brew install tesseract` put beside the binary — rather than the `best_int` model tesseract.js fetches by default.
 * The readers were tuned against that one, and a different model is a different set of answers before the engine is
 * even asked.
 *
 * **It is checked before anything is read with it.** The tag pins where the model is fetched from, not what comes back,
 * and tesseract.js keeps whatever it got in IndexedDB for every visit after. So each worker's loaded copy is read back
 * out of its file system and held to `MODEL_SHA256`, and a worker holding anything else is never handed a read.
 */

import { createWorker, OEM, type Worker } from 'tesseract.js';
import { type Engine } from './ocr.mts';
import { encodePng } from './png.mts';

/** Where the model is fetched from: pinned to the tag, so the file cannot move under a reader tuned against it. */
export const MODEL = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0';

/** The model's SHA-256: `tessdata_fast` 4.1.0's `eng.traineddata`, which is what the CLI's packages install too. */
export const MODEL_SHA256 = '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2';

export interface WasmOptions {
  /** A directory or URL holding `eng.traineddata`, uncompressed. */
  langPath: string;

  /** How many workers to run side by side, each holding its own copy of the model. */
  workers: number;

  /** The browser's worker script and the directory of cores, which default to a CDN where they are not given. */
  workerPath?: string;
  corePath?: string;

  /**
   * Whether to keep the model once fetched: in IndexedDB in a browser, so a second visit does not download it again,
   * and in the working directory under Node, which a test reading the CLI's own copy has no use for. A kept copy that
   * fails the check is fetched again once rather than refused for good.
   */
  cache: boolean;

  /** How far the model's download has got, from 0 to 1, for a page to show while the first read waits on it. */
  progress?: (fraction: number) => void;
}

/**
 * A pool of workers, each handed one read at a time. A worker runs its jobs in order, but the parameters each read
 * sets are passed with it rather than with `setParameters`, so two reads with different whitelists cannot interleave
 * one's parameters with the other's image. Tesseract saves and restores them around the read.
 *
 * The CLI's `tessedit_create_tsv` is `{ tsv: true }` here: the same renderer, asked for through the API rather than a
 * config variable. `debug_file` silences the `Estimating resolution` line every read otherwise prints, which the CLI
 * writes to a stderr nobody reads.
 *
 * A worker whose read fails is never handed another: it is let go and a fresh one started for whoever is waiting, so
 * a module instance a failure left broken cannot take the next read down with it — however the failure was worded.
 * The wording decides only what the read answers. A trap is the CLI's floating-point exception by another name, an
 * integer division by zero that kills the process there and the module instance here, so it reads as nothing read the
 * way `tesseractCli` answers that; anything else is thrown.
 */
export function tesseractWasm(options: WasmOptions): Engine & { terminate(): Promise<void> } {
  const idle: Worker[] = [];

  /** Every worker started and not yet let go, idle or reading, which is what `terminate` has to stop. */
  const live = new Set<Worker>();

  let closed = false;

  /**
   * Reads queued for a worker, each able to be failed as well as handed one: a worker replaced after a trap is spawned
   * for whoever was waiting, and a spawn that fails has to reach that read rather than leave it waiting for good.
   */
  const waiting: { resolve: (worker: Worker) => void; reject: (error: unknown) => void }[] = [];

  let started = 0;

  const create = (cacheMethod: 'write' | 'refresh' | 'none') =>
    createWorker('eng', OEM.LSTM_ONLY, {
      langPath: options.langPath,
      gzip: false,
      cacheMethod,
      ...(options.workerPath === undefined ? {} : { workerPath: options.workerPath }),
      ...(options.corePath === undefined ? {} : { corePath: options.corePath }),
      logger: (message: { status: string; progress: number }) => {
        if (message.status === 'loading language traineddata') {
          options.progress?.(message.progress);
        }
      },
    });

  /**
   * A worker whose model is the pinned one, the copy it was handed having been read back and hashed. One that fails the
   * check, or fails while being checked, is stopped before anything else is tried: it is in no pool `terminate` can
   * reach until this hands it over, so nothing else would ever stop it.
   *
   * The hash is Web Crypto's, which a browser offers only to a secure context, so a page outside one is told that up
   * front rather than starting a worker it cannot check.
   */
  const verified = async (): Promise<Worker> => {
    if (globalThis.crypto?.subtle === undefined) {
      throw new Error(
        'checking the OCR model needs a secure context: open this page from localhost or the published site',
      );
    }

    for (const cacheMethod of options.cache ? (['write', 'refresh'] as const) : (['none'] as const)) {
      const worker = await create(cacheMethod);
      let sha: string;

      try {
        const { data } = (await worker.FS('readFile', ['./eng.traineddata'])) as { data: Uint8Array };
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(data)));
        sha = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
      } catch (error) {
        await worker.terminate().catch(() => {});
        throw error;
      }

      if (sha === MODEL_SHA256) {
        return worker;
      }

      await worker.terminate();
    }

    throw new Error(`the OCR model from ${options.langPath} is not tessdata_fast 4.1.0's, so nothing was read with it`);
  };

  /**
   * The first worker started while the model is kept, which every later one waits on: a cold cache would otherwise have
   * each of the first few reads' workers fetch the same 4 MB at once, where waiting lets the rest read the first's
   * copy. Whether it started is not waited on — a later worker that finds nothing kept fetches for itself.
   */
  let warm: Promise<unknown> | null = null;

  const spawn = (): Promise<Worker> => {
    if (!options.cache) {
      return verified();
    }

    if (warm === null) {
      const first = verified();
      warm = first.catch(() => undefined);

      return first;
    }

    return warm.then(verified);
  };

  const take = async (): Promise<Worker> => {
    const worker = idle.pop();

    if (worker) {
      return worker;
    }

    if (started < options.workers) {
      started++;

      try {
        const worker = await spawn();

        if (closed) {
          void worker.terminate().catch(() => {});
          throw new Error('the OCR engine was stopped');
        }

        live.add(worker);

        return worker;
      } catch (error) {
        started--;

        // With no worker left alive or starting, nothing will ever hand the queue one, so every read in it fails with
        // this one's reason rather than waiting for good. A worker still alive serves the queue as it frees up.
        if (started === 0) {
          for (const read of waiting.splice(0)) {
            read.reject(error);
          }
        }

        throw error;
      }
    }

    return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
  };

  const give = (worker: Worker) => {
    if (closed) {
      return;
    }

    const next = waiting.shift();

    if (next) {
      next.resolve(worker);
    } else {
      idle.push(worker);
    }
  };

  return {
    tsv: async (image, psm, whitelist) => {
      const worker = await take();
      const parameters: Record<string, string> = { tessedit_pageseg_mode: String(psm), debug_file: '/dev/null' };

      if (whitelist !== undefined) {
        parameters['tessedit_char_whitelist'] = whitelist;
      }

      try {
        const result = await worker.recognize(encodePng(image), parameters, { text: false, tsv: true });
        give(worker);

        return result.data.tsv ?? '';
      } catch (error) {
        live.delete(worker);
        void worker.terminate().catch(() => {});
        started--;

        const next = waiting.shift();

        if (next) {
          take().then(next.resolve, next.reject);
        }

        if (/RuntimeError|divide by zero|unreachable/i.test(String(error))) {
          return '';
        }

        throw new Error(`tesseract.js: ${String(error)}`, { cause: error });
      }
    },

    /**
     * Every worker, idle or part way through a read, and every read still waiting for one, which fails rather than
     * waiting on a pool that will never hand it a worker. A read already under way ends however its worker's stopping
     * ends it, and a worker still starting is stopped as it arrives.
     */
    terminate: async () => {
      closed = true;

      for (const read of waiting.splice(0)) {
        read.reject(new Error('the OCR engine was stopped'));
      }

      idle.length = 0;
      await Promise.all([...live].map((worker) => worker.terminate().catch(() => {})));
      live.clear();
      started = 0;
    },
  };
}
