/**
 * What the detail screen states in pixels rather than in words: the size pill over the height, the favourite's star,
 * the gender symbol beside the HP, a lucky Pokémon's caption and the account's own tag chips. The seam with
 * `detail.mts` is the method rather than the subject — each of these is found by colour or shape first, and the star
 * and the symbol need no OCR at all.
 */

import { closest } from './game-master.mts';
import { fold, ocr, ocrLine, type Line } from './ocr.mts';
import { chroma, crop, isolate, luminance, rgb, scale, threshold, type Image } from './png.mts';

/**
 * What the symbol beside the HP says, in the game's own search terms: `genderunknown` is what the game calls a species
 * with no gender, so each value is the search that finds the Pokémon it describes.
 */
export type Gender = 'male' | 'female' | 'genderunknown';

/** The four bands the game records, each of which `src/search/terms.ts` has a search for. */
export type Size = 'XXL' | 'XL' | 'XS' | 'XXS';

interface Patch {
  left: number;
  top: number;
  width: number;
  height: number;
  fraction: number;
}

/** Where the pixels a predicate accepts are in a region, and how much of it they cover. */
function patchIn(image: Image, matches: (r: number, g: number, b: number) => boolean): Patch {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  let found = 0;

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (matches(...rgb(image, x, y))) {
        found++;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }

  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
    fraction: found / (image.width * image.height),
  };
}

/**
 * Where the pixels a predicate accepts are, leaving out any row or column holding only one — a patch's extent without
 * a stray pixel beside it, where `patchIn`'s box reaches every one. One stray coloured pixel at the far corner of the
 * size pill's band would otherwise take in the white panel, which isolating the badge's white text turns black. A
 * proportion of the busiest row will not do: the pill's tail narrows to two or three pixels a row.
 */
function extentOf(image: Image, matches: (r: number, g: number, b: number) => boolean): Omit<Patch, 'fraction'> {
  const rows = new Array<number>(image.height).fill(0);
  const columns = new Array<number>(image.width).fill(0);

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (matches(...rgb(image, x, y))) {
        rows[y] = (rows[y] ?? 0) + 1;
        columns[x] = (columns[x] ?? 0) + 1;
      }
    }
  }

  const span = (counts: number[]) => {
    const first = counts.findIndex((n) => n > 1);

    return [first, counts.findLastIndex((n) => n > 1) - first + 1] as const;
  };

  const [left, width] = span(columns);
  const [top, height] = span(rows);

  return { left, top, width, height };
}

/** The warm gold the game fills a favourite's star with. */
const gold = (r: number, g: number, b: number) => r >= 180 && g >= 110 && g <= 235 && b <= 130 && r - b >= 90;

/** The near-white an ordinary star's outline is drawn in, and a favourite's solid gold star has none of. */
const white = (r: number, g: number, b: number) => Math.min(r, g, b) >= 220;

/** Any hue at all, against a panel that is neutral grey. What the size badge's pill needs, since its hue varies. */
const coloured = (r: number, g: number, b: number) => chroma(r, g, b) >= SIZE_CHROMA;

/**
 * One of the four size badges, or null for the two ordinary bands in the middle, which wear none. White on a coloured
 * pill drawn directly over the height, and the obvious answer to each half of finding it does not work.
 *
 * **Anchored on the height, not the row it shares with the weight**: a band taken from a fraction of the screen's
 * width reaches past the panel into the saturated navy page behind it, which swamps the pill.
 *
 * **Found by saturation, not hue.** The pill is gold where the measurement is also a personal record and teal where it
 * is not — rgb(188,157,56) over a gold `TALLEST` against rgb(109,184,182) over a plain `HEIGHT` — so a gold test
 * answers only for the tallest or shortest of a species, two of the five badged captures here.
 *
 * Cropping to the pill is what makes the text legible: isolating white over the whole band turns the panel black too,
 * the panel being white as well, and hands Tesseract a black page with one white island. The saturation is also the
 * cheap test, most Pokémon wearing no badge — but not sufficient alone, the band holding artwork of any colour, so the
 * text still has to spell one of the four.
 *
 * **Read with no whitelist.** Held to `XSL`, `smoliv.png`'s pill reads `XS` off an `XXS` badge the game's own `xxs`
 * search confirms; open it reads `XXS,` and `fold` drops the comma. An alphabet earns its place where a stray glyph
 * could split a number in two — why `wholeCp` and the overlay keep theirs — and a badge is two or three of one letter
 * with no number to split; the chips below read open as well. Over the corpus, open is right on every row that wears a
 * badge where the whitelist misses `smoliv.png`'s, the rest answering null under both.
 *
 * **The pill's shape counts the letters, and the text only names the last.** A run of one letter is exactly what OCR
 * merges: the WebAssembly Tesseract the Inventory page reads with answers `XS` off `smoliv.png`'s pill even open, where
 * the CLI answers `XXS`. The pill is drawn to fit its text, so its width says how many letters it holds where reading
 * them cannot — 0.96 of its height round two letters on both `XL` captures, 1.31 and 1.36 round three on `XXL` and
 * `XXS` — and `SIZE_THREE` sits between the two. What the text is still asked for is whether it ends in an `S` or an
 * `L`, which no engine has been seen to confuse, and that it spells a badge at all, the band holding artwork of any
 * colour.
 */
