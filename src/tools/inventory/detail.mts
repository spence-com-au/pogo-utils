/**
 * The detail screen's own text, scrolled to the top. Every field is located by what sits beside it rather than by a
 * coordinate, which is what holds across phones of different resolutions.
 *
 * `parseDetail` fills one `Detail` from these text readers and `badges.mts`'s pixel readers. The CP band is re-read
 * under three treatments by `wholeCp` where a label line anchors it and by `cpsIn` where none was found, the CP being
 * white text over artwork as PGSharp's digits are.
 */

import { closest, cpOf, type GameData } from './game-master.mts';
import { fold, ocr, ocrLine, type Line } from './ocr.mts';
import { brighten, crop, isolate, luminance, rgb, scale, type Image } from './png.mts';
import {
  badgeEnd,
  genderOf,
  isFavourite,
  isLucky,
  isLuckyCaption,
  sizeOf,
  tagsOn,
  type Gender,
  type Size,
} from './badges.mts';
import { OVERLAY_CHROMA, OVERLAY_LUMINANCE, TRIPLE } from './overlay.mts';
export interface Detail {
  name: string | null;
  hp: number | null;
  weight: number | null;
  height: number | null;
  types: string[];
  favourite: boolean;

  /** Whether the green `LUCKY POKÉMON` caption is drawn under the name; false where there was no HP to find it by. */
  lucky: boolean;

  /** What OCR made of the CP, which is white over the artwork and read on about half the captures. */
  cp: number | null;

  /**
   * The CPs the screen might be showing, where it showed none for certain: every reading of a label line whose `/`
   * nothing settled, or what the CP region reads where no line carrying the label was recognised at all. Not to be
   * trusted, so never `cp`: it is for narrowing a choice of forms, and only where the arithmetic reproduces one
   * exactly. `readingsOf` and `cpsIn` are where the figures for each live.
   */
  cps: number[];

  /**
   * Null where there was no HP line to find the symbol beside, so nothing looked — which is not `genderunknown`, the
   * answer where it looked and found no symbol.
   */
  gender: Gender | null;

  /** Null for the two ordinary bands in the middle, which wear no badge at all. */
  size: Size | null;

  /**
   * The text of each tag chip under the HP, as read; matching them to the tags that exist is the caller's job. Empty
   * where no chip is drawn, and where the HP or the measurement row the chips sit between was not read.
   */
  tags: string[];

  /**
   * The candy the `EVOLVE` row asks for, which is the game master's `candyCost` for one of the form's branches unless a
   * trade or an event has changed it — the only thing on the screen separating Sinistea's Phony form from its Antique.
   * Null where the screen draws no such row, as for a Pokémon that does not evolve, and where its figure was not read.
   */
  evolveCandy: number | null;

  /**
   * The stardust the `POWER UP` row asks for, which is the game master's cost at the Pokémon's level times whatever
   * being shadow, purified or lucky makes it — the only thing on the plain screen that says which of the first two it
   * is. Null where the screen draws no such row, and where its figure was not read.
   */
  powerUp: number | null;

  /** The Max treatment the row under the measurements names, null where it names none or they were not read. */
  max: Max | null;
}

export type Max = 'dynamax' | 'gigantamax';

/** Everything OCR read off an image: the whole of it, then the top fifth again inverted, where the CP is white. */
export async function readLines(image: Image): Promise<Line[]> {
  const top = Math.round(image.height / 5);
  const [all, sky] = await Promise.all([ocr(image), ocr(crop(image, 0, 0, image.width, top, true))]);

  return [...all, ...sky].sort((a, b) => a.top - b.top || a.left - b.left);
}

/**
 * The small `CP` beside the number is often read with a stray letter after it (`cPe518`), as `GP`, or — the one that
 * cost a capture its whole form — as `ce`: `deoxys-attack.png` reads `ce1441`, digits perfectly right and the `P`
 * taken for an `e`. Both halves of the label are a glyph OCR gets wrong, so both are a pair rather than a letter.
 *
 * It admits 35 captures, 24 reading the CP exactly off the line; `wholeCp` recovers seven more and four are left to
 * the arithmetic. The two go together: the label says which line, the band says the whole number.
 *
 * A number may carry one space, which `cpOn` takes out: the WebAssembly Tesseract the Inventory page reads with answers
 * `cP48 7` off `unown-b.png`, where the CLI's `cP48/` leaves `wholeCp` to find the 487.
 *
 * And it may carry a `/`, which is how the CLI reads the large font's thin 7 more often than not: `cp/56` for a 756,
 * `cp///` for a 777, `cpe4/0` for a 470, and 12 of those 35 label lines carry one. Not always a 7, though — the same
 * CLI reads `cP48/7` off `unown-b.png`'s 487 on a second line, the slash a stroke of nothing. So the `/` is kept,
 * matched against `foldCp` rather than `fold`, and `readingsOf` is what says what it might have been.
 */
export const CP_LABEL = /\b[cg][pe]\s?[a-z]?\s?([\d/]{2,5}(?: \d{1,3})?)(?![\w/])/;

/** `fold`, but keeping the `/` that `CP_LABEL` reads the thin 7 as, where `fold` would make a space of it. */
const foldCp = (text: string) => text.split('/').map(fold).join('/');

/**
 * The line carrying the CP's label, which is what decides whether the CP is read off a line or swept for. Exported so
 * `screens.test.mts` can say which of the two a capture's candidates came from without a second copy of the rule.
 */
export const cpLabelOf = (lines: readonly Line[], image: Image): Line | undefined =>
  lines.find((l) => l.top < image.height / 4 && CP_LABEL.test(foldCp(l.text)));

/**
 * The CP a line carrying `CP_LABEL` states, as its digits alone. The two halves of a number with a space in it are
 * joined only where the whole is no longer than `longest`, the most digits any CP runs to, so a second number OCR set
 * beside the CP is left off it rather than read into a CP no Pokémon has. Null where what is left is still longer than
 * that, spaced or not: `joined` can hang a stray digit off the artwork onto a whole `cp1441`, and a `14417` is no CP.
 *
 * Any `/` is left in the answer, and not counted against `longest`, for `readingsOf` to resolve.
 */
