/**
 * Where the charged-move minigame's bubbles are, so a swipe can go through them rather than across rows that mostly
 * miss. The minigame's rating is what multiplies the move's damage, and rows reached only NICE and GREAT, where the
 * bubbles last over a second — time enough to be aimed at.
 *
 * A bubble is a disc of its move's type colour with a white emblem on it, and the type is known, the move being the
 * one just thrown. The colour comes from the game's own icon for the type, which the bubbles match washed towards
 * white: they are translucent, and paler the bigger they grow. Measured on Water, Ice, Ghost and Dark bubbles: Dark's
 * 102–108/105–106/118–121 against its icon's 106/102/119, Ice's 196/236/228 against 116/207/194 — the same 0.40 to 0.44
 * of the icon's colour in each channel, the rest white. The sky and grass, matching a type's hue, do not hold the same
 * share across their channels; a Pokémon's body of the same colour is far bigger than a bubble and has no emblem on it.
 *
 * Bubbles come in chains, which overlap into one blob, so each blob is swiped along its length. A bubble popped swells
 * and pales before it goes, so a blob paler than the most saturated on the frame is swiped only after the rest.
 */

import { scale, type Image } from '../../core/png.mts';
import { type Point } from './layout.mts';

export type Colour = readonly [r: number, g: number, b: number];

/** A swipe through a blob of bubbles, and the share of the type's colour its pixels hold on average. */
export interface Bubble {
  swipe: readonly [Point, Point];
  share: number;

  /**
   * Kept only for the white `CUT_REACH` followed past its box. A bubble popped swelling pale where a swipe just went is
   * kept so too, the round head of the swipe's trail standing for an emblem, so the player waits through one near a
   * swipe as it does a bubble popping.
   */
  cut?: true;
}

/**
 * The width the finder works at: half a stream frame's, a quarter of the pixels, which took a frame from 55–72ms to
 * a quarter of that and found the same blobs. The sizes below are in pixels at it.
 */
const WIDTH = 180;

/** Where bubbles are looked for, down the screen: below the HUD and the rating, above the foot. */
const FIELD = { top: 0.2, bottom: 0.95 } as const;

/**
 * How closely the share of the type's colour has to agree across the channels, and how much of it there has to be.
 * Only channels the colour is well short of white in count, a channel near white saying nothing about the share. One is
 * enough, the rest held by `PALE`: Fairy's icon is 236/142/228, only its green far from white, and wanting two left
 * no Fairy bubble ever found, a kept Play Rough's minigame swept in rows to `NICE!`.
 */
const SPREAD = 0.12;
const SHARE = { least: 0.3, most: 1.15 } as const;
const CHANNEL_FROM_WHITE = 40;

/**
 * How dim a light, as a fraction of full white, a pixel's shares may be judged under, agreeing under any light from
 * full down to it being enough. The bubbles are shaded across their face, and shading takes the same fraction off
 * every channel, which in a channel near white in the type's colour is much of its share: Water's icon is 78/144/214,
 * blue only 41 from white, and Swampert's Hydro Cannon bubbles read 129/188/220 and 97/154/202, blue's share 0.85 and
 * 1.29 against red's 0.71 and 0.89, so under full white none of their chain agreed within `SPREAD`. Sky of the same
 * hue is paler in that channel than its share makes it, not darker, which a dimmer light only makes worse. Down to
 * 0.88, parts of Giratina's and Kyogre's frames that are not bubbles read as them; only down to 0.97, Swampert's chain
 * read as separate bubbles.
 */
const DIMMEST = 0.93;

/**
 * How far below what the share makes it a channel near white in the type's colour may be. Psychic's icon is
 * 247/111/117, which left only green and blue to judge by, and Mewtwo's lavender — 163/149/162, 204/200/213 — holds
 * the same share in those two: its body read as bubbles before and after the minigame, and was swiped at. The red of
 * Psychic's bubbles stays at 218–244.
 */
const PALE = 40;

/**
 * How big a blob of the colour can be and be bubbles, in pixels at `WIDTH`: one small bubble to a chain of Psychic's
 * large ones running down the right of the screen, Kyogre's body being bigger. And how much of its box it has to fill,
 * a scatter of specks filling little.
 */
const AREA = { least: 20, most: 10000 } as const;
const FILL = 0.25;

/**
 * How much of the share of the most saturated blob on a frame another has to hold to be swiped among the bubbles, rather
 * than after them. A bubble popped swells and pales where it was for about a quarter of a second before it goes, the
 * biggest blob on the frame meanwhile: in a night Training battle against Candela, an Aqua Tail bubble went from about
 * 700 pixels and a share of 0.95, as the bubbles beside it held, to 2,060 and 0.75. The bubbles still to pop on one
 * frame can differ by 12%: Mamoswine's chain held 0.78 beside a lone bubble's 0.89.
 */
const FADED = 0.85;

/** How much white a blob's box has to hold beside it, the emblem on each bubble and its rim. */
const EMBLEM = 0.08;
const WHITE = { least: 225, spread: 25 } as const;

