/**
 * Which species the party screen's three cards hold, told by silhouette. The game draws a Pokémon's icon on its card at
 * one size and in one place, clipped to the card, so the icon's outline laid over the card's cells lines up with what
 * the card shows for the right species and for few others. The outline rather than the colours, because a shiny is
 * drawn in colours its icon does not have, and the outline is the same either way.
 *
 * The card's own name is no help: it is the nickname where there is one, and a nickname is the case this is for.
 *
 * Measured on the six committed cards against every one of the game's 1,215 form icons: each card's own species scores
 * highest, at 0.72 to 0.90 of the cells overlapping, and the nearest other species 0.11 to 0.25 below it. Without its
 * own species a card's nearest others crowd within 0.04 of each other, and `MARGIN` sits between that and 0.11.
 */

import { type Moves } from '../inventory/moves.mts';
import { ocr, type Line } from '../inventory/ocr.mts';
import { rgb, type Image } from '../inventory/png.mts';
import { down, place, type Size } from './layout.mts';
import { type Point } from './play.mts';

/**
 * What is known of a party card: its species, null where neither its silhouette nor its panel named one; the CP it
 * shows, null where unread; and its moves, where the panel the selection screen shows for it held was read.
 */
export interface Card {
  species: string | null;
  cp: number | null;
  moves?: Moves;
}

/** A form's outline as a card draws it, cell by cell across the card: 1 where the Pokémon is. */
export type Silhouette = Uint8Array;

export interface Icon {
  species: string;
  silhouette: Silhouette;
}

/**
 * Where the cards are, in the screen's widths: each one's centre across it and down from its anchor, and half its side.
 * The cards are square, so the side is measured across for both.
 *
 * Down, they are pinned at 0.69 of the height, inside a panel that stretches with the screen, as `layout.mts` places
 * them: on a Pixel 4 XL at 0.7345 of its height, and on a Pixel 8 Pro 5 px above where pinning them at that fraction on
 * every shape would. Measured on two of the Pixel 8 Pro's party screens: pinned at 0.7345, Gengar's outline led the
 * next species by 0.03 to 0.04, under `MARGIN`, and Stunfisk's card read as Durant; from 0.685 to 0.69 all six cards
 * lead by 0.087 or more. Either side the window is a cliff: at 0.70 Stunfisk falls under `MARGIN`, and at 0.68 Absol,
 * white on the card's white, reads at 0.35.
 */
const CARD_XS = [0.231, 0.5, 0.769];
const CARD_Y = 0.0939;
const CARD_ANCHOR = 0.69;
const HALF = 0.088;

/** How wide the game draws an icon's whole canvas on a card, in screen widths, fitted to the committed cards. */
const ICON = 0.2;

/** How many cells a card is divided into each way: some 2.6 pixels apiece on a 720-wide screen. */
const GRID = 48;

/** The corner the sparkles of a shiny are drawn in, as a fraction of the card each way, which is left out of both. */
const SPARKLES = 0.3;

/** How far a pixel's colour has to be from the card's own, summed over the channels, to be part of the Pokémon. */
const INK = 40;

/** How far ahead of every other species the best has to be for the card to be answered rather than declined. */
const MARGIN = 0.05;

/** Where a cell's centre falls, either way, from the card's centre, in screen widths. */
const offset = (cell: number) => -HALF + ((cell + 0.5) * 2 * HALF) / GRID;

const sparkles = (i: number, j: number) => i < GRID * SPARKLES && j < GRID * SPARKLES;

export function silhouetteOfIcon(icon: Image): Silhouette {
  const silhouette = new Uint8Array(GRID * GRID);

  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const u = Math.floor((offset(i) / ICON + 0.5) * icon.width);
      const v = Math.floor((offset(j) / ICON + 0.5) * icon.height);
      const inside = u >= 0 && v >= 0 && u < icon.width && v < icon.height;

      silhouette[j * GRID + i] = inside && (icon.data[(v * icon.width + u) * 4 + 3] ?? 0) >= 128 ? 1 : 0;
    }
  }

  return silhouette;
}

function silhouetteOfCard(image: Image, x: number): Silhouette {
  const unit = image.width;
  const [cx, cy] = [x * unit, down(CARD_Y, CARD_ANCHOR, image) * image.height];
  const card = rgb(image, cx, cy + HALF * unit * 0.9);
  const silhouette = new Uint8Array(GRID * GRID);

  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const pixel = rgb(image, cx + offset(i) * unit, cy + offset(j) * unit);
      const ink = pixel.reduce((sum, c, k) => sum + Math.abs(c - (card[k] ?? 0)), 0);

      silhouette[j * GRID + i] = ink > INK ? 1 : 0;
    }
  }

  return silhouette;
}

/** How much two silhouettes overlap, as the cells both cover over the cells either does. */
function overlap(a: Silhouette, b: Silhouette): number {
  let both = 0;
  let either = 0;

  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      if (!sparkles(i, j)) {
        both += (a[j * GRID + i] ?? 0) & (b[j * GRID + i] ?? 0);
        either += (a[j * GRID + i] ?? 0) | (b[j * GRID + i] ?? 0);
      }
    }
  }

  return either === 0 ? 0 : both / either;
}

/**
 * The species on each of the party screen's three cards, left to right, or null for a card no species is clearly
 * nearest. `icons` is every form's silhouette with the species it belongs to, each species scored by its nearest form.
 */
export function readParty(image: Image, icons: readonly Icon[]): (string | null)[] {
  return CARD_XS.map((x) => {
    const card = silhouetteOfCard(image, x);
    const best = new Map<string, number>();

    for (const { species, silhouette } of icons) {
      best.set(species, Math.max(best.get(species) ?? 0, overlap(card, silhouette)));
    }

    const [first, second] = [...best].sort(([, a], [, b]) => b - a);

    return first && first[1] - (second?.[1] ?? 0) >= MARGIN ? first[0] : null;
  });
}

/** Where each card is tapped to open the selection screen for it, at its centre. */
export const cardAt = (card: number, screen: Size): Point => place([CARD_XS[card] ?? 0.5, CARD_Y], CARD_ANCHOR, screen);

/**
 * The CP each card shows above it, `CP 4673`, at -0.130 to -0.135 widths from the cards' centres across eight committed
 * party screens off both phones and over each card's centre. OCR reads the digits whole and the `CP` as it likes —
 * `ce 4673`, `ce4275`, `a 2495` — so a card's CP is the last number on its line; one of the 24 went unread.
 */
const CP_ABOVE = -0.133;
const CP_REACH = 0.04;

export const readCps = async (image: Image, read: (image: Image) => Promise<Line[]> = ocr) =>
  cpsOf(await read(image), image);

/** The CP each card shows, as `readCps` reads it, out of `lines` already read off the whole of `image`. */
export function cpsOf(lines: readonly Line[], image: Image): (number | null)[] {
  const row = down(CARD_Y, CARD_ANCHOR, image) * image.height;

  return CARD_XS.map((x) => {
    const line = lines.find(
      ({ left, top, width, height }) =>
        Math.abs((top + height / 2 - row) / image.width - CP_ABOVE) <= CP_REACH &&
        Math.abs((left + width / 2) / image.width - x) <= HALF,
    );
    const cp = /(\d{2,4})\D*$/.exec(line?.text ?? '')?.[1];

    return cp === undefined ? null : Number(cp);
  });
}