export function cpOn(text: string, longest: number): string | null {
  const read = CP_LABEL.exec(foldCp(text))?.[1];

  if (read === undefined) {
    return null;
  }

  const digits = (cp: string) => cp.replaceAll('/', '').length;
  const joined = read.replace(' ', '');
  const cp = digits(joined) <= longest ? joined : (read.split(' ')[0] ?? '');

  return digits(cp) <= longest ? cp : null;
}

/**
 * Every number a CP read could be, with each `/` in it taken as the 7 it usually is and as the stray stroke it
 * sometimes is, the 7 first. Only what a CP can be is kept — two digits at the least and `longest` at the most — so a
 * read with no `/` is the one reading, and so is one whose other readings are no CP at all: `burmy-trash.png`'s `cpe4/`
 * is 47 because 4 is too short, and `deoxys-normal.png`'s `ce1/772` is 1772 because 17772 is too long.
 *
 * Several readings are a choice OCR cannot make. `maschiff-female.png`'s `cp/56` is 756 on its screen and the band
 * round it reads `56` under every treatment, the 7 lost the way the line lost it; `unown-b.png`'s `cP48/7` is 487, the
 * slash the stray. Nothing on the screen says which a third read will be, so where `wholeCp` does not settle it
 * `parseDetail` offers every reading as a candidate and leaves the choice to the arithmetic. That is four captures of
 * the corpus, three of them offering the CP their screen prints beside a stray and `castform-snowy.png`'s `ce/4 : 7`
 * offering only 747 and 47 for 746. The one place those figures live; `screens.test.mts` pins them capture by capture.
 */
export function readingsOf(read: string, longest: number): string[] {
  const [first = '', ...rest] = read.split('/');
  const all = rest.reduce((heads, part) => heads.flatMap((head) => [`${head}7${part}`, head + part]), [first]);

  return [...new Set(all)].filter((cp) => cp.length >= 2 && cp.length <= longest);
}

/**
 * A CP line with the rest of its number put back, where Tesseract ended the line part way through it and read the
 * remainder as a line of its own. The WebAssembly build the Inventory page reads with does this on
 * `deoxys-defense.png`, `ce15` beside `69` with no gap between them, and the label alone would answer 15 — which
 * `wholeCp` then rescues into a 156 the screen does not print. Joined only where the second line is digits and nothing
 * else, sits on the same row and starts within half a line-height of where the first ends, so a word beside the CP is
 * never read into it. The nearest such line where there are several, the inverted pass `readLines` adds reading the
 * same digits again a few pixels over — `59` beside that `69`.
 */
export function joined(line: Line, lines: readonly Line[]): Line {
  const end = line.left + line.width;
  const [rest] = lines
    .filter(
      (l) =>
        l !== line &&
        /^\d+$/.test(l.text) &&
        Math.abs(l.top - line.top) <= line.height / 2 &&
        Math.abs(l.left - end) <= line.height / 2,
    )
    .sort((a, b) => Math.abs(a.left - end) - Math.abs(b.left - end));

  if (rest === undefined || !/\d$/.test(line.text)) {
    return line;
  }

  const top = Math.min(line.top, rest.top);

  return {
    text: line.text + rest.text,
    left: line.left,
    top,
    width: rest.left + rest.width - line.left,
    height: Math.max(line.top + line.height, rest.top + rest.height) - top,
  };
}

/**
 * The line a name is read off: the nearest above the HP bar. A nickname reads here as readily as a species, and a
 * player can set one that is no words at all. Three letters or two digits, measured rather than guessed: the name sits
 * 117 to 173 pixels above the HP across the corpus, and what sits nearer is the bar's own furniture, read as `os` or
 * `oy` on five captures at a gap of 57 to 62. Two characters of anything admits those and they win for being nearest.
 *
 * Or a `#`, which a nickname can be made of entirely: `lugia-hashes.png` is called `##`, and passing over it took the
 * catch date's `20/06` beside the artwork as the name instead. Tesseract reads a `#` into 505 lines on 368 of 839
 * detail captures, nearly all of them the status bar's icons, but into none within 400 pixels above the HP except that
 * name — so admitting it changes no other capture's name line.
 *
 * And never at or above PGSharp's overlay, which is drawn over the artwork the name sits under. Another frame of the
 * same Lugia read its `##` as `HH`, which none of the above admits, so the nearest line left was the overlay's `L15
 * iw82 13/14/10` and the nickname became `L15 iw82 131410`; leaving that out, the status bar's `10:06` was next. The
 * overlay is found by its IV triple, `findOverlay`'s own signature, rather than by its box, since the scan reads the
 * detail before it has looked for a box and on its first Pokémon has none. Over the 839 captures it changes no name.
 * Where the overlay did not read as a line, which is 88 of them, the search reaches the top of the screen as before.
 */
export function nameLineOf(lines: readonly Line[], hp: Line, labelled?: Line): Line | undefined {
  return underOverlay(lines, hp, labelled)
    .filter((l) => NAME_SHAPE.test(l.text))
    .at(-1);
}

/** What `nameLineOf` takes a line for a name by, and what a line read again on its own has to be too. */
const NAME_SHAPE = /\p{L}{3}|\p{N}{2}|#/u;

/**
 * Every line between PGSharp's overlay and the HP, nearest the HP last, that a name could be. Never a lucky Pokémon's
 * caption, which sits between the name and the HP and so is nearest where it is read: two rows of a live scan were
 * nicknamed `LUCKY POKEMON` for it.
 */
function underOverlay(lines: readonly Line[], hp: Line, labelled?: Line): Line[] {
  const above = lines.filter((l) => l.top + l.height <= hp.top + 4);
  const overlay = above.filter((l) => TRIPLE.test(l.text)).at(-1);

  return above
    .filter((l) => overlay === undefined || l.top >= overlay.top + overlay.height)
    .filter((l) => l !== labelled && !CP_LABEL.test(foldCp(l.text)) && !isLuckyCaption(l.text));
}

/**
 * How far round a line its own read reaches, in the line's height. Tesseract is on the edge between `##` and `HH` on
 * the Lugia that is called it: one frame's box read alone flips between the two at a few pixels' difference in margin,
 * `HH` at 0.05, `##` at 0.1 and 0.15, `HH` again at 0.2. At 0.15, unenlarged or doubled, all four frames of it read
 * `##` under both engines, where no margin reads `tt if` and half a height `HH`. Unenlarged because at 0.1 doubling
 * reads `H##`, and that `NAME_SHAPE` would take.
 */
const NAME_PAD = 0.15;

