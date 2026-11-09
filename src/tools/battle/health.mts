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

import { chroma, luminance, median, rgb, type Image } from '../../core/png.mts';
import { type Area } from './layout.mts';
import { type Colour } from './minigame.mts';

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
 *
 * Where a bar's fill has gone, from 2 pixels past its end to 4 short of a full bar's, the outline runs on along `along`
 * of it or more: so it did for 26,739 of the 27,208 bars read short of full on one picture in ten of the 26 GO Battle
 * League runs kept with video, and for no more than 82% where a strip of the map shows between the letters of "NOT VERY
 * EFFECTIVE..." or "BLOCKED!", which the game writes just above a bar, the letters breaking it.
 */
const OUTLINE = { contrast: 25, places: 10, least: 0.7, along: 0.9 } as const;

/**
 * How much of where the fill has gone may be drawn over before the fill's end is taken as hidden rather than its HP:
 * near-white, of at least `luminance` at no more than `chroma`, or the fill's own colour `dimmed`, within `off` of each
 * channel. Where the fill has truly gone the bar is dark, a third as bright as the fill, or the orange trailing a hit:
 * of the 5,663 bars read short of full on the committed frames and those kept from 17 runs, the 21 with half or more of
 * it drawn over were each under one of the below, and of the rest none had more than a third.
 *
 * The "GO!" that opens a battle is drawn over our bar, and in 8 of the 28 openings kept from 7 GO Battle League runs
 * its G stopped the fill short, reading 51–82% for up to 0.7s, with 57–100% of the rest near-white; the countdown's 2
 * before it once did the same at 94%. Through what is translucent, the fill runs on at three quarters of its brightness,
 * too dark to be taken for fill: the "Go, X!" bubble as the opponent sends a Pokémon in, which read our full bar at
 * 80–89% for up to 1.1s in 3 of those openings and at 93–94% on two frames of others, one mid-battle; and the backdrop
 * of the Pixel 8 Pro's "Attack incoming!", which read our bar at 45–50% at three shield prompts, where one was 87%.
 */
const COVER = { luminance: 200, chroma: 40, dimmed: [0.6, 0.9], off: 25, least: 0.5 } as const;

/**
 * How long a run of the fill's own colour, at `shown` of its brightness, shows it going on past where its strip stops,
 * in pixels at 360 wide: a thin line drawn across the bar having split it. Pokémon GO draws a pair of white rings
 * wherever the screen is touched, and `FIGHT`'s swipe in `play.mts` starts and ends where our bar lies whenever the
 * camera puts it at that height. The rings and the swipe's trail stopped the fill short, the bar read at 4–47% however
 * full it was, in 12 of the 14 times a GO Battle League run kept with video has our bar drop 30 points for a line of its
 * log and come back, and in 3 of the 28 openings kept. Beyond the line the fill runs on, which neither `cut` nor the
 * share `COVER` takes sees. Of the 6,823 bars read short of full on the committed frames, those kept from 13 runs and
 * the openings, where nothing was drawn across one the fill showed again for no more than 2 pixels, and each with 10 or
 * more was under the rings, the trail, the countdown's 2 fading, PGSharp's star or a stat change's banner.
 */
const AGAIN = { shown: [0.9, 1.15], run: 6 } as const;

/**
 * The least of a full bar a green or yellow fill is read at, as a fraction: the bar turns yellow and then red as it
 * empties, and a strip of either shorter than this is one split off where the bar starts by something drawn across it.
 * Of the 6,909 bars read on the committed frames and those kept from 13 runs, the green ones under 40% and the yellow
 * under 20% were each under something drawn over them, PGSharp's yellow star over our bar's start among them, read as a
 * yellow bar at 2%. A ring split our bar 4 pixels from its start, too short a strip for `covered` to see its colour.
 */
const LIT = 0.1;

const light = (pixel: Colour) => luminance(...pixel) >= COVER.luminance && chroma(...pixel) <= COVER.chroma;

/**
 * Whether `pixel` is `fill` at a brightness in `range` of it: each channel within `COVER.off` of the fill's, scaled as
 * it is.
 */
function scaled(pixel: Colour, fill: Colour, [least, most]: readonly [number, number]): boolean {
  const k = luminance(...pixel) / luminance(...fill);

  return k >= least && k <= most && pixel.every((v, c) => Math.abs(v - k * (fill[c] ?? 0)) <= COVER.off);
}

