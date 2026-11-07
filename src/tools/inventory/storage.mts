/**
 * The walk to Pokémon storage and the search typed into it, which `pnpm inventory` and the Search page share. It runs
 * in Node and in the browser alike, reaching the phone only through a `Device` and the screen only through whichever
 * OCR engine was installed.
 */

import { Device, KEY, typeable } from './adb.mts';
import { type Config, type Point } from './config.mts';
import { CP_LABEL, parseDetail, readLines } from './detail.mts';
import { type GameData } from './game-master.mts';
import { centre, findLine, fold, type Line } from './ocr.mts';
import { luminance, median, rgb, type Image } from './png.mts';
import { isDetail } from './report.mts';
import { SCROLL_STRIP } from './stitch.mts';

/**
 * How many backspaces clear the search box, and **the longest term `unsearchable` will pass** — one number on purpose,
 * the box having no length of its own: all 234 characters of a patterned run landed with no sign of a cap, so what
 * bounds it is what is typed into it.
 *
 * It was 40, shorter than the 50 characters a re-snap sends, so ten survived the clear and the next term was typed
 * onto the end of them. The failure is silent, which is what makes the bound worth enforcing: the field scrolls, so a
 * merged term looks exactly like a clean one and the only symptom is a result count quietly wrong.
 *
 * Generous because generosity is free — `device.key` sends every code in one `input keyevent`, and a backspace on an
 * empty field does nothing. A term typed into the box by hand can still exceed it; clear it by hand too.
 */
export const CLEAR_KEYS = 300;

/**
 * A button only a dialog over a detail screen carries: `CANCEL` on the power-up sheet, `YES` on the evolve prompt. The
 * detail screen itself prints neither as a line of its own, nor does storage.
 */
const DIALOG_BUTTON = /^(cancel|yes)$/;

/**
 * The luminance between a detail screen's white panel and the same panel under a dialog's scrim, as `scrimmed` takes
 * it: measured over every screen committed, the margin's median is 224 or brighter at both heights on each detail
 * screen and storage, scrolled or not, where the scrim the game drew over a Dynamax Sableye
 * (`dialog/sableye-mega-level.png`) brings its foot down to 95 and the map reads 86 at the name's height.
 */
const PANEL_LIT = 160;

/** The median luminance of the panel's margin over the rows from `from` to `to`, as fractions of the screen height. */
function margin(image: Image, from: number, to: number): number {
  const x = Math.round(image.width * SCROLL_STRIP);
  const rows = Array.from({ length: Math.round(image.height * (to - from)) }, (_, row) =>
    luminance(...rgb(image, x, Math.round(image.height * from) + row)),
  );

  return median(rows);
}

/**
 * Whether a dialog's scrim is drawn over a detail screen's panel, which is how a dialog is told whatever its button
 * says: the game's `OK` is white on a pale green pill that OCR reads no line for at all. The margin is the panel's lit
 * at the name's height, which the scrim fades in below, and unlit at the foot, which it covers. The first is what keeps
 * this to a detail screen, the map's margin being as dark there as the scrim is; the second is what a screen with no
 * dialog never is, the margin holding no control to darken it.
 */
const scrimmed = (image: Image) => margin(image, 0.4, 0.5) > PANEL_LIT && margin(image, 0.8, 0.9) < PANEL_LIT;

/**
 * Whether a dialog is open over the screen — what a drag the phone dropped as a tap leaves behind, on whatever control
 * it started over, or one the game raises on its own, such as `New Mega Level available!` — by its button where that
 * reads and by its scrim where it does not. A dialog's own buttons sit where the screen's do — the close button's tap
 * lands on the power-up sheet's CANCEL, and the main menu's tap or a later stray could land on its confirm — so it is
 * asked before the taps at the foot of the screen: `toStorage`'s close and menu taps, and `closeDetail`'s. The scan
 * asks it twice more, on every detail screen it reads and on the screenshot its moves are read from, a dialog hiding
 * what it is drawn over however much of the screen above it read. It is not asked before the swipes between Pokémon,
 * which do nothing over a dialog, nor before the search box's tap or a tile's, which are made on storage, where no
 * detail screen's control can be hit.
 */