/**
 * The name where `nameLineOf` found none, off the nearest line under the overlay read again on its own. The
 * whole-screen pass read `lugia-hashes-hh.png`'s `##` as `HH`, which `NAME_SHAPE` turns down, and the same box alone
 * reads `##`. Only that case pays for it, a name line read whole being what nearly every capture has: none of 839
 * detail captures reaches it, and the one that does is this Lugia.
 */
async function nameAgain(image: Image, lines: readonly Line[], hp: Line, labelled?: Line): Promise<string | null> {
  const nearest = underOverlay(lines, hp, labelled).at(-1);

  if (nearest === undefined) {
    return null;
  }

  const pad = Math.round(nearest.height * NAME_PAD);
  const text = await ocrLine(
    crop(image, nearest.left - pad, nearest.top - pad, nearest.width + pad * 2, nearest.height + pad * 2),
  );

  return text !== null && NAME_SHAPE.test(text) ? text : null;
}

/**
 * The name line's text without the best-buddy badge in front of it, which Tesseract reads as a `1` or an `i`:
 * `magikarp-best-buddy.png`, called `96%`, read `1 96%`. So the line is read again from past the badge `badgeEnd` finds.
 */
async function unbadged(image: Image, line: Line): Promise<string> {
  const end = badgeEnd(image, line);

  if (end === null) {
    return line.text;
  }

  const pad = Math.round(line.height * NAME_PAD);
  const text = await ocrLine(
    crop(image, end, line.top - pad, line.left + line.width - end + pad, line.height + pad * 2),
  );

  return text ?? line.text;
}

/** `97 / 97 HP` or `HP 97/97`; the second number is the maximum, which is the one CP and level determine. */
const HP = /(?:hp\s*)?(\d{1,4})\s*\/\s*(\d{1,4})(?:\s*hp)?/i;

const hpLineOf = (lines: readonly Line[]) => lines.find((l) => /hp/i.test(l.text) && HP.test(l.text));
const hpOn = (line: Line | undefined) => (line ? Number(HP.exec(line.text)?.[2]) : null);

/** The lines below the HP, which is what makes a whole `1m` or `12kg` safe to take — see `WEIGHT`. */
const panelOf = (lines: readonly Line[], hpLine: Line | undefined) =>
  hpLine ? lines.filter((l) => l.top > hpLine.top) : [];

/** The number `pattern` captures on `line`, a decimal comma read as a point. */
function numberOn(line: Line | undefined, pattern: RegExp): number | null {
  const value = line ? pattern.exec(line.text)?.[1] : undefined;

  return value === undefined ? null : Number(value.replace(',', '.'));
}

/**
 * The HP, weight and height `lines` read, spelled as a key spells them: `|` between, and blank where one did not read.
 * Off the lines alone, without `parseDetail`'s rescues, for a screen whose lines are in hand for something else — the
 * moves screen, scrolled one step down, still shows all three, and they say whose moves they are.
 */
export function measuresIn(lines: readonly Line[]): string {
  const hpLine = hpLineOf(lines);
  const panel = panelOf(lines, hpLine);
  const on = (pattern: RegExp) =>
    numberOn(
      panel.find((l) => pattern.test(l.text)),
      pattern,
    );

  return [hpOn(hpLine), on(WEIGHT), on(HEIGHT)].join('|');
}

export async function parseDetail(lines: readonly Line[], data: GameData, image: Image): Promise<Detail> {
  const longest = cpDigits(data);
  const labelled = cpLabelOf(lines, image);
  const cpLine = labelled && joined(labelled, lines);
  const read = cpLine ? cpOn(cpLine.text, longest) : null;
  const readings = read === null ? [] : readingsOf(read, longest);
  const whole = cpLine && read !== null ? wholeCp(image, cpLine, read, longest) : null;

  // The `Promise.all` below is what reports a failed band read, but the name reads are awaited first, and a rejection
  // with no handler for as long as they take is one Node exits over. This handler only marks it seen.
  void whole?.catch(() => {});

  const hpLine = hpLineOf(lines);
  const hp = hpOn(hpLine);

  const nameLine = hpLine ? nameLineOf(lines, hpLine, labelled) : undefined;
  const name = nameLine
    ? sanitise(await unbadged(image, nameLine))
    : hpLine
      ? sanitise((await nameAgain(image, lines, hpLine, labelled)) ?? '')
      : null;

  // The name again off its own band, where what the pass found is no species. Taken only where the band itself names
  // one, so it can turn a missed name into the name and never one species into another: `articuno-kanto.png` detects
  // no name line at all and files a fragment of artwork 487 pixels up as a nickname, where `ho-oh.png`'s band reads
  // the green `LUCKY POKEMON` line, which `closest` rejects. Over the corpus three captures reach this, one is rescued
  // and two keep the nickname they have.
  const rescued =
    hpLine && (name === null || closest(name, data.species, (s) => s) === null)
      ? named(image, hpLine, data.species)
      : null;

  const panel = panelOf(lines, hpLine);
  const row = panel.find((l) => measurement(l.text));
  const weightLine = panel.find((l) => WEIGHT.test(l.text));
  const weight = numberOn(weightLine, WEIGHT) ?? (row ? measured(image, row) : null);

  // The size badge sits over the height in particular, so that line is found on its own rather than taken from the row
  // the two share — which is the weight as often as not. Off the row's own end before the whole-screen pass, which
  // reads a Kecleon's unbadged `1.1m` as `1.4m` and loses a badged height altogether, and the badge with it.
  const sized = (async () => {
    const line = (row && (await heightOn(image, row))) ?? panel.find((l) => HEIGHT.test(l.text));

    return { height: numberOn(line, HEIGHT), size: line ? await sizeOf(image, line) : null };
  })();

  // None of these reads waits on another, and `ocr.mts` holds each Tesseract process to one thread so they can run
  // side by side — a screen reaching every rescue is a dozen reads.
  const [cpWhole, nameRescued, weightRead, measures, swept, types, tags, buttons, lucky, max] = await Promise.all([
    whole,
    rescued,
    weight,
    sized,
    cpLine ? [] : cpsIn(image),
    typesOf(lines, row, data, image),
    hpLine && row ? tagsOn(image, hpLine, row) : [],
    row ? buttonsOn(image, row.top + row.height) : null,
    hpLine ? isLucky(image, hpLine) : false,
    row ? maxUnder(image, row) : null,
  ]);

  // One reading is the CP, and several are none of them: a `/` neither the band nor the cap could settle is offered to
  // the arithmetic as candidates, the way the sweep's numbers are, rather than guessed at.
  const settled = cpWhole ?? (readings.length === 1 ? readings[0] : undefined);

  return {
    cp: settled === undefined ? null : Number(settled),
    cps: cpLine ? (settled === undefined ? readings.map(Number) : []) : swept,
    name: nameRescued ?? name,
    hp,
    weight: weightRead,
    height: measures.height,
    types,
    gender: hpLine ? genderOf(image, hpLine) : null,
    favourite: isFavourite(image),
    lucky,
    size: measures.size,
    tags,
    evolveCandy: buttons?.evolveCandy ?? null,
    powerUp: buttons?.powerUp ?? null,
    max,
  };
}

