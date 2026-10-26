/**
 * The Tesseract CLI as an `Engine`, which is what `pnpm inventory` reads with. It has to be installed separately
 * (`brew install tesseract`, `apt install tesseract-ocr`) at 4.1 or later, since earlier releases' LSTM engine ignores
 * the whitelist `ocrLine` narrows a read with.
 */

import { type Engine } from './ocr.mts';
import { execFile } from 'node:child_process';

/**
 * Tesseract's TSV for an image, in page segmentation mode `psm`.
 *
 * Asked for with `tessedit_create_tsv` rather than the `tsv` config file, which a `TESSDATA_PREFIX` pointing at a
 * models-only download lacks and without which Tesseract writes plain text and still exits 0. OpenMP is held to one
 * thread, as `man tesseract` advises, because callers run reads side by side and each one's threads spin-wait against
 * the others': pinned to four cores, a pair of full-screen reads took a median 12 seconds against 0.3.
 *
 * A floating-point exception counts as reading nothing, it being the image rather than the machine that causes it:
 * Tesseract 5.3.4 dies of one every time on some whitelisted bands.
 *
 * The image goes in as a PAM, its pixels as they are behind a few lines of header, rather than a PNG: Tesseract reads
 * both the same, and deflating a PNG cost Node 40–50ms a full screen and some 7ms a battle's band, where a PAM costs
 * Tesseract no more than 12ms extra to read.
 */
export const tesseractCli: Engine = {
  tsv: (image, psm, whitelist) => {
    const options = whitelist === undefined ? [] : ['-c', `tessedit_char_whitelist=${whitelist}`];

    return new Promise((resolve, reject) => {
      const child = execFile(
        'tesseract',
        ['stdin', 'stdout', '--psm', String(psm), '-c', 'tessedit_create_tsv=1', ...options],
        { env: { ...process.env, OMP_THREAD_LIMIT: '1' } },
        (error, stdout, stderr) => {
          if (!error) {
            resolve(stdout);
          } else if (error.signal === 'SIGFPE') {
            resolve('');
          } else if (typeof error.code === 'string') {
            const hint = error.code === 'ENOENT' ? '; install Tesseract and put it on PATH' : '';
            reject(new Error(`could not run tesseract (${error.message})${hint}`));
          } else {
            const status = error.signal ? `killed by ${error.signal}` : `exited ${error.code}`;
            reject(new Error(`tesseract ${status}: ${stderr.trim()}`));
          }
        },
      );

      // A Tesseract that fails before reading its input closes the pipe under an image too big to buffer, and the EPIPE
      // would otherwise be an unhandled error that kills Node before the exit status above can say what went wrong.
      child.stdin?.on('error', () => {});
      child.stdin?.write(
        `P7\nWIDTH ${image.width}\nHEIGHT ${image.height}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`,
      );
      child.stdin?.end(image.data);
    });
  },
};
