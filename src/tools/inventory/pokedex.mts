/**
 * The Pokédex, read off the phone: an entry's title, its forms, its genders, the tiles of its CAUGHT tab and its
 * costumes, and the counts a tab's region list prints. `pokedex-walk.mts` drives the phone from one to the next, and
 * this says what each screenshot holds, reaching the screen only through the OCR engine installed.
 *
 * **Every measurement is a fraction of the width.** The game lays the Pokédex out across the screen and lets it run as
 * far down as it needs, so a tile is the same fraction of the width on any phone of the shape and starts wherever the
 * rows above it end. Each was measured on a Pixel 4 XL's 1440x3040, off the captures under `fixtures/pokedex/`.
 *
 * **The entry is read as tiles.** Its form row, the CAUGHT tab's categories and the costumes below them are all pale
 * tiles over the backdrop, so one test finds all three, and one more says what a tile holds: the game's icon where
 * that is registered, the icon's silhouette in one flat colour where it is not, and nothing in an empty slot.
 */

import { closest, distance, type Form, type GameData } from '../../core/game-master.mts';
import { centre, fold, ocr, type Line } from '../../core/ocr.mts';
import { crop, luminance, median, threshold, type Image } from '../../core/png.mts';
import { GENERATIONS, regionOf } from '../../pokemon/generations.ts';

/**
 * A four-digit number followed by a name, which is the shape of the entry's title and of nothing else on the screen.
 * Four digits and no more, so the tail of a longer run — a glyph read as a `9` ahead of `0032` — is not taken for one.
 *
 * Searched anywhere in the folded line rather than anchored, because the game draws a circular-arrows glyph ahead of
 * the number: it folds away to nothing, reading as `©`, and an anchor would be betting that it never reads as a letter.
 * The name is matched loosely for the same reason and checked strictly below, and takes digits after its first letter
 * for `Porygon2`.
 */
const TITLE = /(?<!\d)(\d{4})\s+([a-z][a-z0-9 ]*)/;

/**
 * Which species a Pokédex entry screen is showing, as its dex number, or null where the screen does not say so beyond
 * doubt.
 *
 * `data` is here for the cross-check rather than for the lookup: the number names a species, the line names one too,
 * and the two have to be the same species before either is believed. That is what makes the `SEEN` and `CAUGHT`
 * counters inert — 2763 is no species, and a count that did happen to land on a dex number carries no name beside it.
 *
 * The name is compared by exact folded equality rather than through `closest`. Slack exists to rescue a reading that
 * is the only evidence there is; this reading is a check on a number that already answered, so slack would only widen
 * what the check lets past. Both Nidoran fold to `nidoran` and pass it, which is the point: the check says the line
 * agrees, and the **number** says which of the two. The species has to lead the line rather than be the whole of it,
 * since what follows the name is OCR's reading of the `♀` or `♂` the name lost — `NIDORAN d` is still Nidoran.
 */
export function dexOn(lines: readonly Line[], data: GameData): number | null {
  const found = new Set<number>();

  for (const line of lines) {
    const match = TITLE.exec(fold(line.text));

    if (!match) {
      continue;
    }

    const [, digits = '', printed = ''] = match;
    const dex = Number(digits);
    const species = data.forms.find((f) => f.dex === dex)?.species;

    const name = printed.trim();

    if (species !== undefined && (name === fold(species) || name.startsWith(`${fold(species)} `))) {
      found.add(dex);
    }
  }

  // One line agreeing with itself is the whole of what this can be sure of. Two that disagree are a screen mid-swipe
  // between entries, which the game really does draw and a capture really does catch, and picking either would be
  // guessing at which half the walk is standing on.
  const [only] = found;

  return found.size === 1 && only !== undefined ? only : null;
}

/** A rectangle of a screenshot, in its pixels. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * How far down the screen to count a tile as clear of what the game draws over the entry, as fractions of the height:
 * below the CAUGHT, INFO and BATTLE header that pins itself to the top once the entry scrolls under it, and above the
 * close button at the foot. A tile outside is under one or the other, so it is read from a frame that shows it whole.
 */
const CLEAR = { from: 0.14, to: 0.89 } as const;

/**
 * Where the centres of the four columns of the CAUGHT tab's tiles are, the costumes' among them: the middle of each of
 * the labels `SHINY`, `★ 100%` and `LUCKY` on `bulbasaur-2.png`, and of `XXL` beneath the first.
 */
const COLUMNS = [0.1597, 0.3861, 0.6132, 0.8403] as const;

/** A tile of the CAUGHT tab's, and a costume's: 309 by 420 pixels of the 1440, 436 down from one row to the next. */
const TILE = { width: 0.2146, height: 0.2917, row: 0.3028 } as const;

