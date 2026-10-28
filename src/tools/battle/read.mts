/**
 * What a battle's text says: the two names along the top, ours and the opponent's, the CP beside each, and the charged
 * move printed under each button. Our name is the species unless the Pokémon has a nickname, the opponent's always.
 *
 * Read off a stream frame, 360 wide, by cropping each band and scaling it up for Tesseract. Measured on the committed
 * frames, each name and each move comes out whole, lit buttons and unlit alike, where OCR of the whole frame drops
 * most of them into the artwork around them. About 220ms for both bands, so it is done every few seconds rather than
 * every frame.
 */

import { closest, type GameData } from '../inventory/game-master.mts';
import { centre, fold, ocr, ocrLine, type Line } from '../inventory/ocr.mts';
import { crop, scale, type Image } from '../inventory/png.mts';
import { BOTTOM, down, TOP } from './layout.mts';
import { BUTTON_XS } from './recognise.mts';
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
 * How far a label's centre may sit from a button's and still be its label. Two buttons' labels are 0.38 apart, and a
 * long name centred under one spans about 0.15 either side.
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
  const names = band(image, NAMES, TOP, 2);
  const labels = band(image, LABELS, BOTTOM, 3);
  const sighting = unseen();

  // The names share their line with each side's CP, which matches no species and so drops out of the names here. Each
  // CP is placed by where it starts in its line, a line that runs both together holding ours first.
  for (const line of await read(names.image)) {
    const species = closest(line.text, data.species, (name) => name);
    const side = across(line, names, image) < 0.5 ? 'own' : 'opponent';

    if (species) {
      sighting[side] ??= species;
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

  // Beneath each move is how effective it is, which matches no move and so drops out here.
  for (const line of await read(labels.image)) {
    const move = closest(line.text, charged, (name) => name);

    if (!move) {
      continue;
    }

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

  return sighting;
}

/**
 * The banner a charged move puts up once it is thrown, `Quaquaval used Aqua Jet!`, in a pill across the sky. Read as one
 * line, the band 0.232 to 0.317 widths below its anchor cropped and scaled up three times: of six banners in the GO
 * Battle League screenshots off a Pixel 4 XL, where the band is 0.30 to 0.34 of the height, four read whole — `a
 * Swampert used Hydro Cannon! at`, `ae Quaquaval used Aqua Jet! .` — and Golem's Stone Edge as `Golem usedlistras`,
 * which names no move; on a Pixel 8 Pro at night, `Groudon used Solar Beam!` whole once fully drawn. OCR of the whole
 * frame read one of them.
 */
const BANNER = { top: 0.2322, bottom: 0.3167 } as const;

/**
 * Where the banner is pinned, as `layout.mts` measures anchors: its line centred at 0.323 of a Pixel 4 XL's height and
 * at 0.316 of a Pixel 8 Pro's, the middle of the bands a line read finds `used` in, two banners on one and three on the
 * other. The two shapes differ little, so the anchor is good to about 0.1 either way; what it has to get right is the
 * band, which pinned to the top missed the Pixel 8 Pro's lettering, rows 250 to 261 of 802, from row 258 down.
 */
const BANNER_ANCHOR = 0.19;
const USED = /^(.*?)\s*used\s*([^!]*)/i;

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

  const [, who = '', what = ''] = USED.exec((await readLine(band(image, BANNER, BANNER_ANCHOR, 3).image)) ?? '') ?? [];

  // Whatever the pill's edge read as runs on before the name, so the name is the words at the end, as many as it has.
  const words = fold(who).split(' ').slice(-fold(opponent).split(' ').length).join(' ');

  if (!closest(words, [opponent], (name) => name)) {
    return null;
  }

  const charged = data.forms
    .filter((form) => form.species === opponent)
    .flatMap((form) => form.moves.filter((move) => !move.fast).map((move) => move.name));

  return closest(what, [...new Set(charged)], (name) => name);
}

/**
 * What is known after another read: what it read, and what earlier reads did that it did not. A Pokémon has either the
 * one centred button or the pair, so a label read under one layout drops any left from the other, which a label read
 * once off a frame mid-transition would otherwise hold against the pair for the rest of the Pokémon's turn out.
 */
export function merge(seen: Sighting, read: Sighting): Sighting {
  const centre = BUTTON_XS[1];
  const layout = read.moves.size > 0 ? read.moves.has(centre) : undefined;
  const kept = [...seen.moves].filter(([x]) => layout === undefined || (x === centre) === layout);

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
