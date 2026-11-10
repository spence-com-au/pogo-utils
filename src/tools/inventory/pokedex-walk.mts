/**
 * The walk through the game's Pokédex that `pnpm inventory dex` takes, entry by entry, and the check of what it read
 * against the counts the game prints. It runs in Node and in the browser alike, reaching the phone only through a
 * `Device` and a drag the caller makes, and the screen only through `pokedex.mts`.
 *
 * **One line a species**, and only for a species the walk reaches. A swipe from an entry skips every species not yet
 * seen — 0532 Timburr goes straight to 0534 Conkeldurr past an unseen Gurdurr — so there is no entry for one to be read
 * off, and a species with no line is one the game has never shown or does not have.
 *
 * **A form is read by selecting it.** The CAUGHT tab shows the categories of whichever form is selected, so each form
 * is tapped in turn and its tab read down to its foot. Getting back up to the form row is a swipe to the next entry
 * and back again, which reopens the entry at its top: dragging the entry down past its top closes it instead. A form
 * that is not registered cannot be selected — a tap on Paldean Tauros's silhouetted Combat Breed leaves the base form
 * showing — so its tile is all that says anything about it, and what it says is that it is not caught.
 */

import { KEY, type Device } from '../../core/adb.mts';
import { type Config, type Point } from './config.mts';
import { readLines } from './detail.mts';
import { type Form, type GameData } from '../../core/game-master.mts';
import { centre, fold, ocr, type Line } from '../../core/ocr.mts';
import { difference, type Image } from '../../core/png.mts';
import {
  alertOf,
  caughtFrame,
  caughtOn,
  CATEGORIES,
  costumeHeadingOf,
  costumesOn,
  countsOn,
  dexOn,
  formFrame,
  formLabelled,
  formsOn,
  framed,
  gendersOn,
  iconIn,
  isEntry,
  labelsOf,
  listLines,
  lookOf,
  namedFrom,
  pokedexLines,
  ranked,
  regionIn,
  regionsButtonOf,
  seeAllOf,
  titleOf,
  UNIDENTIFIED,
  type Box,
  type Candidate,
  type Category,
  type FormTile,
  type Genders,
  type Look,
  type Named,
} from './pokedex.mts';
import { SCROLL_DRAG_MS, settled } from './scroll.mts';
import { SCROLL_STRIP } from './stitch.mts';
import { dialogOpen, isMainMenu, toFront } from './storage.mts';
import { GENERATIONS, SUB_REGIONS } from '../../pokemon/generations.ts';

/** One of an entry's forms: which it is, whether it is caught, and each category its CAUGHT tab draws a tile for. */
export type FormEntry = { form: Named; caught: boolean } & Partial<Record<Category, boolean>>;

/**
 * One species, as `pnpm inventory dex` writes it: its forms in the order the game draws them, its genders, and the
 * costumes it has registered by name. A category is a key only where the game draws its tile, `false` meaning the tile
 * is there and not registered; `caught` is the species', any form of it caught.
 */
export interface Entry {
  dex: number;
  species: string;
  caught: boolean;
  genders: Genders;
  forms: FormEntry[];
  costumes: Named[];
  notes: string[];
}

/** Everything the walk reaches the phone and the game's icons through. */
export interface Walking {
  device: Device;
  config: Pick<Config, 'package' | 'user' | 'taps' | 'swipes' | 'waits'>;
  data: GameData;

  /** A game icon by its file name, as `pogo_assets` names it. */
  icon: (file: string) => Promise<Image>;

  /** A drag from one point to another over `ms`, as fractions of the screen: the touchscreen's, where there is one. */
  drag: (from: Point, to: Point, ms: number) => Promise<void>;