/**
 * Where a tile's label ends above its foot. The labels are what OCR reads, so the tile is found from its label: up by
 * this from the label's bottom, then up a tile's height.
 */
const LABEL_FOOT = 0.023;

/**
 * Where the game draws a tile's icon: 1.25 times the 256 pixels `pogo_assets` draws it at, which is 320 of the 1440,
 * centred across the tile and this far down from its top. Measured by fitting `pm1.icon.png` and
 * `pm1.fFALL_2019.icon.png` to Bulbasaur's own tile and costume, which put both at 1.24 to 1.27.
 */
const ICON = { size: 0.2222, from: 0.0326 } as const;

/** How far below the CAUGHT tab's header the first row of its tiles starts. */
const HEADER_TO_TILES = 0.129;

/** How far below the `Costume` heading the first row of costumes starts. */
const HEADING_TO_TILES = 0.046;

const at = (image: Image, x: number, y: number) => (Math.round(y) * image.width + Math.round(x)) * 4;

/** One pixel's three channels, or black for one off the image. */
function pixel(image: Image, x: number, y: number): [number, number, number] {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    return [0, 0, 0];
  }

  const p = at(image, x, y);

  return [image.data[p] ?? 0, image.data[p + 1] ?? 0, image.data[p + 2] ?? 0];
}

/** How far apart two colours are, summed over the channels. */
const apart = (a: readonly number[], b: readonly number[]) =>
  Math.abs((a[0] ?? 0) - (b[0] ?? 0)) + Math.abs((a[1] ?? 0) - (b[1] ?? 0)) + Math.abs((a[2] ?? 0) - (b[2] ?? 0));

/**
 * `keep`'s pixels black on white at half the size, which is what OCR is handed. Half, because the Pokédex's text is
 * large — the title 68 pixels tall, a tile's label 30 — and Tesseract takes a third of the time over a quarter of the
 * pixels: two passes over `bulbasaur-2.png` cost 1.6 seconds this way and 4.4 at full size, reading more.
 */
function inked(image: Image, keep: (rgb: [number, number, number]) => boolean): Image {
  const width = Math.floor(image.width / 2);
  const height = Math.floor(image.height / 2);
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = keep(pixel(image, x * 2, y * 2)) ? 0 : 255;

      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }

  return { width, height, data };
}

/**
 * Every line of text an entry or a region list carries, in the screenshot's pixels: read once for the white text — the
 * title, the headings, the counters, the forms' labels — and once for the dark, which is the tiles' labels.
 *
 * Twice, because neither reads both. Over the whole screen as it is, Tesseract finds the tiles' dark labels and not one
 * line of the white text on its pale backdrop: on `bulbasaur-0.png` no title, no `CAUGHT` and no counter. Each pass
 * hands it one colour of text as black on white, the colour itself being what tells the text from the backdrop.
 */
export async function pokedexLines(image: Image): Promise<Line[]> {
  const white = ([r, g, b]: [number, number, number]) => Math.min(r, g, b) >= 235;
  const dark = ([r, g, b]: [number, number, number]) => Math.max(r, g, b) <= 110;
  const passes = await Promise.all([ocr(inked(image, white)), ocr(inked(image, dark))]);

  return passes
    .flat()
    .map((l) => ({ ...l, left: l.left * 2, top: l.top * 2, width: l.width * 2, height: l.height * 2 }))
    .sort((a, b) => a.top - b.top || a.left - b.left);
}

/** What a tile holds: the icon in its own colours, its silhouette in one flat colour, or nothing at all. */
export type Look = 'icon' | 'silhouette' | 'empty';

/**
 * How much of a box has to stand out from its backdrop for a tile to hold anything. An empty slot is backdrop through
 * and through but for the light lines of the pattern behind it, which stand out over well under one percent.
 */
const FILLED = 0.015;

/**
 * How much of what stands out has to be one colour for it to be a silhouette. A silhouette is the icon's shape filled
 * with the backdrop darkened, so everything inside it is within a few steps of everything else, its anti-aliased edge
 * aside; an icon is drawn in its own colours, shaded and outlined. Over the 166 tiles of the CAUGHT tabs under
 * `fixtures/pokedex/`, no icon came out flatter than 0.37 (Galarian Meowth's own) and no silhouette less flat than 0.70
 * (Charizard's MEGA Y), so this sits between the two. The form row's silhouettes are a dark slate rather than the
 * backdrop darkened, and as flat: Unown's run 0.76 against 0.09 for a letter registered, its eye white on black.
 */
const FLAT = 0.55;

