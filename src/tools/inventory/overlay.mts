/**
 * PGSharp's overlay, which states the level and the three IVs outright where the game's own CP does not survive OCR.
 * Two jobs: finding the box, by sweeping isolated bands for the one thing nothing else on the screen carries — three
 * small numbers separated by slashes — and reading what is inside it.
 *
 * `OVERLAY_LUMINANCE` and `OVERLAY_CHROMA` are exported because the detail screen's CP is the same near-white text.
 */

import { type IVs } from './game-master.mts';
import { ocr, ocrLine } from './ocr.mts';
import { brighten, crop, isolate, scale, type Image } from './png.mts';

/** Where PGSharp draws its overlay, as fractions of the screen's width and height. */
export interface OverlayBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Overlay {
  iv: IVs;

  /**
   * Whether the percentage PGSharp prints beside the IVs vouches for them: a pass whose own percentage confirmed its
   * triple, or a triple `assembled` out of several that one of their percentages confirmed. False where the IVs are a
   * fallback nothing on the screen checks, which is where `identify` holds a CP worked out from them to account.
   */
  checked: boolean;

  /**
   * Every level the digits could be saying, rather than one. The small-caps `L` reads as an `L` on one phone and a `1`
   * on another, and the `IV` label after the level reads as another `1`, so `151` is `L15` plus a stray or a stray
   * plus `51` with nothing in the string saying which. `identify` intersects the shortlist with what the HP admits.
   */
  levels: number[];

  /**
   * What PGSharp appends in brackets after the IVs, as read — `L` for an Unown, nothing for most Pokémon. Matching it
   * to a form is `identify`'s job, only it knowing the species.
   */
  form: string | null;
}

/** The IVs as `attack/defense/stamina`, the one spelling every key, landmark and log line compares or shows. */
export function ivsOf({ iv }: Overlay): string {
  return `${iv.attack}/${iv.defense}/${iv.stamina}`;
}

/**
 * Only these survive the whitelist: the level's `L`, the digits, the slashes between the three IVs and the `%` that
 * Tesseract makes of a half level's `½`. The `½` itself is no use here, the model never answering it: whitelisted, a
 * Luxray's `L21½ IV100` still reads `L211`, its `½` a stray `1` that leaves 21.5 offered by nothing. With `%` allowed
 * the same band reads `L21%1`, which is what `levelsIn` turns back into a half.
 */
const OVERLAY_ALPHABET = 'L0123456789/% ';

/**
 * How much to upscale the isolated overlay before reading it. 2 because that is what the IVs were measured against —
 * at 1× Tesseract read `14/18/12` for `14/13/12`, and at 3× and 4× it takes the level's small-caps `L` for a `1`.
 */
const OVERLAY_SCALE = 2;

/** How bright a channel has to be for `brighten` to keep it. Low enough to hold the IV percentage. */
const OVERLAY_BRIGHTNESS = 120;

/**
 * A second brightness floor, for a band this one leaves blank. `basculin-blue.png` reads nothing at 120, so its
 * near-white pass would go unchallenged and its `8` stand as the `3` that treatment makes of it; at 180 the same band
 * reads `5135 8/3/5`, which the percentage settles. A third floor rather than a replacement: without 120, near-white
 * and 180 between them read four other captures wrongly.
 */
const OVERLAY_BRIGHTNESS_HIGH = 180;

/**
 * The three ways to turn an overlay band into black on white, in the order to try. None wins outright, which is why
 * all three are here and why the percentage below arbitrates between them.
 *
 * Near-white first, that being what every reading was measured against. What it costs is thin strokes: the chroma
 * ceiling clips the anti-aliased edge of a leading `1`, so `articuno-galar.png` reads `10/4/13` for `12/4/13`.
 * Brightness is a second opinion rather than a replacement, and misses `unown-question.png`, whose level, percentage
 * and IVs run together at 120.
 *
 * Adding one is three decisions rather than two, and order protects only the first. The loop keeps the first reading
 * the percentage confirms, so a pass appended here cannot displace a `chosen` that an earlier one earned. What it can
 * move is `assembled` below, which an appended pass feeds twice over — a value per field to its cross product, and a
 * `before` to the checksum every combination is put to. So it can turn an abstention into an assembly, and it can turn
 * an assembly into an abstention by making a second combination check out, which falls back on the first pass's triple.
 *
 * `articuno-galar.png` is where that costs something: a fourth treatment reading the near-white `10/4/13` and printing
 * a percentage of its own takes the assembled `12/4/13` to nothing, leaving the `10/4/13` its row denies. It is caught
 * rather than shipped — `screens.test.mts` fails on that row the moment it happens — but a pass is worth reading
 * `assembled` for before adding it, not just this paragraph. `overlay.test.mts` pins the mechanism.
 */
