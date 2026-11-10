/**
 * What a battle's text says: the two names along the top, ours and the opponent's, the CP beside each, and the charged
 * move printed under each button. Our name is the species unless the Pokémon has a nickname, the opponent's always.
 *
 * Read off a stream frame, 360 wide, by cropping each band and scaling it up for Tesseract. Measured on the committed
 * frames, each name and each move comes out whole, lit buttons and unlit alike, where OCR of the whole frame drops
 * most of them into the artwork around them. About 35ms a band, so it is done every few seconds rather than every
 * frame.
 */

import { closest, distance, type GameData } from '../../core/game-master.mts';
import { centre, fold, ocr, ocrLine, type Line } from '../../core/ocr.mts';
import { crop, scale, type Image } from '../../core/png.mts';
import { BOTTOM, down, spanning, TOP, type Area, type Size } from './layout.mts';
import { BANNER_ANCHOR, BANNERS, BUTTON_XS, LAYOUTS, layoutsOf } from './recognise.mts';
import { type Typing } from './strategy.mts';

export interface Sighting {
  /** Our species, or null where a nickname stands in its place. */
  own: string | null;
  opponent: string | null;

  /** Each side's CP, or null where it was not read. */
  ownCp: number | null;
  opponentCp: number | null;

  /** Each side's types, as `readTypes` reads the icons above its panel, or null where they were not read. */
  ownTypes: Typing | null;
  opponentTypes: Typing | null;

  /** The move under each button whose label was read, by the button's x. */
  moves: Map<number, string>;
}

/** A read run beside the battle: `done` once it has finished, or failed, the failure thrown where the read is used. */
export interface Reading<T> {
  done?: T | { error: unknown };
}

/** Sets `reading`'s `done` once `read` has finished or failed. */
export function settle<T>(reading: Reading<T>, read: Promise<T>): void {
  void read.then(
    (done) => (reading.done = done),
    (error: unknown) => (reading.done = { error }),
  );
}

/** A sighting of nothing yet, which a battle starts from. */
export const unseen = (): Sighting => ({
  own: null,
  opponent: null,
  ownCp: null,
  opponentCp: null,
  ownTypes: null,
  opponentTypes: null,
  moves: new Map(),
});

/**
 * The HUD's line of names, pinned to the top, and the labels beneath the buttons, lit or not, pinned to the foot: across
 * as fractions of the screen's width, and down as widths from the edge each is pinned to.
 */
const NAMES = { top: 0.1393, bottom: 0.19 } as const;
const LABELS = { left: 0.05, right: 0.95, top: -0.1583, bottom: -0.0317 } as const;

/**
 * The label of a Mega's mega move, under its button raised between the other two: `FUTURE SIGHT+` at 713 to 719 of 802
 * on a Pixel 8 Pro and how effective it is at 727 to 733, between 0.39 and 0.61 across, clear of the outer buttons'
 * rims. Never seen lit, so taken down as far again as a lit label falls below an unlit one under the other buttons.
 */
const RAISED = { left: 0.32, right: 0.68, top: -0.26, bottom: -0.165 } as const;

/**
 * How far a label's centre may sit from a button's and still be its label: a pair's labels are 0.38 apart, and a long
 * name centred under one spans about 0.15 either side. A pair's outer button and a Mega's on the same side are only
 * 0.096 apart, within reach of the same label, which goes to the nearer.
 */
const LABEL_REACH = 0.12;

/**
 * A CP as the HUD prints it, `CP 2495`, which OCR can run into the names beside it or into the other side's CP when the
 * sky between the panels is dark: `cP 4139 ne CP 4163` at night. Read off the names' band of the committed frames, it
 * gave 52 of the 60 CPs right; three were one digit out, 4143 for 4163 twice and 1397 for 1387, and five were missing.
 */
const CP = /c\s*p\s*(\d{2,4})\b/gi;

/**
 * How wide a label's letter is, as a fraction of the screen's width: 0.019 to 0.023 across Hydro Pump, Avalanche,
 * Shadow Sneak and Crunch on the committed frames. A label's line can run on past it, OCR taking in whatever is drawn
 * to its right — Crunch's from 0.42 to 0.89 behind a Tyranitar, its centre then nearer the right button than its own —
 * so the left edge, which held at 0.42 to 0.46, is what places it, with the name's own width.
 */
const LETTER = 0.022;

/**
 * What the line beneath a move can say of how effective it is, a neutral hit saying nothing. OCR splits it into pieces
 * where the artwork behind breaks it up, and a piece of a few letters can be within `closest`'s slack of a short move:
 * `TIVE` and `IVE`, its end, are each one edit from Dive.
 */