/**
 * Every number the CP region reads where no line carrying the label was found to anchor on. Three Deoxys and Dialga
 * captures are the reason: each states a CP that separates its form from the others sharing its stamina, and each
 * reads nothing the pattern accepts.
 *
 * Unanchored and so unreliable, which is why these are candidates rather than an answer: a candidate is kept only
 * where the arithmetic reproduces it, so a number no form can show narrows nothing. Over the 14 captures that reach it,
 * 11 carry the CP their screen prints — one of them beside a stray — one carries only a wrong `169` for 1679, and two
 * read nothing. The one place those figures live, the callers pointing here; `screens.test.mts` pins them capture by
 * capture, so they fail there rather than going stale.
 */
async function cpsIn(image: Image): Promise<number[]> {
  const band = crop(
    image,
    image.width * CP_SWEEP.x,
    image.height * CP_SWEEP.y,
    image.width * CP_SWEEP.width,
    image.height * CP_SWEEP.height,
  );

  // Every treatment, since plain alone misses what the others read: `castform-rainy.png` answers `C 2` plain and
  // `P832` near-white, `castform-sunny.png` `P99` plain and `P979` brightened. All three are wanted here, so a read
  // that fails is this sweep's failure.
  const texts = await Promise.all(readTreated(band));

  return [...new Set(texts.flatMap((text) => [...text.matchAll(/\d{3,5}/g)].map(([digits]) => Number(digits))))];
}

/**
 * The CP again, out of a band round the line the whole-screen pass found, where that pass lost a digit or two off one
 * end or drew a 7 as a `/`. White over the artwork is the hardest text on the screen. Examples are `/38` for 738, `48/`
 * for 487, `48` for 486 and `1/05` for 1705. A screen whose label line was never found has no line to anchor on and is
 * left to the arithmetic.
 *
 * A line no band can change is not read round at all: one already as long as a CP goes, `rescue` wanting a number
 * longer than the line's and no longer than `longest`, and one with a `/` whose readings are already one, or hold no
 * reading with every `/` a 7 for a band to agree with.
 *
 * The treatments at a pad go together rather than in turn, being three pure functions of the one band, and what is
 * taken is still the first accepted in array order. That gives up stopping early within a pad and buys the latency of
 * a screen read on its own, as `scripts/inventory.mts` reads one. How many cores there are decides whether the three
 * reads run in parallel or queue. The pads stay in turn, 0.35 having to be refused before 0.6 is tried.
 *
 * The corpus suite keeps enough reads in flight to saturate the cores either way, which is the same contention
 * `vitest.config.mjs` raises its timeout for and `ocr.mts` pins `OMP_THREAD_LIMIT=1` against.
 */
async function wholeCp(image: Image, line: Line, read: string, longest: number): Promise<string | null> {
  const readings = readingsOf(read, longest);
  const open = read.includes('/') ? readings.length > 1 && readings.includes(sevens(read)) : read.length < longest;

  if (!open) {
    return null;
  }

  for (const reach of CP_PADS) {
    const pad = Math.round(line.height * reach);
    const across = Math.round(line.height * Math.max(reach, CP_ACROSS));
    const band = crop(image, line.left - across, line.top - pad, line.width + across * 2, line.height + pad * 2);

    // Settled rather than all-or-nothing, then examined in order, which is what keeps a read the answer does not need
    // from failing the capture: a rejection is thrown only where it is reached, and one past the accepted treatment
    // never is. Thrown rather than swallowed because `ocr.mts` rejects for the machine's reasons and resolves for the
    // image's, so a Tesseract missing or killed would otherwise read as a band with nothing on it.
    for (const settled of await Promise.allSettled(readTreated(band))) {
      if (settled.status === 'rejected') {
        throw settled.reason;
      }

      const whole = rescue(settled.value, read, longest);

      if (whole !== null) {
        return whole;
      }
    }
  }

  return null;
}

/**
 * What a treated band's text offers the line's own reading, or null where it offers nothing. Taken only where the
 * band's number **begins or ends with** the line's and is longer, which makes this a rescue rather than a second
 * opinion: it says the band found more of the same number, so a band that misreads outright is turned down for
 * disagreeing. Bounded by a CP's own length, so a `15` is not rescued into a five-digit `15691`.
 *
 * A line with a `/` in it has already said where its digit went, so only the band reading a 7 at every `/` is more of
 * the same number: `growlithe-nickname.png`'s `cpe/38°` is rescued by a band's `738`, and `cp/56` is not by the `56`
 * every band reads off its 756. Any other reading of a `/` — `cP48/7`'s band reading the `487` it is — is left as one
 * of the candidates `parseDetail` offers, where accepting it here would also accept a band that lost the thin 7 the
 * way the line did.
 *
 * Exported because nothing else states what it takes: `screens.test.mts` asserts the CP each capture ends with, which
 * this rule arrives at from any of several band readings. `detail.test.mts` pins the rule itself.
 */
export function rescue(text: string, read: string, longest: number): string | null {
  const more = (digits: string) =>
    read.includes('/')
      ? digits === sevens(read)
      : digits.length > read.length && (digits.startsWith(read) || digits.endsWith(read));

  return text.match(/\d+/g)?.find((digits) => digits.length <= longest && more(digits)) ?? null;
}

/** A CP read with every `/` in it taken as the 7 it usually is. */
const sevens = (read: string) => read.replaceAll('/', '7');

/** Only what a weight or a height is written with; the `g` of `kg` is dropped often enough not to be relied on. */
const MEASURE_ALPHABET = '0123456789.,kgm ';

