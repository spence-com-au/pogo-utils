/**
 * The phone's screen drawn into the terminal by the [Kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/),
 * which Kitty, Ghostty and WezTerm speak. Each frame goes as a temporary file the terminal reads and deletes, so only
 * its path passes through the terminal: a frame at `streamSize` is 1.2 MB of pixels, which written into the escape
 * itself took 10ms to compress and went out 600 KB at a time through stderr, which Node writes to a terminal
 * synchronously, holding up the taps.
 */

import { type Image } from '../../../core/png.mts';
import { type Size } from '../layout.mts';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** How long the terminal is given to answer, in milliseconds: one that answers at all does so at once. */
const QUERY_MS = 1_000;

/** The picture every frame replaces, by its id, and the one the query asks after, which draws nothing. */
const ID = 1;
const QUERY_ID = 31;

/** An escape of the protocol, with its keys, and `path` as its payload; `q=2` keeps the terminal from answering it. */
const escape = (keys: string, path = '') => `\x1b_G${keys},q=2;${Buffer.from(path).toString('base64')}\x1b\\`;

/** The picture taken off the screen. */
export const ERASE = escape(`a=d,d=I,i=${ID}`);

export interface Graphics {
  /** The size of one cell in pixels, which says how many columns a picture so many rows tall takes. */
  cell: Size;

  /**
   * `image` drawn `rows` tall from the cursor, which stays where it is, replacing the picture drawn before, or nothing
   * where its file cannot be written.
   */
  picture(image: Image, rows: number): string;

  /** The temporary files gone, any the terminal has not yet read among them. */
  close(): void;
}

/**
 * Pictures for the terminal at `input` and `output`, or `undefined` where it cannot draw them from a file. Asked as the
 * protocol advises: a query for a 1×1 picture in a file, the cell's size, and then the primary device attributes, which
 * every terminal answers, so one that has said nothing of the first two by then is known not to draw.
 */
export async function pictures(input: NodeJS.ReadStream, output: NodeJS.WriteStream): Promise<Graphics | undefined> {
  // The terminal deletes each file once read, and only from a path naming the protocol, so that an escape cannot be
  // used to delete anything else.
  const dir = mkdtempSync(join(tmpdir(), 'tty-graphics-protocol-'));
  const probe = join(dir, 'query');
  writeFileSync(probe, new Uint8Array(3));

  let answer = '';
  input.setRawMode(true);
  input.resume();

  try {
    await new Promise<void>((resolve) => {
      const heard = (chunk: Buffer) => {
        answer += chunk.toString('latin1');

        // The device attributes, matched past their escape: nothing else the query is answered with ends `c`.
        if (/\[\?[\d;]*c/.test(answer)) {
          stop();
        }
      };

      const stop = () => {
        clearTimeout(timer);
        input.off('data', heard);
        resolve();
      };

      const timer = setTimeout(stop, QUERY_MS);

      input.on('data', heard);
      output.write(
        `\x1b_Ga=q,i=${QUERY_ID},t=t,f=24,s=1,v=1;${Buffer.from(probe).toString('base64')}\x1b\\\x1b[16t\x1b[c`,
      );
    });
  } finally {
    input.setRawMode(false);
    input.pause();
  }

  const [, cellHeight, cellWidth] = /\[6;(\d+);(\d+)t/.exec(answer) ?? [];

  if (!answer.includes(`\x1b_Gi=${QUERY_ID};OK\x1b\\`) || !cellHeight || !cellWidth) {
    rmSync(dir, { recursive: true, force: true });

    return undefined;
  }

  // A file of its own for each frame, as the terminal may still be reading the last.
  let sent = 0;

  return {
    cell: { width: Number(cellWidth), height: Number(cellHeight) },
    picture({ width, height, data }, rows) {
      const path = join(dir, `${sent++}.rgba`);

      // A frame that cannot be written — the temporary directory full or gone — leaves the last on the screen rather
      // than throwing from the panel's timers, where it would be uncaught and skip putting the phone's setting back.
      try {
        writeFileSync(path, data);
      } catch {
        return '';
      }

      return escape(`a=T,i=${ID},t=t,f=32,s=${width},v=${height},r=${rows},C=1`, path);
    },
    close: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** How many columns `image` takes drawn `rows` tall in cells `cell` big, its shape kept as the terminal keeps it. */
export const columnsFor = ({ width, height }: Size, rows: number, cell: Size) =>
  Math.ceil((rows * cell.height * width) / (height * cell.width));