const EFFECTIVENESS = ['Super Effective', 'Not Very Effective'];

const band = (
  image: Image,
  box: { left?: number; right?: number; top: number; bottom: number },
  anchor: number,
  factor: number,
) => {
  const left = Math.round((box.left ?? 0) * image.width);
  const top = Math.round(down(box.top, anchor, image) * image.height);
  const width = Math.round((box.right ?? 1) * image.width) - left;
  const height = Math.round(down(box.bottom, anchor, image) * image.height) - top;

  return { image: scale(crop(image, left, top, width, height), factor), left, width, factor };
};

/** Where a line's centre falls across the screen, as a fraction of its width. */
const across = (line: Line, { left, factor }: { left: number; factor: number }, image: Image) =>
  (left + centre(line)[0] / factor) / image.width;

/**
 * What the battle's text says on `image`. `species` is ours where an earlier frame's HUD named it, which the labels are
 * matched among, as the name on this frame is: Gengar's `SLUDGE BOMB` read short as `SLUDGE B` was nearer Sludge, which
 * Gengar cannot hold, than Sludge Bomb, and the move thrown flipped between them read to read. Unnamed — nicknamed, the
 * species no more than the party's guess, which the labels are what correct — every charged move is a label it could
 * be.
 */
export async function readBattle(
  image: Image,
  data: GameData,
  read: (image: Image) => Promise<Line[]> = ocr,
  species: string | null = null,
): Promise<Sighting> {
  // Every band is cropped before the first read, since `stream.mts` frees the frame two frames on, while OCR runs.
  const names = band(image, NAMES, TOP, 2);
  const labels = band(image, LABELS, BOTTOM, 3);
  const raised = band(image, RAISED, BOTTOM, 3);
  const sighting = unseen();

  // The names share their line with each side's CP, which matches no species and so drops out of the names here. Each
  // CP is placed by where it starts in its line, a line that runs both together holding ours first.
  for (const line of await read(names.image)) {
    const found = closest(line.text, data.species, (name) => name);
    const side = across(line, names, image) < 0.5 ? 'own' : 'opponent';

    if (found) {
      sighting[side] ??= found;
    }

    for (const match of line.text.matchAll(CP)) {
      const at =
        (names.left + (line.left + (match.index / line.text.length) * line.width) / names.factor) / image.width;

      sighting[at < 0.5 ? 'ownCp' : 'opponentCp'] ??= Number(match[1]);
    }
  }

  const own = sighting.own ?? species;
  const charged = (
    own === null ? data.moves : data.forms.filter((form) => form.species === own).flatMap((f) => f.moves)
  )
    .filter((move) => !move.fast && move.name in data.combat)
    .map((move) => move.name);

  // Beneath each move is how effective it is, which matches no move whole. A piece of it can, and is dropped for being
  // no further from some stretch of that line than from the move: `TIVE` is no distance within SUPER EFFECTIVE and one
  // from Dive, where `DIVE` read whole is one and none.
  const movesIn = async ({ image: lines }: typeof labels, among = charged) =>
    (await read(lines)).flatMap((line) => {
      const move = closest(line.text, among, (name) => name);

      return !move || EFFECTIVENESS.some((said) => distance(line.text, said, true) <= distance(line.text, move))
        ? []
        : [{ line, move }];
    });

  for (const { line, move } of await movesIn(labels)) {
    const left = (labels.left + line.left / labels.factor) / image.width;
    const width = Math.min(line.width / labels.factor / image.width, move.length * LETTER);
    const x = left + width / 2;
    const [button] = BUTTON_XS.filter((bx) => Math.abs(bx - x) <= LABEL_REACH).sort(
      (a, b) => Math.abs(a - x) - Math.abs(b - x),
    );

    if (button !== undefined) {
      sighting.moves.set(button, move);
    }
  }

  // The mega move's label, read only where an outer button of three is labelled: elsewhere the band holds whatever
  // another layout's buttons draw there, one move's own button among it. Matched among the mega moves alone, each named
  // with a `+`: among the rest, `FUTURE SIGHT+` is one edit from the Future Sight Armored Mewtwo holds.
  const [first, middle, last] = LAYOUTS[2];
  const mega = charged.filter((name) => name.endsWith('+'));

  if (sighting.moves.has(first) || sighting.moves.has(last)) {
    for (const { move } of await movesIn(raised, mega)) {
      sighting.moves.set(middle, move);
    }
  }

  return sighting;
}

const USED = /^(.*?)\s*used\s*([^!]*)/i;