/** The most of `pixels` in a row that `is` holds for. */
function longest(pixels: readonly Colour[], is: (pixel: Colour) => boolean): number {
  let run = 0;
  let most = 0;

  for (const pixel of pixels) {
    run = is(pixel) ? run + 1 : 0;
    most = Math.max(most, run);
  }

  return most;
}

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

  /** Whether the strip is two found too thin to be read alone, by `rejoin`. */
  rejoined: boolean;
}

/**
 * Where a strip ends, as the middle of where its rows do. An effect drawn over the bar can carry a row or two of it on
 * past the fill in its colours: Latias's cyan ring took the longest of six rows 3 pixels past the rest.
 */
const rightOf = ({ rights }: Strip) => median(rights);

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

      return above ?? { fill, left, top: y, rights: [right], rejoined: false };
    });

    done.push(...open.filter((s) => !next.includes(s)));
    open = next;
  }

  return rejoin([...done, ...open], unit).filter(
    ({ rights }) => rights.length >= THICK.least * unit && rights.length <= THICK.most * unit,
  );
}

/**
 * `found` with each strip too thin to be read alone joined to one as thin just above it, where it starts within 2
 * pixels of where that does and ends near where that did, as one strip starting where the further left of the two does.
 * As the camera sweeps a bar up or down the screen, a row of its fill can start a pixel or two further in than the rows
 * beside it, its left end blurred too pale for `fillOf`, past the 1.5 pixels `strips` lets a row stray, and so split
 * the fill into strips under `THICK.least`: our bar at 43% was lost so in the kept Pixel 8 Pro run of 2026-10-29, and
 * the map between the letters of "NOT VERY EFFECTIVE..." just above it read in its place at 3%. Of the 546,449 pictures
 * of the 27 GO Battle League runs kept with video, joining so reads 11,763 bars that went unread, 11,591 of them within
 * 3 points of a reading of that side within half a second either side. Letting every row stray 2 pixels found the bar
 * at 43% too, but grew strips of artwork already found by the rows that strayed, which then passed `outside` for a bar;
 * joining only what would otherwise be dropped leaves every strip found as it was.
 */
function rejoin(found: Strip[], unit: number): Strip[] {
  const thin = (strip: Strip) => strip.rights.length < THICK.least * unit;
  const joined = new Set<Strip>();

  for (const lower of [...found].sort((a, b) => a.top - b.top)) {
    const upper = found.find(
      (s) =>
        !joined.has(s) &&
        s.fill === lower.fill &&
        thin(s) &&
        thin(lower) &&
        s.top + s.rights.length === lower.top &&
        Math.abs(s.left - lower.left) <= 2 * unit &&
        Math.abs((s.rights.at(-1) ?? 0) - (lower.rights[0] ?? 0)) <= 3 * unit,
    );

    if (upper) {
      upper.left = Math.min(upper.left, lower.left);
      upper.rights.push(...lower.rights);
      upper.rejoined = true;
      joined.add(lower);
    }
  }

  return found.filter((strip) => !joined.has(strip));
}

/** The most any of `levels` is lighter than one after it, which is a light line seen from beyond a dark one. */
const step = (levels: number[]) => Math.max(...levels.map((l, i) => l - Math.min(l, ...levels.slice(i + 1))));

const lum = (image: Image, x: number, y: number) => luminance(...rgb(image, x, y));

/** `level` at each of four rows or columns out from `from`, in 360ths of the frame's width. */
const out = (image: Image, from: number, level: (at: number) => number) =>
  Array.from({ length: Math.round((4 * image.width) / 360) }, (_, i) => level(from + i));

/**
 * Whether the outline is found at `x` along a strip: a light line beyond a dark one both above and below the fill,
 * looked for in four rows out from it.
 */
function edged(image: Image, strip: Strip, x: number): boolean {
  const unit = image.width / 360;
  const above = step(out(image, strip.top - 4 * unit, (y) => lum(image, x, y)));
  const below = step(out(image, strip.top + strip.rights.length, (y) => lum(image, x, y)).reverse());

  return above >= OUTLINE.contrast && below >= OUTLINE.contrast;
}