/**
 * What the tile at `box` holds. Its backdrop is the median of the strip along its top, which is clear of the icon and
 * of the small glyph in a category tile's corner; a pixel stands out where it is far from that, and the ones that do
 * are a silhouette where most of them are within a few steps of their own median colour.
 */
export function lookOf(image: Image, box: Box): Look {
  return flatness(image, box).look;
}

/** `lookOf`'s working: how much of the box stands out, and how much of that is one colour. */
export function flatness(image: Image, box: Box): { filled: number; flat: number; look: Look } {
  const step = Math.max(1, Math.round(box.width / 80));
  const strip: [number, number, number][] = [];

  // Far enough in to be past the white frame round the form showing, and the tile's own rounded edge.
  for (let x = box.left + box.width * 0.4; x < box.left + box.width * 0.9; x += step) {
    strip.push(pixel(image, x, box.top + box.height * 0.07));
  }

  const backdrop = [0, 1, 2].map((c) => median(strip.map((p) => p[c] ?? 0)));
  const standing: [number, number, number][] = [];
  let asked = 0;

  // Between the glyph in a category tile's top corner and the label along its foot, both dark, either of which would
  // pass for a dark patch of an icon.
  for (let y = box.top + box.height * 0.25; y < box.top + box.height * 0.82; y += step) {
    for (let x = box.left + box.width * 0.1; x < box.left + box.width * 0.9; x += step) {
      const p = pixel(image, x, y);
      asked++;

      if (apart(p, backdrop) > 45) {
        standing.push(p);
      }
    }
  }

  const filled = standing.length / asked;

  if (filled < FILLED) {
    return { filled, flat: 0, look: 'empty' };
  }

  const middle = [0, 1, 2].map((c) => median(standing.map((p) => p[c] ?? 0)));
  const flat = standing.filter((p) => apart(p, middle) <= 30).length / standing.length;

  return { filled, flat, look: flat >= FLAT ? 'silhouette' : 'icon' };
}

const brightness = ([r = 0, g = 0, b = 0]: readonly number[]) => luminance(r, g, b);

/** A box `width` and `height` wide, as fractions of the screen's width, around the column at `x` from `top`. */
const tileAt = (image: Image, x: number, top: number): Box => ({
  left: image.width * (x - TILE.width / 2),
  top,
  width: image.width * TILE.width,
  height: image.width * TILE.height,
});

/** Whether a tile is clear of what the game draws over the entry, by `CLEAR`. */
const clear = (image: Image, box: Box) =>
  box.top >= image.height * CLEAR.from && box.top + box.height <= image.height * CLEAR.to;

/**
 * The CAUGHT tab's categories as the entry names them, under the keys the record writes, in the order the game draws
 * them: Charizard's run `XXS`, `MEGA X`, `MEGA Y`, `G-MAX`.
 */
export const CATEGORIES = {
  shiny: 'SHINY',
  perfect: '100%',
  lucky: 'LUCKY',
  xxl: 'XXL',
  xxs: 'XXS',
  mega: 'MEGA',
  megaX: 'MEGA X',
  megaY: 'MEGA Y',
  gmax: 'G-MAX',
  shadow: 'SHADOW',
  purified: 'PURIFIED',
} as const;

export type Category = keyof typeof CATEGORIES;

const KEYS = Object.keys(CATEGORIES) as Category[];

/**
 * The category a label names, or null for text that is none. `★ 100%` reads as `* 100%` and `*& 100%`, so it is the
 * number that names it; the rest go to the nearest name, and a reading as near two of them — `XXI`, one letter off both
 * `XXL` and `XXS` — names neither.
 */
export function categoryOf(text: string): Category | null {
  if (/(?<!\d)100(?!\d)/.test(fold(text))) {
    return 'perfect';
  }

  const named = KEYS.filter((key) => key !== 'perfect');
  const best = closest(text, named, (key) => CATEGORIES[key]);

  if (best === null) {
    return null;
  }

  const gap = distance(text, CATEGORIES[best]);

  return named.filter((key) => distance(text, CATEGORIES[key]) === gap).length === 1 ? best : null;
}

/** A tile of the CAUGHT tab, where it is and what it holds; `category` is null for the first, the form's own. */
export interface Caught {
  category: Category | null;
  box: Box;
  look: Look;
}

/** The column whose centre is nearest `x`, a pixel across a screen `width` wide. */
const columnOf = (x: number, width: number) =>
  COLUMNS.reduce(
    (best, column, i) => (Math.abs(column * width - x) < Math.abs((COLUMNS[best] ?? 0) * width - x) ? i : best),
    0,
  );

/** The line the CAUGHT, INFO and BATTLE tabs share, by its `INFO`, which is short enough to read whole. */
const headerOf = (lines: readonly Line[]) => lines.find((l) => /^info$/.test(fold(l.text)));

