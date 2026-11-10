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
import { centre, findLine, fold, ocr, ocrLine, type Line } from '../../core/ocr.mts';
import { crop, luminance, median, rgb, threshold, type Image } from '../../core/png.mts';
import { LAST_DEX, regionOf } from '../../pokemon/generations.ts';

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
      const value = keep(rgb(image, x * 2, y * 2)) ? 0 : 255;

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
 * aside; an icon is drawn in its own colours, shaded and outlined. Over the tiles of the CAUGHT tabs under
 * `fixtures/pokedex/`, no icon came out flatter than 0.36 (Galarian Meowth's own) but Beedrill's, which `OTHER` tells,
 * and no silhouette less flat than 0.79 (Charizard's MEGA Y), so this sits between the two. The form row's silhouettes
 * are a dark slate rather than the backdrop darkened, and nearly as flat: Unown's 0.63 at the least, against 0.15 at
 * the most for a letter registered, its eye white on black.
 */
const FLAT = 0.55;

/**
 * How much of what stands out may be another colour for it still to be a silhouette: more than a few steps from its one
 * colour and from every blend of that with the backdrop, which is all its anti-aliased edge is. An icon can be as flat
 * as a silhouette where much of it is translucent, the backdrop seen through grey: Beedrill's own is 0.61, its wings,
 * but 0.31 of it is its yellow and black. Under `fixtures/pokedex/` no silhouette came to more than 0.13 (Charizard's
 * MEGA Y), Unown's thin dark ones in the form row among them, and no icon to less than 0.23 (Alolan Meowth's own).
 */
const OTHER = 0.18;

/**
 * What the tile at `box` holds. Its backdrop is taken row by row, by `backdropAt`; a pixel stands out where it is far
 * from its row's, and the ones that do are a silhouette where most of them are within a few steps of their own median
 * colour and next to none are another.
 */
export function lookOf(image: Image, box: Box): Look {
  return flatness(image, box).look;
}

/** How far a pixel has to be from its tile's backdrop to stand out from it, summed over the channels. */
const STANDS_OUT = 45;

/**
 * The colour of a tile's backdrop: the median of the strip along its top, which is clear of the icon and of the small
 * glyph in a category tile's corner.
 */
function backdropOf(image: Image, box: Box): number[] {
  const step = Math.max(1, Math.round(box.width / 80));
  const strip: [number, number, number][] = [];

  // Far enough in to be past the white frame round the form showing, and the tile's own rounded edge.
  for (let x = box.left + box.width * 0.4; x < box.left + box.width * 0.9; x += step) {
    strip.push(rgb(image, x, box.top + box.height * 0.07));
  }

  return [0, 1, 2].map((c) => median(strip.map((p) => p[c] ?? 0)));
}

/** `lookOf`'s working: how much of the box stands out, and how much of that is one colour and how much another. */
export function flatness(image: Image, box: Box): { filled: number; flat: number; other: number; look: Look } {
  const step = Math.max(1, Math.round(box.width / 80));
  const top = backdropOf(image, box);
  const standing: { seen: [number, number, number]; behind: number[] }[] = [];
  let asked = 0;

  // Between the glyph in a category tile's top corner and the label along its foot, both dark, either of which would
  // pass for a dark patch of an icon; and short of the right edge, which the fourth column's tiles run under PGSharp's
  // panel at, its slate plainly another colour beside a thin silhouette.
  for (let y = box.top + box.height * 0.25; y < box.top + box.height * 0.82; y += step) {
    const behind = backdropAt(image, box, y, top);

    for (let x = box.left + box.width * 0.1; x < box.left + box.width * 0.85; x += step) {
      const seen = rgb(image, x, y);
      asked++;

      if (apart(seen, behind) > STANDS_OUT) {
        standing.push({ seen, behind });
      }
    }
  }

  const filled = standing.length / asked;

  if (filled < FILLED) {
    return { filled, flat: 0, other: 0, look: 'empty' };
  }

  const middle = [0, 1, 2].map((c) => median(standing.map(({ seen }) => seen[c] ?? 0)));
  const flat = standing.filter(({ seen }) => apart(seen, middle) <= 30).length / standing.length;
  const other =
    standing.filter(({ seen, behind }) => apart(seen, blendNearest(seen, middle, behind)) > 60).length /
    standing.length;

  return { filled, flat, other, look: flat >= FLAT && other < OTHER ? 'silhouette' : 'icon' };
}

/**
 * How far a tile's margin may be from the backdrop along its top for `backdropAt` to take it as its row's. The game
 * sweeps bands of light down the Pokédex, and its tiles are translucent, so a tile's colour can step from one row to
 * the next by more than `STANDS_OUT`: by 55 between the strip along the top of Unown's own tile on
 * `unown-band-1.png` and the rows under it, and by 57 across the band through its sixteenth form on `unown-band-0.png`.
 * At 60, four of the five forms that band crosses still came out icons. A third of the game's icons drawn onto a tile,
 * as themselves and as silhouettes, under a band of 25 a channel along the tile's top, needed more than 90: there 67 of
 * the 446 silhouettes came out icons, at 120 none did, and nothing read differently from 120 to 200.
 */
const BANDED = 120;

/** A tile's margins either side, as fractions of its width: inside the white frame round the form showing. */
const MARGINS = [
  [0.04, 0.09],
  [0.91, 0.96],
] as const;

/**
 * The backdrop behind the row at `y` of the tile at `box`: whichever of its margins is nearer `top`, the backdrop along
 * its top, where that is near enough to be the same backdrop under another band, and `top` itself where neither is —
 * a row an icon runs into both margins of, or a fourth-column tile's beside PGSharp's panel and a silhouette.
 *
 * Held against `top` alone, a band across part of a tile made the rest of it stand out, and that is both ways wrong: a
 * registered icon came out a silhouette, the tile's own colour all one, as Unown's own tile and SHINY did on
 * `unown-band-1.png`; and a silhouette came out an icon, the tile beside it plainly another colour, as five of Unown's
 * forms did on `unown-band-0.png`.
 */
function backdropAt(image: Image, box: Box, y: number, top: readonly number[]): number[] {
  const margins = MARGINS.map(([from, to]) => {
    const seen: [number, number, number][] = [];

    for (let x = box.left + box.width * from; x < box.left + box.width * to; x++) {
      seen.push(rgb(image, x, y));
    }

    return [0, 1, 2].map((c) => median(seen.map((p) => p[c] ?? 0)));
  });
  const nearest = margins.reduce((best, margin) => (apart(margin, top) < apart(best, top) ? margin : best));

  return apart(nearest, top) <= BANDED ? nearest : [...top];
}

/** The blend of colours `a` and `b` nearest `p`: the point on the line between the two that is closest to it. */
function blendNearest(p: readonly number[], a: readonly number[], b: readonly number[]): number[] {
  const towards = a.map((v, c) => (b[c] ?? 0) - v);
  const length = towards.reduce((sum, v) => sum + v * v, 0);
  const along = towards.reduce((sum, v, c) => sum + v * ((p[c] ?? 0) - (a[c] ?? 0)), 0) / (length || 1);
  const t = Math.min(1, Math.max(0, along));

  return a.map((v, c) => v + t * (towards[c] ?? 0));
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
const headerOf = (lines: readonly Line[]) => findLine(lines, /^info$/);

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

/** The form's own tile, which the game draws first in the row it draws SHINY second in, the one at `shiny`. */
export const ownBeside = (image: Image, shiny: Box): Box => tileAt(image, COLUMNS[0], shiny.top);

/** The heading over an entry's costumes. */
export const costumeHeadingOf = (lines: readonly Line[]) => findLine(lines, /^costumes?$/);

/**
 * The button under everything an entry shows, `SEE ALL BULBASAUR`, which is how the foot of one is known. The words
 * are matched without the space after them, which OCR drops as often as not: `SEE ALLIVYSAUR`.
 */
export const seeAllOf = (lines: readonly Line[]) => findLine(lines, /^see ?all/);

/**
 * The label under the grid's button back to the list of regions, which is how the grid is known: dark on a white pill
 * on every tab, where the tiles' numbers are the tab's colour on its colour and do not read on all of them.
 */
export const regionsButtonOf = (lines: readonly Line[]) => findLine(lines, /^regions$/);

/**
 * The button a pop-up the game puts over the map is put off with: `LATER` under `A mysterious Pokémon has appeared!`
 * (`popup-encounter.png`) and `MAYBE LATER` under the Weekly Challenge (`popup-challenge.png`). `dialogOpen` takes
 * neither for a dialog, and what Back does to either has not been seen, where this is the button a trainer taps. Off
 * `pokedexLines`, which reads it on both under both engines, where `readLines` reads no `LATER` at all off the first.
 */
export const laterOf = (lines: readonly Line[]) => findLine(lines, /^(maybe ?)?later$/);

/**
 * Whether a tile lays its white over the backdrop at `x`, `y`, by being paler there than the gap between the first
 * column and the second at the same height: the backdrop shows through both. Measured on `bulbasaur-2.png`, the tile's
 * red runs 20 to 30 above the gap's.
 */
const tiled = (image: Image, x: number, y: number) =>
  rgb(image, x, y)[0] - rgb(image, image.width * ((COLUMNS[0] + COLUMNS[1]) / 2), y)[0] > 10;

/**
 * How far in from a tile's left edge it is looked for: clear of the icon in its middle, since a silhouette is darker
 * than the backdrop and would end a tile halfway down.
 */
const MARGIN = 0.02;

/** The rows of tiles down the first column between `from` and `to`, as their tops. */
export function rowsBetween(image: Image, from: number, to: number): number[] {
  const inside = image.width * (COLUMNS[0] - TILE.width / 2 + MARGIN);
  const tall = image.width * TILE.height;
  const tops: number[] = [];
  let run: number | null = null;

  for (let y = Math.max(0, from); y < Math.min(image.height, to); y += 2) {
    const tile = tiled(image, inside, y);

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

      if (clear(image, box) && tileDrawn(image, box) && lookOf(image, box) !== 'empty') {
        boxes.push(box);
      }
    }
  }

  return boxes;
}

/**
 * Whether a tile is drawn in `box`'s slot, by its left margin being pale down most of its height, rather than the
 * backdrop showing through an empty one. What the slot holds would not do: on `pikachu-5.png` and `pikachu-6.png` a
 * white pill at the screen's right edge, which scrolls with the entry, crosses the empty slot after the last costume,
 * and `lookOf` takes its outline for an icon. A tile's margin is pale over 0.97 of its height or more on the captures,
 * and an empty slot's over 0.18 at most, under the pill.
 */
function tileDrawn(image: Image, box: Box): boolean {
  const x = box.left + image.width * MARGIN;
  let pale = 0;
  let asked = 0;

  for (let y = box.top; y < box.top + box.height; y += 2) {
    asked++;

    if (tiled(image, x, y)) {
      pale++;
    }
  }

  return pale > asked / 2;
}

/**
 * How much two tiles' icons differ, 0 for one icon and towards 1 for two unalike: the share of the pixels standing out
 * from either tile's backdrop that do not stand out from both alike. Each against its own backdrop, because the tiles
 * are translucent over one that stays put as they scroll, so two tiles of one icon a drag apart differ wherever the
 * icon is not; and the best of a few pixels either way down, since `rowsBetween` finds a row's top two at a time.
 */
function iconsApart(a: Image, boxA: Box, b: Image, boxB: Box): number {
  const [backA, backB] = [backdropOf(a, boxA), backdropOf(b, boxB)];
  const [frameA, frameB] = [caughtFrame(a, boxA), caughtFrame(b, boxB)];
  const step = Math.max(1, Math.round(frameA.size / 64));
  const reach = Math.round(a.width * 0.003);
  let least = 1;

  for (let dy = -reach; dy <= reach; dy += 2) {
    let either = 0;
    let unlike = 0;

    for (let v = 0; v < frameA.size; v += step) {
      for (let u = 0; u < frameA.size; u += step) {
        const p = rgb(a, frameA.left + u, frameA.top + v);
        const q = rgb(b, frameB.left + u, frameB.top + v + dy);
        const [inP, inQ] = [apart(p, backA) > STANDS_OUT, apart(q, backB) > STANDS_OUT];

        if (inP || inQ) {
          either++;

          // Wider than a pixel's standing out, since an icon's edges are drawn part translucent too: at 60, the shift
          // the drag made from `pikachu-2.png` to `pikachu-3.png` came to 0.23, against 0.34 for the next.
          if (!inP || !inQ || apart(p, q) > 120) {
            unlike++;
          }
        }
      }
    }

    least = Math.min(least, either === 0 ? 1 : unlike / either);
  }

  return least;
}

/**
 * How unalike two screenshots' costumes may be under a shift for it to be the one the drag between them made, by
 * `iconsApart` over every pair of tiles it lines up. Measured over the drags from `pikachu-2.png` to `pikachu-6.png`,
 * the shift the drag made came to 0.16 at most and every other to 0.31 at least.
 */
const SAME_ICONS = 0.25;

/** Costumes on one screenshot, with what places a top on it below the `Costume` heading. */
interface Placed {
  image: Image;
  boxes: Box[];
  offset: number;
}

/**
 * How far the costumes moved up from `before` to `after`, in pixels, or null where it cannot be told: of the shifts
 * that put a tile of one on a tile of the other in the same column, the one under which the tiles hold the same icons.
 * Only up, as a drag down the entry moves them, or by nothing where the phone dropped the drag.
 */
function shiftBetween(before: Placed, after: { image: Image; boxes: Box[] }): number | null {
  const near = after.image.width * 0.004;
  const shifts: number[] = [];

  for (const a of before.boxes) {
    for (const b of after.boxes) {
      const shift = a.top - b.top;

      if (a.left === b.left && shift > -near && !shifts.some((s) => Math.abs(s - shift) <= near)) {
        shifts.push(shift);
      }
    }
  }

  let best: { shift: number | null; unlike: number } = { shift: null, unlike: SAME_ICONS };

  for (const shift of shifts) {
    const pairs = after.boxes.flatMap((b) => {
      const a = before.boxes.find((t) => t.left === b.left && Math.abs(t.top - b.top - shift) <= near);

      return a ? [iconsApart(before.image, a, after.image, b)] : [];
    });
    const unlike = pairs.reduce((sum, p) => sum + p, 0) / pairs.length;

    if (unlike < best.unlike) {
      best = { shift, unlike };
    }
  }

  return best.shift;
}

/** A costume read off an entry: its place in the game's order of them, and its name where its icon settled one. */
export interface Costume {
  slot: number;
  name: string | null | undefined;
}

/**
 * The costumes of one form's CAUGHT tab, read a screenshot at a time down it, each once however many show it. One is
 * told from another by its place among them, never by its looks: a costume no icon names comes out a few percent
 * nearer or further from each icon on one screenshot than on the next, so that two alike pass for one and one for two.
 *
 * The place is taken below the `Costume` heading where that is on the screen, and otherwise from the last screenshot
 * placed, by how far the tiles moved since. A screenshot whose costumes cannot be lined up with the last one's leaves
 * them unread, and says so in `unplaced`, rather than counting any of them twice.
 */
export class CostumeReader {
  readonly #candidates: readonly Candidate[];
  readonly #held = new Map<number, Costume>();
  #below = false;
  #last: Placed | null = null;
  unplaced = false;

  /** `candidates` are the icons a costume is named among. */
  constructor(candidates: readonly Candidate[]) {
    this.#candidates = candidates;
  }

  /** Reads the costumes `image` shows, `caught` being the tiles above them that `caughtOn` found on it. */
  read(image: Image, lines: readonly Line[], caught: readonly Caught[]) {
    const heading = costumeHeadingOf(lines);
    const overlaps = (a: Box, b: Box) =>
      Math.abs(a.top - b.top) < a.height / 2 && Math.abs(a.left - b.left) < a.width / 2;
    const boxes = costumesOn(image, lines, this.#below).filter((box) => !caught.some((c) => overlaps(c.box, box)));

    this.#below ||= heading !== undefined;

    if (boxes.length === 0) {
      return;
    }

    const shift = heading || !this.#last ? null : shiftBetween(this.#last, { image, boxes });
    const offset = heading
      ? -(heading.top + heading.height + image.width * HEADING_TO_TILES)
      : this.#last && shift !== null
        ? this.#last.offset + shift
        : null;

    if (offset === null) {
      this.unplaced = true;

      return;
    }

    for (const box of boxes) {
      const row = Math.round((box.top + offset) / (image.width * TILE.row));
      const slot = row * COLUMNS.length + columnOf(box.left + box.width / 2, image.width);

      // Named once, by the first screenshot to name it: one that did not is ranked again on the next that shows it.
      if (this.#held.get(slot)?.name === undefined) {
        const ranking = ranked(image, box, caughtFrame(image, box), lookOf(image, box), this.#candidates);

        this.#held.set(slot, { slot, name: namedFrom(ranking) });
      }
    }

    this.#last = { image, boxes, offset };
  }

  /** Every costume read, in the game's order. */
  get costumes(): Costume[] {
    return [...this.#held.values()].sort((a, b) => a.slot - b.slot);
  }
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
  const pale = (x: number, y: number) => rgb(image, x, y)[0] - rgb(image, margin, y)[0] > 10;
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

/**
 * Whether a tile wears the white frame of what is showing, a form or a category of the CAUGHT tab, down the middle of
 * its left edge. Looked for a few pixels either side of the edge, since a CAUGHT tile is placed by its column rather
 * than found: the frame round SHINY on `ekans-shiny-0.png` runs from 4 pixels outside its box to 1 inside.
 */
export const framed = (image: Image, box: Box) => {
  const reach = Math.round(image.width * 0.004);

  return Array.from({ length: reach * 2 + 1 }, (_, i) => box.left - reach + i).some((x) =>
    Array.from({ length: 8 }, (_, i) => rgb(image, x, box.top + box.height * (0.3 + i * 0.05))).every(
      (p) => Math.min(...p) >= 215,
    ),
  );
};

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
          white += Number(Math.min(...rgb(image, x, y)) >= 220);
        }
      }

      if (white < 10) {
        return null;
      }

      const strip = crop(image, box.left - box.width * 0.1, top, box.width * 1.2, height);

      return ocrLine(threshold(strip, (r, g, b) => Math.min(r, g, b) >= 220));
    }),
  );
}

