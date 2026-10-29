/**
 * A party card's moves, off the game's own screens: tapping a card on the party screen opens the Pokémon selection
 * screen, to swap the card's Pokémon for another, and holding a Pokémon there shows a panel of its types, HP, fast move
 * and charged moves for as long as it is held. The release selects nothing, and CANCEL leaves the party as it was.
 *
 * The selection screen lists the whole storage by CP, opened at the top, so the Pokémon tapped is in view only where
 * its CP is near the top of storage. It is searched for instead, by the species and CP its card shows, and is the cell
 * tinted pink: the card being swapped. The rest of the party is tinted green, and anything else the search finds is
 * white. The game keeps a search for the screen's next opening, so it is cleared before CANCEL.
 *
 * Positions are widths from the anchor each is pinned to, as `layout.mts` places them, measured on a Pixel 8 Pro's
 * full-size screenshots: the header, search field and grid pinned to the top, CANCEL to the foot.
 */

import { closest, type Form, type GameData } from '../inventory/game-master.mts';
import { readMoves, type Moves } from '../inventory/moves.mts';
import { fold, ocr, type Line } from '../inventory/ocr.mts';
import { crop, rgb, type Image } from '../inventory/png.mts';
import { BOTTOM, down, place, tall, TOP } from './layout.mts';
import { onParty } from './menus.mts';
import { type Point } from './play.mts';

/** The search field, tapped right of its middle, which is inside it whether or not a search has drawn `<` before it. */
const SEARCH: Point = [0.556, 0.536];

/** The ⊗ at the search field's right end, drawn once a search is in force, which clears it. */
const CLEAR: Point = [0.92, 0.536];

/** CANCEL, left of DONE at the foot of the screen. */
const CANCEL: Point = [0.278, -0.1558];

/**
 * Whether `lines`, OCR of a whole screenshot, are the selection screen's: `POKÉMON` over the grid, read as `pokemon`,
 * and `CANCEL` at the foot. DONE is no help, being white on the green, which OCR reads as nothing.
 */
export function isSelection(lines: readonly Line[]): boolean {
  const words = new Set(lines.map((line) => fold(line.text)));

  return words.has('pokemon') && words.has('cancel');
}

/** Whether a search is in force: the toggle that shows each result's evolutionary line is drawn only then. */
export const searched = (lines: readonly Line[]) =>
  lines.some((line) => fold(line.text).includes('show evolutionary line'));

/**
 * What to search for to find the card of the species numbered `dex` at `cp`: `376&cp3986` for Metagross, or the CP
 * alone where the species was not read. A dex number finds the species alone, where its name would find nicknames too,
 * and is a term for every species, Ho-Oh's and Mr. Mime's as much as Metagross's. The CP alone can find a crowd, a Great
 * League storage holding many at CP 1500, the species alone more.
 */
export const query = (dex: number | undefined, cp: number) => (dex === undefined ? `cp${cp}` : `${dex}&cp${cp}`);

/**
 * The grid: three columns centred across the screen, rows of cells from 0.715 widths down from the top, a row every
 * 0.361 widths, each cell 0.339 tall. The CP lines of the first rows were read at 0.326, 0.488, 0.651 and 0.813 of the
 * Pixel 8 Pro's height with a search in force and without, so the grid starts in the same place either way.
 */
const COLUMNS = [0.185, 0.5, 0.815];
const GRID_TOP = 0.715;
const ROW = 0.361;
const CELL = 0.339;

/** Where the white bar holding CANCEL and DONE begins, in widths above the foot, which no cell is read below. */
const BAR = -0.267;

/**
 * Where a cell's tint is sampled: left of its centre, clear of the Pokémon drawn there, at three heights down it, since
 * an overlay at the screen's left edge — PGSharp's star, at about 1.1 widths down — can cover one of them.
 */
const TINT_X = 0.125;
const TINT_YS = [0.1, 0.17, 0.24];

/** The pink of the card being swapped, 255/228/228 on every capture, against 228/246/218 for the rest of the party. */
const isPink = ([r, g, b]: readonly [number, number, number]) =>
  r >= 245 && Math.abs(g - 228) <= 12 && Math.abs(b - 228) <= 12;

/** Where to hold the cell tinted pink, the card being swapped, at its centre; `undefined` where none is in view. */
export function pinkCell(image: Image): Point | undefined {
  const bar = down(BAR, BOTTOM, image);

  for (let row = 0; down(GRID_TOP + row * ROW + CELL, TOP, image) <= bar; row++) {
    const top = GRID_TOP + row * ROW;

    for (const x of COLUMNS) {
      const pink = TINT_YS.filter((y) =>
        isPink(rgb(image, (x - TINT_X) * image.width, down(top + y, TOP, image) * image.height)),
      );

      if (pink.length >= 2) {
        return place([x, top + CELL / 2], TOP, image);
      }
    }
  }

  return undefined;
}

