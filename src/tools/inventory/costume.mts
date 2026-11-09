/**
 * Which costume a Pikachu is wearing, off its artwork: what the `costume` column names. Nothing else on a detail screen
 * says, and the hue histogram `artwork.mts` compares cannot — Pikachu's yellow is most of every costume's colour, and the
 * three GO Fest 2026 caps differ by a logo some 15 pixels wide.
 *
 * Two references, because neither is enough alone. Measured over 160 Pikachu labelled by hand on a Pixel 4 XL and the
 * corpus's five from a 1008-wide phone:
 *
 * - **Captures already labelled**, which show the same model under the same lighting, are right 154 times in 155. But
 *   they can only name a costume someone has labelled, and their distances cannot say when that is not the case: an
 *   unlabelled costume's nearest capture is often nearer than a labelled one's own.
 * - **The game's icons**, which draw every costume there is, are right 102 times in 160. Each icon is lit unlike the
 *   game's model and framed to fit its own outfit, so a big one shrinks Pikachu in it by up to 1.6×.
 *
 * So the captures answer and the icons check them. Where the icons put the captures' pick further behind their own best
 * than they ever put that costume on its own labelled captures, the pick is a costume nobody labelled, and the answer is
 * every icon close to the best instead. Each of the 160 judged against the other 159 and the corpus's five against all
 * of them, that names 159 rightly and lists 1 with the right one among them. One of the 5 wrong is a yellow GO Fest cap
 * the icons veto: their yellow cap is drawn unlike the model, and comes further behind on that capture than on the
 * other two.
 *
 * Both are compared in the plain icon's frame rather than the screen's. Each screen is registered onto the plain icon by
 * Pikachu's yellow, searched afresh each time, which is what lets references labelled on one phone read another's: the
 * scale comes out at 0.003 of the width on both phones measured.
 *
 * Pikachu only, for two reasons that are one: its yellow is what a screen is registered by, and it is the only species
 * anything has been labelled for.
 */

import { said } from '../../errors.ts';
import { FETCH_BATCH } from '../../pokedex/icons.ts';
import { hsv } from './artwork.mts';
import { REFERENCES } from './costume-references.mts';
import { type GameData } from './game-master.mts';
import { type Image } from './png.mts';

/** The one species this reads, by its dex. */
export const DEX = 25;

/**
 * Every labelled capture, as `blocksOf` reduced its `BODY` and its `FRONT`, and how far behind its own icons' best each
 * costume came on its own captures at worst: the per-costume allowance the veto measures a pick against.
 *
 * Written by `scripts/costume-references.mts` from a directory of captures and the costume each wears.
 */
export interface References {
  captures: { costume: string; blocks: string; front: string }[];
  behind: Record<string, number>;
}

/** A costume's icons, the ordinary one then the shiny, under the name the column gives it: blank for none. */
export interface Design {
  costume: string;
  colourings: readonly Image[];
}

/** Every icon drawn into the plain icon's frame, prepared once for every screen read against them. */
export interface Wardrobe {
  plain: Point[];
  yellow: readonly [number, number, number];
  drawn: { costume: string; rgb: Uint8Array; alpha: Uint8Array }[];

  /** Each row's first and last cell that any icon covers, or `[-1, -1]` for a row none does. */
  spans: [number, number][];
  union: Uint8Array;
}

interface Point {
  x: number;
  y: number;
}

/** Where one image lands on another, `to = from × scale + offset`, and how well its yellow overlaps there. */
interface Fit {
  scale: number;
  x: number;
  y: number;
  overlap: number;
}

/**
 * A set of an image's pixels, with a border one pixel wide past its right edge and its bottom that is never in it: where
 * `search` counts a point that lands off the image, rather than checking each one.
 */
interface Mask {
  width: number;
  height: number;
  bits: Uint8Array;
  count: number;
}

/**
 * The icons' frame: the plain icon's own pixels, with `PAD` either side for an outfit that reaches past it — a hat's
 * brim, a balloon's string.
 */
const FRAME = 384;
const PAD = 64;

/** Blocks over the plain icon's pixels: the columns and rows they span, and each one's side. */
interface Grid {
  x: readonly [number, number];
  y: readonly [number, number];
  block: number;
}