export async function sizeOf(image: Image, height: Line): Promise<Size | null> {
  const band = crop(
    image,
    height.left - height.height,
    height.top - height.height * SIZE_RISE,
    height.width * SIZE_SPAN + height.height,
    height.height * SIZE_RISE,
  );

  if (patchIn(band, coloured).fraction < SIZE_FILL) {
    return null;
  }

  const pill = extentOf(band, coloured);
  const badge = crop(band, pill.left, pill.top, pill.width, pill.height);
  const text = fold((await ocrLine(scale(isolate(badge, 200, 70), 3))) ?? '');
  const last = /x\s*([sl])/.exec(text)?.[1];

  if (last === undefined) {
    return null;
  }

  const size = `${pill.width / pill.height >= SIZE_THREE ? 'XX' : 'X'}${last.toUpperCase()}`;

  return SIZES.find((known) => known === size) ?? null;
}

/**
 * Whether the star at the top right is filled. A favourite's is solid gold where an ordinary one is a white outline, so
 * this is the one flag colour alone settles — but by the white as much as by the gold, since a gold or yellow
 * background behind an outline puts as much gold in the corner as a filled star does. The star is the game's own
 * furniture rather than PGSharp's, so it scales with the screen and a fraction holds where one for the overlay did not
 * — 0.900, 0.074 against 0.903, 0.080.
 */
export function isFavourite(image: Image): boolean {
  const star = crop(image, image.width * 0.86, image.height * 0.05, image.width * 0.1, image.height * 0.06);

  return patchIn(star, gold).fraction >= FAVOURITE_GOLD && patchIn(star, white).fraction < FAVOURITE_WHITE;
}

/**
 * Where the best-buddy badge ends on the name line, or null where it carries none. The game draws a gold and red rosette
 * about the name's cap height in front of a best buddy's name, told apart by colour rather than by what Tesseract reads
 * it as, so a nickname that does start with a `1` keeps it. The name is drawn dark grey on white: no pixel inside the
 * corpus's 56 other name lines is more saturated than a chroma of 41, nor one inside 501 more from scans' detail
 * screens as much as `BADGE_CHROMA`, where the badge reaches 166 and carries 88 columns past it. Only a patch starting
 * within a line-height of the line's left counts, the badge being the first thing on it.
 */
export function badgeEnd(image: Image, line: Line): number | null {
  const { left, width } = extentOf(
    crop(image, line.left, line.top, line.width, line.height),
    (r, g, b) => chroma(r, g, b) >= BADGE_CHROMA,
  );

  return left === -1 || left > line.height ? null : line.left + left + width;
}

/**
 * Male, female, or `genderunknown` for a species that has no gender. The symbol is the only ink in that corner of the
 * panel, so it is found by where the HP is rather than by a fraction of the screen.
 *
 * Colour cannot tell the two apart, both being the same pale blue-grey, so the shape does it: a female's stem makes
 * her ink taller than it is wide where a male's is square. Measured on two phones, 1.51 against 0.99 and 1.51 against
 * 1.00, so one threshold serves both, and all 16 captures of a genderless species report no symbol at all.
 *
 * What the ink is darker *than* is the panel itself, read off the region rather than written down. Nine tenths of the
 * region is panel by construction, so its commonest luminance is the panel's and the symbol is a clear 49 below it. A
 * level written down does not hold: at 235 the panel is itself ink, which makes the answer the shape of the crop — and
 * the crop is sized from `hp.height`, which Tesseract reports as anything from 20 to 37 for the same text.
 */
export function genderOf(image: Image, hp: Line): Gender {
  const region = crop(image, image.width * 0.78, hp.top - hp.height * 4, image.width * 0.15, hp.height * 6);
  const histogram = new Map<number, number>();

  for (let y = 0; y < region.height; y++) {
    for (let x = 0; x < region.width; x++) {
      const level = Math.round(luminance(...rgb(region, x, y)));
      histogram.set(level, (histogram.get(level) ?? 0) + 1);
    }
  }

  const panel = [...histogram].reduce((most, level) => (level[1] > most[1] ? level : most), [0, 0])[0];
  const symbol = patchIn(
    region,
    (r, g, b) => luminance(r, g, b) < panel - GENDER_INK_BELOW && chroma(r, g, b) < GENDER_INK_CHROMA,
  );

  if (symbol.fraction < GENDER_INK_MIN) {
    return 'genderunknown';
  }

  return symbol.height / Math.max(1, symbol.width) >= GENDER_TALL ? 'female' : 'male';
}