/** How far above the HP the name band reaches, in the HP line's own heights, and how much of the width it omits. */
const NAME_RISE = 5;
const NAME_INSET = 0.1;
const NAME_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ♀♂.'-";
const MEASURE_WIDTH = 0.38;

/**
 * A weight and a height, with the decimals the game leaves off a whole number: an Audino's `1m`, a Charmander's `12kg`.
 * Taken only from lines below the HP, since a bare `\d\s*(kg|m)` is not safe over the whole screen: the status bar's
 * `09:00` reads as `0900 M © Os` and PGSharp's overlay offers a `53 m`. Both sit above the panel, and either taken for
 * the height puts the size band off the top of the screen and reports no badge over a gold `XXL`.
 *
 * Separate because the two are read as separate lines at the same height — `0.97kg` at x 131 and `0.15m` at x 759 — so
 * a caller wanting one cannot take it from whichever the row happened to be.
 */
const WEIGHT = /(\d+(?:[.,]\d+)?)\s*kg\b/i;
export const HEIGHT = /(\d+(?:[.,]\d+)?)\s*m\b/i;

/**
 * The Max treatment the row under the measurements names, read off a band of its own: the whole-screen pass drops it
 * from a plain screen as often as not, reading the Gigantamax Gengar's off its stitch and nothing off the screen
 * alone. Its top sits a fixed fraction of the screen's width below the measurements' top — 196 pixels on the
 * 1008-wide `chansey-dynamax.png`, 279 on the 1440-wide `gengar-gigantamax.png` — and a Pokémon with no such row has
 * its stardust there, which reads as no treatment at all.
 */
async function maxUnder(image: Image, row: Line): Promise<Max | null> {
  const { width } = image;
  const band = crop(image, width * 0.1, row.top + width * MAX_BAND.from, width * 0.8, width * MAX_BAND.height);
  const word = MAX.exec((await ocrLine(band, MAX_ALPHABET)) ?? '')?.[1];

  return word ? (word.toLowerCase() as Max) : null;
}

/** The band `maxUnder` reads, in fractions of the screen's width below the measurements' top. */
const MAX_BAND = { from: 0.14, height: 0.11 };

const MAX_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ';
const MAX = /\b(dynamax|gigantamax)\b/i;

export const measurement = (text: string) => WEIGHT.test(text) || HEIGHT.test(text);

/**
 * What a name may be made of after OCR. `%`, `*` and `#` are here because a nickname can be made of them, and stripping
 * them left `96` for `96%`, `Steve` for `** Steve` and nothing at all for `##`; the gender signs because two species'
 * own names carry one. Tesseract does read a `*` out of sparkles and icons, but not on the line a name is taken from:
 * over 770 detail captures it reads one into 124 other lines on 95 of them, and into no name line but
 * `budew-asterisks.png`'s. A `#` is the same, measured where the name line is chosen.
 */