/**
 * The tiles of the CAUGHT tab one screenshot shows whole: one per label read, the tile being up from it by `LABEL_FOOT`
 * and a tile's height; and the first, which carries no label, where the header above the tiles is on the screen to say
 * where their first row starts.
 */
export function caughtOn(image: Image, lines: readonly Line[]): Caught[] {
  const found: Caught[] = [];

  for (const line of lines) {
    const category = categoryOf(line.text);

    if (category === null) {
      continue;
    }

    const [x] = centre(line);
    const foot = line.top + line.height + image.width * LABEL_FOOT;
    const box = tileAt(image, COLUMNS[columnOf(x, image.width)] ?? 0, foot - image.width * TILE.height);

    if (clear(image, box)) {
      found.push({ category, box, look: lookOf(image, box) });
    }
  }

  const header = headerOf(lines);

  if (header) {
    const box = tileAt(image, COLUMNS[0], header.top + header.height + image.width * HEADER_TO_TILES);

    if (clear(image, box)) {
      found.push({ category: null, box, look: lookOf(image, box) });
    }
  }

  return found;
}

/** The heading over an entry's costumes. */
const costumeHeadingOf = (lines: readonly Line[]) => lines.find((l) => /^costumes?$/.test(fold(l.text)));

/**
 * The button under everything an entry shows, `SEE ALL BULBASAUR`, which is how the foot of one is known. The words
 * are matched without the space after them, which OCR drops as often as not: `SEE ALLIVYSAUR`.
 */
export const seeAllOf = (lines: readonly Line[]) => lines.find((l) => /^see ?all/.test(fold(l.text)));

/**
 * The rows of tiles down the first column between `from` and `to`, as their tops, found by the tile being paler than
 * the gap between the first column and the second at the same height: the backdrop shows through both, and only the
 * tile lays its white over it. Measured on `bulbasaur-2.png`, the tile's red runs 20 to 30 above the gap's.
 *
 * Down a strip near the tile's left edge rather than its middle, which is where the icon is: a silhouette is darker
 * than the backdrop, and would end a row halfway down.
 */
export function rowsBetween(image: Image, from: number, to: number): number[] {
  const inside = image.width * (COLUMNS[0] - TILE.width / 2 + 0.02);
  const gap = image.width * ((COLUMNS[0] + COLUMNS[1]) / 2);
  const tall = image.width * TILE.height;
  const tops: number[] = [];
  let run: number | null = null;

  for (let y = Math.max(0, from); y < Math.min(image.height, to); y += 2) {
    const tile = pixel(image, inside, y)[0] - pixel(image, gap, y)[0] > 10;

    if (tile && run === null) {
      run = y;
    } else if (!tile && run !== null) {
      // A run as tall as a tile is one; a shorter one is a stray line of the pattern, or a tile cut off at either end.
      if (y - run > tall * 0.9 && y - run < tall * 1.1) {
        tops.push(run);
      }

      run = null;
    }
  }

  return tops;
}

/** The costumes one screenshot shows whole, as the box of each. */
export function costumesOn(image: Image, lines: readonly Line[], below: boolean): Box[] {
  const heading = costumeHeadingOf(lines);
  const foot = seeAllOf(lines)?.top ?? image.height;

  // Below the heading where it is on the screen; where it is not, below everything if an earlier screenshot has shown
  // the heading above this one's top, and nothing otherwise.
  const from = heading ? heading.top + heading.height + image.width * HEADING_TO_TILES * 0.5 : below ? 0 : null;

  if (from === null) {
    return [];
  }

  const boxes: Box[] = [];

  for (const top of rowsBetween(image, from, foot)) {
    for (const column of COLUMNS) {
      const box = tileAt(image, column, top);

      if (clear(image, box) && lookOf(image, box) !== 'empty') {
        boxes.push(box);
      }
    }
  }

  return boxes;
}

/** A tile of the form row: where it is, what it holds, and whether its white frame says it is the form showing. */
export interface FormTile {
  box: Box;
  look: Look;
  selected: boolean;
}

/**
 * The form row's tiles between `from` and `to`, or none for an entry with one form. They are found as the categories'
 * rows are, by being paler than the backdrop, but with no columns to go by: the game centres one row of up to five and
 * wraps the rest, so every run of pale pixels across a row is a tile.
 *
 * The backdrop's colour at a height is taken at the left margin, which no tile reaches.
 */
