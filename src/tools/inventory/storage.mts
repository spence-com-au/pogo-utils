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
import { type Image } from './png.mts';
import { isDetail } from './report.mts';

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
  config: Pick<Config, 'package' | 'taps' | 'waits'>,
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
   * The first Pokémon's CP label in a grid, which doubles as how a grid is told from the suggestions panel drawn over
   * it: the panel carries no CP anywhere.
   */
  const tileLabel = (lines: readonly Line[]) =>
    lines.find((l) => l.top > (searchBox?.[1] ?? 0) && fold(l.text).search(CP_LABEL) === 0);

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
   */
  const foreground = async () => {
    if ((await device.focused()) === config.package) {
      say('Pokémon GO is already in front');
    } else {
      say('Launching Pokémon GO');
      await device.launch(config.package);
      await sleep(config.waits.launch);
    }
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

      if (isDetail(await parseDetail(lines, data, image))) {
        await tap(at(config.taps.closeDetail));
        continue;
      }

      await tap(at(config.taps.mainMenu), config.waits.menu);
      await tap(at(config.taps.pokemonButton), config.waits.search);
    }

    // Opening it by hand is enough on its own now: storage showing means the game is in front, so the next run reads
    // that off the phone and neither relaunches it nor waits for a cold start it is not doing.
    throw new Error('could not find Pokémon storage; open it by hand and run again');
  };

  /** Types a search into storage's search box, replacing whatever was there, and answers the grid it leaves. */
  const search = async (term: string) => {
    let lines = await toStorage();
    searchBox ??= ((l) => (l ? centre(l) : null))(findLine(lines, /\bsearch\b/)) ?? at(config.taps.search);
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

  return { at, tap, swipe, search, tileLabel, matches, firstTile };
}