/** Each of `OUTLINE.places` along where a strip's full bar would run, and whether the outline is found there. */
function outline(image: Image, strip: Strip): { x: number; found: boolean }[] {
  return Array.from({ length: OUTLINE.places }, (_, k) => {
    const x = strip.left + ((k + 0.5) / OUTLINE.places) * FULL * image.width;

    return { x, found: edged(image, strip, x) };
  });
}

/**
 * Whether a strip has the bar's frame around it: the outline at `OUTLINE.least` of the places `outline` looks, and a
 * light line beyond a dark one at its left end too, looked for on the strip's middle row in four columns out from it.
 */
function framed(image: Image, strip: Strip): boolean {
  const unit = image.width / 360;
  const middle = Math.floor(strip.top + strip.rights.length / 2);
  const places = outline(image, strip).filter(({ found }) => found).length;
  const left = step(out(image, strip.left - 4 * unit, (x) => lum(image, x, middle)));

  return places / OUTLINE.places >= OUTLINE.least && left >= OUTLINE.contrast;
}

/**
 * Whether something is drawn over a strip's bar where its fill has gone, by `COVER`, or across the fill, which shows
 * again beyond it by `AGAIN`, the fill's colour the middle of what it shows: looked for on the strip's middle row from 2
 * pixels past where the fill ends, clear of the encoder's blur at its edge, to 4 short of where a full bar's would, clear
 * of the outline. A strip that near full has nothing there to look at, and is read as it is.
 */
function covered(image: Image, strip: Strip): boolean {
  const unit = image.width / 360;
  const middle = Math.floor(strip.top + strip.rights.length / 2);
  const row = (from: number, to: number) =>
    Array.from({ length: Math.max(0, Math.ceil(to - from)) }, (_, i) => rgb(image, from + i, middle));
  const right = rightOf(strip);
  const fill = row(Math.round(strip.left + 2 * unit), right - 2 * unit);
  const colour: Colour = [
    median(fill.map(([r]) => r)),
    median(fill.map(([, g]) => g)),
    median(fill.map(([, , b]) => b)),
  ];
  const gone = row(Math.round(right + 2 * unit), strip.left + FULL * image.width - 4 * unit);
  const over = gone.filter((pixel) => light(pixel) || scaled(pixel, colour, COVER.dimmed));

  return (
    gone.length > 0 &&
    (over.length / gone.length >= COVER.least ||
      longest(gone, (pixel) => scaled(pixel, colour, AGAIN.shown)) >= AGAIN.run * unit)
  );
}

/**
 * Whether a strip's fill ends where something is drawn across its bar rather than where its HP runs out: the outline
 * missing at the first of `outline`'s places past the fill's end, where it should frame the bar left empty, and either
 * missing at every place past it, the bar itself ending there with its left end hidden, or with the fill showing again
 * further along its rows, among `all` the strips found. The countdown before a battle does both to the opponent's bar,
 * its 2 drawn across the middle and its 1 over the left end: in 10 of the 28 openings kept from 7 GO Battle League
 * runs, on up to 29 frames of one, the strip alone read 11–24% under the 2 and 76–91% under the 1. A digit fading in
 * or out shows the outline through it, and is missed. Of the 5,342 bars read on the committed frames and those kept
 * from 16 runs, 5 go unread for it, each with something drawn across it: a move's beam over a full bar the strip read
 * at 50%, `BLOCKED!`, `NOT VERY EFFECTIVE...` and PGSharp's star.
 */
function cut(image: Image, strip: Strip, all: readonly Strip[]): boolean {
  const unit = image.width / 360;
  const right = rightOf(strip);
  const past = outline(image, strip).filter(({ x }) => x > right + 2 * unit);
  const again = all.some(
    (other) =>
      other.fill === strip.fill &&
      other.left >= right + 2 * unit &&
      rightOf(other) <= strip.left + FULL * image.width + 2 * unit &&
      other.top >= strip.top - unit &&
      other.top + other.rights.length <= strip.top + strip.rights.length + unit,
  );

  return past[0]?.found === false && (past.every(({ found }) => !found) || again);
}

