/**
 * Telling two forms apart by the artwork, for the ones the numbers cannot reach. HP is a function of `stamina` alone,
 * so two forms sharing their types and all three base stats are identical in every field the detail screen states —
 * Deerling's four seasons, Burmy's three, Genesect's five and more. Without this `identify` answers one of them and
 * reports the rest as unseparated, which is honest and still names no form.
 *
 * **The backdrop is the whole problem, not the colours.** The game blurs an arbitrary scene behind the model and will
 * put a photograph there, against which a small model is a minority of any fixed box. So the subject is bounded by the
 * panel below it and by sharpness, edges being what a blurred scene lacks, and only the one connected run of what those
 * edges enclose that holds the most colour is kept — a flat backdrop with crisp shapes on it has edges too, and growing
 * the mask from them would flood it.
 *
 * **Judge it on the margin.** Twenty-one committed captures fall in a reachable family; at `MARGIN` the match answers
 * five and is right on all five, and thirteen of the sixteen it declines are nearest a form that is not their own. So
 * the margin is what stands between the match and being confidently wrong thirteen times.
 *
 * **Against every colouring, not only the ordinary one.** A shiny is recoloured as a whole, which takes it as far from
 * its own form's ordinary icon as another form is: `psyduck-shiny.png`'s pale blue body sits in the bin the cyan of the
 * Swim 2025 ring does, so against the ordinary icons alone it leads for the swim ring by 0.820, far past any margin.
 * So a form is as near as the nearer of its ordinary and shiny icons, which needs nothing to say whether the capture is
 * shiny — the scan's own pass misses some — and leaves the margin to decline where two forms' colourings meet: the two
 * shiny Psyduck icons are 0.024 apart, which is all it leads by.
 */

import { said } from '../../errors.ts';
import { FETCH_BATCH } from '../../pokedex/icons.ts';
import { type Form, type GameData } from '../../core/game-master.mts';
import { luminance, rgb, type Image } from '../../core/png.mts';
import { progress } from './progress.mts';

/** How many hue bins a signature holds. Coarse on purpose: the model is lit and posed, where the icon is flat art. */
const BINS = 12;

/**
 * How saturated and how bright a pixel has to be to carry form information. Below these it is the game's own
 * furniture, a shadow or the panel — and the white UI falling out for free is why the arc, the CP, the star and
 * PGSharp's overlay need no excluding by position. Which is a claim about the histogram alone: an edge can weld the
 * furniture to the model and keep it inside the run, and `subject` is where that loses — to the run carrying more hue,
 * the furniture itself contributing none of it.
 */
const SATURATION = 0.35;
const VALUE = 0.2;

/**
 * What the game's panel is, as the two things that hold whatever it is drawn in: neutral, and brighter than the scene
 * behind the artwork. A level written down instead does not hold — `genderOf` says the same thing about the same panel
 * and for the same reason. Written down as 224 it matched no row of any capture in the corpus, the panel being
 * rgb(255,255,255) on every one, and `panelTop` then ran on past it to a grey divider 600 rows into the panel.
 */
const PANEL_FLOOR = 200;
const PANEL_SPREAD = 6;

/** How much of a row has to be panel for that row to be the top of it, and where to look for it. */
const PANEL_FILL = 0.9;
const PANEL_FROM = 0.25;
const PANEL_TO = 0.6;

/** The artwork's top where no overlay was found to put a floor under it, and how much of the width to take. */
export const ARTWORK_FROM = 0.215;
const ARTWORK_SPAN = { from: 0.28, to: 0.72 };

/**
 * How far apart two luminances have to be, and over how many pixels, for the gap to be an edge of the model rather
 * than the gradient of a blurred scene. Then how far to grow those edges, which takes in the flat interior they bound:
 * a body's own colour has no gradient in it, so edges alone would sample the outline and nothing else.
 */
const EDGE = 28;
const EDGE_RADIUS = 2;
const GROW = 6;

/**
 * How much closer the nearest form has to be than the runner-up before the answer is worth having. Over the committed
 * captures anything above 0.053 and at or below 0.558 is right wherever it answers: the widest lead a wrong form takes
 * is `unown-m.png`'s 0.053 and the narrowest right answer leads by 0.558 (`burmy-sandy.png`). 0.3 sits inside that.
 *
 * Which holds only against both colourings. Against the ordinary icons alone the window is empty, the shiny
 * `psyduck-shiny.png` leading for the wrong form by 0.820 and the shiny `ho-oh.png` for the wrong one by 0.190, where
 * its own leads by 0.105 now. That and `basculin-blue.png`'s 0.139 are right answers the margin declines, and the 0.139
 * is the water behind the fish rather than the fish: PGSharp's box covers the head, the only part of it the three
 * stripes differ in. So that row pins the forms it cannot be told from instead.
 *
 * Which is this capture's lead and not a bound on the family's. Its icons are 0.221 apart at their closest, and a lead
 * cannot exceed the distance to the icon it is measured against, so a Blue- or Red-Striped Basculin can lead by at most
 * that.
 */