/**
 * The panel a held Pokémon shows: white, 255 in every channel, over the rest of the screen dimmed to 186 or so. A row is
 * the panel's where `PANEL` of it is that white, the rest being its text, icons and energy bars; the panel is the
 * longest run of such rows above the bar at the foot, across gaps of up to `RULE` widths, and no shorter than
 * `PANEL_TALL` widths, its types and a single move. The gaps are the rule under its types, 4 px across the four
 * captured panels, and the edge of an energy bar, 1 px under Xerneas's Moonblast.
 */
const WHITE = 252;
const PANEL = 0.4;
const RULE = 0.01;
const PANEL_TALL = 0.15;

function panelBand(image: Image): { top: number; height: number } | undefined {
  const bottom = Math.round(down(BAR, BOTTOM, image) * image.height);
  const step = Math.max(1, Math.round(image.width / 120));
  const gap = RULE * image.width;
  let best: { top: number; height: number } | undefined;
  let run: { top: number; last: number } | undefined;

  for (let y = 0; y <= bottom; y++) {
    let white = 0;
    let all = 0;

    for (let x = 0; y < bottom && x < image.width; x += step, all++) {
      white += rgb(image, x, y).every((c) => c >= WHITE) ? 1 : 0;
    }

    if (y < bottom && white >= all * PANEL) {
      run = run && y - run.last <= gap ? { ...run, last: y } : { top: y, last: y };
    }

    if (run && (y === bottom || y - run.last > gap)) {
      const height = run.last + 1 - run.top;
      best = !best || height > best.height ? { top: run.top, height } : best;
      run = undefined;
    }
  }

  return best && best.height >= tall(PANEL_TALL, image) * image.height ? best : undefined;
}

/** A card's Pokémon as its panel shows it: the species its types and moves name, where they name one, and its moves. */
export interface Panel extends Moves {
  species: string | null;
}

const same = (a: readonly string[], b: ReadonlySet<string>) => a.length === b.size && a.every((t) => b.has(t));

/**
 * What the panel on `image`, a screenshot taken while a Pokémon is held, says of it: its fast move and charged moves,
 * and the species whose forms of the panel's types hold them. `species` is the card's as its silhouette was read, which
 * the moves are matched among first; null, every move is. Undefined where no panel is drawn, or its types or moves went
 * unread. A Pokémon whose moves two species of its types can hold is named by neither, and one whose moves no form of
 * its types holds, by none.
 */
export async function readPanel(
  image: Image,
  data: GameData,
  species: string | null,
  read: (image: Image) => Promise<Line[]> = ocr,
): Promise<Panel | undefined> {
  const band = panelBand(image);

  if (!band) {
    return undefined;
  }

  const panel = crop(image, 0, band.top, image.width, band.height);
  const lines = [...(await read(panel))].sort((a, b) => a.top - b.top);
  const [first] = lines;

  if (!first) {
    return undefined;
  }

  // The first row, `Steel / Psychic` and `166/166 HP`, which OCR can split in two and run each type's icon into its
  // name: `OSteel /`, one edit from Steel.
  const head = lines.filter((line) => line.top < first.top + first.height);
  const types = new Set(
    head.flatMap((line) => line.text.split(/[\s/]+/).flatMap((word) => closest(word, data.types, (t) => t) ?? [])),
  );
  const typed = data.forms.filter((form) => same(form.types, types));

  // The moves' rows, their names in title case: the captions under a move with a stat change, `DEFENSE DROP`, are
  // capitals throughout.
  const rows = lines.filter((line) => !head.includes(line) && /[a-z]/.test(line.text));
  const pool = (forms: readonly Form[]) => [...new Set(forms.flatMap((form) => form.moves))];
  const of = (name: string | null) => pool(typed.filter((form) => form.species === name));

  // The one species whose forms of these types hold every move read, or null.
  const speciesOf = ({ fast, charged }: Moves) => {
    const read = [fast, ...charged].filter((move) => move !== null);
    const fits = new Set(
      typed.filter((form) => read.every((move) => form.moves.some((m) => m.name === move))).map((form) => form.species),
    );

    return read.length > 0 && fits.size === 1 ? ([...fits][0] ?? null) : null;
  };

  let moves = await readMoves(rows, data, of(species), panel);
  let named = speciesOf(moves);

  // Matched among another species' moves, or every move there is where the card's species was not read: read again
  // among the moves of the species they name, which affords slack the whole list cannot, for a row the first pass lost.
  if (named !== null && named !== species && (moves.fast === null || moves.charged.length < 2)) {
    moves = await readMoves(rows, data, of(named), panel);
    named = speciesOf(moves);
  }

  return types.size === 0 || (moves.fast === null && moves.charged.length === 0)
    ? undefined
    : { species: named, ...moves };
}