const OVERLAY_TREATMENTS = [
  (band: Image) => isolate(band, OVERLAY_LUMINANCE, OVERLAY_CHROMA),
  (band: Image) => brighten(band, OVERLAY_BRIGHTNESS),
  (band: Image) => brighten(band, OVERLAY_BRIGHTNESS_HIGH),
];

/**
 * Whether the IV percentage PGSharp prints beside the triple agrees with it. It is `floor((a + d + s) / 45 * 100)`, so
 * it is redundant — and redundancy is what makes it a checksum, settling which treatment to believe where two read
 * different possible triples. `deoxys-attack.png` is the case: near-white says `20 14/13/14` with no percentage to
 * check it by, and brightness at 180 says `00 9114/13/14`, whose `91` is what 14/13/14 comes to.
 *
 * `articuno-galar.png` is the case this settles without either pass having read it. Near-white says `10/4/13`,
 * brightness at 180 says `12/4/ 3` and prints the right `164`, and neither triple comes to the percentage beside it —
 * so nothing confirms, and `assembled` asks this the same question about every combination of the fields the two
 * passes read instead. Only `12/4/13` comes to the `64`.
 *
 * It is the end of the last run of digits ahead of the triple rather than a whole word, since it runs into what is
 * beside it — `xurkitree.png`'s `82` arrives as `182`. And that run must not be the level alone, because a treatment
 * that drops the coloured percentage leaves the level as the last run, and a level of 20 would confirm any triple
 * summing to 9; so it is the `L` that says which run is the level. Where the `L` reads as a `1` that cannot be told
 * apart, `120` being a level of 20 as readily as a level of 1 and a percentage of 20.
 *
 * Two digits of it at least, because one is no checksum: a single digit ends almost any run, so `L20` would confirm a
 * triple summing to 0 and `182` one summing to 1 — and the `L` cannot be what rules those out, since the run carrying
 * the digit need not be a level at all.
 *
 * What that refuses is the 35 triples of 4,096 that sum under 5, whose percentage is one digit, and it refuses them
 * outright rather than only where the digit was borrowed from a longer run: all 35 could confirm themselves off a
 * percentage printed as its own run, and none can now. So a 0/0/0 screen loses a `chosen` as well as an `assembled` and
 * stands on the fallback, which is where any reading with no checksum beside it stands. The confirmation it loses was
 * never sound — one digit of agreement is one digit — but it is refused now, not merely unavailable.
 */
export function confirmed(before: string, iv: IVs): boolean {
  const percentage = String(Math.floor(((iv.attack + iv.defense + iv.stamina) / 45) * 100));
  const runs = before.match(/\d+/g) ?? [];
  const last = runs.at(-1) ?? '';
  const lastIsLevel = /L\d+\D*$/.test(before);

  return (
    percentage.length > 1 &&
    last.endsWith(percentage) &&
    (last.length > percentage.length || (runs.length > 1 && !lastIsLevel))
  );
}

/**
 * One triple built from the fields the passes read, where no pass read all three right. Each reading offers its own
 * value per field, every combination of them is checked against each reading's percentage, and the answer is the one
 * that checks out — or nothing, where none does or more than one does.
 *
 * It is asked only where no pass confirmed, which over the corpus is four captures with a reading between them: it
 * answers on two of those and changes the answer on one. That last number is the one the feature is for.
 *
 * `articuno-galar.png` is the capture it changes: its attack is 10 or 12 and its stamina 13 or 3 across two passes, and
 * only `12/4/13` comes to the `64` one of them printed. On `dialga-origin.png` it answers the `10/13/13` the first pass
 * read anyway, the second having lost only the stamina, so the row cannot tell that apart from the fallback. On
 * `burmy-plant.png` and `rotom-wash.png` nothing checks out and the fallback stands. `overlay.test.mts` asserts all
 * four off the readings the real loop hands this, which a row by itself cannot say.
 *
 * Checked with `confirmed` rather than against the percentage directly, so that what counts as the percentage is one
 * definition and not two — it is the tail of a run of digits, and which run is itself a judgement that function makes.
 *
 * A combination is not a reading, which is the thing to hold on to: no pass saw `12/4/13` on the screen. What makes it
 * safe to answer anyway is that the percentage is redundant with the triple, so agreement between them is a fact about
 * the screen rather than about the reader — and what makes it safe to be wrong is that `identify` still has to fit the
 * HP and the printed CP to the answer.
 */