export function formsOn(image: Image, from: number, to: number): FormTile[] {
  const margin = image.width * 0.03;
  const pale = (x: number, y: number) => pixel(image, x, y)[0] - pixel(image, margin, y)[0] > 10;
  const step = 4;
  const rows: [number, number][] = [];
  let run: number | null = null;

  // Rows of tiles first, by how much of each line across the band is pale: a row of one tile is pale over a seventh
  // of the width, and a line between rows over nothing.
  for (let y = from; y < to; y += step) {
    let count = 0;

    for (let x = margin; x < image.width - margin; x += step) {
      count += Number(pale(x, y));
    }

    const inRow = count * step > image.width * 0.08;

    if (inRow && run === null) {
      run = y;
    } else if (!inRow && run !== null) {
      const last = rows.at(-1);

      // A run that starts within a few lines of the last one's end, and makes no more than a tile with it, is that
      // row going on: a row of icons dark all the way across leaves little pale at their middle, as Unown's first five
      // do, where the gap between two rows is pale nowhere for twice as long. A label under its tile is as near, but
      // with its tile is taller than a tile.
      if (last && run - last[1] < image.width * 0.03 && y - last[0] < image.width * 0.16) {
        last[1] = y;
      } else {
        rows.push([run, y]);
      }

      run = null;
    }
  }

  const tall = image.width * 0.1;
  const tiles: FormTile[] = [];

  for (const [top, bottom] of rows.filter(([a, b]) => b - a > tall)) {
    let start: number | null = null;

    for (let x = margin; x < image.width - margin + step; x += step) {
      let count = 0;

      for (let y = top; y < bottom; y += step) {
        count += Number(pale(x, y));
      }

      // Pale over a sixth of the row's height is a tile: a silhouette as big as Paldean Tauros's leaves little more of
      // its tile pale than the margins above and below it, where the gap between two tiles is pale nowhere.
      const inTile = count * step > (bottom - top) * 0.16;

      if (inTile && start === null) {
        start = x;
      } else if (!inTile && start !== null) {
        if (x - start > tall) {
          const box = { left: start, top, width: x - start, height: bottom - top };

          tiles.push({ box, look: lookOf(image, box), selected: framed(image, box) });
        }

        start = null;
      }
    }
  }

  return tiles;
}

/** Whether a form tile wears the white frame of the form showing, down the middle of its left edge. */
export const framed = (image: Image, box: Box) =>
  Array.from({ length: 8 }, (_, i) => pixel(image, box.left + 2, box.top + box.height * (0.3 + i * 0.05))).every(
    (p) => Math.min(...p) >= 215,
  );

/**
 * What each form tile's label says, or null for one with none. Each is read on its own and at full size: two labels
 * side by side come back from one read as one line — `Blaze Breed Aqua Breed` — and the small ones, `Combat Breed` and
 * `Incarnate Forme`, do not read at the half size the rest of the screen is read at. A tile with no white under it is
 * not asked about, which is every one of Unown's.
 */
export async function labelsOf(image: Image, tiles: readonly FormTile[]): Promise<(string | null)[]> {
  return Promise.all(
    tiles.map(async ({ box }) => {
      const top = box.top + box.height;
      const height = image.width * 0.07;
      let white = 0;

      for (let y = top; y < top + height; y += 3) {
        for (let x = box.left; x < box.left + box.width; x += 3) {
          white += Number(Math.min(...pixel(image, x, y)) >= 220);
        }
      }

      if (white < 10) {
        return null;
      }

      const strip = crop(image, box.left - box.width * 0.1, top, box.width * 1.2, height);
      const [line] = await ocr(threshold(strip, (r, g, b) => Math.min(r, g, b) >= 220));

      return line?.text ?? null;
    }),
  );
}

/** Which genders an entry draws, and whether each is registered: drawn solid where it is, dashed where it is not. */
export interface Genders {
  male?: boolean;
  female?: boolean;
}

/** The line under the row of gender and type icons that only it carries, `ALERT OFF` or `ALERT ON`. */
export const alertOf = (lines: readonly Line[]) => lines.find((l) => /^alert\b/.test(fold(l.text)));

/** How far above the `ALERT` label the middle of the row of icons is. */
const ALERT_TO_ICONS = 0.067;

/** A mark of an icon's: where it is, and whether it is the white of a glyph. */
interface Mark {
  x: number;
  y: number;
  white: boolean;
}

/**
 * The genders an entry draws, from the icons left of its types. A registered gender is a disc in its colour, ♂ blue and
 * ♀ red; one not registered is its glyph in a dashed white ring; and a species with no gender draws a white ring with
 * nothing in it, which says nothing either way. ♂ comes first where both are drawn.
 *
 * So two icons are ♂ then ♀, solid or dashed, and one is told by its colour where it has one and by its glyph where it
 * is white: ♂'s arrow points up to the right, where ♀ has nothing, and ♀'s cross hangs below. Measured inside the ring
 * on `golem-0.png` and `ivysaur-0.png`, a dashed ♂ carries 68 marks to the upper right against 24 below, where a dashed
 * ♀ carries 30 and 32; and Unown's ring on `unown-2.png` carries none inside at all, where every dashed glyph has over
 * a hundred.
 */