const sanitise = (text: string) => text.replace(/[^\p{L}\p{N} .'%*#♀♂:-]/gu, '').trim() || null;

/**
 * The name read off the band between the artwork and the HP bar, answered only where it is a species' name, which is
 * what makes it safe to prefer over the whole-screen pass. Measured in the HP's own height rather than a fraction of
 * the screen, since that is what holds across phones: the name sits 117 to 173 pixels above an HP line Tesseract
 * reports as 37 to 45 tall, so five of those covers it.
 */
async function named(image: Image, hp: Line, species: readonly string[]): Promise<string | null> {
  const band = crop(
    image,
    image.width * NAME_INSET,
    hp.top - hp.height * NAME_RISE,
    image.width * (1 - NAME_INSET * 2),
    hp.height * NAME_RISE,
  );
  const text = sanitise((await ocrLine(scale(band, 2), NAME_ALPHABET)) ?? '');

  return text !== null && closest(text, species, (s) => s) !== null ? text : null;
}

/**
 * The weight read off its own end of the row, for when the whole-screen pass missed it. The number rather than the
 * unit, the unit being the part that goes: a Cyndaquil's `5.42kg` came back `5.42k`. A decimal point is what makes a
 * bare number safe to take where stray artwork digits are not, so a whole weight is left to the pass.
 */
async function measured(image: Image, row: Line): Promise<number | null> {
  const band = crop(image, 0, row.top - row.height * 0.25, image.width * MEASURE_WIDTH, row.height * 1.5);
  const text = (await ocrLine(scale(band, 2), MEASURE_ALPHABET)) ?? '';
  const value = /(\d+[.,]\d+)/.exec(text)?.[1];

  return value === undefined ? null : Number(value.replace(',', '.'));
}

/**
 * The height's line read sparse off the row's right-hand end, in the screen's own coordinates so the size badge can be
 * found above it. Cropped and doubled, which reads what the whole-screen pass does not: a Kecleon's `1.1m` that pass
 * calls `1.4m`, and the `0.75m`, `0.48m` and `0.13m` under an `XL` or `XS` badge whose tail runs into the digits, where
 * it finds no height at all. Sparse rather than as one line, which reads those three as `075m`, `048m` and `013m`.
 *
 * Topped by the row rather than by the box, which takes in that tail: `0.75m`'s reaches the top of the band, 64 tall
 * where an unbadged height is 47, and a size band ending there cut the pill short and read its `XL` as `XXL`.
 */
async function heightOn(image: Image, row: Line): Promise<Line | undefined> {
  const left = Math.floor(image.width * (1 - MEASURE_WIDTH));
  const top = Math.max(0, Math.floor(row.top - row.height * 0.25));
  const band = crop(image, left, top, image.width * MEASURE_WIDTH, row.height * 1.5);
  const line = (await ocr(scale(band, 2))).find((l) => HEIGHT.test(l.text));

  return (
    line && {
      ...line,
      left: left + line.left / 2,
      top: row.top,
      width: line.width / 2,
      height: top + (line.top + line.height) / 2 - row.top,
    }
  );
}

/** Only letters and the slash between two types; the row also holds `WEIGHT` and `HEIGHT`, which are letters too. */
const TYPE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ/ ';

/** How much taller than the other one a measurement box may be before it has taken in something besides its digits. */
const ANCHOR_RATIO = 1.4;

/**
 * The types, read off the row of labels under the weight rather than out of the whole-screen pass. That row is small
 * grey capitals and the sparse pass mangles it, measuring **6 of 25** on real screens; found by the weight and read on
 * its own at double size it measured **24 of 25**, and recovers the second type where the pass had been reporting
 * `ice` for a Pokémon that is `Ice / Flying`.
 *
 * Worth more than one column: the types are what narrow a species' candidates to a form.
 */
async function typesOf(lines: readonly Line[], row: Line | undefined, data: GameData, image: Image): Promise<string[]> {
  const names = new Map(data.types.map((t) => [fold(t), t]));

  // Matched across whatever spaces Tesseract put inside a name, but only where it begins at a word boundary. An exact
  // word match loses a name the reader split, as `IT POISO N` is; the boundary is what keeps this from being a free
  // substring search, `WEIGH TICE` otherwise inventing an `ice`. No type name prefixes another, so the first that fits
  // a given start is the only one that can.
  const found = (text: string) => {
    const words = fold(text).split(' ').filter(Boolean);

    return words.flatMap((_, i) => {
      const rest = words.slice(i).join('');
      const key = [...names.keys()].find((k) => rest.startsWith(k));

      return key === undefined ? [] : [names.get(key) as string];
    });
  };

  // The whole-screen pass's reading: a line made of type names and nothing else, which is what keeps `WEIGHT` from
  // lending it a letter the way the band's looser match is guarded against.
  const line = lines.find((l) => {
    const words = fold(l.text).split(' ').filter(Boolean);

    return words.length > 0 && words.length <= 2 && words.every((w) => names.has(w));
  });
  const pass = line ? found(line.text) : [];

  // The row is either of the pair, since the weight and the height sit on one row and the labels on the row beneath it —
  // and taking only the weight lost a Cyndaquil whose `0.44m` read perfectly and whose `kg` did not.
  if (row) {
    // Generous, because the band is measured in the anchor's own height and the two anchors disagree: `0.44m` came
    // back 45 tall where `5.42kg` beside it came back 58, and a band sized off the shorter ended six pixels into the
    // labels and lost a Cyndaquil's `FIRE`. The alphabet keeps the digits above out of it.
    //
    // But no taller than the other anchor allows, since a box can take in more than its digits. Over 64 screens reading
    // both, the corpus's and four more Gengars from one scan, the weight came back 1.21–1.30 times the height, its `g`
    // hanging below the line; a fifth Gengar's came back `xt 28.63kg`, PGSharp's gear glued on from the toolbar at the
    // left edge, 106 tall against its `1.13m`'s 45. A band twice that ran past the divider into the `Gigantamax`
    // heading below and read nothing at all.
    const level = lines.filter(
      (l) => measurement(l.text) && l.top < row.top + row.height && row.top < l.top + l.height,
    );
    const tall = Math.min(row.height, ...level.map((l) => l.height * ANCHOR_RATIO));
    const band = crop(image, image.width * 0.25, row.top + tall * 0.8, image.width * 0.5, tall * 2);
    const read = found((await ocrLine(scale(band, 2), TYPE_ALPHABET)) ?? '');

    // Unless the pass read the band's types and another besides. The band can take the slash for a letter and glue it
    // to the second name: `frigibax.png`'s comes back `T DRAGON TICE`, which the word boundary rightly refuses as
    // `ice`, losing a type the pass had read whole as `DRAGON / ICE`.
    const more = pass.length > read.length && read.every((t) => pass.includes(t));

    if (read.length > 0 && !more) {
      return read;
    }
  }

  // Where neither was read there is nothing to find the row by, so the whole-screen pass is all there is.
  return pass;
}

/**
 * What the rows of buttons from row `from` down ask for, which on the plain screen is the measurement row's foot: the
 * candy the `EVOLVE` row does, and the stardust the `POWER UP` row does. The whole-screen pass is no use for finding
 * either: white capitals on a green pill, it reads `EVOLVE` on 2 of the 40 detail screens a Pixel 4 XL scan kept, and
 * the figure beside it as `S50` or `225`, the candy icon taken for a digit. So the rows are found by their pills, each
 * pill's label is read on its own, and the figure is cut out of the row by its columns of ink before it is read.
 *
 * Every button row is a pill, `PURIFY` and `NEW ATTACK` as much as `EVOLVE`, which is why the label is read: the rows
 * move with what the panel holds above them, a mega energy count pushing them 185 pixels down on a Pixel 4 XL, and a
 * shadow's `PURIFY` comes ahead of its `POWER UP`. The candy is the rightmost number in its row, whether an item, a
 * trade or a time of day is asked for beside it, and the first `EVOLVE` row whose figure reads is the answer, a species
 * with a branch per item drawing one row per branch. The stardust is the first number in its row, past its icon.
 */
export async function buttonsOn(
  image: Image,
  from: number,
): Promise<{ evolveCandy: number | null; powerUp: number | null }> {
  const found = pills(image, from);
  const labels = await Promise.all(
    found.map((pill) => {
      const label = crop(image, image.width * PILL.left, pill.top, image.width * PILL.width, pill.height);

      return ocrLine(scale(isolate(label, LABEL_WHITE.luminance, LABEL_WHITE.chroma), 2), LABEL_ALPHABET);
    }),
  );
  const labelled = (name: string) => found.filter((_, i) => closest(labels[i] ?? '', [name], (s) => s) !== null);

  let evolveCandy: number | null = null;

  for (const pill of labelled('EVOLVE')) {
    evolveCandy = await figureOn(image, pill, false);

    if (evolveCandy !== null) {
      break;
    }
  }

  const [power] = labelled('POWER UP');

  return { evolveCandy, powerUp: power ? await figureOn(image, power, true) : null };
}

/**
 * The stardust the `POWER UP` row asks for, found anywhere on `image`: a screen scrolled down, or a whole stitch, for
 * the Pokémon whose plain screen ends above the row. Necrozma's fusion panel — artwork, a paragraph and two `FUSE` rows
 * — is one, leaving `POWER UP` some 700 pixels below the foot of a Pixel 4 XL's screen, so `buttonsOn` reads no figure
 * there and `shadowOf` cannot say it is neither shadow nor purified. Searched from the top rather than below the
 * measurement row, which a screen scrolled down no longer shows; each pill's label is what keeps the `FUSE` rows out.
 */
export async function powerUpOn(image: Image): Promise<number | null> {
  return (await buttonsOn(image, 0)).powerUp;
}

/** The figure `figureIn` finds in a row, read; null where none is found or what is read is no number. */
async function figureOn(image: Image, pill: Pill, first: boolean): Promise<number | null> {
  const span = figureIn(image, pill, first);

  if (span === null) {
    return null;
  }

  // Cropped to the middle of the pill the ink was measured in, and no further either side than a gap could be: a
  // wider band takes in an edge of the candy icon, which reads as a leading digit, and a taller one the floating menu
  // button's rim where the row sits low enough to reach it — `30` for a `50` with the rim in the corner.
  const margin = pill.height * FIGURE_GAP;
  const band = crop(
    image,
    span.left - margin,
    pill.top + pill.height * INK_BAND.from,
    span.right - span.left + margin * 2,
    pill.height * (INK_BAND.to - INK_BAND.from),
  );
  const digits = ((await ocrLine(scale(band, 2), '0123456789,')) ?? '').replaceAll(',', '');

  return /^\d+$/.test(digits) ? Number(digits) : null;
}

/** A button row's pill, in the screen's rows. */
export interface Pill {
  top: number;
  height: number;
}

/**
 * Every button pill below `from`, found down a column through the pills' rounded left ends: the card behind them is
 * white and every pill is not, green as `EVOLVE` is, pink where an item or a time of day is wanted and grey where the
 * candy is short. Kept by height, measured in the screen's width as the layout is: 0.086 to 0.088 of it on a 1008 phone
 * and a 1440 one alike, and 0.080 where the screen's foot cuts one off, where the nearest other run down the column is
 * a move's type icon at 0.049 and a stray on `charizard-gigantamax.png` at 0.067. A run let through costs one read of
 * a label that is not `EVOLVE`, nothing more.
 */
export function pills(image: Image, from: number): Pill[] {
  const x = image.width * PILL.column;
  const found: Pill[] = [];
  let top: number | null = null;

  for (let y = Math.max(0, Math.round(from)); y <= image.height; y++) {
    const inked = y < image.height && luminance(...rgb(image, x, y)) < CARD_LUMINANCE;

    if (inked && top === null) {
      top = y;
    } else if (!inked && top !== null) {
      const height = y - top;

      if (height >= image.width * PILL.shortest && height <= image.width * PILL.tallest) {
        found.push({ top, height });
      }

      top = null;
    }
  }

  return found;
}

/**
 * Where the row's rightmost number lies across the screen, or null where nothing in the row reads as a number. Each
 * column of the panel is ink or not by whether any pixel in the middle of the row parts from the panel's own colour
 * — sampled from the row, so a pink or a grey panel and red digits read as readily as the ordinary ones — and runs of
 * ink columns are glyphs.
 *
 * A digit is narrow, at most 0.24 of the pill's height on either phone, where every icon beside it is not: a candy is
 * 0.44 to 0.48, the menu button over the lowest rows 0.83. So the number is the rightmost run of narrow glyphs, stopped
 * at a wide one and at a gap of `FIGURE_GAP` or more — the gaps inside a figure, its comma's included, are 0.05 of the
 * height at most, and the one between a candy icon and its figure 0.12 at least. The gap is for a pale candy, whose
 * stripes alone are ink: the white one on a Pixel 4 XL breaks into glyphs of which the widest is 0.32, near enough to a
 * digit not to rely on width alone.
 *
 * `first` asks instead for the leftmost number, which in a `POWER UP` row is the stardust ahead of the candy. The
 * stardust icon before it is a narrow glyph standing a gap apart, so a number is taken only where it is at least as
 * many glyphs as a power-up's cost can be.
 */
export function figureIn(image: Image, pill: Pill, first = false): { left: number; right: number } | null {
  const from = Math.round(image.width * PANEL.from);
  const to = Math.round(image.width * PANEL.to);
  const panel = rgb(image, from, pill.top + pill.height / 2);
  const top = Math.round(pill.top + pill.height * INK_BAND.from);
  const bottom = Math.round(pill.top + pill.height * INK_BAND.to);
  const glyphs: { left: number; right: number }[] = [];

  for (let x = from; x <= to; x++) {
    let inked = false;

    for (let y = top; y < bottom && !inked; y++) {
      inked = rgb(image, x, y).some((c, i) => Math.abs(c - (panel[i] ?? 0)) > INK_CONTRAST);
    }

    const last = glyphs.at(-1);

    if (inked && last?.right === x) {
      last.right = x + 1;
    } else if (inked) {
      glyphs.push({ left: x, right: x + 1 });
    }
  }

  const narrow = (g: { left: number; right: number }) => g.right - g.left <= pill.height * DIGIT_WIDTH;

  // The runs of narrow glyphs, each ended by a wide one or a gap.
  const runs: { left: number; right: number; glyphs: number }[] = [];
  let open = false;

  for (const glyph of glyphs) {
    const run = runs.at(-1);

    if (!narrow(glyph)) {
      open = false;
    } else if (open && run && glyph.left - run.right < pill.height * FIGURE_GAP) {
      run.right = glyph.right;
      run.glyphs++;
    } else {
      runs.push({ ...glyph, glyphs: 1 });
      open = true;
    }
  }

  const run = first ? runs.find((r) => r.glyphs >= SHORTEST_COST) : runs.at(-1);

  return run ? { left: run.left, right: run.right } : null;
}

/**
 * Where the pills sit across the screen, in its width: the column they are found down, just inside the rounded end at
 * 0.069; where the label is read, the whole pill to its end at 0.470; and the heights a pill runs to, round the 0.080
 * to 0.088 `pills` measures.
 */
const PILL = { column: 0.09, left: 0.07, width: 0.4, shortest: 0.07, tallest: 0.1 };

/**
 * What the card behind the pills is brighter than: it is 255, a green pill 201 to 203, a grey 215, and a pink 214 where
 * a time of day is wanted and 154 where `applin.png` wants an apple.
 */
const CARD_LUMINANCE = 235;

/** The panel beside a pill, from just past the pill's end at 0.470 to just short of the panel's own at 0.930. */
const PANEL = { from: 0.49, to: 0.92 };

/** The rows of a pill a figure's ink is looked for in, being the middle of it: the digits are centred. */
const INK_BAND = { from: 0.2, to: 0.8 };

/** How far a channel has to part from the panel's colour for the pixel to be ink. */
const INK_CONTRAST = 60;

/** The widest a digit is, in its pill's height. */
const DIGIT_WIDTH = 0.3;

/** The fewest glyphs a power-up's stardust is drawn in, the cheapest being a lucky Pokémon's 100 at level 1. */
const SHORTEST_COST = 3;

/** The narrowest gap that ends a figure, in its pill's height, between the 0.05 inside one and an icon's 0.12. */
const FIGURE_GAP = 0.08;

/** The label's white, kept apart from the pill it is drawn on, the brightest of which is the grey at 215. */
const LABEL_WHITE = { luminance: 240, chroma: 30 };

const LABEL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ ';

const CP_ALPHABET = 'CP0123456789 ';

/** How many digits the highest CP any form can show runs to: perfect IVs at the highest level there is. */
export const cpDigits = (data: GameData) => {
  const [, top = 0] = data.cpm.at(-1) ?? [];
  const best = { attack: 15, defense: 15, stamina: 15 };

  return String(Math.max(...data.forms.map((form) => cpOf(form, best, top)))).length;
};

/**
 * Where the CP sits when no line carrying its label was recognised — the one place here with no anchor to measure
 * from, what would anchor it being the label the pass failed to read. Inside the top fifth `readLines` already inverts
 * for this text, and the numbers come from where the label-bearing lines are found on the captures that do read one:
 * top 123 and 127 of 2244, against a band spanning 0.055 to 0.09.
 */
const CP_SWEEP = { x: 0.3, y: 0.055, width: 0.4, height: 0.035 };

/**
 * How far round the line the CP band reaches, in that line's own heights, in the order to try. 0.35 reads most
 * rescues, and 0.6 earns `meowth-galar.png`: its `cpe5/1` band reads `51` under every treatment at 0.35 and `571` plain
 * at 0.6, which without it would be left to the arithmetic as 571 or 51. By the floor standard `overlay.mts` sets that
 * is one capture legible at 0.6 and illegible at 0.35, and so the pad's whole case.
 */
const CP_PADS = [0.35, 0.6];

/**
 * How far either side of the line the CP band reaches at the least, in that line's own heights, whatever `CP_PADS` is
 * reaching above and below it. The digit a line loses is lost off one end of it, so the band has to reach across that
 * digit: `unown-question.png`'s line reads `cp48` and stops at the left edge of the `6`, so at a reach of 0.35 the band
 * holds none of it, and at 0.6 it holds half — which near-white reads as `64`, rescuing `4864` for the 486 on its
 * screen. At 0.5 the band at 0.35 reads `P486` plain, and is accepted before 0.6 is reached.
 *
 * A floor rather than a pad of its own, so 0.6 reaches across exactly as it always did and only 0.35 is widened. That
 * is measured rather than tidy: at a whole line height across both pads `smoliv.png`, whose `340` is whole on its line,
 * reads `P3400` at 0.6 and is rescued into a CP it does not have. So this is a fit to one capture with a failure on
 * either side, the same kind `CP_BRIGHTNESS` is, and the CP map in `screens.test.mts` is what would fail.
 */
const CP_ACROSS = 0.5;

/**
 * The ways to turn the CP band into something readable, in the order to try. None wins outright, and what bounds the
 * risk of trying each is `wholeCp`'s acceptance rule — which turns down a *different* number, not a longer wrong one:
 * `unown-question.png`'s `4864` was exactly that, and was taken until `CP_ACROSS` let 0.35 read its `486` first.
 *
 * `readTreated` is the one reader, for `wholeCp` and `cpsIn` alike, so a treatment added or reordered answers to both.
 * Both the order and that rule are `wholeCp`'s: `cpsIn` unions what the three read, so what bounds a wrong number
 * there is `identify` refusing a candidate the arithmetic cannot reproduce.
 *
 * Brightness is here for `growlithe-nickname.png`, which neither of the others reaches: at pad 0.35 its band reads `38`
 * plain and near-white and `738` brightened. `castform-sunny.png` is the same at 0.35, `99` against a brightened
 * `CP979`. Where two treatments accept at one pad they accept the same number, so the order picks nothing the corpus
 * can show. Going last is no protection for a line already read right either: a pass reading that number back is the
 * same length, so the rule turns it down and the loop carries on. What bounds the noise is the four-digit cap, which
 * `wholeCp` applies before any band is read.
 *
 * What `cpsIn` has neither of is the guard that skips a band and the acceptance that ends a pad, so it reads all three
 * treatments on every capture it sweeps.
 */
const CP_TREATMENTS = [
  (band: Image) => band,
  (band: Image) => isolate(band, OVERLAY_LUMINANCE, OVERLAY_CHROMA),
  (band: Image) => brighten(band, CP_BRIGHTNESS),
];

/**
 * A CP band read under every treatment, in `CP_TREATMENTS` order and all three already in flight. The one place that
 * says how a band becomes text, both callers wanting the same scale and alphabet of it and neither gaining anything by
 * reading in turn: the treatments are pure functions of the one band and their readings are independent.
 *
 * The reads rather than their texts, because what a failed read means is the caller's to decide — `cpsIn` wants all
 * three and takes a rejection as its own, where `wholeCp` stops at the treatment it accepts and never looks past it.
 */
const readTreated = (band: Image): Promise<string>[] =>
  CP_TREATMENTS.map(async (treat) => (await ocrLine(scale(treat(band), 2), CP_ALPHABET)) ?? '');

/**
 * How bright a channel has to be for the CP band's brightening to keep it. `brighten` keeps a pixel where a channel
 * reaches the floor, so raising the floor keeps strictly less: ink on `growlithe-nickname.png`'s band falls from 14.8%
 * at 100 to 9.6% at 200, and what 180 and 200 lose is the `7` itself, its strokes falling under the floor.
 *
 * 120 is not the middle of a window. Swept in fives over that band the digit comes back at 100, 105, 110, 120, 125 and
 * 130 and is lost at 115 and from 135 up — a jagged region with a failure five units below the value chosen, which is a
 * fit to OCR's noise rather than to the artwork. A Tesseract bump or a retaken capture can flip the single read this
 * treatment exists for, and the CP map in `screens.test.mts` is what would fail.
 *
 * Its own number rather than `overlay.mts`'s private `OVERLAY_BRIGHTNESS`, also 120, which is set low enough to hold
 * the overlay's colour-coded IV percentage — a glyph this band has none of, where this floor answers to the artwork.
 */
const CP_BRIGHTNESS = 120;
