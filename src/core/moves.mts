/**
 * The detail screen scrolled down: the fast move and one or two charged moves. Each row is matched against the pool its
 * form can actually learn, which is a median of seven moves rather than all 329 — the single largest thing that can be
 * done for the reading, since a small pool affords slack a large one cannot.
 *
 * The region is bounded above by the `GYMS & RAIDS` tab and below by the catch details.
 */

import { closest, type Form, type GameData, type Move } from './game-master.mts';
import { findLine, fold, ocrLine, type Line } from './ocr.mts';
import { crop, scale, type Image } from './png.mts';

export interface Moves {
  fast: string | null;
  charged: string[];
}

/**
 * The moves, read out of the rows beneath the `GYMS & RAIDS` tabs — the one thing that sits immediately above them, so
 * a screen without it is read as showing no moves at all. Bounding the region below matters as much: `CAUGHT IN THE
 * WILD` and the rest are ordinary prose a fuzzy match will take for a short move.
 *
 * How each row is matched is described on `readMoves`.
 */
export async function parseMoves(
  lines: readonly Line[],
  data: GameData,
  form: Form | null,
  image: Image,
): Promise<Moves> {
  return readMoves(moveRows(lines), data, form?.moves ?? [], image);
}

/**
 * The moves `rows` name, each row a move's icon, name, energy bar and power, as the detail screen draws them and the
 * panel a held Pokémon shows in a trainer battle's party.
 *
 * Each row is matched against `pool`, the moves its form can hold, before the whole list is considered, which is a
 * choice among a median of seven rather than 329 and affords far more slack: `oO Tackle`, where the type icon came
 * through as two letters, is two edits from `Tackle` and is rejected outright against the full list. A row that still
 * does not match is cropped out of `image` and read again on its own, and that rescue answers only to the pool.
 *
 * A move is the fast one or a charged one by the game master's say rather than by the row it sits in. The rows are
 * where OCR is unreliable — one lost, split or read twice moves every row below it — where a move's kind is a fact.
 *
 * Two charged moves at most, and a third where a row below them names one of `megas`: a Mega's panel lists its mega
 * move there. Matched among those alone, since among every move `Future Sight+` is one edit from the Future Sight
 * Armored Mewtwo holds. None by default, the detail screen's reading stopping at two.
 */
export async function readMoves(
  rows: readonly Line[],
  data: GameData,
  pool: readonly Move[],
  image: Image,
  megas: readonly Move[] = [],
): Promise<Moves> {
  const found: Move[] = [];
  let mega: Move | null = null;

  for (const row of rows) {
    // Enough once a fast move and two charged ones are in, which spares what lies below them a rescue read apiece, but
    // for a mega move, matched as the row reads.
    if (found.some((m) => m.fast) && found.filter((m) => !m.fast).length >= 2) {
      mega = moveIn(row.text, megas, MOVE_SLACK);

      if (mega !== null || megas.length === 0) {
        break;
      }

      continue;
    }

    const move =
      moveIn(row.text, pool, POOL_SLACK) ??
      moveIn(row.text, data.moves, MOVE_SLACK) ??
      (await moveUnder(image, row, pool));

    // Once however many lines it spans: a rescue band at an energy bar's height takes in the name beside the bar too.
    if (move && !found.includes(move)) {
      found.push(move);
    }
  }

  return {
    fast: found.find((m) => m.fast)?.name ?? null,
    charged: [...found.filter((m) => !m.fast).slice(0, 2), ...(mega ? [mega] : [])].map((m) => m.name),
  };
}

/** The lines that can be a move: under the tabs, above the catch details, and carrying letters rather than a power. */
function moveRows(lines: readonly Line[]): Line[] {
  const tab = findLine(lines, MOVE_TAB);

  if (!tab) {
    return [];
  }

  const floor = tab.top + tab.height;
  const middle = (line: Line) => line.top + line.height / 2;
  const rows: Line[] = [];

  // Placed and ordered by its middle rather than its top, since a line's box stretches over whatever glyph was read
  // beside it: on `no-pgsharp.png` a button lifts the fast move's top 74 pixels, to above the tabs.
  for (const line of [...lines].filter((l) => middle(l) > floor).sort((a, b) => middle(a) - middle(b))) {
    const text = fold(line.text);

    if (BELOW_MOVES.test(text)) {
      break;
    }

    if (!CAPTION.test(text) && line.text.replace(/[^A-Za-z]/g, '').length >= 3) {
      rows.push(line);
    }
  }

  return rows.slice(0, MOVE_ROWS);
}