export function gendersOn(image: Image, lines: readonly Line[]): Genders {
  const alert = alertOf(lines);

  if (!alert) {
    return {};
  }

  // The types are the labels on the alert's own line left of it, and the gender icons are what comes before them.
  const types = lines.filter((l) => Math.abs(l.top - alert.top) < alert.height && l.left < alert.left);
  const end = Math.min(...types.map((l) => l.left), alert.left) - image.width * 0.03;
  const middle = alert.top - image.width * ALERT_TO_ICONS;
  const reach = image.width * 0.04;
  const step = 2;
  const backdrop = pixel(image, image.width * 0.02, middle);
  const icons: Mark[][] = [];
  let last = -Infinity;

  for (let x = image.width * 0.02; x < end; x += step) {
    const marks: Mark[] = [];

    for (let y = middle - reach; y < middle + reach; y += step) {
      const seen = pixel(image, x, y);

      if (apart(seen, backdrop) >= 60) {
        marks.push({ x, y, white: Math.min(...seen) >= 200 });
      }
    }

    // Icons are runs of columns with something in them, a gap of the backdrop between each.
    if (marks.length > 0) {
      if (x - last > step * 3) {
        icons.push([]);
      }

      icons.at(-1)?.push(...marks);
      last = x;
    }
  }

  // Wider than the line between the genders and the types, which is a column or two of pale, and no wider than an icon
  // with the white ring round the one selected, 0.093 of the width: Unown's last row of forms ends just above its row
  // of icons, and the foot of its tiles reads as one mark across half the screen.
  const width = (marks: readonly Mark[]) => Math.max(...marks.map((m) => m.x)) - Math.min(...marks.map((m) => m.x));
  const drawn = icons.filter((marks) => width(marks) > image.width * 0.02 && width(marks) < image.width * 0.12);

  if (drawn.length === 2) {
    const [male, female] = drawn.map((marks) => solid(image, marks));

    return { male: male !== null, female: female !== null };
  }

  const [only] = drawn;

  if (drawn.length !== 1 || !only) {
    return {};
  }

  const colour = solid(image, only);

  if (colour !== null) {
    return { [colour]: true };
  }

  const glyph = glyphOf(only);

  return glyph === null ? {} : { [glyph]: false };
}

/** The gender a disc is solid in, by its colour, or null for an icon drawn in white alone. */
function solid(image: Image, marks: readonly Mark[]): 'male' | 'female' | null {
  let blue = 0;
  let red = 0;

  for (const { x, y } of marks) {
    const [r, g, b] = pixel(image, x, y);

    blue += Number(b > r + 70 && Math.min(r, g, b) < 200);
    red += Number(r > g + 80);
  }

  return blue > marks.length * 0.3 ? 'male' : red > marks.length * 0.3 ? 'female' : null;
}

/** The gender a white glyph draws, by where its ink is inside its ring, or null for a ring with nothing in it. */
function glyphOf(marks: readonly Mark[]): 'male' | 'female' | null {
  const xs = marks.map((m) => m.x);
  const ys = marks.map((m) => m.y);
  const [left, top] = [Math.min(...xs), Math.min(...ys)];
  const size = Math.max(Math.max(...xs) - left, Math.max(...ys) - top);
  const inside = (u0: number, u1: number, v0: number, v1: number) =>
    marks.filter(({ x, y, white }) => {
      const [u, v] = [(x - left) / size, (y - top) / size];

      return white && u >= u0 && u <= u1 && v >= v0 && v <= v1;
    }).length;

  if (inside(0.3, 0.7, 0.3, 0.7) < 20) {
    return null;
  }

  return inside(0.55, 0.8, 0.2, 0.45) > inside(0.4, 0.6, 0.6, 0.8) * 1.6 ? 'male' : 'female';
}

/** A region as a tab's list prints it, with the count beside it. */
export interface Counted {
  region: string;
  count: number;
}

/**
 * The game files Meltan and Melmetal under a region of their own rather than Alola's, which `regionOf` puts them in:
 * the POKÉMON tab's list ends on `UNIDENTIFIED 2 / 2`, with Alola's `86` counting 722 to 807.
 */
export const UNIDENTIFIED = { region: 'Unidentified', first: 808, last: 809 } as const;

