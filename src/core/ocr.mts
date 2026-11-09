/**
 * Reads text off a screenshot with Tesseract. Pokémon GO is drawn by Unity, so there is no view hierarchy to ask:
 * `uiautomator dump` sees the game as one opaque surface, with only what is drawn over it, as PGSharp's overlay is,
 * views of their own, and the game's pixels are all there is.
 *
 * Which Tesseract is an `Engine`, installed once with `useEngine` by whatever is running the readers: the CLI in
 * `node/ocr-cli.mts` for `pnpm inventory`, and the WebAssembly build in `ocr-wasm.mts` for the Inventory page. Neither
 * is imported here, since each drags in what the other platform lacks — a child process on one side, a `Worker` on the
 * other — and the readers below this have to run on both.
 *
 * Downstream, readers anchor on where text sits wherever the screen offers something to anchor on, rather than on fixed
 * coordinates. The game lays itself out differently on every aspect ratio, and "the line above the HP" holds on all of
 * them where "y = 1180" holds on one. The screen fractions that remain, with nothing to anchor them, are the ones to
 * recalibrate for a new device.
 */

import { type Image } from './png.mts';

/**
 * One way of running Tesseract: the TSV it writes for an image, read in page segmentation mode `psm` and, where a
 * `whitelist` is given, restricted to those characters. TSV rather than the plain text because the readers anchor on
 * where text sits, which only the boxes carry.
 *
 * Both engines answer the same reads the same way only where they hold the same model, and both honour the whitelist
 * only where the LSTM engine reading them is 4.1 or later — earlier releases' ignores it.
 */
export interface Engine {
  tsv(image: Image, psm: number, whitelist?: string): Promise<string>;
}

let engine: Engine | null = null;

/** Hands every read below to `next`, which is how the CLI and the page each pick their Tesseract. */
export function useEngine(next: Engine): void {
  engine = next;
}

/** One line of text as Tesseract grouped it, in the pixels of the image it was read from. */
export interface Line {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Lines of text in an image.
 *
 * Page segmentation mode 11, "sparse text", because a game screen is labels scattered over artwork rather than a page
 * of paragraphs.
 */
export async function ocr(image: Image): Promise<Line[]> {
  return group(await tesseract(image, 11));
}

/**
 * One line of text from an image cropped down to hold nothing else. Page segmentation mode 7 tells Tesseract the whole
 * image is that one line, which is the opposite of the sparse mode above and the right answer whenever a caller has
 * already narrowed the picture to something it knows the shape of. The difference is not small: a band of a screen
 * holding `L1 IV48 5/2/15` over a bright background reads as `r '` sparse and as `L1 1V48 5/2/15` as a line, because
 * sparse mode takes the blocks either side of it for pictures rather than for the margins they are.
 *
 * `whitelist` narrows the alphabet to the characters the line can contain, which is what stops a stray glyph splitting
 * a number in two.
 */
export async function ocrLine(image: Image, whitelist?: string): Promise<string | null> {
  const [line] = group(await tesseract(image, 7, whitelist));

  return line?.text ?? null;
}

/**
 * Lowercase with accents and punctuation gone, so `POKéMON`, `Pokémon` and `pokemon` compare equal. `+` stays, since it
 * is all that tells `Aeroblast`, `Aeroblast+` and `Aeroblast++` apart.
 */
export function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim();
}

/** The first line whose folded text matches, top to bottom. */
export function findLine(lines: readonly Line[], pattern: RegExp): Line | undefined {
  return lines.find((line) => pattern.test(fold(line.text)));
}

export function centre(line: Line): [number, number] {
  return [line.left + line.width / 2, line.top + line.height / 2];
}

interface Word {
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Tesseract's TSV rows grouped into lines. Only word rows are read, which is what passes over the header the CLI writes
 * and the WebAssembly build does not.
 *
 * Words are put in order left to right, and one repeating the word before it and lying mostly over it is dropped, since
 * sparse mode sometimes reads a word twice: `smoliv.png`'s move otherwise reads `© Energy Ball am Ball`, the second
 * `Ball` four pixels right of the first.
 *
 * The box is every word's, glyphs included, so a button read alongside the text as `©` or `=)` stretches it: on
 * `no-pgsharp.png` the line holding `Bubble` starts 74 pixels above the word and runs 119 tall. It is left that way
 * because the readers that pad a box to crop around it are measured against these boxes, and a line's top or height is
 * no more than a rough place to look.
 */
function group(tsv: string): Line[] {
  const lines = new Map<string, Word[]>();

  for (const row of tsv.split('\n')) {
    const cells = row.split('\t');
    const text = cells[11]?.trim();

    if (cells[0] !== '5' || !text) {
      continue;
    }

    const [left, top, width, height] = cells.slice(6, 10).map(Number) as [number, number, number, number];
    const key = cells.slice(1, 5).join('.');
    lines.set(key, [...(lines.get(key) ?? []), { text, left, top, right: left + width, bottom: top + height }]);
  }

  return [...lines.values()]
    .map((words) => {
      const kept: Word[] = [];

      for (const word of words.sort((a, b) => a.left - b.left)) {
        const last = kept.at(-1);

        if (!last || last.text !== word.text || last.right - word.left <= (word.right - word.left) / 2) {
          kept.push(word);
        }
      }

      const left = Math.min(...kept.map((w) => w.left));
      const top = Math.min(...kept.map((w) => w.top));

      return {
        text: kept.map((w) => w.text).join(' '),
        left,
        top,
        width: Math.max(...kept.map((w) => w.right)) - left,
        height: Math.max(...kept.map((w) => w.bottom)) - top,
      };
    })
    .sort((a, b) => a.top - b.top || a.left - b.left);
}

/**
 * Tesseract's TSV for an image, from whichever engine was installed.
 *
 * An empty image reads as nothing without asking — a crop wholly off the edge is one, and libpng refuses a PNG with no
 * width or height as `Invalid IHDR data`.
 */
async function tesseract(image: Image, psm: number, whitelist?: string): Promise<string> {
  if (image.width === 0 || image.height === 0) {
    return '';
  }

  if (engine === null) {
    throw new Error('no OCR engine: `useEngine` has to be called before anything is read');
  }

  return engine.tsv(image, psm, whitelist);
}