/** Which genders an entry draws, and whether each is registered: drawn solid where it is, dashed where it is not. */
export interface Genders {
  male?: boolean;
  female?: boolean;
}

/** The entry's title line, `0052 MEOWTH`, by `TITLE`: the line `dexOn` reads, and the top of the form row. */
export const titleOf = (lines: readonly Line[]) => findLine(lines, TITLE);

/**
 * Whether a screen is an entry, however far down it is scrolled: its title at the top, the CAUGHT tab's header lower
 * down, and its `SEE ALL` at its foot, where the other two have scrolled away.
 */
export const isEntry = (lines: readonly Line[]) =>
  titleOf(lines) !== undefined || headerOf(lines) !== undefined || seeAllOf(lines) !== undefined;

/** The line under the row of gender and type icons that only it carries, `ALERT OFF` or `ALERT ON`. */
export const alertOf = (lines: readonly Line[]) => findLine(lines, /^alert\b/);

/** The label over the `SEEN` counter, which every entry draws under its row of icons. */
const seenOf = (lines: readonly Line[]) => findLine(lines, /^seen$/);

/**
 * How far above the `SEEN` label the `ALERT` label is, the foot of the row of icons between them: 94 to 98 pixels of
 * the 1440 on `bulbasaur-0.png`, `meowth-0.png` and the rest.
 */