export const MARGIN = 0.3;

/**
 * How many pixels have to carry a hue before the signature is worth comparing. Sampling alone moves a twelve-bin
 * histogram of a thousand pixels by about 0.08 from the colours they were drawn from, and one of a hundred by about
 * 0.27, which is most of `MARGIN`: a few stray pixels would lead by a margin they had not earned. The fewest any
 * capture is answered on is `burmy-trash.png`'s 4,858.
 */
const COUNTED = 1000;

/** A normalised hue histogram. Comparable between a capture and an icon, which is the only thing the two share. */
export type Signature = readonly number[];

/** A form's icon in every colouring it is drawn in: the ordinary one, then the shiny one where there is one. */
export type Colourings = readonly Signature[];

/** The first row of the game's own panel, which bounds the artwork below. */
function panelTop(image: Image): number {
  const from = Math.round(image.width * 0.2);
  const to = Math.round(image.width * 0.8);
  const wanted = ((to - from) / 4) * PANEL_FILL;

  for (let y = Math.round(image.height * PANEL_FROM); y < image.height * PANEL_TO; y++) {
    let flat = 0;

    for (let x = from; x < to; x += 4) {
      const [r, g, b] = rgb(image, x, y);

      if (r >= PANEL_FLOOR && Math.abs(r - g) <= PANEL_SPREAD && Math.abs(g - b) <= PANEL_SPREAD) {
        flat++;
      }
    }

    if (flat > wanted) {
      return y;
    }
  }

  return Math.round(image.height * 0.34);
}

/** Whether a pixel carries a form's colour at all, which is what the histogram counts and what a run is worth. */
const hued = (saturation: number, value: number): boolean => saturation >= SATURATION && value >= VALUE;

/** Hue in turns, saturation and value, which is what separates a body's colour from the lighting on it. */
export function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  let hue = 0;

  if (span !== 0) {
    if (max === r) {
      hue = ((g - b) / span + 6) % 6;
    } else if (max === g) {
      hue = (b - r) / span + 2;
    } else {
      hue = (r - g) / span + 4;
    }
  }

  return [hue / 6, max === 0 ? 0 : span / max, max / 255];
}

/** The histogram of a list of pixels, over however many of them carry a hue. */
function histogram(pixels: Iterable<[number, number, number]>): Signature {
  const bins = new Array<number>(BINS).fill(0);
  let counted = 0;

  for (const [r, g, b] of pixels) {
    const [hue, saturation, value] = hsv(r, g, b);

    if (!hued(saturation, value)) {
      continue;
    }

    const bin = Math.min(BINS - 1, Math.floor(hue * BINS));
    bins[bin] = (bins[bin] ?? 0) + 1;
    counted++;
  }

  return bins.map((n) => n / (counted || 1));
}

/** Grown by `radius` in both directions, done as two passes since a square structuring element separates. */
function grow(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const across = new Uint8Array(mask.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) {
        continue;
      }

      for (let d = -radius; d <= radius; d++) {
        const nx = x + d;

        if (nx >= 0 && nx < width) {
          across[y * width + nx] = 1;
        }
      }
    }
  }

  const out = new Uint8Array(mask.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!across[y * width + x]) {
        continue;
      }

      for (let d = -radius; d <= radius; d++) {
        const ny = y + d;

        if (ny >= 0 && ny < height) {
          out[ny * width + x] = 1;
        }
      }
    }
  }

  return out;
}

/**
 * The one connected run of the mask carrying the most hued pixels, with that count, which is the subject rather than
 * the scenery or the game's own furniture. Hue count is the whole of the ranking and extent plays no part in it: a run
 * is worth what the histogram will go on to count of it, so a backdrop's own detail — bubbles, leaves, bokeh edges —
 * takes the mask only by carrying more colour than the model does. Ranked by extent instead, PGSharp's box is a long
 * sharp-edged run of grey, and on `cherrim-overcast.png` it ran into the model's pink head and took the mask, leaving
 * the purple body — which is the whole of what separates it from its Sunny form — in two smaller runs outside it.
 */
