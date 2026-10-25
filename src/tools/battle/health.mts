/**
 * How much HP each side has left, out of the bar the game draws near each Pokémon: a fill that shrinks from the right
 * and turns from green to yellow to red as it does, inside a thin light outline with a dark rim between the two, and
 * dark where the fill has gone. The opponent's floats over it, and ours sits at the left. Neither stays put: the camera
 * moves both up and down the screen, from y 0.25 to 0.65, and the opponent's across it too. So the bars are searched
 * for rather than sampled at a place, and told apart by where they start across.
 *
 * Measured on the committed stream frames, at 360 wide, and on 251 screenshots of two GO Battle League runs scaled down
 * to it, menus among them, every distance below in the frame's width, which is what the game sizes the bars by.
 */

import { luminance, rgb, type Image } from '../inventory/png.mts';

type Fill = 'green' | 'yellow' | 'red';

/**
 * The fill's three colours along the bars found: green 17–33/248–255/179–198 on the stream frames, which screenshots
 * draw paler at 120–127/251/192–196, yellow 249–255/244–255/101–143 and red 222–237/102–111/84–109. Behind the fill,
 * where a hit has just taken it, trails an orange that drains away after it, 246–255/139–152/0–22, which is no part of
 * what is left and which the red's test stops short of by its green.
 */
function fillOf(r: number, g: number, b: number): Fill | undefined {
  if (g > 200 && g - r > 90 && g - b > 30) {
    return 'green';
  }

  if (r > 200 && g > 200 && b < 160 && Math.abs(r - g) < 40) {
    return 'yellow';
  }

  if (r > 200 && g < 130 && b < 130) {
    return 'red';
  }

  return undefined;
}

/**
 * How long a full fill is, from where it starts to the outline at its right: 0.278 on 136 of the 174 bars found, 0.275
 * on 29 and 0.281 on 9, the opponent's and ours alike and on the Pixel 8 Pro's frames as on the Pixel 4 XL's.
 */
const FULL = 0.278;

/**
 * How tall the fill is, in 360ths of the width: four to six rows of the stream's frames on every bar found. A strip of
 * the fill's colours of another height is artwork, and so is one that runs on past where a full bar would end.
 */
const THICK = { least: 4, most: 7.5 } as const;

/**
 * Where across each side's fill starts: ours at 0.061–0.081 on all but one of the frames that drew it, which had it at
 * 0.119, and the opponent's anywhere from 0.481 to 0.664. Between the two, at 0.361–0.364, is where the camera centres
 * either while a charged move plays, which says nothing of whose it is.
 */
const STARTS = { own: [0.03, 0.15], opponent: [0.45, 0.7] } as const;

/** Where down the screen the bars are looked for: clear of the HUD above and the charged-move buttons below. */
const SEARCH = { top: 0.12, bottom: 0.85 } as const;

/**
 * How much lighter the outline is than the dark rim inside it, in luminance. The outline is translucent, and over
 * Charizard's orange measured 155 against the rim's 115; over the pale sky of a stream frame 250 against 139. Artwork
 * of the fill's colours has no such frame around it: of the strips the search turned up where a bar would start, the
 * 930 that were artwork — the minigame's bubbles, Kyogre's and Mamoswine's colours, the menus — had it at no more
 * than 4 of the 10 places along the bar it is looked for, bar one at 6, where all 180 bars had it at 7 or more.
 */
const OUTLINE = { contrast: 25, places: 10, least: 0.7 } as const;

interface Run {
  fill: Fill;
  left: number;
  right: number;
}

/** A run of one fill colour on each of a few rows running down from `top`, as pixels. */
interface Strip {
  fill: Fill;
  left: number;
  top: number;
  rights: number[];
}

/**
 * Where a strip ends, as the middle of where its rows do. An effect drawn over the bar can carry a row or two of it on
 * past the fill in its colours: Latias's cyan ring took the longest of six rows 3 pixels past the rest.
 */
const rightOf = ({ rights }: Strip) => [...rights].sort((a, b) => a - b)[rights.length >> 1] ?? 0;

/**
 * Every strip of one fill colour a few rows tall. A row's run of a colour carries over a pixel's gap, the encoder's
 * blur at an edge, and continues the strip above it where it starts and ends near where that did.
 */
function strips(image: Image): Strip[] {
  const unit = image.width / 360;
  const done: Strip[] = [];
  let open: Strip[] = [];

  for (let y = Math.round(SEARCH.top * image.height); y < SEARCH.bottom * image.height; y++) {
    const runs: Run[] = [];
    let run: Run | undefined;
    let gap = 0;

    for (let x = 0; x <= image.width; x++) {
      // Read off the data rather than through `rgb`, which made an array for each pixel of the search.
      const i = (y * image.width + x) * 4;
      const fill =
        x < image.width ? fillOf(image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0) : undefined;

      if (run && fill === run.fill) {
        run.right = x + 1;
        gap = 0;
      } else if (run && gap < unit && x < image.width) {
        gap++;
      } else {
        if (run && run.right - run.left >= 2 * unit) {
          runs.push(run);
        }

        run = fill && { fill, left: x, right: x + 1 };
        gap = 0;
      }
    }

    const next = runs.map(({ fill, left, right }) => {
      const above = open.find(
        (s) =>
          s.fill === fill &&
          Math.abs(s.left - left) <= 1.5 * unit &&
          Math.abs((s.rights.at(-1) ?? 0) - right) <= 3 * unit,
      );

      above?.rights.push(right);

      return above ?? { fill, left, top: y, rights: [right] };
    });

    done.push(...open.filter((s) => !next.includes(s)));
    open = next;
  }

  return [...done, ...open].filter(
    ({ rights }) => rights.length >= THICK.least * unit && rights.length <= THICK.most * unit,
  );
}