/**
 * The blocks a screen is compared with the labelled captures in: Pikachu from the eyes down to its feet, across its
 * arms and tail. Its ears and the hats above them are under PGSharp's box on every screen measured, and blocks the box
 * covers are left empty. Blocks of 6 and 10 answered the same.
 */
const BODY: Grid = { x: [60, 210], y: [140, 230], block: 10 };

/**
 * A closer look at the front of the head, just below where PGSharp's box ends, at rows 123 to 137 of the plain icon on
 * every screen measured. The three GO Fest 2026 caps differ only by the logo on their front, some 15 of the icon's
 * pixels across, which `BODY`'s blocks average away.
 *
 * Counted twice over beside `BODY`. Weights from 1 to 4 all named as many rightly, and so did blocks of 3 and of 5 over
 * much the same area.
 */
const FRONT: Grid = { x: [98, 130], y: [134, 154], block: 4 };
const FRONT_WEIGHT = 2;

/** How much the brightness counts beside the colour, which is what keeps a darker backdrop from outweighing an outfit. */
const BRIGHTNESS = 0.3;

/**
 * The least overlap with the screen's yellow a fit needs to be a Pikachu at all, which is asked only of a screen
 * `identify` already says is one. An outfit covers most of what the plain icon is registered by, so this is low: the
 * twelve PXP 2026 captures measured 0.24 to 0.28, and 14 of the 160 came under 0.3.
 */
const FOUND = 0.2;

/**
 * What the icons' veto allows a pick on top of its own worst, and how close to the icons' best a costume has to come to
 * be listed once it is vetoed. Chosen together over the same captures: no slack named 6 fewer rightly and listed 7 more,
 * and a shortlist of 0.01 named 3 fewer and listed longer.
 */
const SLACK = 0.005;
const SHORTLIST = 0.005;

/** How many of a fit's points are tried at each placement, which is accuracy enough for a search the refine finishes. */
const SAMPLE = 800;

/** Pikachu's yellow: the colour every screen and every icon is registered by. */
function isYellow(r: number, g: number, b: number): boolean {
  const [hue, saturation, value] = hsv(r, g, b);

  return hue >= 0.09 && hue < 0.19 && saturation > 0.45 && value > 0.45;
}

const range = (from: number, to: number, step: number) =>
  Array.from({ length: Math.floor((to - from) / step + 1e-9) + 1 }, (_, i) => from + i * step);

/**
 * Where each of `at` lands along one side of a mask, `size` long, once scaled and offset: as an offset into its bits,
 * `stride` apart, and one past the end for any that land off it, which the mask's border keeps out of the set.
 */
function along(at: readonly number[], scale: number, offset: number, size: number, stride: number): Int32Array {
  const offsets = new Int32Array(at.length);

  for (let i = 0; i < at.length; i++) {
    const to = Math.round((at[i] as number) * scale + offset);
    offsets[i] = (to >= 0 && to < size ? to : size) * stride;
  }

  return offsets;
}

/** The placement of `points` that overlaps `target` most, as intersection over union in the target's pixels. */
function search(points: readonly Point[], target: Mask, scales: number[], xs: number[], ys: number[]): Fit {
  const step = Math.max(1, Math.floor(points.length / SAMPLE));
  const sampled = points.filter((_, i) => i % step === 0);
  const across = sampled.map((p) => p.x);
  const down = sampled.map((p) => p.y);
  let best: Fit = { scale: 0, x: 0, y: 0, overlap: -1 };

  for (const scale of scales) {
    // Each point stands for a patch `scale` on a side, so both sides of the ratio are counted in the target's pixels.
    const area = scale * scale;

    // This loop is where drawing a wardrobe spends its time. A point's row is the same at every offset across and its
    // column at every offset down, so each is worked out once per scale rather than at every placement, and the count
    // is a sum with no branch: whether a point lands on the yellow is as good as random, so a branch on it mispredicts.
    const rows = ys.map((y) => ({ y, row: along(down, scale, y, target.height, target.width + 1) }));

    for (const x of xs) {
      const column = along(across, scale, x, target.width, 1);

      for (const { y, row } of rows) {
        let n = 0;

        for (let i = 0; i < sampled.length; i++) {
          n += target.bits[(row[i] as number) + (column[i] as number)] as number;
        }

        const shared = n * step * area;
        const overlap = shared / (points.length * area + target.count - shared);

        if (overlap > best.overlap) {
          best = { scale, x, y, overlap };
        }
      }
    }
  }

  return best;
}