export function assembled(readings: readonly { iv: IVs; before: string }[]): IVs | null {
  const perField = (['attack', 'defense', 'stamina'] as const).map((field) => [
    ...new Set(readings.map((reading) => reading.iv[field])),
  ]);
  const [attacks = [], defenses = [], staminas = []] = perField;
  const checks: IVs[] = [];

  for (const attack of attacks) {
    for (const defense of defenses) {
      for (const stamina of staminas) {
        const iv = { attack, defense, stamina };

        if (readings.some((reading) => confirmed(reading.before, iv))) {
          checks.push(iv);
        }
      }
    }
  }

  return checks.length === 1 ? (checks[0] ?? null) : null;
}

/**
 * A later reading that holds the first one's digits and more, where the first has lost some: each of its fields reads
 * the first's field with digits added, and at least one adds something. `1/1/1` against `11/10/11` is the case — each
 * `1` is in the field beside it — where `10/4/13` against `12/4/3` is not, `10` not being in `12`.
 *
 * Asked only where nothing confirmed and nothing assembled, so it never overrides the percentage; it only chooses
 * between readings the percentage could not separate, in favour of the one OCR lost less of. Losing strokes is the
 * direction near-white errs in — the chroma ceiling clips the anti-aliased edge of a `1` — and adding them is not.
 *
 * The one with the most digits, and nothing where two different readings tie for it, that being a guess between them.
 */
export function fuller(readings: readonly { iv: IVs }[]): IVs | null {
  const [first, ...rest] = readings;

  if (first === undefined) {
    return null;
  }

  const fields = (iv: IVs) => [iv.attack, iv.defense, iv.stamina].map(String);
  const digits = (iv: IVs) => fields(iv).join('').length;

  const holds = (whole: string, part: string) => {
    let at = 0;

    for (const digit of whole) {
      if (digit === part[at]) {
        at++;
      }
    }

    return at === part.length;
  };

  const base = fields(first.iv);
  const extending = rest
    .map((reading) => reading.iv)
    .filter((iv) => digits(iv) > digits(first.iv) && fields(iv).every((field, i) => holds(field, base[i] ?? '')));
  const most = Math.max(...extending.map(digits));
  const best = [
    ...new Map(extending.filter((iv) => digits(iv) === most).map((iv) => [fields(iv).join('/'), iv])).values(),
  ];

  return best.length === 1 ? (best[0] ?? null) : null;
}

/**
 * The alphabet the bracketed form is read with, deliberately not the one above widened: the letters a form needs are
 * precisely the glyphs a digit is confused with — `O` for `0`, `S` for `5`, `B` for `8` — so two reads of the same
 * crop cost one more Tesseract call and leave the numbers coming out of the alphabet they were measured against.
 *
 * `[` and `\\` are in it because PGSharp draws them: it indexes a species' forms from `A`, so the 27th and 28th Unown
 * come out as `[` and `\\`. Without them `unown-question.png`'s `(\\)` reads as `(X)`, a **real** Unown form, so the
 * answer came back confidently wrong rather than absent.
 *
 * Digits are read on a second pass rather than added here, which is measured: over 24 Unown the letters come back
 * identical either way, and over 18 Pokémon carrying no suffix a single pass with digits invents one — `(251)` out of
 * a Decidueye's artwork — where the pass without them reads nothing on all 18. Spinda is the species that needs them,
 * its forms being `00` to `19`, and what separates it from that false positive is the length. So `SUFFIX_SHAPE` is the
 * narrow claim, not the alphabet.
 */