/** The most any of `levels` is lighter than one after it, which is a light line seen from beyond a dark one. */
const step = (levels: number[]) => Math.max(...levels.map((l, i) => l - Math.min(l, ...levels.slice(i + 1))));

/**
 * Whether a strip has the bar's frame around it: a light line beyond a dark one above it, below it and at its left end,
 * looked for in four rows or columns out from the fill. Above and below are looked for at `OUTLINE.places` along where
 * the full bar would run, and the left end on the strip's middle row.
 */
function framed(image: Image, strip: Strip): boolean {
  const unit = image.width / 360;
  const lum = (x: number, y: number) => luminance(...rgb(image, x, y));
  const out = (from: number, k: (i: number) => number) =>
    Array.from({ length: Math.round(4 * unit) }, (_, i) => k(from + i));
  const bottom = strip.top + strip.rights.length;
  let places = 0;

  for (let k = 0; k < OUTLINE.places; k++) {
    const x = strip.left + ((k + 0.5) / OUTLINE.places) * FULL * image.width;
    const above = step(out(strip.top - 4 * unit, (y) => lum(x, y)));
    const below = step(out(bottom, (y) => lum(x, y)).reverse());

    if (above >= OUTLINE.contrast && below >= OUTLINE.contrast) {
      places++;
    }
  }

  const middle = Math.floor((strip.top + bottom) / 2);
  const left = step(out(strip.left - 4 * unit, (x) => lum(x, middle)));

  return places / OUTLINE.places >= OUTLINE.least && left >= OUTLINE.contrast;
}

export interface Health {
  /** Our HP left, as a fraction of full, or null where our bar is not found. */
  own: number | null;
  opponent: number | null;
}

/**
 * Each side's HP left, as a fraction of full. A bar not drawn — through the minigame, or with the camera elsewhere — or
 * not told from the artwork is null. Where a side has two strips, an effect over the fill having split it, the one
 * starting further left is the bar.
 */
export function readHealth(image: Image): Health {
  const health: Health = { own: null, opponent: null };
  const starts: Partial<Record<keyof Health, number>> = {};

  for (const strip of strips(image)) {
    const left = strip.left / image.width;
    const fraction = (rightOf(strip) - strip.left) / (FULL * image.width);
    const side = (['own', 'opponent'] as const).find((s) => left >= STARTS[s][0] && left <= STARTS[s][1]);

    if (side && fraction <= 1.03 && left < (starts[side] ?? Infinity) && framed(image, strip)) {
      health[side] = Math.min(1, fraction);
      starts[side] = left;
    }
  }

  return health;
}

/**
 * How far a bar may move from the HP held before a second reading must agree with it, as a fraction of the bar. A
 * steady bar reads to within 2 points of itself frame to frame, Entei's at 98–100% and Charizard's at 76–78% in a live
 * Ultra League run, while the misreads in that run were 62–85 points out: Entei at 14% once among 98–100%, Dialga at 2%
 * between readings of 64% and Charizard at 4% between readings of 80%. A charged move's hit is as large, so size alone
 * cannot tell them apart; what does is that a real hit stays and a misread snaps back.
 */
const JUMP = 0.1;

/**
 * Each side's HP as decided on from the bars read frame by frame: a reading within `JUMP` of the HP held replaces it at
 * once, and one further out only once the next reading of that bar agrees with it. A misread flickering out between
 * steady readings so never moves what a shield or the opponent's energy is decided on, at the cost of a real hit as
 * large as one waiting a frame to count. A bar not drawn keeps both what is held and what awaits a second reading.
 */
export class Steady {
  #held: Health = { own: null, opponent: null };
  #pending: Health = { own: null, opponent: null };

  get health(): Health {
    return this.#held;
  }

  read(bars: Health): void {
    for (const side of ['own', 'opponent'] as const) {
      const read = bars[side];

      if (read === null) {
        continue;
      }

      const near = (hp: number | null) => hp !== null && Math.abs(read - hp) <= JUMP;

      if (this.#held[side] === null || near(this.#held[side]) || near(this.#pending[side])) {
        this.#held[side] = read;
        this.#pending[side] = null;
      } else {
        this.#pending[side] = read;
      }
    }
  }

  /** A side's Pokémon replaced, its bar a new one: the next reading of it is taken as it comes. */
  forget(side: keyof Health): void {
    this.#held[side] = null;
    this.#pending[side] = null;
  }
}