/** A search around `fit`, halving its steps each round. */
function refine(points: readonly Point[], target: Mask, fit: Fit, ds: number, dxy: number, rounds: number): Fit {
  let best = fit;

  for (let round = 0, s = ds, d = dxy; round < rounds; round++, s /= 2, d /= 2) {
    best = search(
      points,
      target,
      range(best.scale - s, best.scale + s, s / 2),
      range(best.x - d, best.x + d, d / 2),
      range(best.y - d, best.y + d, d / 2),
    );
  }

  return best;
}

/** An icon's opaque yellow pixels. */
function yellowOf(icon: Image): Point[] {
  const points: Point[] = [];

  for (let y = 0; y < icon.height; y++) {
    for (let x = 0; x < icon.width; x++) {
      const i = (y * icon.width + x) * 4;
      const { data } = icon;

      if ((data[i + 3] as number) >= 128 && isYellow(data[i] as number, data[i + 1] as number, data[i + 2] as number)) {
        points.push({ x, y });
      }
    }
  }

  return points;
}

function maskOf(points: readonly Point[], width: number, height: number): Mask {
  const bits = new Uint8Array((width + 1) * (height + 1));

  for (const { x, y } of points) {
    bits[y * (width + 1) + x] = 1;
  }

  return { width, height, bits, count: points.length };
}

/**
 * The icons drawn into one frame. Each costume's icon is registered onto the plain one by their yellow, its ordinary
 * colouring standing for its shiny since the two share every outline, so an icon that shrank Pikachu to fit its outfit
 * is scaled back up before it is compared.
 */
export function wardrobeOf(designs: readonly Design[]): Wardrobe {
  const plainIcon = designs.find((d) => d.costume === '')?.colourings[0];

  if (!plainIcon) {
    throw new Error('the costumes need the plain icon to register everything else onto');
  }

  const plain = yellowOf(plainIcon);
  const target = maskOf(plain, plainIcon.width, plainIcon.height);
  const yellow = [0, 1, 2].map(
    (k) =>
      plain.reduce((sum, p) => sum + (plainIcon.data[(p.y * plainIcon.width + p.x) * 4 + k] as number), 0) /
      plain.length,
  ) as [number, number, number];

  const drawn: Wardrobe['drawn'] = [];
  const union = new Uint8Array(FRAME * FRAME);

  for (const { costume, colourings } of designs) {
    const [ordinary] = colourings;

    if (!ordinary) {
      continue;
    }

    // In the icons' own pixels, all 256 on a side. The grid has to hold no shift at all, which is where most costumes
    // sit and which the refine cannot reach from a step either side of it: off the grid, the plain icon fits itself at
    // a scale of 1.06.
    const own = yellowOf(ordinary);
    const shifts = range(-120, 120, 10);
    const fit = refine(own, target, search(own, target, range(0.6, 1.8, 0.1), shifts, shifts), 0.05, 5, 3);

    for (const icon of colourings) {
      const rgb = new Uint8Array(FRAME * FRAME * 3);
      const alpha = new Uint8Array(FRAME * FRAME);

      for (let v = 0; v < FRAME; v++) {
        for (let u = 0; u < FRAME; u++) {
          const x = Math.round((u - PAD - fit.x) / fit.scale);
          const y = Math.round((v - PAD - fit.y) / fit.scale);
          const i = (y * icon.width + x) * 4;

          if (x < 0 || y < 0 || x >= icon.width || y >= icon.height || (icon.data[i + 3] as number) < 128) {
            continue;
          }

          const cell = v * FRAME + u;
          alpha[cell] = 1;
          union[cell] = 1;
          rgb.set(icon.data.subarray(i, i + 3), cell * 3);
        }
      }

      drawn.push({ costume, rgb, alpha });
    }
  }

  const spans = Array.from({ length: FRAME }, (_, v): [number, number] => {
    let first = -1;
    let last = -1;

    for (let u = 0; u < FRAME; u++) {
      if (union[v * FRAME + u]) {
        first = first < 0 ? u : first;
        last = u;
      }
    }

    return [first, last];
  });

  return { plain, yellow, drawn, spans, union };
}