function subject(mask: Uint8Array, colour: Uint8Array, width: number, height: number): { run: number[]; hues: number } {
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  let best: number[] = [];
  let most = 0;

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) {
      continue;
    }

    const blob: number[] = [];
    let hues = 0;
    seen[start] = 1;
    stack.push(start);

    for (let p = stack.pop(); p !== undefined; p = stack.pop()) {
      blob.push(p);
      hues += colour[p] ?? 0;
      const x = p % width;
      const y = (p - x) / width;

      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ] as const) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          continue;
        }

        const q = ny * width + nx;

        if (mask[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }

    if (hues > most) {
      best = blob;
      most = hues;
    }
  }

  return { run: best, hues: most };
}

/**
 * The signature of the Pokémon on a detail screen, or null where too little of it was found to mean anything.
 *
 * `from` is where the artwork starts, as a fraction of the height — PGSharp's overlay sits over the artwork and its own
 * box is the floor to use where one was found, since a fraction written down here would be one phone's.
 */
export function signatureOf(image: Image, from = ARTWORK_FROM): Signature | null {
  const left = Math.round(image.width * ARTWORK_SPAN.from);
  const right = Math.round(image.width * ARTWORK_SPAN.to);
  const top = Math.round(image.height * from);
  const bottom = panelTop(image);
  const width = right - left;
  const height = bottom - top;

  if (width < 1 || height < 1) {
    return null;
  }

  // Read once rather than per neighbour, since each pixel is compared against four others — and whether it carries a
  // hue, which `subject` ranks runs by, falls out of the same read.
  const luminances = new Float64Array(width * height);
  const colour = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = ((top + y) * image.width + left + x) * 4;
      const r = image.data[i] ?? 0;
      const g = image.data[i + 1] ?? 0;
      const b = image.data[i + 2] ?? 0;
      const [, saturation, value] = hsv(r, g, b);
      const p = y * width + x;

      luminances[p] = luminance(r, g, b);
      colour[p] = hued(saturation, value) ? 1 : 0;
    }
  }

  const edges = new Uint8Array(width * height);

  // Neighbours are read inside the crop only. Above it is PGSharp's box and below it the panel, so a neighbour read
  // across either border finds the border itself, and a full-width edge there grows into a band of backdrop.
  for (let y = EDGE_RADIUS; y < height - EDGE_RADIUS; y++) {
    for (let x = EDGE_RADIUS; x < width - EDGE_RADIUS; x++) {
      const p = y * width + x;
      const here = luminances[p] ?? 0;
      const gap = Math.max(
        Math.abs(here - (luminances[p - EDGE_RADIUS] ?? 0)),
        Math.abs(here - (luminances[p + EDGE_RADIUS] ?? 0)),
        Math.abs(here - (luminances[p - EDGE_RADIUS * width] ?? 0)),
        Math.abs(here - (luminances[p + EDGE_RADIUS * width] ?? 0)),
      );

      if (gap >= EDGE) {
        edges[p] = 1;
      }
    }
  }

  const { run, hues } = subject(grow(edges, width, height, GROW), colour, width, height);

  if (hues < COUNTED) {
    return null;
  }

  return histogram(run.map((p) => rgb(image, left + (p % width), top + Math.floor(p / width))));
}

/** The signature of one of the game's own form icons, which is flat art over transparency. */
export function signatureOfIcon(image: Image): Signature {
  const pixels: [number, number, number][] = [];

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if ((image.data[(y * image.width + x) * 4 + 3] ?? 0) >= 128) {
        pixels.push(rgb(image, x, y));
      }
    }
  }

  return histogram(pixels);
}

/** How far apart two signatures are, as the sum of the differences per bin. 0 is identical and 2 shares no hue. */
export function distance(a: Signature, b: Signature): number {
  let total = 0;

  for (let i = 0; i < BINS; i++) {
    total += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  }

  return total;
}

/**
 * Whichever reference the signature is nearest, or null where nothing is near enough *ahead of the rest* to be worth
 * answering. The margin is the whole of the contract: a list of one is answered outright, and anything closer than
 * `margin` to its runner-up is declined rather than guessed at. A reference is as near as the nearest of its
 * colourings, the capture being drawn in one of them.
 */
export function nearest<T>(signature: Signature, references: ReadonlyMap<T, Colourings>, margin = MARGIN): T | null {
  const ranked = [...references].map(([key, colourings]) => ({
    key,
    gap: Math.min(...colourings.map((colouring) => distance(signature, colouring))),
  }));

  ranked.sort((a, b) => a.gap - b.gap);

  const [best, runner] = ranked;

  if (!best) {
    return null;
  }

  return runner === undefined || runner.gap - best.gap >= margin ? best.key : null;
}

/** A form the index found artwork for, which is what `iconsFor` needs and what `ambiguous` has already checked. */
export type Drawn = Form & { icon: string };