/** The region the game files a species under, or null for a number past the last generation. */
export const regionIn = (dex: number) =>
  dex >= UNIDENTIFIED.first && dex <= UNIDENTIFIED.last ? UNIDENTIFIED.region : regionOf(dex);

/** The last number in the national dex, which is where the last generation ends. */
export const LAST = Math.max(...GENERATIONS.map((g) => g.last));

/** How many species the game files under each region, which is the second number the POKÉMON tab prints. */
export const SIZES: ReadonlyMap<string, number> = Array.from({ length: LAST }, (_, i) => regionIn(i + 1)).reduce(
  (sizes, region) => (region === null ? sizes : sizes.set(region, (sizes.get(region) ?? 0) + 1)),
  new Map<string, number>(),
);

/**
 * A region list's text, which neither of `pokedexLines`' passes reads: each card prints its region and count in the
 * tab's own colour on a near-white card — teal on the POKÉMON tab's, orange on SHINY's — and the backdrop between the
 * cards is as dark as that text on some tabs. So the ink taken is what is darker than the card, and only on the rows
 * that cross one, which is told by the light down the card's left margin; and on the left half alone, where the names
 * and counts are and the cards' artwork is not.
 */
export async function listLines(image: Image): Promise<Line[]> {
  const width = Math.floor(image.width / 4);
  const height = Math.floor(image.height / 2);
  const data = new Uint8Array(width * height * 4).fill(255);
  const bright = (x: number, y: number) => brightness(pixel(image, x, y));

  for (let y = 0; y < height; y++) {
    let light = 0;
    let asked = 0;

    for (let x = image.width * 0.05; x < image.width * 0.4; x += 8) {
      asked++;
      light += Number(bright(x, y * 2) > 200);
    }

    if (light < asked * 0.4) {
      continue;
    }

    for (let x = 0; x < width; x++) {
      if (bright(x * 2, y * 2) < 185) {
        data.set([0, 0, 0, 255], (y * width + x) * 4);
      }
    }
  }

  return (await ocr({ width, height, data })).map((l) => ({
    ...l,
    left: l.left * 2,
    top: l.top * 2,
    width: l.width * 2,
    height: l.height * 2,
  }));
}

/**
 * What a tab's region list says each region holds, from its cards: the region's name, then `Caught: 80` on every tab
 * but the first, which prints `148 / 151` — the species caught of the species there are. That second number is the
 * check on the first: a count is taken only where it is the region's own size, so `97 {107` under Sinnoh is 97 and a
 * line of the artwork read as numbers is nothing. A card whose count did not read is left out rather than read as
 * nought, so a count can be missing but never wrong.
 */
export function countsOn(lines: readonly Line[]): Counted[] {
  const counted: Counted[] = [];
  const regions = [...SIZES.keys()];

  lines.forEach((line, i) => {
    const region = closest(line.text, regions, (r) => r);

    if (!region) {
      return;
    }

    // The count is the next line down the card's left, under the name and before the next card's: `Complete!` can come
    // between them.
    for (const below of lines.slice(i + 1, i + 4)) {
      if (below.top > line.top + line.height * 4) {
        break;
      }

      const caught = /caught\D*(\d+)/i.exec(below.text);
      const [held, of] = (below.text.match(/\d+/g) ?? []).map(Number);

      if (caught) {
        counted.push({ region, count: Number(caught[1]) });
        break;
      }

      if (held !== undefined && of !== undefined && of === SIZES.get(region) && held <= of) {
        counted.push({ region, count: held });
        break;
      }
    }
  });

  return counted;
}

/** One of an entry's variants, by its name where it was settled and by its place where it was not. */
export type Named = string | null | { unidentified: number };

/** An icon to match a tile against, and the name it answers. */
export interface Candidate {
  name: string | null;
  icon: Image;
}

/**
 * How much nearer the best icon has to be than the next before a tile is named after it: a quarter. The match that
 * settles a tile is the icon itself, so the right one lands within a few steps of the screen and every other twice as
 * far — but two costumes can share a model and differ by a hat, and a tile is named after neither then.
 */
const NAMED_BY = 0.75;

/** Where the game draws a tile's icon: the square its 256 pixels are scaled into. */
export interface Frame {
  left: number;
  top: number;
  size: number;
}

/** The icon's frame in a tile of the CAUGHT tab or a costume's, by `ICON`. */
export const caughtFrame = (image: Image, box: Box): Frame => {
  const size = image.width * ICON.size;

  return { left: box.left + (box.width - size) / 2, top: box.top + image.width * ICON.from, size };
};

/**
 * The icon's frame in a tile of the form row, which draws it at 0.862 of the 256 pixels, as wide as the tile itself and
 * starting 7 pixels of the 1440 above it: fitted to Alolan Meowth's tile on `meowth-0.png`.
 */