/**
 * Where the plain icon lands on a screen, or null where too little of the screen's yellow is anywhere it could: no
 * Pikachu, or one hidden. Searched from where PGSharp's box ends, `top`, in proportion to the width, which is what the
 * game draws the model in proportion to.
 */
function register(image: Image, top: number, plain: readonly Point[]): Fit | null {
  const w = image.width;
  const from = Math.max(0, Math.round(top - 0.07 * w));
  const to = Math.min(image.height, Math.round(top + 0.46 * w));
  const points: Point[] = [];

  for (let y = from; y < to; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;

      if (isYellow(image.data[i] as number, image.data[i + 1] as number, image.data[i + 2] as number)) {
        points.push({ x, y });
      }
    }
  }

  const screen = maskOf(points, w, image.height);
  const coarse = search(
    plain,
    screen,
    range(0.0022 * w, 0.004 * w, 0.0001 * w),
    range(-0.1 * w, 0.4 * w, 0.012 * w),
    range(top - 0.6 * w, top - 0.2 * w, 0.012 * w),
  );
  const fit = refine(plain, screen, coarse, 0.0001 * w, 0.006 * w, 4);

  return fit.overlap >= FOUND ? fit : null;
}

/** The screen's colour at a point of the plain icon's frame. */
const sample = (image: Image, fit: Fit, u: number, v: number) => {
  const x = Math.round(u * fit.scale + fit.x);
  const y = Math.round(v * fit.scale + fit.y);

  return (y * image.width + x) * 4;
};

/**
 * The screen as the labelled captures are kept: three bytes per block of the grid, its red and green shares of the
 * total and its brightness, from every screen pixel the block covers below `top`. A block with none is all zeroes.
 */
function blocksOf(image: Image, fit: Fit, top: number, { x, y, block }: Grid): Uint8Array {
  const out: number[] = [];

  for (let v = y[0]; v < y[1]; v += block) {
    for (let u = x[0]; u < x[1]; u += block) {
      const total = [0, 0, 0];
      let n = 0;

      // Half-pixel steps, since each of the icon's pixels is three or four of the screen's, which are what is averaged.
      for (let dv = 0; dv < block; dv += 0.5) {
        for (let du = 0; du < block; du += 0.5) {
          if ((v + dv) * fit.scale + fit.y < top) {
            continue;
          }

          const i = sample(image, fit, u + du, v + dv);

          for (let k = 0; k < 3; k++) {
            total[k] = (total[k] as number) + (image.data[i + k] as number);
          }

          n++;
        }
      }

      const [r = 0, g = 0, b = 0] = total;
      const sum = r + g + b || 1;
      out.push(Math.round((255 * r) / sum), Math.round((255 * g) / sum), n === 0 ? 0 : Math.round(sum / 3 / n));
    }
  }

  return Uint8Array.from(out);
}

const empty = (blocks: Uint8Array, i: number) => blocks[i] === 0 && blocks[i + 1] === 0 && blocks[i + 2] === 0;

/**
 * How far apart two screens' blocks are, over the blocks both show and scaled up to the whole grid: a block the box
 * covers on either screen says nothing about the other, and a screen whose box ends lower is no nearer for showing
 * less.
 */
function apart(a: Uint8Array, b: Uint8Array): number {
  let total = 0;
  let shown = 0;

  for (let i = 0; i < a.length; i += 3) {
    if (empty(a, i) || empty(b, i)) {
      continue;
    }

    total +=
      Math.abs((a[i] as number) - (b[i] as number)) +
      Math.abs((a[i + 1] as number) - (b[i + 1] as number)) +
      BRIGHTNESS * Math.abs((a[i + 2] as number) - (b[i + 2] as number));
    shown++;
  }

  return shown === 0 ? 0 : (total / 255) * (a.length / 3 / shown);
}