/**
 * Whether two forms are the same Pokémon to everything but the artwork, as one string: one dex, one set of types and
 * one stat line. The one definition of "the same numbers", so the groups `ambiguous` fetches icons for are the groups
 * `identify` lets the artwork narrow.
 */
export const numbersOf = (form: Form): string =>
  `${form.dex}|${[...form.types].sort().join('+')}|${form.attack}|${form.defense}|${form.stamina}`;

/**
 * What the numbers leave ambiguous, split by whether the artwork can reach it: the groups of two or more forms
 * identical in dex, types and all three stats, partitioned on whether **every** member has an icon. A group short of
 * one can never be narrowed — `identify` declines to choose between forms it cannot all see — so its icons would be
 * downloaded for nothing, and naming it once is the whole of what can be said about it.
 *
 * Measured over a real game master: 52 groups hold 237 forms, and 44 of those groups have an icon for every member.
 * The other 8 are short of 63 icons between them, Scatterbug, Spewpa, Minior and Magearna having none at all and Spinda
 * nine of twenty — nine being what the game has released.
 */
export function ambiguous(data: GameData): { drawn: Drawn[][]; short: Form[][] } {
  const groups = new Map<string, Form[]>();

  for (const form of data.forms) {
    if (form.costume) {
      continue;
    }

    const key = numbersOf(form);
    const group = groups.get(key) ?? [];
    group.push(form);
    groups.set(key, group);
  }

  const drawn: Drawn[][] = [];
  const short: Form[][] = [];

  for (const family of groups.values()) {
    if (family.length < 2) {
      continue;
    }

    // The narrowing is what carries the icon's name into `iconsFor`, so the gate is a length rather than an `every`:
    // the same walk cannot both prove a family complete and hand back forms the type says are drawn.
    const complete = family.filter((f): f is Drawn => f.icon !== null);

    if (complete.length === family.length) {
      drawn.push(complete);
    } else {
      short.push(family);
    }
  }

  return { drawn, short };
}

/**
 * The colourings of every form the artwork could settle, each icon fetched and read by `read`, which is where the two
 * callers differ: `download.mts` caches the icons beside the game master for `pnpm inventory`, and the Inventory page
 * fetches them straight from `ICON_BASE`. 361 files of some 24 KB on a real game master, an ordinary and a shiny icon
 * for all but three of its 182 forms, so this is a one-off of under 9 MiB.
 */
export async function signaturesFor(
  data: GameData,
  read: (file: string) => Promise<Signature>,
): Promise<Map<Form, Colourings>> {
  const { drawn: families, short } = ambiguous(data);
  const drawn = families.flat();
  const signatures = new Map<Form, Colourings>();
  const files = (form: Drawn) => (form.shiny === null ? [form.icon] : [form.icon, form.shiny]);
  const count = drawn.reduce((total, form) => total + files(form).length, 0);

  if (count > 0) {
    progress(`Reading ${count} form icons`);
  }

  // Per family and ahead of the download, since the index already said so: a family short of one icon is one the game
  // draws no artwork for, and reporting it per missing form would be the same sentence 72 times a scan.
  if (short.length > 0) {
    const named = short.map((family) => `${family[0]?.species ?? '?'} (${family.length})`);
    progress(`  no icon for every form of ${short.length} families, which stay ambiguous: ${named.join(', ')}`);
  }

  // All of a form's colourings or none: judged on its ordinary icon alone, a shiny is as far from it as another form
  // is, so a form short of the shiny it has would be answered against the wrong colours rather than declined.
  const signatureFor = async (form: Drawn): Promise<Colourings | null> => {
    try {
      const colourings: Signature[] = [];

      for (const file of files(form)) {
        colourings.push(await read(file));
      }

      return colourings;
    } catch (error) {
      // An icon is an improvement rather than a prerequisite, so one that cannot be had costs an abstention and not a
      // scan. That holds as much for a network that is down with nothing cached as for a 404, a truncated download or
      // a page served in place of the image.
      //
      // `read` is what leaves every one of them naming the icon. This line is written as a continuation, and the
      // batches below keep 16 downloads in flight, so the `Downloading` above it is rarely its own.
      const reason = said(error);
      console.error(`  ${reason}; forms sharing its numbers stay ambiguous`);

      return null;
    }
  };

  for (let at = 0; at < drawn.length; at += FETCH_BATCH) {
    const batch = drawn.slice(at, at + FETCH_BATCH);
    const fetched = await Promise.all(batch.map(signatureFor));

    for (const [i, form] of batch.entries()) {
      const colourings = fetched[i];

      if (colourings) {
        signatures.set(form, colourings);
      }
    }
  }

  return signatures;
}