/** What reading a card needs of the phone, as `run.mts`'s `Phone` gives it. */
export interface Hands {
  screenshot(): Promise<Image>;
  tap(at: Point): Promise<void>;
  hold(at: Point): Promise<Image>;
  search(text: string): Promise<void>;
}

/**
 * How long each step is given to draw, in milliseconds: a screen sliding in after a card's tap or CANCEL, as a menu's
 * tap is; the keyboard after the search field's tap; the results after a search; and the grid after the search is
 * cleared.
 */
const OPENS_MS = 1_500;
const KEYBOARD_MS = 1_000;
const RESULTS_MS = 1_500;
const CLEARED_MS = 1_000;

/**
 * Reads the party card at `card` by its panel: tap it, search for it, hold the pink cell, then clear the search and
 * CANCEL. `species` is the card's as its silhouette was read, which it is searched for by with `cp` and its panel's
 * moves matched among first. A silhouette misread names a species the search finds nothing of, so a search by both that
 * shows no pink cell is followed by one by the CP alone. Answers the panel, or why it went unread, and whether the party
 * screen is showing again for certain. A tap meant for the party screen that lands on the selection screen swaps a
 * Pokémon in, so the screen is read after the card's tap, after each search and after CANCEL; the taps between those
 * reads, on the search field, its ⊗ and CANCEL, land above or below the grid, where no tap swaps anything. A selection
 * screen not showing after the card's tap is looked for once more, a phone at work being slower to draw it, and may
 * yet be on its way after that, so the party screen still showing then is not taken for certain.
 */
export async function readCard(
  hands: Hands,
  sleep: (ms: number) => Promise<void>,
  card: Point,
  { species, cp }: { species: string | null; cp: number },
  data: GameData,
  read: (image: Image) => Promise<Line[]> = ocr,
): Promise<{ panel?: Panel; why?: string; back: boolean }> {
  await hands.tap(card);
  await sleep(OPENS_MS);

  const opened = await hands.screenshot();
  const at = (point: Point, anchor: number) => place(point, anchor, opened);
  const dex = data.forms.find((form) => form.species === species)?.dex;
  const terms = [...new Set([query(dex, cp), query(undefined, cp)])];
  let lines = await read(opened);
  let cell: Point | undefined;
  let found: string | undefined;

  if (!isSelection(lines)) {
    await sleep(OPENS_MS);
    lines = await read(await hands.screenshot());
  }

  if (!isSelection(lines)) {
    return { why: 'the selection screen did not open', back: false };
  }

  for (const term of terms) {
    await hands.tap(at(SEARCH, TOP));
    await sleep(KEYBOARD_MS);
    await hands.search(term);
    await sleep(RESULTS_MS);

    const results = await hands.screenshot();
    lines = await read(results);
    cell = isSelection(lines) ? pinkCell(results) : undefined;

    if (cell || !searched(lines)) {
      found = cell && term;
      break;
    }
  }

  // A cell its dex number found is the species searched for, whoever the panel names: a type OCR missed leaves its
  // moves to fit another, a Metagross whose Steel went unread holding Shadow Claw and Psychic as Mew does.
  const held = cell && (await readPanel(await hands.hold(cell), data, species, read));
  const panel = held && dex !== undefined && found === query(dex, cp) ? { ...held, species } : held;
  const took = searched(lines);

  // Only where the search took: with none in force there is no ⊗, and the field's end opens the keyboard over CANCEL.
  if (took) {
    await hands.tap(at(CLEAR, TOP));
    await sleep(CLEARED_MS);
  }

  await hands.tap(at(CANCEL, BOTTOM));
  await sleep(OPENS_MS);

  const back = onParty(await hands.screenshot());
  const why = cell
    ? 'its panel went unread'
    : !isSelection(lines)
      ? 'the selection screen went unrecognised after the search'
      : took
        ? `no pink cell for ${terms.join(' or ')}`
        : 'the search did not take';

  return panel ? { panel, back } : { why, back };
}
