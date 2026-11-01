/**
 * Where the game draws something on a phone of any shape. The game sizes what it draws by the screen's width and pins
 * each piece at a fraction of the height, its anchor: 0 for the top edge, 1 for the foot, 0.5 for the middle, and
 * anywhere between for a piece inside a panel that stretches with the screen. So a piece is `anchor` of the height plus
 * a fixed number of the screen's widths from it, a number every phone agrees on, and every position down the screen is
 * written that way: an anchor and widths from it, with no phone's shape as the one the rest are taken from.
 *
 * A position is measured the same way on any phone: drawn at `f` of the height, it is `(f - anchor) × height / width`
 * widths from its anchor. An anchor is measured too, not guessed: from where one piece sits on two shapes,
 * `(f₁ r₂ - f₂ r₁) / (r₂ - r₁)`, each `r` being that screen's width over its height. Measured that way on a Pixel 8 Pro
 * at 1008×2244 and a Pixel 4 XL at 1440×3040: the HUD and its names at 0, the charged-move buttons, their labels, the
 * shield prompt, the map's Poké Ball and the round button at the foot at 1, the leader's BATTLE at 0.507, USE THIS PARTY
 * at 0.90, and the party's cards at 0.69. Measured means by the reader that uses it, at the pixel: the cards' anchor
 * judged by eye, as their own height, was 5 px out, which took a card's outline from leading the next species by 0.10
 * or more to under the margin it is held to.
 *
 * Across needs nothing of this: a fraction of the width is the same fraction on every shape.
 */

/** The anchors most pieces have, the top edge and the foot. */
export const TOP = 0;
export const BOTTOM = 1;

export interface Size {
  width: number;
  height: number;
}

/** A distance down `screen` of `widths` of its width, as a fraction of its height. */
export function tall(widths: number, { width, height }: Size): number {
  return (widths * width) / height;
}

/** The fraction of `screen`'s height a piece `widths` of its width from `anchor` sits at, negative being above it. */
export function down(widths: number, anchor: number, screen: Size): number {
  return anchor + tall(widths, screen);
}

/** Where on `screen` a point `x` across it and `widths` from `anchor` down it is, as fractions of it. */
export function place([x, widths]: readonly [number, number], anchor: number, screen: Size): [number, number] {
  return [x, down(widths, anchor, screen)];
}

/** A rectangle on the screen as fractions of it: left, top, right and bottom. */
export type Box = readonly [number, number, number, number];

/**
 * What a reader samples, reads with OCR or taps on a screen a run passes through, which an overlay drawn over it would
 * spoil: named as a refusal names it, `the party grid's left column`. Its `boxes` are where, every one needed unless the
 * reader has spares, when `need` says how many must be clear for it to work.
 */
export interface Area {
  name: string;
  boxes: readonly Box[];
  need?: number;
}

/** The box `half` widths either side of `[x, widths]` down from `anchor`, across and down alike. */
export function around([x, widths]: readonly [number, number], half: number, anchor: number, screen: Size): Box {
  const y = down(widths, anchor, screen);
  const up = tall(half, screen);

  return [x - half, y - up, x + half, y + up];
}