/**
 * How far past a blob's box, above and below and as a fraction of its width, the emblem it holds is followed when the
 * box holds too little white: a bubble found only in part cuts its emblem short. A Close Combat bubble on Zamazenta's
 * red body by day, its lower half lit orange by the fist beside it, was found as its top alone, its box holding 7.8%
 * white and the fist below it (#1017); followed, the fist made it 63.6%.
 */
const CUT_REACH = 1;

/** How far past a blob's ends a swipe through it runs, as a fraction of the width, so its end bubbles are crossed. */
const OVERRUN = 0.03;

/**
 * Where a swipe may start and end, as fractions of the screen: off its edges, where Android takes a swipe for its own
 * gestures. One aimed at a blob reaching y 0.97 left the game for the home screen mid-battle, a swipe in from a side
 * edge being back.
 */
const REACH = { left: 0.05, right: 0.95, top: FIELD.top, bottom: 0.92 } as const;

/** The colour a type's bubbles are drawn in: its icon's commonest colour, the white emblem on it aside. */
export function typeColour(icon: Image): Colour {
  const counts = new Map<string, { n: number; colour: Colour }>();

  for (let i = 0; i < icon.data.length; i += 4) {
    const colour: Colour = [icon.data[i] ?? 0, icon.data[i + 1] ?? 0, icon.data[i + 2] ?? 0];

    if ((icon.data[i + 3] ?? 0) < 250 || Math.min(...colour) > WHITE.least) {
      continue;
    }

    const key = colour.map((c) => Math.round(c / 8)).join('/');
    const entry = counts.get(key) ?? { n: 0, colour };
    entry.n++;
    counts.set(key, entry);
  }

  const [commonest] = [...counts.values()].sort((a, b) => b.n - a.n);

  return commonest?.colour ?? [255, 255, 255];
}

/**
 * Whether the shares of the channels that tell agree within `SPREAD` under some light from full white down to
 * `DIMMEST`. Lit by `light`, a channel's share is `(255 - c / light) / from`, a line in `1 / light`, so each pair of
 * channels agrees over a range of it, and some light has to lie in every pair's range.
 */
function agreesLit(pixel: Colour, colour: Colour): boolean {
  let least = 1;
  let most = 1 / DIMMEST;

  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const from = 255 - (colour[i] ?? 0);
      const other = 255 - (colour[j] ?? 0);

      if (from <= CHANNEL_FROM_WHITE || other <= CHANNEL_FROM_WHITE) {
        continue;
      }

      // The two shares differ by `apart - slope / light`.
      const apart = 255 / from - 255 / other;
      const slope = (pixel[i] ?? 0) / from - (pixel[j] ?? 0) / other;
      const a = (apart - SPREAD) / slope;
      const b = (apart + SPREAD) / slope;
      least = Math.max(least, Math.min(a, b));
      most = Math.min(most, Math.max(a, b));
    }
  }

  return least <= most;
}

/**
 * The share of `colour` a pixel holds washed towards white, the same in each channel that tells under some light, or
 * 0 where it is not so washed. How much share there is, and how pale the channels that do not tell are, are judged
 * under full white: dimmed, the `PALE` guard let Mewtwo's lavender back in.
 */
function washed(pixel: Colour, colour: Colour): number {
  // Run on every pixel of the field each frame, so written without the arrays a `map` would make, and with the tests
  // that turn most pixels away before `agreesLit`, the dearest.
  let sum = 0;
  let told = 0;

  for (let i = 0; i < 3; i++) {
    const from = 255 - (colour[i] ?? 0);

    if (from > CHANNEL_FROM_WHITE) {
      sum += (255 - (pixel[i] ?? 0)) / from;
      told++;
    }
  }

  const mean = sum / told;

  if (told < 1 || mean < SHARE.least || mean > SHARE.most) {
    return 0;
  }

  for (let i = 0; i < 3; i++) {
    const from = 255 - (colour[i] ?? 0);

    if (from <= CHANNEL_FROM_WHITE && 255 - mean * from - (pixel[i] ?? 0) > PALE) {
      return 0;
    }
  }

  return agreesLit(pixel, colour) ? mean : 0;
}

const white = ([r, g, b]: Colour) =>
  Math.min(r, g, b) >= WHITE.least && Math.max(r, g, b) - Math.min(r, g, b) <= WHITE.spread;

/**
 * The swipes through the bubbles of `colour` on a minigame frame, as fractions of the screen, each with its blob's
 * share, the biggest blob first of those as saturated as `FADED` asks, then the biggest of the rest: along each blob's
 * length, through its middle, and a little past either end. Their ends can lie past `REACH`, so that a bubble at an
 * edge keeps its size and middle for whatever is told from them, and `reachable` brings each onto it before it is
 * swiped.
 */