const SEEN_TO_ALERT = 0.066;

/**
 * Where an entry's form row can be on a screenshot: from the foot of its title to above its row of gender and type
 * icons, and whether that row is on the screen to end it, which Unown's forms run past the foot of.
 *
 * The row of icons is found by the `ALERT` label at its foot or, where that is not read, by the `SEEN` counter's below
 * it. Without either the band runs on into the counters and the CAUGHT tab, pale tiles all, which `formsOn` takes for
 * forms: a full walk that went by `ALERT` alone gave Ditto, Smeargle, Kecleon, Zorua and Zoroark seven apiece.
 */
export function formBand(image: Image, lines: readonly Line[]): { from: number; to: number; ended: boolean } {
  const title = titleOf(lines);
  const seen = seenOf(lines);
  const foot = alertOf(lines)?.top ?? (seen && seen.top - image.width * SEEN_TO_ALERT);

  return {
    from: title ? title.top + title.height : image.height * 0.42,
    to: foot === undefined ? image.height * 0.89 : foot - image.width * 0.12,
    ended: foot !== undefined,
  };
}

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
  const backdrop = rgb(image, image.width * 0.02, middle);
  const icons: Mark[][] = [];
  let last = -Infinity;

  for (let x = image.width * 0.02; x < end; x += step) {
    const marks: Mark[] = [];

    for (let y = middle - reach; y < middle + reach; y += step) {
      const seen = rgb(image, x, y);

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
    const [r, g, b] = rgb(image, x, y);

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

/** How many species the game files under each region, which is the second number the POKÉMON tab prints. */
export const SIZES: ReadonlyMap<string, number> = Array.from({ length: LAST_DEX }, (_, i) => regionIn(i + 1)).reduce(
  (sizes, region) => (region === null ? sizes : sizes.set(region, (sizes.get(region) ?? 0) + 1)),
  new Map<string, number>(),
);

/**
 * Where a region list's names and counts lie across the screen, as fractions of its width: they start 0.068 in, and
 * `UNIDENTIFIED`, the longest, ends at 0.41. Left of them is the backdrop beside the cards and right of them the cards'
 * artwork, and with both in, Tesseract read no count at all off `tab-shadow-2.png`.
 */
const LIST_TEXT = { left: 0.04, right: 0.45 };

/**
 * How much darker than its row, by `brightness`, a pixel of a region list is drawn black; one less dark is drawn a grey
 * between. Greys rather than black and white, since no one cut read every count on the captures: cut at 20 below the
 * row, Sinnoh's on `tab-pokemon-0.png` did not read, and at 32 Hoenn's `Caught: 11` on `tab-perfect-0.png` read as 14.
 */
const LIST_INK = 60;

/**
 * A region list's text, which neither of `pokedexLines`' passes reads: each card prints its region and count in the
 * tab's own colour on a near-white card — teal on the POKÉMON tab's, orange on SHINY's — and the backdrop between the
 * cards is as dark as that text on some tabs. Each pixel is measured against its own row, which is the card's where the
 * row crosses one and the backdrop's where it does not, since no one level is the card's: the list's last card fades
 * towards the tabs, to 198 against 210 above it on `tab-xxs-2.png`. A row is as light as three quarters of it, the rest
 * being text or the foot of the artwork.
 */
export async function listLines(image: Image): Promise<Line[]> {
  const from = Math.round(image.width * LIST_TEXT.left);
  const width = Math.floor((image.width * LIST_TEXT.right - from) / 2);
  const height = Math.floor(image.height / 2);
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const row = Array.from({ length: width }, (_, x) => brightness(rgb(image, from + x * 2, y * 2)));
    const paper = [...row].sort((a, b) => a - b)[Math.floor(width * 0.75)] ?? 0;

    row.forEach((bright, x) => {
      const grey = Math.round(Math.min(255, Math.max(0, 255 - ((paper - bright) * 255) / LIST_INK)));
      data.set([grey, grey, grey, 255], (y * width + x) * 4);
    });
  }

  return (await ocr({ width, height, data })).map((l) => ({
    ...l,
    left: from + l.left * 2,
    top: l.top * 2,
    width: l.width * 2,
    height: l.height * 2,
  }));
}

/**
 * How far from where the names start a count can start and still be whole, in heights of its region's name: every
 * count read off the captures starts within 0.08 of it, and the ones that had lost a digit 0.2 and more further in.
 */
const ALIGNED = 0.15;

/**
 * What a tab's region list says each region holds, from its cards: the region's name, then `Caught: 80` on every tab
 * but the first, which prints `148 / 151` — the species caught of the species there are. That second number is the
 * check on the first: a count is taken only where it is the region's own size, so `97 {107` under Sinnoh is 97 and a
 * line of the artwork read as numbers is nothing. A card whose count did not read is left out rather than read as
 * nought, so a count can be missing but never wrong.
 *
 * So a count is also taken only where it starts where the names do. One starting further in has lost its first digits:
 * the medal under each card on the POKÉMON tab can split them into a line of their own, so that Sinnoh's `97 / 107`
 * reads as `9` and `7/ 107`. Where the names start is where most of them do, since PGSharp's star button over the
 * list's left edge hides the first letter of whichever passes under it.
 */
export function countsOn(lines: readonly Line[]): Counted[] {
  const counted: Counted[] = [];
  const regions = [...SIZES.keys()];
  const named = lines.map((line) => closest(line.text, regions, (r) => r));
  const margin = median(lines.filter((_, i) => named[i]).map((line) => line.left));

  lines.forEach((line, i) => {
    const region = named[i];

    if (!region) {
      return;
    }

    // The count is the next line down the card's left, under the name and before the next card's: `Complete!` can come
    // between them.
    for (const below of lines.slice(i + 1, i + 4)) {
      if (below.top > line.top + line.height * 4) {
        break;
      }

      if (Math.abs(below.left - margin) > line.height * ALIGNED) {
        continue;
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
 * The icon's frame in a tile of the form row, which draws it at 0.862 of the 256 pixels, as wide as a tile and starting
 * 7 pixels of the 1440 above it: fitted to Alolan Meowth's tile on `meowth-0.png`. As wide as a tile is drawn rather
 * than as the tile was found, since the panel docked at the screen's right edge cuts short the tiles under it: Unown's
 * E, J and O are found 204 pixels wide on `unown-0.png`, where every other tile is 216 or 220.
 */
export const formFrame = (image: Image, box: Box): Frame => ({
  left: box.left,
  top: box.top - image.width * 0.005,
  size: image.width * 0.153,
});

/**
 * Which candidate's icon a tile holds, by its name, where one is plainly nearer than the rest, and undefined where none
 * is or the tile is empty.
 *
 * The game draws the icon itself, scaled into `frame`, so each candidate is laid where the game would draw it and
 * compared pixel for pixel over its opaque pixels, a few pixels either way for the drawing's rounding. A silhouette is
 * compared by its outline instead, since its colours are not there to compare: how far each of the tile's dark pixels
 * lies from the candidate's nearest, and each of the candidate's from the tile's nearest. Its area would not do: the
 * game draws a silhouette a pixel or two fatter than the icon, and Unown's letters, a thin stroke round a disc about
 * 50 pixels of the 1440 across, differ by less area than that. By area, 9 of the 14 silhouetted letters on
 * `unown-0.png` came out nearer another letter than their own, and the other 5 too near the next to be named.
 */
export function iconIn(
  image: Image,
  box: Box,
  frame: Frame,
  look: Look,
  candidates: readonly Candidate[],
): string | null | undefined {
  return namedFrom(ranked(image, box, frame, look, candidates));
}

/**
 * The name a ranking settles on: its first, where that is plainly nearer than its second, and undefined where not, or
 * where there is no second to be nearer than. A cost alone says nothing: over the captures a costume came 11 to 19
 * from its own icon, and Pikachu's party hat 14 from the plain one, so one candidate would name a costume nothing in
 * the pool is.
 */
export function namedFrom([first, second]: readonly { name: string | null; cost: number }[]):
  string | null | undefined {
  return !first || !second || first.cost > second.cost * NAMED_BY ? undefined : first.name;
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

  const backdrop = rgb(image, box.left + box.width * 0.6, box.top + box.height * 0.07);

  // A silhouette is the backdrop darkened, so its outline is what is darker than the backdrop: not the tile's own pale
  // edge, and nothing outside the tile, where the panel docked at the screen's edge is as dark as any silhouette. A few
  // pixels inside it, too, since `formsOn` finds a tile's edges 4 pixels at a time: E's, J's and O's boxes on
  // `unown-0.png` take in the panel's first 2, which put each of them at least 8 times as far from its own icon as any
  // other letter was from its own.
  const dark = brightness(backdrop) - DARKER;
  const inset = image.width * 0.003;
  const inner = {
    left: box.left + inset,
    top: box.top + inset,
    width: box.width - inset * 2,
    height: box.height - inset * 2,
  };
  const tile =
    look === 'silhouette'
      ? shapeOf(inner, (x, y) => brightness(rgb(image, inner.left + x, inner.top + y)) < dark)
      : null;
  const cap = image.width * 0.007;

  // A tile placed off its header or its label can sit a dozen pixels from where the frame says: coarsely over that,
  // then a pixel at a time round the best. Unown's N, laid at most 9 pixels off, came out 26 from its own icon where
  // M's came out 10.
  const reach = Math.round(image.width * 0.012);
  const stride = Math.ceil(reach / 3);

  return candidates
    .map(({ name, icon }) => {
      const ratio = icon.width / frame.size;
      const drawn =
        tile &&
        shapeOf(
          { left: frame.left, top: frame.top, width: frame.size, height: frame.size },
          (x, y) => (icon.data[(Math.floor(y * ratio) * icon.width + Math.floor(x * ratio)) * 4 + 3] ?? 0) >= COVERED,
        );
      const off = (dx: number, dy: number) =>
        tile && drawn
          ? outlineCost(tile, drawn, dx, dy, cap)
          : costOf(image, icon, frame.left + dx, frame.top + dy, frame.size);
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
function costOf(image: Image, icon: Image, left: number, top: number, size: number): number {
  const ratio = icon.width / size;
  const step = Math.max(1, Math.round(size / 96));
  let total = 0;
  let n = 0;

  for (let v = 0; v < size; v += step) {
    for (let u = 0; u < size; u += step) {
      const ip = (Math.floor(v * ratio) * icon.width + Math.floor(u * ratio)) * 4;
      const opaque = (icon.data[ip + 3] ?? 0) >= 250;
      const seen = rgb(image, left + u, top + v);

      if (opaque) {
        total += apart(seen, [icon.data[ip] ?? 0, icon.data[ip + 1] ?? 0, icon.data[ip + 2] ?? 0]) / 3;
        n++;
      }
    }
  }

  return n === 0 ? Infinity : total / n;
}

/**
 * How much darker than its backdrop, by `brightness`, a pixel has to be to be inside a silhouette: half as dark as a
 * silhouette's middle, which is 82 to 96 darker on `unown-0.png`, so an anti-aliased edge counts where half covered.
 */
const DARKER = 45;

/** How opaque, of 255, a pixel of an icon has to be to be inside its silhouette: half, as `DARKER` asks of the tile. */
const COVERED = 128;

/** A shape over a box of the screen: the pixels inside it, and how far every pixel of the box is from the nearest. */
interface Shape {
  box: Box;
  width: number;
  points: number[];
  gaps: Float32Array;
}

/**
 * The shape `inside` draws over `box`, asked of each pixel by where it lies in the box. Every pixel's gap is found in
 * two passes, each taking the nearest of its own and its neighbours' already passed over, plus the step to them: 1
 * straight and √2 diagonally, which is near enough the true distance over the few pixels a gap is ever counted to.
 */
function shapeOf(box: Box, inside: (x: number, y: number) => boolean): Shape {
  const width = Math.round(box.width);
  const height = Math.round(box.height);
  const gaps = new Float32Array(width * height).fill(Infinity);
  const points: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inside(x, y)) {
        gaps[y * width + x] = 0;
        points.push(y * width + x);
      }
    }
  }

  // Off the top or the foot is past the array's ends, and so undefined; off either side would wrap to the next row.
  const at = (x: number, y: number) => (x < 0 || x >= width ? Infinity : (gaps[y * width + x] ?? Infinity));

  for (const down of [true, false]) {
    const by = down ? 1 : -1;

    for (let y = down ? 0 : height - 1; y >= 0 && y < height; y += by) {
      for (let x = down ? 0 : width - 1; x >= 0 && x < width; x += by) {
        gaps[y * width + x] = Math.min(
          at(x, y),
          at(x - by, y) + 1,
          at(x, y - by) + 1,
          at(x - by, y - by) + Math.SQRT2,
          at(x + by, y - by) + Math.SQRT2,
        );
      }
    }
  }

  return { box, width, points, gaps };
}

/**
 * How far apart a tile's shape and an icon's are with the icon moved `dx`, `dy`: over each one's pixels, the mean of
 * how far the other's nearest lies, each at most `cap`, so a stray pixel with no counterpart costs no more than one a
 * little off.
 */
function outlineCost(tile: Shape, icon: Shape, dx: number, dy: number, cap: number): number {
  const from = (a: Shape, b: Shape, offset: { x: number; y: number }) => {
    let total = 0;

    for (const i of a.points) {
      const x = Math.round(a.box.left + (i % a.width) + offset.x - b.box.left);
      const y = Math.round(a.box.top + Math.floor(i / a.width) + offset.y - b.box.top);

      total += x < 0 || x >= b.width ? cap : Math.min(cap, b.gaps[y * b.width + x] ?? cap);
    }

    return a.points.length === 0 ? Infinity : total / a.points.length;
  };

  return from(icon, tile, { x: dx, y: dy }) + from(tile, icon, { x: -dx, y: -dy });
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

/** A silhouette of the form row: which of the row's tiles it is, and where it was found, on which screenshot. */
export interface Silhouette {
  index: number;
  image: Image;
  box: Box;
  label: string | null;
}

/**
 * Which of a species' forms each of its silhouettes is, `named` being the forms its registered tiles already are: by
 * label, then by shape where the nearest is a form not yet named, then by being the forms left once every other is.
 * Elimination settles which forms the tiles are but not which tile is which, handing them out in the game master's
 * order rather than the game's, so each form it names is noted as named that way.
 *
 * A shape is held against every one of the species' forms, the ones already named too, so the last silhouette has more
 * than one to be nearer than: `namedFrom` names nothing after a lone candidate, and against only the forms left, a
 * species' last unregistered form would always fall to elimination.
 */
export function silhouettesNamed(
  silhouettes: readonly Silhouette[],
  forms: readonly Form[],
  shapes: readonly Candidate[],
  named: Iterable<string | null>,
): { forms: { index: number; form: Named }[]; notes: string[] } {
  const taken = new Set(named);
  const found: { index: number; form: Named }[] = [];
  const notes: string[] = [];
  const unnamed: number[] = [];

  for (const { index, image, box, label } of silhouettes) {
    const byLabel = label === null ? null : formLabelled(label, forms);
    const byShape = byLabel ? undefined : iconIn(image, box, formFrame(image, box), 'silhouette', shapes);
    const form = byLabel ? byLabel.form : byShape !== undefined && !taken.has(byShape) ? byShape : undefined;

    if (form === undefined) {
      unnamed.push(index);
    } else {
      taken.add(form);
      found.push({ index, form });
    }
  }

  const left = forms.filter((f) => !taken.has(f.form));

  for (const [i, index] of unnamed.entries()) {
    const unread = `form ${index + 1} is a silhouette that neither its label nor its shape names`;

    if (left.length === unnamed.length) {
      const form = left[i]?.form ?? null;

      notes.push(`${unread}, named ${form ?? 'the plain form'} by elimination`);
      found.push({ index, form });
    } else {
      notes.push(unread);
      found.push({ index, form: { unidentified: index + 1 } });
    }
  }

  return { forms: found, notes };
}