/**
 * How unlike each costume's icons the screen is, its closest colouring's score, lower being likelier.
 *
 * Every costume is judged over the same cells, the union of every icon's outline, rather than over its own: under its
 * own a small icon is judged on Pikachu alone, which every costume shares, and wins. Where a costume's icon covers a
 * cell it is compared with the screen there; where it does not, the screen should be the backdrop, which is estimated
 * row by row from the screen just beyond the union either side.
 *
 * The screen's colours are scaled channel by channel first, so its yellow matches the plain icon's: the game's model is
 * lit far dimmer than its icon.
 */
function scoresOf(image: Image, fit: Fit, top: number, wardrobe: Wardrobe): Map<string, number> {
  const toScreen: Fit = { ...fit, x: fit.x - PAD * fit.scale, y: fit.y - PAD * fit.scale };
  const lit = [0, 0, 0];
  let n = 0;

  for (const p of wardrobe.plain) {
    const i = sample(image, fit, p.x, p.y);
    const [r, g, b] = [image.data[i] as number, image.data[i + 1] as number, image.data[i + 2] as number];

    if (isYellow(r, g, b)) {
      lit[0] = (lit[0] as number) + r;
      lit[1] = (lit[1] as number) + g;
      lit[2] = (lit[2] as number) + b;
      n++;
    }
  }

  const gain = lit.map((total, k) => (n === 0 || total === 0 ? 1 : (wardrobe.yellow[k] as number) / (total / n)));

  const colour = (u: number, v: number) => {
    const i = sample(image, toScreen, u, v);

    return [0, 1, 2].map((k) => (image.data[i + k] as number) * (gain[k] as number));
  };

  const cells: { cell: number; colour: number[]; backdrop: number }[] = [];

  for (let v = 0; v < FRAME; v++) {
    const [first, last] = wardrobe.spans[v] as [number, number];

    if (first < 0 || v * toScreen.scale + toScreen.y < top) {
      continue;
    }

    const left = colour(Math.max(0, first - 4), v);
    const right = colour(Math.min(FRAME - 1, last + 4), v);

    for (let u = first; u <= last; u++) {
      if (!wardrobe.union[v * FRAME + u]) {
        continue;
      }

      const here = colour(u, v);
      const f = last === first ? 0 : (u - first) / (last - first);
      const backdrop = here.map((c, k) => c - ((left[k] as number) * (1 - f) + (right[k] as number) * f));
      cells.push({ cell: v * FRAME + u, colour: here, backdrop: Math.hypot(...backdrop) });
    }
  }

  const scores = new Map<string, number>();

  for (const { costume, rgb, alpha } of wardrobe.drawn) {
    let total = 0;

    for (const {
      cell,
      colour: [r = 0, g = 0, b = 0],
      backdrop,
    } of cells) {
      total += alpha[cell]
        ? Math.hypot(
            r - (rgb[cell * 3] as number),
            g - (rgb[cell * 3 + 1] as number),
            b - (rgb[cell * 3 + 2] as number),
          )
        : backdrop;
    }

    const score = total / Math.max(1, cells.length) / 255;
    scores.set(costume, Math.min(scores.get(costume) ?? Infinity, score));
  }

  return scores;
}

/**
 * What both references are compared on: the screen's blocks for the labelled captures and its score against every
 * costume's icons. Null where no Pikachu was found. Apart from `costumeOf` for the script that writes the references,
 * which keeps the one and measures each costume's allowance from the other.
 */
export function measure(
  image: Image,
  from: number,
  wardrobe: Wardrobe,
): { blocks: Uint8Array; front: Uint8Array; scores: Map<string, number> } | null {
  const top = Math.round(from * image.height);
  const fit = register(image, top, wardrobe.plain);

  return (
    fit && {
      blocks: blocksOf(image, fit, top, BODY),
      front: blocksOf(image, fit, top, FRONT),
      scores: scoresOf(image, fit, top, wardrobe),
    }
  );
}

const bytes = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

const decoded = (references: References) =>
  references.captures.map(({ costume, blocks, front }) => ({ costume, blocks: bytes(blocks), front: bytes(front) }));

let kept: ReturnType<typeof decoded> | null = null;