export function bubbleSwipes(frame: Image, colour: Colour): Bubble[] {
  const image = frame.width === WIDTH ? frame : scale(frame, WIDTH / frame.width);
  const { width, height } = image;
  const pixel = (i: number): Colour => [image.data[i * 4] ?? 0, image.data[i * 4 + 1] ?? 0, image.data[i * 4 + 2] ?? 0];
  const whiteAt = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height && white(pixel(y * width + x));
  const top = Math.round(FIELD.top * height);
  const bottom = Math.round(FIELD.bottom * height);
  const mask = new Uint8Array(width * height);

  for (let i = top * width; i < bottom * width; i++) {
    mask[i] = washed(pixel(i), colour) ? 1 : 0;
  }

  const swipes: (Bubble & { area: number })[] = [];
  const seen = new Uint8Array(width * height);

  for (let start = top * width; start < bottom * width; start++) {
    if (!mask[start] || seen[start]) {
      continue;
    }

    // The blob is grabbed whole, four ways, before it is judged.
    const blob: number[] = [];
    const stack = [start];
    seen[start] = 1;

    while (stack.length > 0) {
      const i = stack.pop() ?? 0;
      const x = i % width;
      blob.push(i);

      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (j >= 0 && j < width * height && mask[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }

    const xs = blob.map((i) => i % width);
    const ys = blob.map((i) => Math.floor(i / width));
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const box = (x1 - x0 + 1) * (y1 - y0 + 1);

    if (blob.length < AREA.least || blob.length > AREA.most || blob.length / box < FILL) {
      continue;
    }

    let whites = 0;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        whites += whiteAt(x, y) ? 1 : 0;
      }
    }

    const cut = whites / blob.length < EMBLEM;

    if (cut && (whites + cutOff(whiteAt, width, [x0, x1, y0, y1], [top, bottom])) / blob.length < EMBLEM) {
      continue;
    }

    // Told again over the blobs kept rather than kept for every pixel of the field, which would take four times the mask.
    const share = blob.reduce((sum, i) => sum + washed(pixel(i), colour), 0) / blob.length;
    swipes.push({ area: blob.length, share, swipe: along(xs, ys, width, height), ...(cut && { cut: true as const }) });
  }

  const vivid = Math.max(...swipes.map(({ share }) => share));
  const unfaded = ({ share }: Bubble) => Number(share >= FADED * vivid);

  return swipes
    .sort((a, b) => unfaded(b) - unfaded(a) || b.area - a.area)
    .map(({ swipe, share, cut }) => ({ swipe, share, ...(cut && { cut }) }));
}

/**
 * The white of an emblem a blob's box cuts off, in pixels: each white shape in the box followed above and below it,
 * within the blob's columns and `CUT_REACH` of its width past either end. A shape that runs out of that is no emblem,
 * and of one that does not, only the pixels past the box whose four neighbours are white count, so that a rim's thin
 * edge adds nothing.
 */
function cutOff(
  at: (x: number, y: number) => boolean,
  width: number,
  [x0, x1, y0, y1]: readonly [number, number, number, number],
  [top, bottom]: readonly [number, number],
): number {
  const reach = Math.round(CUT_REACH * (x1 - x0 + 1));
  const [from, to] = [Math.max(top, y0 - reach), Math.min(bottom - 1, y1 + reach)];
  const seen = new Set<number>();
  let beyond = 0;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (seen.has(y * width + x) || !at(x, y)) {
        continue;
      }

      seen.add(y * width + x);
      const stack: [number, number][] = [[x, y]];
      let open = false;
      let past = 0;

      while (stack.length > 0) {
        const [px, py] = stack.pop() ?? [0, 0];
        const solid = at(px - 1, py) && at(px + 1, py) && at(px, py - 1) && at(px, py + 1);
        past += (py < y0 || py > y1) && solid ? 1 : 0;

        for (const [nx, ny] of [
          [px - 1, py],
          [px + 1, py],
          [px, py - 1],
          [px, py + 1],
        ] as const) {
          if (!at(nx, ny) || seen.has(ny * width + nx)) {
            continue;
          }

          if (nx < x0 || nx > x1 || ny < from || ny > to) {
            open = true;
            continue;
          }

          seen.add(ny * width + nx);
          stack.push([nx, ny]);
        }
      }

      beyond += open ? 0 : past;
    }
  }

  return beyond;
}

/** A swipe along a blob's longest axis, through its middle and `OVERRUN` past each end. */
function along(xs: readonly number[], ys: readonly number[], width: number, height: number): [Point, Point] {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let [sxx, syy, sxy] = [0, 0, 0];

  for (let i = 0; i < n; i++) {
    const dx = (xs[i] ?? 0) - mx;
    const dy = (ys[i] ?? 0) - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  const angle = Math.atan2(2 * sxy, sxx - syy) / 2;
  const [ux, uy] = [Math.cos(angle), Math.sin(angle)];
  const offsets = xs.map((x, i) => (x - mx) * ux + ((ys[i] ?? 0) - my) * uy);
  const overrun = OVERRUN * width;
  const end = (t: number): Point => [(mx + ux * t) / width, (my + uy * t) / height];

  return [end(Math.min(...offsets) - overrun), end(Math.max(...offsets) + overrun)];
}

const clamp = (v: number, least: number, most: number) => Math.min(Math.max(v, least), most);

/** `point` brought onto the part of the screen a swipe may reach, as `REACH` says. */
export const reachable = ([x, y]: Point): Point => [
  clamp(x, REACH.left, REACH.right),
  clamp(y, REACH.top, REACH.bottom),
];