/**
 * Whether a strip lies outside the bar's outline rather than in it, beside the bar or just above or below it, among
 * `all` the strips found, any of which starting where `side`'s bar starts may be that bar.
 *
 * Beside it, the outline is found over fewer than half the strip's own pixels, with another strip starting past its end
 * across some of its rows. Artwork just left of a bar passes `framed`, the bar's own outline running along most of where
 * the strip's bar would, but the fill a bar has left lies inside its outline. Red and orange foliage and pumpkins on the
 * autumn map, and PGSharp's star, did so in 11 of the 17 GO Battle League runs kept with video: of their 350,000
 * pictures, 1,008 readings were the artwork at 2–18%, now the bar beside it at 14–99% or, where that is not framed,
 * unread. Another fill past a strip's end says nothing alone: the opponent's own artwork, PGSharp's star and the orange
 * trail's red end lie there too, inside a bar's outline, which runs over that bar's fill. Foliage a few pixels wide has
 * had its shading pass for the outline over exactly half of them, which is outside too where the other fill starts no
 * more than 4 pixels on, the outline and its rim between the two. PGSharp's star over our bar's left end leaves an edge
 * like it further from where the fill shows past the star, which read from there would be 44–46% of a bar at 56–64%.
 *
 * Just above or below it, a longer, framed strip lies across its columns or the outline's left end beyond them, its fill
 * within 12 rows, and the outline runs along less than `OUTLINE.along` of where the strip's fill has gone. The outline
 * looked for 4 rows out from each finds one between the two, framing both, but only a bar's runs on past its fill. The
 * map between the letters of "NOT VERY EFFECTIVE..." read as our bar at 2–4% while it was at 43–85%, or left it unread:
 * the game writes them 8–16 rows above the bar's fill on both phones, so a strip of 4 rows or more between them ends
 * 7–12 rows above it. Two bars drawn one above the other where the opponent's starts, as a charged move starts, are
 * each a bar.
 */
function outside(image: Image, strip: Strip, all: readonly Strip[], side: keyof typeof STARTS): boolean {
  const unit = image.width / 360;
  const [least, most] = STARTS[side];
  const right = rightOf(strip);
  const bottom = strip.top + strip.rights.length;
  const xs = Array.from({ length: Math.ceil(right - strip.left) }, (_, i) => strip.left + i);
  const over = xs.filter((x) => edged(image, strip, x)).length;
  const bars = all.filter((other) => other.left >= least * image.width && other.left <= most * image.width);
  const beside = bars.some(
    (other) =>
      other.left > right &&
      other.top < bottom &&
      strip.top < other.top + other.rights.length &&
      (2 * over < xs.length || (2 * over === xs.length && other.left - right <= 4 * unit)),
  );
  const from = Math.round(right + 2 * unit);
  const gone = Array.from(
    { length: Math.max(0, Math.ceil(strip.left + FULL * image.width - 4 * unit - from)) },
    (_, i) => from + i,
  );
  const stacked =
    bars.some((other) => {
      const gap = Math.max(other.top - bottom, strip.top - (other.top + other.rights.length));

      return (
        gap >= 0 &&
        gap <= 12 * unit &&
        other.left - 4 * unit < right &&
        strip.left < rightOf(other) &&
        rightOf(other) - other.left > right - strip.left &&
        framed(image, other)
      );
    }) && gone.filter((x) => edged(image, strip, x)).length < OUTLINE.along * gone.length;

  return beside || stacked;
}

export interface Health {
  /** Our HP left, as a fraction of full, or null where our bar is not found. */
  own: number | null;
  opponent: number | null;
}

/**
 * Whether `strip` is taken for a side's bar over `other`, the one taken so far: one found whole over one `rejoin`ed,
 * and otherwise the one starting further left. Red foliage of the autumn map, slanting across a few rows just left of a
 * bar, splits as a bar sweeping by does, and rejoined passes `framed` and `outside`: of the 546,449 pictures of the 27
 * GO Battle League runs kept with video, the strip starting further left would have been a rejoined one over a bar
 * found whole in 62, 31 of them foliage read at 4–8% where the bar was at 2–90%, three pictures in a row reading 6% of
 * a bar at 76%.
 */
const before = (strip: Strip, other: Strip | undefined) =>
  !other || (strip.rejoined === other.rejoined ? strip.left < other.left : other.rejoined);