export const dialogOpen = (lines: readonly Line[], image: Image) =>
  findLine(lines, DIALOG_BUTTON) !== undefined || scrimmed(image);

/**
 * Why `term` cannot be typed into storage's search box, or null where it can: a character `type` would refuse, or more
 * characters than `CLEAR_KEYS` clears, which would leave the next search typed onto the end of this one.
 *
 * Asked before the phone is driven anywhere, since nothing it answers could change it, and against `typeable` rather
 * than a second copy of it: `type` refusing only once storage is open leaves it there with the keyboard up. The
 * characters are named, the term being one a reader composed rather than typed and so not one they can scan for them.
 */
export function unsearchable(term: string): string | null {
  if (!typeable(term)) {
    const refused = [...new Set(term.replaceAll(' ', ''))].filter((character) => !typeable(character));

    return `has characters the phone cannot be sent: ${refused.join(' ')}`;
  }

  if (term.length > CLEAR_KEYS) {
    return `is ${term.length} characters, more than the ${CLEAR_KEYS} the box can be cleared of`;
  }

  return null;
}

/** Whether a screen is the storage grid, by the tab and the box only it has. */
function isStorage(lines: readonly Line[]): boolean {
  return findLine(lines, /\beggs?\b/) !== undefined || findLine(lines, /^search\b/) !== undefined;
}

/**
 * Whether the main menu is open, by the Pokémon button's label as a line of its own. Whole, because the map can say the
 * word too — a quest reading `Catch 500 Pokémon` sits above the trainer's avatar — and the button beneath that label
 * is, on the map, a patch of ground PGSharp's tap-to-walk takes as somewhere to walk to.
 */
const isMainMenu = (lines: readonly Line[]) => findLine(lines, /^pokemon$/) !== undefined;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Replaces what the focused search box holds with `term`: cleared by `CLEAR_KEYS`, typed unless empty, and entered. */
export async function replaceSearch(device: Device, term: string): Promise<void> {
  await device.key(KEY.MOVE_END, ...Array<number>(CLEAR_KEYS).fill(KEY.DEL));

  if (term) {
    await device.type(term);
  }

  await device.key(KEY.ENTER);
}

/**
 * Getting about storage on the phone: to the grid, a search typed into it, and where the first tile of what it left is.
 *
 * Shared by `scan`, `snap --search` and the Search page rather than written once each, because they have to agree about
 * what a grid is and which tile is its first. A second copy would drift, and the way it would show is a capture pinned
 * off the *second* Pokémon the search matched — a screenshot of the wrong Pokémon looks just like one of the right
 * Pokémon.
 *
 * Taps are sized against a screenshot rather than `Config`, every position in it being a fraction of the screen so that
 * one configuration suits any phone of the same shape. `say` hears whether the game had to be launched, which the CLI
 * prints and the page shows.
 */