/**
 * Whether the green `LUCKY POKÉMON` caption is drawn between the name and the HP. The whole-screen pass reads it on no
 * capture, and where it did read it the line was nearest the HP and taken for a nickname, so it is looked for on its
 * own: only the caption's green kept, which drops the teal name above it, and the band read sparse, which takes the HP
 * bar's own green below it for a picture rather than a line. Over the corpus both lucky captures read `LUCKY POKEMON`
 * and the other 54 read nothing at all.
 *
 * Reaching from the HP rather than from the name line, since that line is the caption itself where it went wrong.
 */
export async function isLucky(image: Image, hp: Line): Promise<boolean> {
  const band = crop(
    image,
    image.width * LUCKY_INSET,
    hp.top - hp.height * LUCKY_RISE,
    image.width * (1 - LUCKY_INSET * 2),
    hp.height * LUCKY_RISE,
  );

  return (await ocr(threshold(band, captionGreen))).some((line) => isLuckyCaption(line.text));
}

/**
 * Whether a line reads as the lucky caption. Never a nickname, which the game holds to twelve characters where
 * `LUCKY POKÉMON` runs to thirteen.
 */
export const isLuckyCaption = (text: string) => closest(text, [LUCKY_CAPTION], (c) => c) !== null;

const LUCKY_CAPTION = 'Lucky Pokémon';

/**
 * The caption's green, rgb(100,195,130) at its core, against the name's teal rgb(64,96,96) — which no green floor
 * reaches — and the HP bar's mint rgb(100,230,180), which this keeps and the sparse read declines.
 */
const captionGreen = (r: number, g: number, b: number) => g - r >= 60 && g - b >= 40;

/**
 * How far above the HP the caption band reaches, in the HP line's own heights, and how much of the width it omits:
 * the band `detail.mts` reads a name off, the caption sitting inside it.
 */
const LUCKY_RISE = 5;
const LUCKY_INSET = 0.1;

/** A tag chip is the only coloured thing on the panel, and it is drawn between the HP and the weight. */
const TAG_CHROMA = 45;
const TAG_PANEL = { from: 0.12, width: 0.76 };

/**
 * A chip is a solid pill, so most of its own box is coloured, and it stands about a thirtieth of the screen tall.
 * Measured against a real one at 97 pixels on a 3040 screen, and against the strays that are not chips at 26 to 28.
 */
const TAG_FILL = 0.5;
const TAG_HEIGHT = 0.025;

/**
 * The tags a Pokémon carries, read off the chips the game draws under its HP. White on a coloured pill, so the colour
 * is what finds them, and each chip is cropped on its own by the columns it occupies — a Pokémon can carry several and
 * reading the row whole would run their names together.
 *
 * It answers what it read rather than what the tag is called, a caller that knows the names being able to match
 * against them: `Trade to 0xNULL` comes back as `Trade toOxNULL` and only agrees once folded.
 */