/**
 * Each side's HP left, as a fraction of full. A bar not drawn — through the minigame, or with the camera elsewhere — or
 * not told from the artwork is null, and so is one whose fill ends where something is drawn over it: `covered`, `cut`
 * and `LIT`. Where a side has two strips, an effect over the fill having split it, the one taken is the bar by
 * `before`, unless it lies `outside` the bar.
 */
export function readHealth(image: Image): Health {
  const health: Health = { own: null, opponent: null };
  const taken: Partial<Record<keyof Health, Strip>> = {};
  const all = strips(image);

  for (const strip of all) {
    const left = strip.left / image.width;
    const fraction = (rightOf(strip) - strip.left) / (FULL * image.width);
    const side = (['own', 'opponent'] as const).find((s) => left >= STARTS[s][0] && left <= STARTS[s][1]);

    if (
      side &&
      fraction <= 1.03 &&
      before(strip, taken[side]) &&
      framed(image, strip) &&
      !outside(image, strip, all, side)
    ) {
      health[side] =
        covered(image, strip) || cut(image, strip, all) || (strip.fill !== 'red' && fraction < LIT)
          ? null
          : Math.min(1, fraction);
      taken[side] = strip;
    }
  }

  return health;
}

/**
 * Where the bars have been found during the fight, for `overlay.mts`, as fractions of the screen and a little past them
 * for the outline the finder looks for around each: ours starting 0.050–0.081 across and lying 0.247–0.647 down, and
 * the opponent's starting 0.455–0.661 and lying 0.251–0.561, across every committed frame of both phones that drew
 * them, each `FULL` long. Searched for further afield, as the camera swings through a charged move, but read only in
 * the fight, which is where an overlay over them would read a bar short.
 */
const DRAWN = {
  own: [0.04, 0.24, 0.081 + FULL + 0.01, 0.665],
  opponent: [0.445, 0.24, 0.661 + FULL + 0.01, 0.58],
} as const;

export const areas = (): Area[] => [
  { name: 'our HP bar', boxes: [DRAWN.own] },
  { name: "the opponent's HP bar", boxes: [DRAWN.opponent] },
];

/**
 * How far a bar may move from the HP held before a second reading must agree with it, as a fraction of the bar. A
 * steady bar reads to within 2 points of itself frame to frame, Entei's at 98–100% and Charizard's at 76–78% in a live
 * Ultra League run, while the misreads in that run were 62–85 points out: Entei at 14% once among 98–100%, Dialga at 2%
 * between readings of 64% and Charizard at 4% between readings of 80%. A charged move's hit is as large, so size alone
 * cannot tell them apart; what does is that a real hit stays and a misread snaps back.
 */
export const JUMP = 0.1;

/**
 * Each side's HP as decided on from the bars read frame by frame: a reading within `JUMP` of the HP held replaces it at
 * once, and one further out only once the next frame's reading of that bar agrees with it. A misread flickering out
 * between steady readings so never moves what a shield or the opponent's energy is decided on, at the cost of a real
 * hit as large as one waiting a frame to count. A bar not drawn keeps both what is held and what awaits a second
 * reading.
 */
export class Steady {
  #held: Health = { own: null, opponent: null };
  #pending: Health = { own: null, opponent: null };

  // The frame each side's bar was last read off. The loop comes round faster than frames come, and the screen
  // standing still sends none, so it hands over the same frame turn after turn, and a misread read again would agree
  // with itself.
  #from: Record<keyof Health, Image | undefined> = { own: undefined, opponent: undefined };

  get health(): Health {
    return this.#held;
  }

  read(frame: Image, bars: Health): void {
    for (const side of ['own', 'opponent'] as const) {
      const read = bars[side];

      if (read === null || this.#from[side] === frame) {
        continue;
      }

      this.#from[side] = frame;
      const near = (hp: number | null) => hp !== null && Math.abs(read - hp) <= JUMP;

      if (this.#held[side] === null || near(this.#held[side]) || near(this.#pending[side])) {
        this.#held[side] = read;
        this.#pending[side] = null;
      } else {
        this.#pending[side] = read;
      }
    }
  }

  /** A side's Pokémon replaced, its bar a new one: its next reading is taken as it comes, the last frame's too. */
  forget(side: keyof Health): void {
    this.#held[side] = null;
    this.#pending[side] = null;
    this.#from[side] = undefined;
  }
}