const OVERLAY_FORM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ()!?[\\ ';

/** The same widened to digits, for the one species the game labels numerically. */
const OVERLAY_NUMERIC_ALPHABET = OVERLAY_FORM_ALPHABET + '0123456789';

/**
 * What a suffix PGSharp drew can look like, which is the guard the two passes need rather than an alphabet. Every form
 * it labels is one character — Unown's 26 letters plus `[` and `\\` — or Spinda's two digits. Nothing it draws is two
 * letters, so `basculin-blue.png`'s `(SV)` and `spinda-04.png`'s `(OA)` are both noise, and rejecting them is what
 * lets the numeric pass run at all: `O` for `0` and `A` for `4` is exactly the confusion it invites.
 */
const SUFFIX_SHAPE = /^(?:[A-Z[\\]|\d{2})$/;

/**
 * The last bracketed run on the line, the suffix being appended and a stray bracket landing among the digits ahead of
 * it — one capture read `L17 1V33 177(7 (L)`, where the first group is noise and the last is the form.
 */
const FORM_SUFFIX = /\(([^()]{1,20})\)/g;

/** Bright enough to be the overlay's white text, and flat enough in colour not to be its IV percentage. */
export const OVERLAY_LUMINANCE = 150;
export const OVERLAY_CHROMA = 55;

export const TRIPLE = /(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/;

/** The same pattern anchored, so `tripleIn` can ask it *at* an offset rather than from one. Derived, not retyped. */
const TRIPLE_AT = new RegExp(TRIPLE.source, 'y');

/**
 * Where the three IVs are on a line of overlay text: the **last** triple on it rather than the first.
 *
 * PGSharp draws the level and the percentage ahead of the IVs, and a percentage whose second digit reads as a slash
 * opens a triple of its own. `rotom-wash.png`'s band reads `L12 3/ 13/3/1` — its `ɪᴠ37` came out as `3/` — so
 * `3/ 13/3` matches ahead of the `13/3/1` the screen shows, and the first match is a triple of the percentage's tail
 * and the first two IVs. Taking the last instead reads the screen.
 *
 * The longest of those ending together, which is the other half: `articuno-galar.png`'s `10/4/ 13` and the `0/4/ 13`
 * inside it end at the same place, and the one that starts earlier is the one with the whole leading digit.
 *
 * Scanned from every offset rather than with `matchAll`, which steps past each match and so cannot see one that starts
 * inside it — and a stray digit ahead of a real triple is exactly that case.
 */
function tripleIn(text: string): RegExpExecArray | null {
  let best: RegExpExecArray | null = null;
  const endOf = (match: RegExpExecArray) => match.index + match[0].length;

  for (let at = 0; at < text.length; at++) {
    TRIPLE_AT.lastIndex = at;
    const match = TRIPLE_AT.exec(text);

    if (match && (best === null || endOf(match) > endOf(best))) {
      best = match;
    }
  }

  return best;
}

/**
 * How far left of the three IVs the box reaches, in characters. `L25 IV86 14/13/12` is eighteen, and the generosity
 * beyond that is not spare: the em it multiplies is estimated from whatever line was recognised, often the triple
 * alone, which under-estimates it. At 19 a box tightened on one Pokémon clipped the `L31` off the next while keeping
 * its IVs, which reads as a success. Measured per phone over 62 screens, 19 reads 49 of 50 levels and 30 reads all.
 */
const OVERLAY_CHARACTERS = 30;

/**
 * How far right of them it reaches, for the form PGSharp appends there. Bounded on both sides, unlike the reach the
 * other way, because the level and the IVs come out of the same crop: too short clips the suffix, too long drags the
 * artwork into a band `ocrLine` reads whole.
 *
 * Measured over 24 Unown and 26 Pokémon PGSharp appends nothing to. At one character the letter comes back on 20 of
 * the 24 and cannot be told from the level's own `L`; from three up all 24 read a closed bracket. Going further costs
 * readings: the no-suffix corpus reads 18 of its 26 overlays at 3, 4 and 5 and only 16 at 6 and beyond, losing two
 * triples outright — which would read as the overlay simply not being there. Five is the most generous reach that
 * costs none.
 */
const OVERLAY_SUFFIX_CHARACTERS = 5;

/**
 * How much wider than the triple's box to read the bracketed form out of, as a fraction of that box's width. The
 * tightened box already reaches as far past the IVs as their own read can go, and that is not always far enough for
 * the bracket: `unown-m.png` reads `(MN` out of it, with no closing bracket and so no form. The suffix has its own
 * crop and alphabet, so reaching further costs the IVs nothing, and half the box again reads `(M)`.
 */
const OVERLAY_SUFFIX_REACH = 0.5;

/**
 * What the bracketed suffix is isolated against, which is not what the triple is. A `[` is a thin upright that the
 * near-white floor clips away entirely: `unown-exclamation.png` reads an empty `()` at 150/55 and `[` at 120/40,
 * while `unown-b.png` and `unown-question.png` answer under either.
 */
const SUFFIX_LUMINANCE = 120;
const SUFFIX_CHROMA = 40;

/** Level 51 is a best buddy's; nothing the overlay can be saying is higher. */
const MAX_LEVEL = 51;

/** How far down the screen the overlay can sit, and how tall a band to sweep, as fractions of the screen's height. */
const OVERLAY_FROM = 0.08;
const OVERLAY_TO = 0.45;
const OVERLAY_BAND = 0.03;

/**
 * How much of the width to sweep, centred. PGSharp centres the overlay — measured at 718 and 720 against a screen
 * centre of 720 on one phone and 501 against 504 on another — and the widest of those boxes is 38% of its screen, so
 * this is generous. What it buys is leaving out the movable PGSharp toolbar along the edges, which is otherwise read
 * as part of the same line.
 */
const OVERLAY_SPAN = 0.7;

/**
 * The text of an isolated overlay crop, upscaled, or null where it holds no IV triple. The whitelist is what stops the
 * isolated artwork either side of the text being read as glyphs that split a number in two.
 */
async function tripled(band: Image): Promise<string | null> {
  const text = (await ocrLine(scale(band, OVERLAY_SCALE), OVERLAY_ALPHABET)) ?? '';

  return TRIPLE.test(text) ? text : null;
}

/**
 * How many bands of a sweep to read at once: one Tesseract per core. `navigator` rather than `node:os` because it is
 * the one both sides have, Node answering `availableParallelism()` there.
 */
const SWEEP_BATCH = navigator.hardwareConcurrency || 1;

/**
 * Where the overlay sits and what it says, found by the one thing nothing else on the screen carries: three small
 * numbers separated by slashes. The expensive half, and it only has to work once — a caller finds the box on whichever
 * Pokémon it first succeeds on and reads every later one straight out of it. PGSharp draws the overlay itself rather
 * than leaving it to Unity, so the box does not move between species, only between devices, which is why it is found
 * rather than configured.
 *
 * By sweeping narrow isolated bands rather than looking for the triple among a whole-screen read, which finds the box
 * on nine of twelve captures from one phone and none at all from another, the text being too low in contrast against
 * the artwork. Each band is read as a line rather than sparsely: the same band holding `L1 IV48 5/2/15` reads as `r '`
 * sparse, sparse mode taking the isolated blocks either side for pictures.
 */
export async function findOverlay(image: Image): Promise<{ box: OverlayBox; overlay: Overlay } | null> {
  const height = Math.round(image.height * OVERLAY_BAND);
  const step = Math.max(1, Math.round(height / 3));
  const width = Math.round(image.width * OVERLAY_SPAN);
  const left = Math.round((image.width - width) / 2);
  const tops: number[] = [];

  for (let top = Math.round(image.height * OVERLAY_FROM); top < image.height * OVERLAY_TO; top += step) {
    tops.push(top);
  }

  // A whole sweep per pass rather than every pass per band, which matters only for the clock: the first pass finds the
  // overlay on all but a handful, and trying them all at every band cost the suite 60% more wall time.
  //
  // Within a pass, a core's worth of bands at a time, `ocr.mts` holding each Tesseract process to one thread. The
  // bands of a batch are still taken top first, so the answer is the one a band-by-band sweep gives.
  for (const treat of OVERLAY_TREATMENTS) {
    for (let at = 0; at < tops.length; at += SWEEP_BATCH) {
      const batch = tops.slice(at, at + SWEEP_BATCH);
      const lines = await Promise.all(batch.map((top) => tripled(treat(crop(image, left, top, width, height)))));

      for (const [i, first] of batch.entries()) {
        if (lines[i] === null) {
          continue;
        }

        // The band below where it matches too, the first band to match being the highest the triple is legible in and
        // so the one holding the least of the text beneath it. A band is three steps tall, so the line is legible in a
        // run of neighbouring bands, and the top of that run reads the IVs and loses the level: on
        // `charizard-gigantamax.png` it holds the claw above the overlay and only the top of the `L20` beside it,
        // which reads as `90`, `L` and `5 80` under the three treatments and offers no 20 at all. One step lower
        // offers 20 among the levels the HP chooses from. Read here only where the batch ends on the match, the band
        // below being in it otherwise.
        const below = first + step;
        const next =
          i + 1 < batch.length ? lines[i + 1] : await tripled(treat(crop(image, left, below, width, height)));
        const top = next === null ? first : below;

        // The band itself, which is already the right shape. Sizing a box from the line instead does not work, because
        // reading a band as one line is what makes its width meaningless — everything comes back as one box, which on
        // one capture spanned 626 pixels against a true 329 and on another sat 250 to the right of the text.
        const found = within({
          x: left / image.width,
          y: top / image.height,
          width: width / image.width,
          height: height / image.height,
        });

        // `tighten` improves on the band where it can, and is checked rather than trusted: it derives the box from the
        // `top` Tesseract reports for a sparse line, which can sit a character-width above the glyphs — 434 against a
        // true 460 on `eevee-background.png` — leaving the box straddling the text.
        //
        // The band is checked the same way, matching `TRIPLE` not being the same as reading an overlay: it admits an
        // IV of 48, which a band holding half a line reads. `readOverlay` is what decides.
        const tightened = await tighten(image, found);

        for (const box of tightened ? [tightened, found] : [found]) {
          const overlay = await readOverlay(image, box);

          if (overlay) {
            return { box, overlay };
          }
        }
      }
    }
  }

  return null;
}

/**
 * A second look at the band the sweep matched, measured from the three IVs alone. A band is a good enough crop to read
 * from — ten of twelve captures on one phone — but a tight box is better at twelve of twelve, a crop being small
 * enough for sparse mode to pick the triple out where it could not in the band.
 *
 * Answers null where the sparse pass finds nothing, which is not a failure: the band already contains the text, and on
 * the second phone this null is the difference between reading the overlay and reading nothing at all.
 */
async function tighten(image: Image, box: OverlayBox): Promise<OverlayBox | null> {
  const region = scale(isolate(cropBox(image, box), OVERLAY_LUMINANCE, OVERLAY_CHROMA), OVERLAY_SCALE);
  const inner = (await ocr(region)).find((l) => TRIPLE.test(l.text));

  if (!inner) {
    return null;
  }

  return boxAround(
    {
      ...inner,
      left: box.x * image.width + inner.left / OVERLAY_SCALE,
      top: box.y * image.height + inner.top / OVERLAY_SCALE,
      width: inner.width / OVERLAY_SCALE,
    },
    image,
  );
}

/**
 * The box around a line the overlay was recognised in, sized from the width of one character rather than the height
 * Tesseract reports: measured over twelve captures the same overlay came back 25, 28, 49 and 54 pixels tall as the row
 * merged with whatever artwork sat beside it, where character width stayed within a pixel of itself throughout.
 *
 * Anchored one character past the three IVs, the part that goes missing always being the left. It reaches further
 * right only because PGSharp appends the form there, and a box holding the whole overlay is the honest thing for
 * `--config` to take and `snap` to print.
 */
function boxAround(line: { left: number; top: number; width: number; text: string }, image: Image): OverlayBox {
  const em = line.width / Math.max(1, line.text.length);
  const anchor = line.left + line.width + em;
  const left = anchor - OVERLAY_CHARACTERS * em;
  const right = anchor + OVERLAY_SUFFIX_CHARACTERS * em;

  return within({
    x: left / image.width,
    y: (line.top - em * 0.7) / image.height,
    width: (right - left) / image.width,
    height: (em * 3) / image.height,
  });
}

/**
 * A box kept inside the screen. `crop` clamps anyway, so this changes no reading — but a box is also what `--config`
 * takes and what `snap` prints for someone to copy, and a thirty-character reach off an em measured on wide digits and
 * slashes comes out past the left edge often enough to be worth not reporting as `x: -0.17`.
 */
function within(box: OverlayBox): OverlayBox {
  const x = Math.max(0, Math.min(1, box.x));
  const y = Math.max(0, Math.min(1, box.y));

  return { x, y, width: Math.min(1 - x, box.width + box.x - x), height: Math.min(1 - y, box.height + box.y - y) };
}

/** The pixels a box covers, reaching `reach` of its width further right. */
function cropBox(image: Image, box: OverlayBox, reach = 0): Image {
  return crop(
    image,
    box.x * image.width,
    box.y * image.height,
    box.width * image.width * (1 + reach),
    box.height * image.height,
  );
}

/** The smallest box covering both, so a box that clipped one Pokémon's line grows rather than flips between them. */
export function widen(a: OverlayBox, b: OverlayBox): OverlayBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);

  return within({
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  });
}

/**
 * The level and the three IVs, read out of a box already found. Isolating the white text and doubling it is what makes
 * this reliable: over twelve captures the IVs came out right in all twelve, where the same screens read whole gave
 * three. The level is a guess by comparison, at ten of twelve — the `IV` label beside it OCRs as a `1` and runs into
 * the digits — so it is offered rather than asserted, and `identify` keeps it only if the HP agrees.
 */
export async function readOverlay(image: Image, box: OverlayBox): Promise<Overlay | null> {
  const raw = cropBox(image, box);

  // Every treatment, keeping the first whose percentage confirms its own triple and falling back on the first that
  // read a possible one. Without that arbitration the order alone decides, and the first pass is wrong about
  // `articuno-galar.png` in a way nothing downstream could notice: `10/4/13` is a perfectly possible triple.
  const possible: { iv: IVs; before: string }[] = [];
  let chosen: { iv: IVs; before: string } | null = null;

  // The text ahead of the triple from every treatment the loop reaches, which is where the level shortlist comes from
  // — so every one of them up to and including the confirmed pass it stops on, that being as far as the loop goes. The
  // triple and the level are separate readings of separate parts of one line, the same argument the bracket below
  // makes, and taking the level from whichever pass won the triple threw away a level another had read plainly:
  // `deoxys-attack.png` reads `20 14/13/14` under the first treatment and `00 9114/13/14` under the third, and it is
  // the third whose percentage confirms its triple.
  //
  // Kept whatever the triple turns out to be, so a treatment whose triple is impossible still offers its level:
  // `burmy-plant.png` reads `L151 44/15/15`, where 44 is no IV and `L151` is the `L15` on the screen with the `IV`
  // label's upright run into it.
  const ahead: string[] = [];

  for (const treat of OVERLAY_TREATMENTS) {
    const text = (await ocrLine(scale(treat(raw), OVERLAY_SCALE), OVERLAY_ALPHABET)) ?? '';
    const triple = tripleIn(text);

    if (!triple) {
      continue;
    }

    ahead.push(text.slice(0, triple.index));

    const [attack, defense, stamina] = triple.slice(1).map(Number) as [number, number, number];

    if ([attack, defense, stamina].some((v) => v > 15)) {
      continue;
    }

    const reading = { iv: { attack, defense, stamina }, before: text.slice(0, triple.index) };
    possible.push(reading);

    if (confirmed(reading.before, reading.iv)) {
      chosen = reading;
      break;
    }
  }

  // Where nothing confirmed itself, the three fields can still be put back together across the passes. The percentage
  // is a checksum over all three, so a triple that each pass gets wrong in a *different* place is one the percentage
  // can recover — and that is `articuno-galar.png`, one of the two captures it answers: near-white reads `10/4/13` and
  // brightness at 180 reads `12/4/ 3`, so the attack is 10 or 12 and the stamina 13 or 3, and of the four combinations
  // only `12/4/13` comes to the `64` that brightness printed beside it.
  //
  // Behind `chosen` rather than beside it, so a pass that read the whole line and checks out is never second-guessed,
  // and only where exactly one combination checks out, two being a guess between them rather than a reading.
  //
  // Then, where the percentage settles nothing, a reading holding every digit the first pass read and more. Near-white
  // clips thin `1`s, so its triple can be another pass's with digits missing — a Skarmory whose overlay reads
  // `11/10/11` came back `1/1/1` — and a triple that has lost digits cannot be told from a real one by looking at it.
  const assembly = chosen ? null : assembled(possible);
  const iv = chosen?.iv ?? assembly ?? fuller(possible) ?? possible[0]?.iv ?? null;

  if (iv === null) {
    return null;
  }

  const suffixIn = async (crop: Image, alphabet: string) =>
    [...((await ocrLine(crop, alphabet))?.matchAll(FORM_SUFFIX) ?? [])].at(-1)?.[1]?.trim() ?? null;

  // Both alphabets always run and a two-digit answer wins, because only one of them could have produced it: the
  // letters alphabet holds no digits, so it says "letter" about Spinda's `(04)` either way. Nothing but Spinda is
  // labelled numerically, so a two-digit read is not a close call to arbitrate.
  //
  // Off the first pass always, and deliberately not off whichever pass the triple came from: the two are separate
  // readings of separate parts of the line. `unown-m.png`'s IVs are only right under brightness and its `(M)` only
  // under near-white, so following the triple would trade one for the other.
  //
  // Under its own thresholds for the same reason — a lower floor and tighter chroma keeps the thin upright of a `[`.
  // Thresholds rather than a vote, because a vote cannot work here: swept over 72 treatments and scales, that
  // capture's bracket reads `N` eighteen times, `T` seven, `[` six and `I` four, and `N` and `I` are both real Unown
  // forms. There is no majority to take; there is only a treatment that is right.
  const shaped = (suffix: string | null) => (suffix !== null && SUFFIX_SHAPE.test(suffix) ? suffix : null);
  const bracket = scale(
    isolate(cropBox(image, box, OVERLAY_SUFFIX_REACH), SUFFIX_LUMINANCE, SUFFIX_CHROMA),
    OVERLAY_SCALE,
  );
  const [lettered, numeric] = await Promise.all([
    suffixIn(bracket, OVERLAY_FORM_ALPHABET).then(shaped),
    suffixIn(bracket, OVERLAY_NUMERIC_ALPHABET).then(shaped),
  ]);

  return {
    // Unioned per text rather than over the texts joined, so that `levelsIn`'s pair spanning two runs stays inside one
    // reading: a digit the first treatment ended on and a digit the third began with were never neighbours on a screen.
    levels: [...new Set(ahead.flatMap(levelsIn))],

    iv,
    checked: chosen !== null || assembly !== null,
    form: numeric !== null && /^\d{2}$/.test(numeric) ? numeric : lettered,
  };
}

/**
 * Every level the digits ahead of the IVs could be: each one and two digit piece of every run of them, which end of a
 * run carries the stray `1` being exactly what cannot be told from the text. Every run rather than the first, because
 * the artwork ahead of the level can add noise too — a band wide enough to find the overlay on one phone is wide
 * enough to read a stray `4` left of it, which as the only candidate would disagree with a perfectly clear HP. Being
 * generous is safe: this is a shortlist for the HP to choose from, not an answer.
 */
function levelsIn(text: string): number[] {
  const levels = new Set<number>();
  const runs = [...text.matchAll(/\d+/g)].map(([digits]) => digits);

  const offer = (piece: string) => {
    const level = Number(piece);

    if (level >= 1 && level <= MAX_LEVEL) {
      levels.add(level);
    }
  };

  for (const digits of runs) {
    for (let at = 0; at < digits.length; at++) {
      for (const length of [1, 2]) {
        const piece = digits.slice(at, at + length);

        if (piece.length === length) {
          offer(piece);
        }
      }
    }
  }

  // And a pair spanning two neighbouring runs, a space Tesseract put between digits not being a boundary the screen
  // drew. `pikachu-witch-hat.png`'s `L27 ɪᴠ51` is read as runs of `2`, `7` and `51`, so `27` was offered by nothing at
  // all and the HP was left choosing between the 26.5 and 27 it admits.
  for (const [i, run] of runs.entries()) {
    const next = runs[i + 1];

    if (next !== undefined) {
      offer((run.at(-1) ?? '') + (next.at(0) ?? ''));
    }
  }

  // And the half a `%` stands for, PGSharp printing 21.5 as `L21½` and nothing else on the line being a percent sign.
  // Offered beside the whole levels above rather than in their place, the shortlist being generous for the reason it
  // always was: which end of the run a stray `1` sits on is no clearer for there being a `½` after it.
  for (const [, digits = ''] of text.matchAll(/(\d+)%/g)) {
    for (const length of [1, 2]) {
      if (digits.length >= length) {
        offer(`${digits.slice(-length)}.5`);
      }
    }
  }

  return [...levels];
}