export function storage(
  device: Device,
  config: Pick<Config, 'package' | 'user' | 'taps' | 'waits'>,
  data: GameData,
  screen: Image,
  say: (message: string) => void = console.error,
) {
  let searchBox: Point | null = null;
  let fronted: Promise<void> | null = null;

  const at = (p: Point): Point => [p[0] * screen.width, p[1] * screen.height];

  const tap = async (p: Point, wait = config.waits.tap) => {
    await device.tap(p);
    await sleep(wait);
  };

  const swipe = async ([from, to]: [Point, Point], wait: number) => {
    await device.swipe(at(from), at(to));
    await sleep(wait);
  };

  /**
   * Closes a dialog with Back, which every one of them takes as its cancel, rather than with a tap on a button that
   * might be its confirm. Said, since a dialog open means a gesture went astray, and that is worth knowing about.
   */
  const dismiss = async () => {
    say('  a dialog was open; closing it with Back');
    await device.key(KEY.BACK);
    await sleep(config.waits.tap);
  };

  /**
   * Taps a detail screen's close button, having looked first: a dialog open over it is closed with Back instead, and a
   * screen that is not a detail screen is left for `toStorage` to find its own way from rather than tapped blind.
   */
  const closeDetail = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const image = await device.screenshot();
      const lines = await readLines(image);

      if (dialogOpen(lines, image)) {
        await dismiss();
        continue;
      }

      if (isDetail(await parseDetail(lines, data, image))) {
        await tap(at(config.taps.closeDetail));
      }

      return;
    }
  };

  /**
   * The first Pokémon's CP label in a grid, which doubles as how a grid is told from the suggestions panel drawn over
   * it: the panel carries no CP anywhere.
   *
   * A label is one that reads as `CP_LABEL`, or one that ends in a CP-sized number where another line bears it out:
   * one ending in a number at the same height, or one reading as `CP_LABEL` further down. Whichever is higher up. The
   * numbers are for a first row whose `CP`s all misread, which would otherwise leave the first label that does read a
   * row down, and the walk begun from the fourth Pokémon. The sparkles a shiny tile carries against its `CP` read as
   * `on 376`, `£ 546` and `seo` across a row of three shiny Magnemite, where the row beneath read `cP 578`
   * (`storage/sparkles.png`); and as `yor 37`, `7°` and `£ agi` across three shiny Spheal, only one of them ending in a
   * number, where the row beneath read `cp 434` (`storage/spheal.png`, #798).
   *
   * A number alone is not enough, since a nickname can end in one, and so can a search among the Recent suggestions.
   * Two at one height are a row of labels, and the `96%` under each tile ends in its `%` rather than a digit. One above
   * a `CP` label is no nickname of that label's row or any after it, each sitting beneath its own row's labels, and
   * could be one only of a row whose labels all failed, where the first label to read is a row down anyway; nor is it a
   * suggestion, the panel carrying no `CP`. Nor a number after a `/`, which is a count rather than a CP: the tabs'
   * `12800 / 12825` and `12/12` sit at one height too, and nothing keeps them out where no search has found the box
   * yet. The term in the box can end in a number too, `shiny&363`, which the box keeps out: only below it is a tile.
   */
  const tileLabel = (lines: readonly Line[]) => {
    const below = lines.filter((l) => l.top > (searchBox?.[1] ?? 0));
    const numbered = below.filter((l) => /(?<![\d/]\s*)\d{2,5}$/.test(l.text.trim()));
    const labelled = below.filter((l) => fold(l.text).search(CP_LABEL) === 0);
    const level = (a: Line, b: Line) => Math.abs(a.top - b.top) < Math.min(a.height, b.height) / 2;

    return below
      .filter(
        (l) =>
          labelled.includes(l) ||
          (numbered.includes(l) &&
            (numbered.some((n) => n !== l && level(n, l)) || labelled.some((c) => c.top > l.top))),
      )
      .reduce<Line | undefined>((first, l) => (first && first.top <= l.top ? first : l), undefined);
  };

  /**
   * How many Pokémon a search matched, off the game's own counter beside the magnifier in the POKEMON tab — `(1)`, or
   * `(0)` where it found nothing — or null where the counter did not read.
   *
   * This is what separates the two halves `tileLabel` cannot. A grid whose first CP label misread and a search that
   * matched nothing both leave no label, and the counter says which: measured on a shiny Ho-Oh the search matched, the
   * tile read as `2738,` with its `CP` lost entirely while the counter beside it read `(1)`. The label is small grey
   * text over a pale tile where the counter is the header's own, which is why one reads and the other does not.
   *
   * Matched on the raw text rather than the folded, `fold` stripping the brackets that carry the meaning — `(1)` and
   * `6/12` both fold to a bare number. Above the search box for the same reason: a tile's `96%` has no brackets, but a
   * nickname could, where nothing above the box is a Pokémon at all.
   */
  const matches = (lines: readonly Line[]): number | null => {
    for (const line of lines) {
      const counted = /\((\d+)\)/.exec(line.text);

      if (counted && line.top < (searchBox?.[1] ?? Infinity)) {
        return Number(counted[1]);
      }
    }

    return null;
  };

  /**
   * Whether a search matched any Pokémon: the counter `matches` reads where it read, and `tileLabel` in its place only
   * where it did not, a label lost to a shiny tile's sparkles being no sign that the search matched nothing.
   */
  const matched = (lines: readonly Line[]): boolean => {
    const found = matches(lines);

    return found !== 0 && (found !== null || tileLabel(lines) !== undefined);
  };

  /**
   * How many Pokémon storage holds, off the `12800 / 12825` under the POKÉMON tab of a grid nothing was searched for,
   * or null where it did not read. A searched grid has the `(N)` `matches` reads in its place.
   *
   * The EGGS tab beside it carries a count of the same shape, `12 / 12`, which OCR may hand over first or on the same
   * line, so the count taken is the one out of the most room: storage holds at least 300 where an incubator-full of
   * eggs is a dozen.
   */
  const stored = (lines: readonly Line[]): number | null => {
    let best: { held: number; room: number } | null = null;

    for (const line of lines) {
      if (line.top >= (searchBox?.[1] ?? Infinity)) {
        continue;
      }

      for (const [, held, room] of line.text.matchAll(/(\d+)\s*\/\s*(\d+)/g)) {
        const count = { held: Number(held), room: Number(room) };

        if (count.held <= count.room && count.room > (best?.room ?? -1)) {
          best = count;
        }
      }
    }

    return best?.held ?? null;
  };

  /**
   * Launched where it is not already in front, which is the phone's answer to give rather than the user's: a game
   * running and a game showing are different states, and only the second is one `toStorage` can start from. A game in
   * the background still needs the launch to bring it forward — skipping it there taps the launcher instead, three
   * times over, and reports that storage cannot be found. The wait goes with the launch, since thirty seconds is what a
   * cold start costs and a game already drawn is past it; measured, a resume takes the focus back in 676ms.
   *
   * It belongs to `toStorage` rather than to each caller because it is `toStorage`'s own precondition, and a caller is
   * free to forget it: every path that drives storage gets it from here whether its author thought of the backgrounded
   * phone or not. Asked once per run rather than before every search, which is the one `adb` call `scan` spent when it
   * owned this rather than one for each flag.
   *
   * In front means the right copy in front, since a phone with a work profile holds two installs of one package. The
   * user is `config.user` where one was given, and otherwise the one the game in front runs as; only with neither is
   * the phone asked which users have it installed, by `onlyInstall`, a second `adb` call made only by a run that is
   * launching anyway. A game in front for another user than the one named is launched for the named one, which brings
   * that copy forward instead.
   */
  const foreground = async () => {
    const front = await device.focused();
    const user = config.user ?? (front?.package === config.package ? front.user : await onlyInstall());

    if (front?.package === config.package && front.user === user) {
      say('Pokémon GO is already in front');
    } else {
      say(user === 0 ? 'Launching Pokémon GO' : `Launching Pokémon GO for Android user ${user}`);
      await device.launch(config.package, user);
      await sleep(config.waits.launch);
    }
  };

  /**
   * The Android user to launch the game for when nothing says which: the one it is installed for, where that is one.
   *
   * Where it is more than one, the phone has a copy in each profile — a work profile's and the personal profile's,
   * signed in to different trainers — and picking either is a guess that drives an account nobody asked for: launching
   * user 0's, as the scan did, brought up the personal profile's trainer where the game was played from the work
   * profile (#594). Refused, then, rather than guessed, and the game in front answers it from then on: that is the copy
   * being played, which is why it is asked before this is.
   */
  const onlyInstall = async () => {
    const users = await device.installs(config.package);

    if (users.length === 1) {
      return users[0] as number;
    }

    if (users.length === 0) {
      throw new Error(`${config.package} is not installed on the phone`);
    }

    throw new Error(
      `Pokémon GO is installed for Android users ${users.join(' and ')}, a copy in each profile: open the one this ` +
        'account plays so that it is in front, or name its user with --user, and run again',
    );
  };

  /** Gets to the storage grid from wherever the game is: the map, a detail screen, or the grid already. */
  const toStorage = async () => {
    await (fronted ??= foreground());

    for (let attempt = 0; attempt < 3; attempt++) {
      const image = await device.screenshot();
      const lines = await readLines(image);

      if (isStorage(lines)) {
        return lines;
      }

      // Before either tap below, which are both at the foot of the screen where a dialog keeps its buttons.
      if (dialogOpen(lines, image)) {
        await dismiss();
        continue;
      }

      if (isDetail(await parseDetail(lines, data, image))) {
        await tap(at(config.taps.closeDetail));
        continue;
      }

      await tap(at(config.taps.mainMenu), config.waits.menu);

      // Thrown rather than tried again: a menu tap that opened something else — the stop a walking avatar carried under
      // the Poké Ball — leaves a screen nothing here knows the controls of, and every further tap there is a guess.
      if (!isMainMenu(await readLines(await device.screenshot()))) {
        throw new Error('the main menu did not open; open Pokémon storage by hand and run again');
      }

      await tap(at(config.taps.pokemonButton), config.waits.search);
    }

    // Opening it by hand is enough on its own now: storage showing means the game is in front, so the next run reads
    // that off the phone and neither relaunches it nor waits for a cold start it is not doing.
    throw new Error('could not find Pokémon storage; open it by hand and run again');
  };

  /** Types a search into storage's search box, replacing whatever was there, and answers the grid it leaves. */
  const search = async (term: string) => {
    let lines = await toStorage();
    const found = findLine(lines, /\bsearch\b/);
    searchBox ??= found ? centre(found) : at(config.taps.search);
    await tap(searchBox);
    await replaceSearch(device, term);
    await sleep(config.waits.search);
    lines = await readLines(await device.screenshot());

    // Clearing the box uncovers the Recent and Recommended suggestions, and Enter only takes the keyboard away; Back
    // closes them and leaves the unfiltered grid behind. An empty search matches everything, so a grid with nothing in
    // it is that panel and can be nothing else — which is a surer test than the panel's own headings, since PGSharp's
    // toolbar sits down the left edge over their first letters and `Recent` reads as `serccemt` behind it. Getting
    // this wrong is expensive rather than merely unhelpful: `firstTile` then falls back to its blind tap, which lands
    // on the first Recent chip and quietly opens whatever was searched for last.
    if (term === '' && !tileLabel(lines)) {
      await device.key(KEY.BACK);
      await sleep(config.waits.search);
      lines = await readLines(await device.screenshot());

      // A grid whose labels all misread is taken for the panel too, and Back closes storage itself from there.
      if (!isStorage(lines)) {
        lines = await toStorage();
      }
    }

    return lines;
  };

  /**
   * Where the first Pokémon in a grid is, to be tapped.
   *
   * The row comes from the grid and the column from the configuration, which is not a compromise but the right split.
   * How far down the first row sits depends on whether a search is showing, so it has to be read; which column is
   * first does not, since the grid is three even columns and 0.18 of the width lands in the leftmost of them on both
   * phones tried. Taking the column from the label as well would open the *second* Pokémon whenever the first one's CP
   * failed to OCR — in an `xxl` grid of five, the top row's only legible label was the middle tile's, so the walk began
   * one along and marked four. One short is the hardest kind of wrong to notice.
   */
  const firstTile = (grid: readonly Line[]): Point => {
    const label = tileLabel(grid);

    return label ? [at(config.taps.firstTile)[0], label.top + label.height * 2.5] : at(config.taps.firstTile);
  };

  return { at, tap, swipe, dismiss, closeDetail, search, tileLabel, matches, matched, stored, firstTile };
}