export const formFrame = (image: Image, box: Box): Frame => ({
  left: box.left,
  top: box.top - image.width * 0.005,
  size: box.width,
});

/**
 * Which candidate's icon a tile holds, by its name, where one is plainly nearer than the rest, and undefined where none
 * is or the tile is empty.
 *
 * The game draws the icon itself, scaled into `frame`, so each candidate is laid where the game would draw it and
 * compared pixel for pixel over its opaque pixels, a few pixels either way for the drawing's rounding. A silhouette is
 * compared by shape instead, the candidate's opaque pixels against the tile's dark ones, since its colours are not
 * there to compare.
 */
export function iconIn(
  image: Image,
  box: Box,
  frame: Frame,
  look: Look,
  candidates: readonly Candidate[],
): string | null | undefined {
  const [first, second] = ranked(image, box, frame, look, candidates);

  if (!first || (second && first.cost > second.cost * NAMED_BY)) {
    return undefined;
  }

  return first.name;
}

/** Every candidate with how far the tile is from its icon, nearest first, which is what `iconIn` decides on. */
export function ranked(
  image: Image,
  box: Box,
  frame: Frame,
  look: Look,
  candidates: readonly Candidate[],
): { name: string | null; cost: number }[] {
  if (look === 'empty') {
    return [];
  }

  const backdrop = pixel(image, box.left + box.width * 0.6, box.top + box.height * 0.07);

  // A tile placed off its header or its label can sit a dozen pixels from where the frame says: coarsely over that,
  // then a pixel at a time round the best. Unown's N, laid at most 9 pixels off, came out 26 from its own icon where
  // M's came out 10.
  const reach = Math.round(image.width * 0.012);
  const stride = Math.ceil(reach / 3);

  return candidates
    .map(({ name, icon }) => {
      const off = (dx: number, dy: number) =>
        costOf(image, icon, frame.left + dx, frame.top + dy, frame.size, look, backdrop);
      let best = { cost: Infinity, dx: 0, dy: 0 };

      for (let dy = -reach; dy <= reach; dy += stride) {
        for (let dx = -reach; dx <= reach; dx += stride) {
          const here = off(dx, dy);

          if (here < best.cost) {
            best = { cost: here, dx, dy };
          }
        }
      }

      let nearest = best.cost;

      for (let dy = best.dy - stride + 1; dy < best.dy + stride; dy++) {
        for (let dx = best.dx - stride + 1; dx < best.dx + stride; dx++) {
          nearest = Math.min(nearest, off(dx, dy));
        }
      }

      return { name, cost: nearest };
    })
    .sort((a, b) => a.cost - b.cost);
}

/** How far the tile is from `icon` drawn `size` wide at `left`, `top`: a mean over the icon's opaque pixels. */
function costOf(
  image: Image,
  icon: Image,
  left: number,
  top: number,
  size: number,
  look: Look,
  backdrop: readonly number[],
): number {
  const ratio = icon.width / size;
  const step = Math.max(1, Math.round(size / 96));
  let total = 0;
  let n = 0;

  for (let v = 0; v < size; v += step) {
    for (let u = 0; u < size; u += step) {
      const ip = (Math.floor(v * ratio) * icon.width + Math.floor(u * ratio)) * 4;
      const opaque = (icon.data[ip + 3] ?? 0) >= 250;
      const seen = pixel(image, left + u, top + v);

      if (look === 'silhouette') {
        // Shape alone: a pixel costs where the icon and the silhouette disagree about whether it is inside.
        const inside = apart(seen, backdrop) > 45;
        total += Number(inside !== opaque);
        n++;
      } else if (opaque) {
        total += apart(seen, [icon.data[ip] ?? 0, icon.data[ip + 1] ?? 0, icon.data[ip + 2] ?? 0]) / 3;
        n++;
      }
    }
  }

  return n === 0 ? Infinity : total / n;
}

/**
 * The form a label names, among a species' forms: the one sharing a word with it, where only one does. A word is shared
 * where one begins the other, so `ALOLAN` is Alola's and `Combat Breed` is `Paldea Combat`'s.
 */
export function formLabelled(label: string, forms: readonly Form[]): Form | null {
  const words = fold(label)
    .split(' ')
    .filter((w) => w.length >= 3);
  const sharing = forms.filter((f) =>
    fold(f.form ?? '')
      .split(' ')
      .some((w) => w.length >= 3 && words.some((l) => l.startsWith(w) || w.startsWith(l))),
  );

  return sharing.length === 1 ? (sharing[0] ?? null) : null;
}