export async function tagsOn(image: Image, hp: Line, row: Line): Promise<string[]> {
  const top = hp.top + hp.height;

  if (row.top <= top) {
    return [];
  }

  const gap = crop(image, image.width * TAG_PANEL.from, top, image.width * TAG_PANEL.width, row.top - top);
  const floor = aboveTypes(gap);

  if (floor < 1) {
    return [];
  }

  const band = crop(gap, 0, 0, gap.width, floor);
  const found: string[] = [];

  for (const chip of chipsIn(band, image.height * TAG_HEIGHT)) {
    const text = await ocrLine(scale(isolate(crop(band, chip.left, chip.top, chip.width, chip.height), 200, 70), 2));

    if (text) {
      found.push(
        text
          .replace(/[^\p{L}\p{N} .'-]/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      );
    }
  }

  return found.filter(Boolean);
}

/** Whether any pixel of a row carries a hue, against a panel that is neutral grey. */
function rowColoured(band: Image, y: number): boolean {
  for (let x = 0; x < band.width; x++) {
    if (chroma(...rgb(band, x, y)) >= TAG_CHROMA) {
      return true;
    }
  }

  return false;
}

/**
 * How much of the gap between the HP and the weight the chips can be in, which the gap itself says. The type icons sit
 * level with the weight row, so they always reach the bottom of the gap where a chip row never does — on `ho-oh.png`
 * the chips occupy rows 44-110 of 220 and the icons rows 201-219. So the bottom-most run of coloured rows is the
 * icons, and everything above it is the chips' band.
 *
 * Deriving it is what makes it right rather than nearly right, both obvious fractions being wrong silently. 0.45 of
 * the gap clips `ho-oh.png`'s chips to 55 rows against a true 67, below the 56.1 a chip has to stand to be counted, so
 * the screen reports no tags with two plainly on it. The whole gap merges each chip with the icons beneath it and
 * drops its fill from 0.86 to 0.31, which reads as no chip just the same.
 */
function aboveTypes(gap: Image): number {
  let floor = gap.height;

  // Only a run reaching the bottom row is the icons. A Normal type's icon is grey and colours nothing, so taking
  // whatever run is lowest would cut away `snorlax-purified.png`'s `Perfect` chip as though it were the icons. Over
  // the 45 captures with a gap to read, every icon run ends on the last row exactly and that chip is the only run that
  // does not.
  while (floor > 0 && rowColoured(gap, floor - 1)) {
    floor--;
  }

  return floor;
}

/** The coloured runs of columns in a band, one per chip, with the rows each of them actually occupies. */
function chipsIn(band: Image, tallest: number): { left: number; top: number; width: number; height: number }[] {
  const coloured = (x: number, y: number) => chroma(...rgb(band, x, y)) >= TAG_CHROMA;

  const filled: boolean[] = [];

  for (let x = 0; x < band.width; x++) {
    filled[x] = false;

    for (let y = 0; y < band.height && !filled[x]; y++) {
      filled[x] = coloured(x, y);
    }
  }

  const chips: { left: number; top: number; width: number; height: number }[] = [];
  let start = -1;

  for (let x = 0; x <= band.width; x++) {
    if (filled[x]) {
      start = start < 0 ? x : start;
      continue;
    }

    if (start < 0) {
      continue;
    }

    let top = band.height;
    let bottom = -1;
    let n = 0;

    for (let y = 0; y < band.height; y++) {
      for (let cx = start; cx < x; cx++) {
        if (coloured(cx, y)) {
          n++;
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    }

    const height = bottom - top + 1;
    const width = x - start;

    if (height >= tallest && n >= width * height * TAG_FILL) {
      chips.push({ left: start, top, width, height });
    }

    start = -1;
  }

  return chips;
}

/**
 * Measured over the 63 committed captures: 53 are exactly 0 and the five favourites run 18.66% to 38.47%. Not 0.02,
 * because `castform-rainy.png`'s background puts **15.78%** in that corner behind a white-outline star. Gold alone
 * cannot separate them, though: the bokeh behind `frigibax.png`'s outline puts 19.13% there and a live Axew's 24.31%,
 * inside the favourites' range, which is what `FAVOURITE_WHITE` is for.
 */
const FAVOURITE_GOLD = 0.17;

/**
 * Near-white in the star's corner, which is the outline itself and so does not move with the background: exactly 0 on
 * all five favourites in the corpus, solid gold leaving none, and 6.40% to 7.23% on its 50 outline stars. The two
 * plain Pixel 4 XL screens of Axew over yellow bokeh that gold alone read as favourites hold 7.07% and 7.33%, and
 * issue #586 found none under 6.4% over about 450 live outlines. Anything between 0 and 6.4% separates them, so the line
 * sits a third of the way up: a favourite's edge catching some glare still clears it, and an outline would have to
 * lose two thirds of itself to fall under it.
 */
const FAVOURITE_WHITE = 0.02;

/**
 * The size badge's pill as a band over the height, measured in the height's own height: the pill is a little under two
 * line-heights tall and the text beside it runs half again as wide as `0.15m`.
 *
 * `SIZE_CHROMA` separates the pill from the panel it sits on — the panel is neutral rgb(224,224,224) and both of the
 * pill's hues are far from it, at 132 and 75 — so anything over 60 catches either without catching the panel's own
 * antialiasing. `SIZE_FILL` only has to beat the stray coloured pixel; a real pill is several per cent of the band.
 */
const SIZE_RISE = 1.9;
const SIZE_SPAN = 1.6;
const SIZE_CHROMA = 60;
const SIZE_FILL = 0.01;

/** How saturated a pixel inside the name line has to be to be the best-buddy badge rather than the name's grey. */
const BADGE_CHROMA = 80;

/** The four words a badge can spell. */
const SIZES = ['XXL', 'XXS', 'XL', 'XS'] as const satisfies readonly Size[];

/** How wide the pill runs against its own height once it holds three letters rather than two; see `sizeOf`. */
const SIZE_THREE = 1.15;

/**
 * The gender symbol against the white panel behind it: how far below the panel's own level its ink has to fall, how
 * neutral it has to stay, how much of the region it has to cover and how tall it has to be to be a female's.
 */
const GENDER_INK_BELOW = 20;
const GENDER_INK_CHROMA = 45;
const GENDER_INK_MIN = 0.01;
const GENDER_TALL = 1.25;