  /** Hands over every screenshot read, named for the species and form, for `--keep-screens`. */
  keep: (name: string, image: Image) => void;
  say: (message: string) => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** How many screenshots of one form's CAUGHT tab a read may take before its foot is given up on. */
const FRAMES = 12;

/**
 * How long a drag down the grid takes, in milliseconds. The grid flings where an entry does not: dragged 0.32 of the
 * height in a second it went on 14 rows past, and 0.15 in a second and a half it moved the one row the finger did.
 */
const GRID_DRAG_MS = 2000;

/**
 * How much of an entry has to change across a swipe for it to have moved, as `difference` measures it below the model.
 * An entry left where it was still changes by as much as 0.155, the light bands of its backdrop sweeping across it;
 * scrolled or swiped to another, half of it does.
 */
const MOVED = 0.3;

/** One screenshot of the walk's, and its text. */
interface Shot {
  image: Image;
  lines: Line[];
}

const shoot = async (device: Device): Promise<Shot> => {
  const image = await settled(device);

  return { image, lines: await pokedexLines(image) };
};

/** The tabs along the foot of the region list, in the game's order, and which of an entry's tiles each counts. */
export const TABS: readonly { label: string; counts: (entry: Entry) => boolean }[] = [
  { label: 'POKÉMON', counts: (e) => e.caught },
  ...(['shiny', 'lucky', 'xxl', 'xxs', 'gmax'] as const).map((key) => ({ label: CATEGORIES[key], counts: has(key) })),
  { label: 'MEGA', counts: (e: Entry) => has('mega')(e) || has('megaX')(e) || has('megaY')(e) },
  ...(['shadow', 'purified', 'perfect'] as const).map((key) => ({ label: CATEGORIES[key], counts: has(key) })),
];

/** Whether any form of an entry has `key` registered, which is what fills the species' tile in that tab. */
function has(key: Category) {
  return (entry: Entry) => entry.forms.some((form) => form[key] === true);
}

/**
 * The regions in the order the list draws them: by their first species, but for Unidentified, which the game puts
 * last, after Paldea, though Meltan's 808 comes between Alola's and Galar's.
 */
const LISTED = [...GENERATIONS, ...SUB_REGIONS]
  .sort((a, b) => a.first - b.first)
  .map((r) => r.region)
  .concat(UNIDENTIFIED.region);

/** A region where the game's count and the record's disagree, on one tab. */
export interface Mismatch {
  tab: string;
  region: string;
  game: number;
  record: number;
}

/** The Pokédex on the phone, and the walk through it. */
export function pokedex({ device, config, data, icon, drag, keep, say }: Walking) {
  let fronted: Promise<void> | null = null;
  const icons = new Map<string, Promise<Image | null>>();

  const at = (image: Image, [x, y]: Point): Point => [x * image.width, y * image.height];

  const tap = async (p: Point, wait = config.waits.tap) => {
    await device.tap(p);
    await sleep(wait);
  };

  /** An icon, fetched once however many entries ask for it, and null where it cannot be had. */
  const iconOf = (file: string) => {
    let held = icons.get(file);

    if (!held) {
      held = icon(file).catch((error: unknown) => {
        say(`  ${file} could not be had (${String(error)}), so nothing is matched against it`);

        return null;
      });
      icons.set(file, held);
    }

    return held;
  };

  /** The icons of `files`, each once, leaving out any the game master names no file for or that cannot be had. */
  const candidates = async (files: readonly { name: string | null; file: string | null }[]): Promise<Candidate[]> => {
    const seen = new Set<string>();
    const held: Candidate[] = [];

    for (const { name, file } of files) {
      if (file === null || seen.has(file)) {
        continue;
      }

      seen.add(file);
      const image = await iconOf(file);

      if (image) {
        held.push({ name, icon: image });
      }
    }

    return held;
  };

  /** A species' forms by their icons: every one the game master names that is not a costume. */
  const formsOf = (dex: number): Form[] => data.forms.filter((f) => f.dex === dex && !f.costume);

  /**
   * A species' costumes by their icons: every costume the game master lists for it, and every form that is not the
   * plain one, since `Copy 2019` and `Goggles 2026` are forms there and costumes on the entry.
   */
  const costumesOf = (dex: number) =>
    candidates([
      ...data.costumes.filter((c) => c.dex === dex).map((c) => ({ name: c.name, file: c.icon })),
      ...data.forms.filter((f) => f.dex === dex && f.form !== null).map((f) => ({ name: f.form, file: f.icon })),
    ]);

  /**
   * Gets to the list of regions from wherever the game is: the map, the main menu, an entry or its grid. An entry
   * closes to its grid, and the grid's own button opens the list.
   */
  const toList = async () => {
    await (fronted ??= toFront(device, config, say));

    // Two taps from an entry, the furthest in a walk leaves it, and three more from the map: the menu opened and the
    // Pokédex opened from it. Each tap is made only on a screen known to be what it is for, as `toStorage` makes its
    // own: the main menu's Poké Ball is where a walking avatar can carry a stop, and where a dialog keeps its buttons.
    for (let attempt = 0; attempt < 6; attempt++) {
      const image = await settled(device);

      if (countsOn(await listLines(image)).length > 0) {
        return;
      }

      const lines = await readLines(image);

      if (isMainMenu(lines)) {
        await tap(at(image, config.taps.pokedexButton), config.waits.search);
        continue;
      }

      const shown = await pokedexLines(image);
      const regions = regionsButtonOf(shown);

      if (regions) {
        await tap(centre(regions), config.waits.search);
        continue;
      }

      // Asked before a dialog is, since the Pokédex's backdrop darkens towards its foot as a dialog's scrim does.
      if (isEntry(shown)) {
        await tap(at(image, config.taps.closeDetail), config.waits.menu);
        continue;
      }

      if (dialogOpen(lines, image)) {
        say('  a dialog was open; closing it with Back');
        await device.key(KEY.BACK);
        await sleep(config.waits.tap);
        continue;
      }

      await tap(at(image, config.taps.mainMenu), config.waits.menu);

      // Thrown rather than tried again, for `toStorage`'s reason: a tap that opened something else leaves a screen
      // nothing here knows the controls of, and every further tap there is a guess.
      if (!isMainMenu(await readLines(await device.screenshot()))) {
        throw new Error('the main menu did not open; open the Pokédex by hand and run again');
      }
    }

    throw new Error('could not find the Pokédex; open its list of regions by hand and run again');
  };

  /** The tab a label in the strip names, by its place in `TABS`, or -1 for one that names none. */
  const tabOf = (text: string) =>
    TABS.findIndex(({ label }) => fold(text) === fold(label) || (label === '100%' && /(?<!\d)100(?!\d)/.test(text)));

  /**
   * Selects a tab of the region list, stepping the strip along to it where it is out of sight. The Pokédex opens on
   * whichever tab was last left selected, so the one wanted can be either way along.
   */
  const toTab = async (label: string) => {
    const wanted = tabOf(label);

    for (let attempt = 0; attempt < TABS.length; attempt++) {
      const image = await settled(device);
      const strip = (await pokedexLines(image))
        .filter((l) => l.top > image.height * 0.8 && l.top < image.height * 0.9 && tabOf(l.text) >= 0)
        .sort((a, b) => a.left - b.left);
      const found = strip.find((l) => tabOf(l.text) === wanted);

      if (found) {
        await tap(centre(found), config.waits.search);

        return;
      }

      // The strip scrolls the tab tapped to its middle, so a tap on the furthest one in sight towards the tab wanted
      // brings more of the strip in from that side.
      const towards = strip.every((l) => tabOf(l.text) > wanted) ? strip[0] : strip.at(-1);

      if (!towards) {
        break;
      }

      await tap(centre(towards), config.waits.search);
    }

    throw new Error(`could not find the ${label} tab of the Pokédex`);
  };

  /**
   * Opens the entry for `from`, or the first seen after it: the card of its region in the list, then the first tile of
   * that region's grid to open an entry, then a swipe at a time to `from`. A tile of a species not yet seen opens
   * nothing, so the tiles are tried along the first rows until one does.
   */
  const open = async (from: number): Promise<Shot> => {
    const region = regionIn(from);

    if (region === null) {
      throw new Error(`#${from} is past the last species, so there is no region to open it in`);
    }

    let tapped = false;

    for (let attempt = 0; attempt < 6 && !tapped; attempt++) {
      const image = await settled(device);
      const lines = await listLines(image);
      const card = lines.find((l) => fold(l.text) === fold(region));

      if (card) {
        await tap(centre(card), config.waits.search);
        tapped = true;
        continue;
      }

      // Towards it along the list, which is wherever the last walk or tally left it: up where every region in sight
      // comes after it, and down otherwise. Dragged in the middle, where a drag the phone took as a tap would open a
      // region rather than press anything else.
      const shown = countsOn(lines).map((c) => LISTED.indexOf(c.region));
      const up = shown.length > 0 && shown.every((i) => i > LISTED.indexOf(region));
      await drag(up ? [0.5, 0.38] : [0.5, 0.7], up ? [0.5, 0.7] : [0.5, 0.38], SCROLL_DRAG_MS);
      await sleep(config.waits.scroll);
    }

    if (!tapped) {
      throw new Error(
        `could not find ${region}'s card in the Pokédex's list of regions; open its grid by hand and run again`,
      );
    }

    // The grid's tiles by the number under each, which the plain read gets exactly. Dragged on down the region until
    // `from` or one after it is in sight, a drag bringing in two rows where a swipe brings in one species; then `from`'s
    // own tile, those after it, then those before it nearest first, since a tile of a species not seen opens nothing.
    let tiles: { line: Line; number: number }[] = [];

    for (let drags = 0; drags < 40; drags++) {
      const grid = await settled(device);

      // Clear of the counts pinned over the top and of the tabs along the foot, a tap on either doing something else.
      const clear = (line: Line) => line.top > grid.height * 0.15 && line.top < grid.height * 0.78;

      tiles = (await ocr(grid))
        .filter((line) => clear(line) && /^\d{4}$/.test(line.text.trim()))
        .map((line) => ({ line, number: Number(line.text) }));

      if (tiles.length === 0 || tiles.some((t) => t.number >= from)) {
        break;
      }

      // Slowly enough that the grid stops where the finger does: at a second for the drag, it flings on fourteen rows.
      await drag([SCROLL_STRIP, 0.7], [SCROLL_STRIP, 0.4], GRID_DRAG_MS);
      await sleep(config.waits.scroll);
    }

    const after = tiles.filter((t) => t.number >= from).sort((a, b) => a.number - b.number);
    const before = tiles.filter((t) => t.number < from).sort((a, b) => b.number - a.number);

    // Every tile in sight rather than the first few, since every one from `from` on can be a species not yet seen.
    for (const { line } of [...after, ...before]) {
      await tap(centre(line), config.waits.search);
      let shot = await shoot(device);
      let dex = dexOn(shot.lines, data);

      // An entry that opened with its title unread is read again, as a step reads one, and closed where it still will
      // not, so the next tile is tapped on the grid rather than over the entry.
      for (let again = 0; dex === null && isEntry(shot.lines) && again < 2; again++) {
        shot = await shoot(device);
        dex = dexOn(shot.lines, data);
      }

      if (dex === null) {
        if (isEntry(shot.lines)) {
          await tap(at(shot.image, config.taps.closeDetail), config.waits.menu);
        }

        continue;
      }

      // Along to `from` either way, the tile tapped being any of the region's first few: back while the one before is
      // still `from` or past it, and on again from the one that was not, then on while short of it.
      let back = await previous(dex);

      while (back && back[1] >= from) {
        [shot, dex] = back;
        back = await previous(dex);
      }

      // Where the step on again fails, the phone is left on the one before `from`, and that is where the walk goes on
      // from: never a screenshot of an entry the phone is no longer showing.
      const forward = back ? ((await next(back[1])) ?? back) : null;

      if (forward) {
        [shot, dex] = forward;
      }

      while (dex < from) {
        const moved = await next(dex);

        if (!moved) {
          break;
        }

        [shot, dex] = moved;
      }

      say(`Walking the Pokédex from #${dex}`);

      return shot;
    }

    throw new Error(`no tile in sight in ${region ?? 'the region'} opened an entry; open one by hand and run again`);
  };

  /**
   * Swipes from the entry for `dex` to the next or, `back`, to the one before, answering where it landed and its number,
   * or null where the swipe went nowhere twice: the end of the Pokédex that way, a swipe the phone dropped leaving the
   * same screen, so it is made twice before it is believed.
   *
   * Only a screen that did not move is swiped again. One that moved and whose title did not read is the next entry read
   * badly, and a second swipe would go past it to the one after, never reading it: so it is read again, and refused
   * where it still will not, rather than skipped.
   */
  const step = async (dex: number, back: boolean): Promise<[Shot, number] | null> => {
    const [grab, drop] = config.swipes.next;
    let before = await settled(device);

    for (let attempt = 0; attempt < 2; attempt++) {
      await (back ? drag(drop, grab, 300) : drag(grab, drop, 300));
      await sleep(config.waits.swipe);
      let after = await shoot(device);
      let now = dexOn(after.lines, data);
      const moved = difference(before, after.image, 0.34, 0.95) > MOVED;

      for (let again = 0; now === null && moved && again < 2; again++) {
        after = await shoot(device);
        now = dexOn(after.lines, data);
      }

      if (now !== null && now !== dex) {
        return [after, now];
      }

      if (now === null && moved) {
        throw new Error(`the entry ${back ? 'before' : 'after'} #${dex} would not read; walk on from it with --from`);
      }

      before = after.image;
    }

    return null;
  };

  const next = (dex: number) => step(dex, false);
  const previous = (dex: number) => step(dex, true);

  /**
   * Back to the top of the entry for `dex`: to the next entry and back, or to the one before and back at the end.
   * Checked by its number rather than trusted, since a swipe either way that lands one entry off would leave the walk
   * reading the next species as a form of this one and then skipping it; one that lands off is stepped back towards
   * `dex`, and one that cannot be is refused.
   */
  const reopen = async (shot: Shot, dex: number): Promise<Shot> => {
    const moved = await next(dex);
    let landed = moved ? await previous(moved[1]) : await previous(dex).then((back) => back && next(back[1]));

    for (let tries = 0; landed && landed[1] !== dex && tries < 2; tries++) {
      landed = landed[1] < dex ? await next(landed[1]) : await previous(landed[1]);
    }

    if (!landed || landed[1] !== dex) {
      throw new Error(`could not get back to the top of #${dex}'s entry to select its next form`);
    }

    return landed[0];
  };

  /**
   * A tile of the form row, where a tap reaches it on the entry as it opens, and where it was seen: the screenshot
   * and the box it is in there, which differ for one only a drag brought up.
   */
  type Placed = FormTile & { label: string | null; image: Image; at: Box };

  /** What one form's CAUGHT tab holds, read down to its foot. */
  interface View {
    tiles: Map<Category | null, { look: Look; box: Box; image: Image }>;
    costumes: { name: Named | undefined; costs: number[]; box: Box; image: Image }[];
    genders: Genders | null;
  }

  /** Reads the CAUGHT tab of the form showing, from `first` down a drag at a time until `SEE ALL` is on the screen. */
  const view = async (first: Shot, dex: number, name: string): Promise<View> => {
    const tiles: View['tiles'] = new Map();
    const costumes: View['costumes'] = [];
    const wardrobe = await costumesOf(dex);
    let below = false;
    let genders: Genders | null = null;
    let shot = first;

    for (let frame = 0; frame < FRAMES; frame++) {
      keep(`${name}-${frame}`, shot.image);
      const { image, lines } = shot;

      if (genders === null && alertOf(lines)) {
        genders = gendersOn(image, lines);
      }

      const caught = caughtOn(image, lines);

      for (const { category, look, box } of caught) {
        if (!tiles.has(category)) {
          tiles.set(category, { look, box, image });
        }
      }

      const overlaps = (a: Box, b: Box) =>
        Math.abs(a.top - b.top) < a.height / 2 && Math.abs(a.left - b.left) < a.width / 2;

      for (const box of costumesOn(image, lines, below)) {
        if (caught.some((c) => overlaps(c.box, box))) {
          continue;
        }

        const look = lookOf(image, box);
        const ranking = ranked(image, box, caughtFrame(image, box), look, wardrobe);
        const costs = ranking.map((r) => r.cost);
        const byIcon = namedFrom(ranking);

        // The same costume seen in two screenshots: by its name where it has one, and by being as far from every icon
        // as one already read where it has none.
        const again = costumes.some((c) =>
          byIcon !== undefined ? c.name === byIcon : c.name === undefined && sameCosts(c.costs, costs),
        );

        if (!again) {
          costumes.push({ name: byIcon, costs, box, image });
        }
      }

      below ||= costumeHeadingOf(lines) !== undefined;

      if (seeAllOf(lines)) {
        break;
      }

      await drag([SCROLL_STRIP, 0.7], [SCROLL_STRIP, 0.38], SCROLL_DRAG_MS);
      await sleep(config.waits.scroll);
      shot = await shoot(device);
    }

    return { tiles, costumes, genders };
  };

  /** What a form's view says of it, by the record's keys, in the order the game draws its tiles. */
  const formFrom = (form: Named, { tiles }: View): FormEntry => {
    const entry: FormEntry = { form, caught: tiles.get(null)?.look === 'icon' };

    for (const category of Object.keys(CATEGORIES) as Category[]) {
      const tile = tiles.get(category);

      if (tile) {
        entry[category] = tile.look === 'icon';
      }
    }

    return entry;
  };

  /** The form a view is of, by its own tile's icon among the species' forms, or undefined where that does not settle. */
  const identityOf = async ({ tiles }: View, dex: number) => {
    const own = tiles.get(null);
    const forms = await candidates(formsOf(dex).map((f) => ({ name: f.form, file: f.icon })));

    return own ? iconIn(own.image, own.box, caughtFrame(own.image, own.box), own.look, forms) : undefined;
  };

  /** Reads the entry showing in `top`, every form of it, and answers it; `top` is its screenshot at its top. */
  const read = async (top: Shot, dex: number): Promise<Entry> => {
    const species = formsOf(dex)[0]?.species ?? data.forms.find((f) => f.dex === dex)?.species ?? String(dex);
    const notes: string[] = [];
    const tag = String(dex).padStart(4, '0');
    const title = titleOf(top.lines);
    const alert = alertOf(top.lines);
    const from = title ? title.top + title.height : top.image.height * 0.42;
    const to = alert ? alert.top - top.image.width * 0.12 : top.image.height * 0.89;
    const opened = formsOn(top.image, from, to);
    const forms = formsOf(dex);

    // One form: its CAUGHT tab, from where the entry opened.
    if (opened.length < 2) {
      const seen = await view(top, dex, tag);
      const named = await identityOf(seen, dex);

      return assemble({ dex, species, notes, views: [{ form: named === undefined ? null : named, seen }] });
    }

    const openedLabels = await labelsOf(top.image, opened);
    const tiles: Placed[] = opened.map((tile, i) => ({
      ...tile,
      label: openedLabels[i] ?? null,
      image: top.image,
      at: tile.box,
    }));
    let shot = top;

    // Where the row of icons is not on the screen the forms run on below its foot, as Unown's 28 do: a drag brings the
    // rest up, and each is placed where it would be on the entry opened by how far the title moved.
    if (!alert && title) {
      await drag([SCROLL_STRIP, 0.6], [SCROLL_STRIP, 0.4], SCROLL_DRAG_MS);
      await sleep(config.waits.scroll);
      const lower = await shoot(device);
      const moved = titleOf(lower.lines);
      const below = alertOf(lower.lines);

      if (moved) {
        const shift = title.top - moved.top;
        const foot = Math.max(...opened.map((t) => t.box.top + t.box.height)) - shift;
        const more = formsOn(
          lower.image,
          foot + 4,
          below ? below.top - lower.image.width * 0.12 : lower.image.height * 0.89,
        );
        const labels = await labelsOf(lower.image, more);

        tiles.push(
          ...more.map((tile, i) => ({
            ...tile,
            box: { ...tile.box, top: tile.box.top + shift },
            label: labels[i] ?? null,
            image: lower.image,
            at: tile.box,
          })),
        );
      }

      shot = await reopen(lower, dex);
    }

    const views: { index: number; form: Named; seen: View }[] = [];
    const silhouettes: { index: number; tile: Placed }[] = [];
    let scrolled = false;

    for (const [index, tile] of tiles.entries()) {
      const { label } = tile;

      if (tile.look === 'silhouette') {
        silhouettes.push({ index, tile });
        continue;
      }

      // Back to the top for every form after the first read, which left the entry scrolled to its foot; the form
      // showing then is the one the entry opens on, so that one is read without a tap.
      if (scrolled) {
        shot = await reopen(shot, dex);
      }

      if (!tile.selected) {
        // A tile under the close button or off the foot is brought up by a drag first, and found again by how far the
        // title moved, which is how far everything under it did.
        const x = tile.box.left + tile.box.width / 2;
        let y = tile.box.top + tile.box.height / 2;

        if (y > shot.image.height * 0.85) {
          const titleBefore = title?.top ?? 0;
          await drag([SCROLL_STRIP, 0.6], [SCROLL_STRIP, 0.4], SCROLL_DRAG_MS);
          await sleep(config.waits.scroll);
          scrolled = true;
          shot = await shoot(device);
          const titleAfter = titleOf(shot.lines)?.top;
          y -= titleBefore - (titleAfter ?? titleBefore);
        }

        // A form the game will not select is one not registered, whatever its tile looked like: the tap leaves the
        // form that was showing selected, and its tab would be read as this one's. Tapped twice before that is
        // concluded, since the phone drops a tap now and then, and a registered form would go down as not.
        let selected = false;

        for (let attempt = 0; attempt < 2 && !selected; attempt++) {
          await tap([x, y]);
          shot = await shoot(device);
          selected = framed(shot.image, { ...tile.box, top: y - tile.box.height / 2 });
        }

        if (!selected) {
          silhouettes.push({ index, tile });
          continue;
        }
      }

      scrolled = true;
      const seen = await view(shot, dex, `${tag}-${index + 1}`);
      const byLabel = label === null ? null : formLabelled(label, forms);
      const byIcon = await identityOf(seen, dex);

      if (byLabel && byIcon !== undefined && byLabel.form !== byIcon) {
        notes.push(`form ${index + 1} is labelled ${label}, where its icon is ${byIcon ?? 'the plain form'}`);
      }

      views.push({
        index,
        form: byLabel ? byLabel.form : byIcon === undefined ? { unidentified: index + 1 } : byIcon,
        seen,
      });
    }

    // The silhouettes, by label, then by their shape, then by being the forms left over once every other is named.
    const taken = new Set(views.map((v) => v.form).filter((f) => typeof f !== 'object' || f === null));
    const shapes = await candidates(forms.map((f) => ({ name: f.form, file: f.icon })));
    const left = () => forms.filter((f) => !taken.has(f.form));
    const unnamed: number[] = [];

    for (const { index, tile } of silhouettes) {
      const byLabel = tile.label === null ? null : formLabelled(tile.label, forms);
      const byShape = iconIn(
        tile.image,
        tile.at,
        formFrame(tile.image, tile.at),
        'silhouette',
        shapes.filter((c) => !taken.has(c.name)),
      );
      const form = byLabel ? byLabel.form : byShape;

      if (form === undefined) {
        unnamed.push(index);
        continue;
      }

      taken.add(form);
      views.push({ index, form, seen: { tiles: new Map(), costumes: [], genders: null } });
    }

    const leftover = left();

    for (const [i, index] of unnamed.entries()) {
      const form = leftover.length === unnamed.length ? (leftover[i]?.form ?? null) : { unidentified: index + 1 };

      if (typeof form === 'object' && form !== null) {
        notes.push(`form ${index + 1} is a silhouette that neither its label nor its shape names`);
      }

      views.push({ index, form, seen: { tiles: new Map(), costumes: [], genders: null } });
    }

    // In the order the game draws the forms, rather than the order they were read in.
    views.sort((a, b) => a.index - b.index);

    return assemble({ dex, species, notes, views });
  };

  /** The line for a species, out of what each of its forms' views read. */
  const assemble = ({
    dex,
    species,
    notes,
    views,
  }: {
    dex: number;
    species: string;
    notes: string[];
    views: { form: Named; seen: View }[];
  }): Entry => {
    const forms = views.map(({ form, seen }) => formFrom(form, seen));
    const costumes: Named[] = [];
    const unnamed: number[][] = [];

    for (const { seen } of views) {
      for (const costume of seen.costumes) {
        if (costume.name !== undefined) {
          if (!costumes.includes(costume.name)) {
            costumes.push(costume.name);
          }
        } else if (!unnamed.some((costs) => sameCosts(costs, costume.costs))) {
          unnamed.push(costume.costs);
          costumes.push({ unidentified: costumes.length + 1 });
          notes.push(`costume ${costumes.length} is none of ${species}'s icons closely enough to name`);
        }
      }
    }

    const genders = views.find(({ seen }) => seen.genders !== null)?.seen.genders ?? {};

    return { dex, species, caught: forms.some((f) => f.caught), genders, forms, costumes, notes };
  };

  /**
   * Every entry from `from` to `to`, read in turn, from wherever the game is: the walk ends past `to` or where a swipe
   * goes nowhere, which is the end of the Pokédex.
   */
  async function* walk(from: number, to: number): AsyncGenerator<Entry> {
    await toList();
    await toTab(TABS[0]?.label ?? 'POKÉMON');
    let shot = await open(from);
    let dex = dexOn(shot.lines, data);

    // Short of `from` where nothing from it on has been seen: `open` swipes on from the last species seen before it and
    // stops there. That species is outside the walk, and a line for it would stand beside the one the record keeps.
    if (dex !== null && dex < from) {
      say(`Nothing from #${from} on has been seen, the last species seen before it being #${dex}`);

      return;
    }

    while (dex !== null && dex <= to) {
      const entry = await read(shot, dex);
      yield entry;

      // Not a swipe further at `to`: nothing past it is wanted, and a swipe onto an entry that would not read would fail
      // a walk that had already read everything it was for.
      if (dex >= to) {
        return;
      }

      const moved = await next(dex);

      if (!moved) {
        return;
      }

      [shot, dex] = moved;
    }
  }

  /**
   * What each tab's region list counts against what `entries` hold, region by region, for every region the game
   * prints a count for: a tab lists only the regions it can hold anything from — G-MAX four of them — and a card whose
   * count did not read is not compared. Answers the regions that disagree, and the tabs whose list would not read.
   */
  const tally = async (entries: readonly Entry[]) => {
    const mismatches: Mismatch[] = [];
    const unread: { tab: string; regions: string[] }[] = [];

    await toList();

    for (const { label, counts } of TABS) {
      await toTab(label);
      const found = new Map<string, number>();

      let shown = await settled(device);

      const take = async (image: Image) => {
        for (const { region, count } of countsOn(await listLines(image))) {
          found.set(region, count);
        }
      };

      // A drag along the list, answering whether it moved: where it did not, that end of the list is in sight. Told by
      // the list itself rather than by what reads on it, since a drag can bring in only regions already read.
      const moved = async (up: boolean) => {
        await drag(up ? [0.5, 0.38] : [0.5, 0.7], up ? [0.5, 0.7] : [0.5, 0.38], SCROLL_DRAG_MS);
        await sleep(config.waits.scroll);
        const after = await settled(device);
        const did = difference(shown, after, 0.1, 0.8) > MOVED;

        shown = after;

        return did;
      };

      // Up to the list's top first, it being wherever the walk left it — scrolled to Kalos after `--from 650` — until
      // its first region is in sight or the list stops; then down, reading each screenshot, until it stops at its foot,
      // which the POKÉMON tab's eleven reach in three.
      await take(shown);

      for (let frame = 0; !found.has(LISTED[0] ?? '') && frame < 4 && (await moved(true)); frame++) {
        await take(shown);
      }

      for (let frame = 0; frame < 6 && (await moved(false)); frame++) {
        await take(shown);
      }

      // What the tab should have shown: every region on POKÉMON's, and on the others each the record counts anything
      // of, which the game lists too. One that did not read is said, never taken for agreeing.
      const expected =
        label === TABS[0]?.label
          ? LISTED
          : LISTED.filter((region) => entries.some((e) => regionIn(e.dex) === region && counts(e)));
      const missing = expected.filter((region) => !found.has(region));

      if (missing.length > 0) {
        unread.push({ tab: label, regions: missing });
      }

      for (const [region, game] of found) {
        const record = entries.filter((e) => regionIn(e.dex) === region && counts(e)).length;

        if (record !== game) {
          mismatches.push({ tab: label, region, game, record });
        }
      }
    }

    return { mismatches, unread };
  };

  return { walk, tally };
}

/**
 * Whether two tiles are as far from each of the nearest icons as each other, which is how one costume no icon names is
 * told apart from another when two screenshots both show it.
 */
function sameCosts(a: readonly number[], b: readonly number[]) {
  // Never alike with nothing to compare: with no icon to match against, every costume's costs are empty.
  return (
    a.length > 0 &&
    a.length === b.length &&
    a.slice(0, 3).every((cost, i) => Math.abs(cost - (b[i] ?? 0)) <= cost * 0.03)
  );
}