/**
 * Whether the moves can run on past the foot of `image`, so that a screen further down would show what this one does
 * not: the `GYMS & RAIDS` tab is not on it, or the screen ends with less than `MOVE_ROOM` under the tab. A panel the
 * game draws above POWER UP is what does it — Necrozma's fusion artwork, its paragraph and two FUSE buttons leave the
 * tab at the very foot of the screen the scan's one step down brings up, every move row below it.
 *
 * Measured from the tab rather than read off whatever follows the moves, which OCR does not see: NEW ATTACK is white on
 * a pale button and comes through on neither `pikachu.png` nor Necrozma's stitch. So a screen with the room says the
 * moves were there to be read, and a reading short of them on it is a misread another scroll would not help.
 */
export function movesCutOff(lines: readonly Line[], image: Image): boolean {
  const tab = findLine(lines, MOVE_TAB);

  return !tab || image.height - (tab.top + tab.height) < image.width * MOVE_ROOM;
}

/**
 * The move a row names. A charged move is followed by its energy bar, which comes through as a couple of short
 * nonsense tokens — `© Energy Ball ay Ay` — and four characters of them is enough to put the row past the slack. So
 * the whole row is tried first and short trailing tokens dropped one at a time only while nothing has matched:
 * longest-first is what stops `Aqua Jet` being shortened to `Aqua`, which matches nothing at all.
 */
function moveIn(text: string, moves: readonly Move[], slack: number): Move | null {
  let words = text.replace(/\d+/g, '').split(/\s+/).filter(Boolean);

  for (;;) {
    const move = moves.length > 0 ? closest(words.join(' '), moves, (m) => m.name, slack) : null;
    const last = words.at(-1);

    if (move !== null || last === undefined || last.length > MOVE_NOISE) {
      return move;
    }

    words = words.slice(0, -1);
  }
}

/**
 * A row read again on its own, doubled, for the rows the whole-screen pass only half caught — `t Breath` for `Frost
 * Breath`, where the icon and the first letters were lost. Only the pool is offered, since a rescue read is the least
 * trustworthy text on the screen and the whole list would take almost anything.
 */
async function moveUnder(image: Image, row: Line, pool: readonly Move[]): Promise<Move | null> {
  if (pool.length === 0) {
    return null;
  }

  const band = crop(image, 0, row.top - row.height * 0.3, image.width * MOVE_WIDTH, row.height * 1.6);

  return moveIn((await ocrLine(scale(band, 2), MOVE_ALPHABET)) ?? '', pool, POOL_SLACK);
}

/** How far a row may be from a move's name, and how short a trailing token has to be to be an energy bar. */
const MOVE_SLACK = 0.2;
const MOVE_NOISE = 3;

/** A form's own pool is a median of seven moves against 329, so a row may be much further from one of those. */
const POOL_SLACK = 0.45;

/** The tabs directly above the moves, and the first of whatever follows them. */
const MOVE_TAB = /\b(gyms|raids|trainer battles)\b/;
const BELOW_MOVES = /\b(new attack|caught|hatched|traded|swap buddies|transfer|appraise)\b/;

/**
 * The captions under a move: furniture, `WEATHER BONUS` three edits from Weather Ball and a shadow's `SHADOW BONUS` two
 * from Shadow Bone, which the whole move list took it for on both shadow captures. The weather's is matched by its
 * start, since OCR cuts it to `WEATHER BON` about as often as not, and the shadow's by the `BONU` the move lacks.
 */
const CAPTION = /\bweather bon|\bbonu/;

/**
 * The room under the tabs a fast move's row and one charged move's take, as a fraction of the width: the second row's
 * foot is about 0.2 of it below the tabs on both `pikachu.png`, 1008 wide, and Necrozma's stitch, 1440 wide. The rest is
 * slack, and `no-pgsharp.png`, ending halfway through its charged move's row, is 0.19.
 */
const MOVE_ROOM = 0.25;

/** Three rows of moves and a little slack; and how much of the width a name can occupy, short of its power. */
const MOVE_ROWS = 6;
const MOVE_WIDTH = 0.62;

/**
 * Move names are words, with a hyphen in a few — `Lock-On`, `Power-Up Punch` — and a `+` or two after the Apex ones.
 */
const MOVE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-'+ ";