/**
 * Where across the screen `Get Ready!` is read: the pill it is drawn in, 0.339 to 0.656 of the width on both phones,
 * narrower than any banner's. Read with the sky either side, as a banner is, it went unread over bright cloud, `la` and
 * `at` on frames that show it plainly, where the pill alone read it on every one.
 */
const PILL = { left: 0.34, right: 0.66 } as const;

/**
 * The charged move the banner says `opponent` used, matched to one its species can hold, or null where no banner is up,
 * it names another Pokémon — ours, each side's moves having one — or the move is not one of its. A mirror match, both
 * sides the same species, says nothing of whose move it was, and so is not read.
 */
export async function readBanner(
  image: Image,
  data: GameData,
  { own, opponent }: { own: string | null; opponent: string | null },
  readLine: (image: Image) => Promise<string | null> = ocrLine,
): Promise<string | null> {
  if (opponent === null || own === opponent) {
    return null;
  }

  // Every band is cropped before the first read, since `stream.mts` frees the frame two frames on, while OCR is running.
  const bands = BANNERS.map((place) => band(image, place, BANNER_ANCHOR, 3).image);

  for (const banner of bands) {
    const [, who = '', what = ''] = USED.exec((await readLine(banner)) ?? '') ?? [];

    // Whatever the pill's edge read as runs on before the name, so the name is the words at the end, as many as it has.
    const words = fold(who).split(' ').slice(-fold(opponent).split(' ').length).join(' ');

    if (closest(words, [opponent], (name) => name)) {
      const charged = data.forms
        .filter((form) => form.species === opponent)
        .flatMap((form) => form.moves.filter((move) => !move.fast).map((move) => move.name));

      return closest(what, [...new Set(charged)], (name) => name);
    }
  }

  return null;
}

/**
 * Whether `image` shows `Get Ready!`, which our charged move's minigame opens with, in the pill a banner is drawn in and
 * in either place it has been. Nothing else the battle draws says `Ready`, the opponent's minigame being hidden from us.
 * Over 6,935 frames of charged moves under way, a tenth of a second apart, from 120 of the opponent's throws to ours
 * after it in 18 kept runs, OCR read it before 106 of the 109 minigames and on no other frame: two drew no pill, and
 * the touch rings of our own swipes covered the third.
 */
export async function readGetReady(image: Image): Promise<boolean> {
  // Every band is cropped before the first read, since `stream.mts` frees the frame two frames on, while OCR is running.
  const bands = BANNERS.map((place) => band(image, { ...PILL, ...place }, BANNER_ANCHOR, 3).image);

  for (const banner of bands) {
    if (/\bready\b/.test(fold((await ocrLine(banner)) ?? ''))) {
      return true;
    }
  }

  return false;
}

/**
 * What is known after another read: what it read, and what earlier reads did that it did not. A Pokémon has one layout
 * of buttons — the one centred, the pair, or a Mega's three — so a label read under one layout drops any left from
 * those it rules out, which a label read once off a frame mid-transition would otherwise hold against the buttons for
 * the rest of the Pokémon's turn out.
 */
export function merge(seen: Sighting, read: Sighting): Sighting {
  const layouts = layoutsOf(read.moves.keys());
  const kept = [...seen.moves].filter(([x]) => layouts.some((layout) => layout.includes(x)));

  return {
    own: read.own ?? seen.own,
    opponent: read.opponent ?? seen.opponent,
    ownCp: read.ownCp ?? seen.ownCp,
    opponentCp: read.opponentCp ?? seen.opponentCp,
    ownTypes: read.ownTypes ?? seen.ownTypes,
    opponentTypes: read.opponentTypes ?? seen.opponentTypes,
    moves: new Map([...kept, ...read.moves]),
  };
}

/** The bands OCR reads, for `overlay.mts`: each is cropped whole and read as one, so the whole of it is needed. */
export function areas(screen: Size): Area[] {
  const box = ({ left = 0, right = 1, top, bottom }: { left?: number; right?: number; top: number; bottom: number }) =>
    [left, top, right, bottom] as const;

  return [
    { name: "the battle's names and CPs", boxes: [spanning(box(NAMES), TOP, screen)] },
    { name: "the charged moves' names", boxes: [spanning(box(LABELS), BOTTOM, screen)] },
    { name: "a Mega's mega move's name", boxes: [spanning(box(RAISED), BOTTOM, screen)] },
    {
      name: "the opponent's charged move banner",
      boxes: BANNERS.map((place) => spanning(box(place), BANNER_ANCHOR, screen)),
    },
  ];
}