/**
 * The costume a Pikachu on this screen wears: one name where the screen settles it, every one it could be where it does
 * not, none for a Pikachu in none, and null where no Pikachu was found to read. `from` is where the artwork starts as a
 * fraction of the height, PGSharp's box being the floor where one was found, as for `signatureOf`.
 *
 * `costumed` is true where the scan's `costume` search found the Pikachu in a costume, which cannot be the plain one,
 * and null where it did not run. A Pikachu it did not find wears none, which `costumeIn` answers without reading it and
 * so without a wardrobe, and is not asked here. A list of several keeps no costume in it as `''` wherever the screen
 * could not rule it out, since the costumes alone would read as the screen having settled on one of them.
 */
export function costumeOf(
  image: Image,
  from: number,
  wardrobe: Wardrobe,
  costumed: true | null = null,
  references: References = REFERENCES,
): string[] | null {
  const measured = measure(image, from, wardrobe);

  if (!measured) {
    return null;
  }

  const allowed = (costume: string) => !(costumed === true && costume === '');
  const { blocks, front } = measured;
  const labelled = (references === REFERENCES ? (kept ??= decoded(references)) : decoded(references)).filter((r) =>
    allowed(r.costume),
  );
  const pick = labelled.reduce<{ costume: string; gap: number } | null>((best, r) => {
    const gap = apart(blocks, r.blocks) + FRONT_WEIGHT * apart(front, r.front);

    return best === null || gap < best.gap ? { costume: r.costume, gap } : best;
  }, null)?.costume;

  const scores = [...measured.scores].filter(([costume]) => allowed(costume));
  const best = Math.min(...scores.map(([, score]) => score));
  const picked = scores.find(([costume]) => costume === pick)?.[1];

  // A pick the icons cannot judge, having no icon for it, stands: the veto is the icons' to cast.
  const answer =
    pick !== undefined && (picked === undefined || picked - best <= (references.behind[pick] ?? 0) + SLACK)
      ? [pick]
      : scores.filter(([, score]) => score - best <= SHORTLIST).map(([costume]) => costume);

  return answer.length === 1 ? answer.filter((costume) => costume !== '') : answer.sort();
}

/** The icon files a Pikachu's wardrobe is drawn from: the plain form's, then every costume's, ordinary then shiny. */
export function designFiles(data: GameData): { costume: string; files: string[] }[] {
  const plain = data.forms.find((f) => f.dex === DEX && f.form === null && f.icon !== null);
  const files = (icon: string, shiny: string | null) => (shiny === null ? [icon] : [icon, shiny]);

  return [
    ...(plain?.icon ? [{ costume: '', files: files(plain.icon, plain.shiny) }] : []),
    ...data.costumes.filter((c) => c.dex === DEX).map((c) => ({ costume: c.name, files: files(c.icon, c.shiny) })),
  ];
}

/** An icon by its file, decoded: out of the CLI's cache, from `pogo_assets` for the Inventory page, or a fixture. */
export type Fetch = (file: string) => Promise<Image>;

/**
 * Pikachu's wardrobe, out of every icon that could be had, or null where the plain icon could not be, everything else
 * being registered onto it.
 *
 * An icon is an improvement rather than a prerequisite, as it is for `signaturesFor`: a costume whose icons cannot be
 * had is left out, so a Pikachu wearing it is answered from the labelled captures alone or as something else, rather
 * than a 404 failing the whole read. Each costume is had whole or not at all, since a shiny judged against an ordinary
 * icon alone is as far from it as another costume is. `FETCH_BATCH` at a time, as `signaturesFor` fetches.
 */
export async function wardrobeFor(data: GameData, fetch: Fetch): Promise<Wardrobe | null> {
  const wanted = designFiles(data);
  const designs: Design[] = [];

  for (let at = 0; at < wanted.length; at += FETCH_BATCH) {
    const batch = wanted.slice(at, at + FETCH_BATCH).map(async ({ costume, files }) => {
      try {
        return [{ costume, colourings: await Promise.all(files.map(fetch)) }];
      } catch (error) {
        console.error(`  ${said(error)}; ${costume ? `Pikachu's ${costume} costume is` : 'its costumes are'} left out`);

        return [];
      }
    });

    designs.push(...(await Promise.all(batch)).flat());
  }

  return designs.some((d) => d.costume === '') ? wardrobeOf(designs) : null;
}
