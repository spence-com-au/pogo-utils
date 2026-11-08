/**
 * Walks every Pokémon in storage on an Android phone over `adb` and writes what it finds as JSON Lines, one object per
 * Pokémon: species, form, costume, shiny, lucky, size, Dynamax or Gigantamax, CP, HP, level, IVs and moves. Pokémon GO
 * has no export, so this reads the screen the way a person would — open the first Pokémon, read it, swipe to the next —
 * with Tesseract doing the reading. Each line is added as its Pokémon is read, so a run cut short keeps the ones before.
 *
 * Each field comes from wherever it can be got most reliably. The CP, HP, name, weight, height, types, gender, size
 * badge, favourite star, tag chips and the Dynamax or Gigantamax row are read off the detail screen, and the moves off
 * the same screen scrolled down. The level and the three IVs come off PGSharp's own overlay, which is why the scanner
 * needs PGSharp rather than the stock client — nothing else gives the IVs without walking the appraisal dialogue every
 * time. The form is worked out rather than read, HP being fixed by base stamina, the stamina IV and the level; see
 * `inventory/game-master.mts`. Shadow and purified are worked out too, from the stardust a power-up costs at that
 * level. Shiny and costume say nothing on the screen at all, so each is a search pass instead, whose matches the full
 * pass recognises by name, HP, weight, height and IVs together. A pass for shadow or purified outranks the screen where
 * it is asked for. Lucky has a pass too, and a caption under the name besides, which marks the row whatever the pass
 * made of it. The costume is named rather than said yes to: a Pikachu's off its artwork, against captures labelled by
 * hand and the game's own icons (`inventory/costume.mts`), with every costume it could be where the artwork does not
 * settle which, and any other species' as every costume it has once the pass has found it.
 *
 * Usage, from the repository root, with the phone plugged in, USB debugging on and Pokémon GO in English:
 *
 *   pnpm inventory scan [--out inventory.jsonl] [--search TERM] [--limit N] [--skip N] [--flags shiny,lucky,…]
 *                       [--tags 'Trade to 0xNULL,…'] [--no-moves] [--scroll] [--keep-screens DIR]
 *                       [--config FILE] [--serial SERIAL] [--user N] [--refresh] [--verbose]
 *   pnpm inventory snap [--search TERM] [--verbose] [--refresh] [--config FILE] [--serial SERIAL] [--user N]
 *                       [NAME]
 *                       save `NAME.png` — the whole screen stitched out of a scroll, or the plain screenshot where
 *                       PGSharp's overlay did not read, which is where nothing is scrolled at all — and print what
 *                       each reader makes of it; fails unless it is a detail screen carrying that overlay, and a
 *                       failure leaves a capture already saved under the name as it was. `--search` opens the first
 *                       Pokémon that storage's own search matches, so that a capture names the Pokémon it wants —
 *                       `--search '+burmy & cp196'` rather than a screen set up by hand
 *   pnpm inventory parse [--verbose] [--refresh] [--config FILE] FILE.png…
 *                       the same for screenshots already saved, with no phone needed
 *   A flag handed to a command whose line omits it is refused rather than ignored — see `HONOURED`.
 *   `help`, or `--help` beside any command, prints this.
 *
 * `--search TERM` scans only what storage's own search matches, the flag passes too: each searches `shiny&TERM` and the
 * like, the game reading a `,` inside a clause as or and the `&` between clauses as and.
 *
 * `--skip N` resumes a scan whose `--out` already holds rows 1 to N, and appends to it. It swipes N Pokémon on blind,
 * then finds row N by its HP, weight, height and IVs and starts just past it, since a swipe can go nowhere and a skip
 * that trusted every one of them would land short by each it dropped. It refuses an `--out` without a row N to find,
 * and stops rather than write where it cannot find it.
 *
 * A scroll capture drags the screen up until it stops moving and stitches the frames into one tall image, which is how
 * a screen longer than the phone is seen whole. The stitch is **not** given to the other readers, and that is a limit
 * rather than an oversight: the star corner, the overlay sweep, the tag band and the artwork are each anchored on a
 * fraction of the image's height. `parseMoves` is the one reader that is not, being anchored on `GYMS & RAIDS`, and
 * `powerUpOn` finds its row by the label wherever it is, for a screen that ends above it.
 *
 * `snap` and `parse` are the tools for fixing a misread. Every tap position, swipe and delay is in `DEFAULTS` and can
 * be overridden from a JSON file passed as `--config`, with positions as fractions of the screen so one file suits any
 * phone of the same shape. Each prints its answer — species, form, CP, HP, level, IVs and moves, once each, coloured by
 * whether it was read off the screen or worked out from what was — with the notes that qualify it. `--verbose` adds the
 * lines OCR found with their boxes, which is what separates a field left empty because no text was read there from one
 * left empty because a reader anchored on the wrong line, and what each reader made of them.
 *
 * Automating input breaks Niantic's terms of service. This only reads, and moves at a person's pace, but the risk to
 * the account is the user's to weigh.
 */

import { said } from '../src/errors.ts';
import { adbCli, adbHeld } from '../src/tools/inventory/adb-cli.mts';
import { Device, type Transport } from '../src/tools/inventory/adb.mts';
import { type Colourings } from '../src/tools/inventory/artwork.mts';
import { bestOf, faultsOf } from '../src/tools/inventory/attempts.mts';
import { configWith, DEFAULTS, type Point } from '../src/tools/inventory/config.mts';
import { measuresIn, parseDetail, powerUpOn, readLines, type Detail } from '../src/tools/inventory/detail.mts';
import { DEX, wardrobeFor, type Wardrobe } from '../src/tools/inventory/costume.mts';
import { CACHE, cachedIcon, iconsFor, loadGameData } from '../src/tools/inventory/download.mts';
import { closest, type Form, type GameData } from '../src/tools/inventory/game-master.mts';
import { clearable, identify, settledForm, shadowOf, type Identity } from '../src/tools/inventory/identify.mts';
import { movesCutOff, parseMoves, type Moves } from '../src/tools/inventory/moves.mts';
import { tesseractCli } from '../src/tools/inventory/ocr-cli.mts';
import { ocr, useEngine, type Line } from '../src/tools/inventory/ocr.mts';
import { findOverlay, ivsOf, readOverlay, type Overlay } from '../src/tools/inventory/overlay.mts';
import { decodePng, difference, encodePng, type Image } from '../src/tools/inventory/png.mts';
import { showProgress } from '../src/tools/inventory/progress.mts';
import {
  answer,
  artworkIn,
  costumeIn,
  dumped,
  NO_BOX,
  NO_OVERLAY,
  printable,
  readScreen,
  refusals,
  type Source,
} from '../src/tools/inventory/report.mts';
import {
  count,
  keyOf,
  land,
  landmarkOf,
  landmarksBefore,
  Marks,
  movesOf,
  OverlayBoxes,
  parseFlags,
  reachMoves,
  reachOf,
  shaded,
  shortfall,
  walk as stepThrough,
  type Flag,
  type Mark,
  type Landmark,
  type Row,
} from '../src/tools/inventory/scan.mts';
import { offsetBetween, scrollStep, stitch } from '../src/tools/inventory/stitch.mts';
import { dialogOpen, storage, unsearchable } from '../src/tools/inventory/storage.mts';
import { touchscreen } from '../src/tools/inventory/touchscreen.mts';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs, styleText } from 'node:util';

/**
 * The band a screen is watched for movement in, and how much of it may still differ for it to count as still. The
 * game's own panel, since the artwork above it holds an animated Pokémon that never stops and the status bar ticks with
 * the clock. Measured through one swipe: 31%, then 6.2%, then 0.54% and steady, so anything between settles it.
 */
const SETTLE_BAND = { from: 0.34, to: 0.95 };
const SETTLE_CHANGE = 0.02;
const SETTLE_ATTEMPTS = 4;

/**
 * How long a swipe from one Pokémon to the next takes, in milliseconds: `input swipe`'s own, which is what
 * `config.swipes.next` and `config.waits.swipe` were measured with, and so what the touchscreen is given too.
 */
const NEXT_MS = 300;

/** How many frames one `--scroll` may take before it is a loop rather than a screen. */
const SCROLL_FRAMES = 12;

/**
 * How long one drag of a scroll takes, in milliseconds. Slow, so that the content follows the finger rather than
 * flinging on past where it stopped and out of `offsetBetween`'s reach. Measured with a `scrollStep` on a Pixel 4 XL's
 * 1440x3040, where the step is 836 pixels and the reach 1254: at `input swipe`'s own 300 the panel went on to 1484 and
 * 1697, at 1000 it moved 966 to 1032, and at 2000 it moved 847, margin this already has bought at a second a Pokémon.
 */
const SCROLL_DRAG_MS = 1000;

/** The note on a row whose swipe to the moves moved further than `offsetBetween` could measure, once however many. */
const UNMEASURED_SWIPE = 'the swipe to the moves could not be measured; the scroll back is what it dragged';

/**
 * How far down the panel may be left after a snap has dragged it back, as a fraction of the screen's height, under
 * which another drag is not asked for. A finger travelling less than the system's touch slop — 8dp, around 24 pixels on
 * the phone `SCREEN_BAND` was measured on — arrives as a tap rather than a drag, and a tap on a detail screen opens
 * something. So this is where a drag stops being one, and what it leaves is under a line of the panel's own text.
 */
const SCROLL_BACK_FLOOR = 0.012;

/**
 * Size is not among these: the detail screen wears a gold badge saying `XXL` or `XXS`, so it is read off the screen the
 * scan is already looking at rather than bought with a search of its own. Checked against the game's own `xxl` search,
 * which marked the same Applin — 5/2/15 at 0.33m — that the badge does.
 */
const DEFAULT_FLAGS: Flag[] = ['shiny', 'lucky', 'costume'];

/** How many times one detail screen is read before its reading is taken as final. */
const READ_ATTEMPTS = 3;

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'out': { type: 'string', default: 'inventory.jsonl' },
    'limit': { type: 'string' },
    'skip': { type: 'string' },
    'flags': { type: 'string' },
    'tags': { type: 'string' },
    'no-moves': { type: 'boolean', default: false },
    'scroll': { type: 'boolean', default: false },
    'keep-screens': { type: 'string' },
    'search': { type: 'string' },
    'config': { type: 'string' },
    'serial': { type: 'string' },
    'user': { type: 'string' },
    'refresh': { type: 'boolean', default: false },
    'verbose': { type: 'boolean', default: false },
    'help': { type: 'boolean', default: false },
  },
});

// `--help` stands in for the command rather than going beside it, so `scan --help` prints the usage instead of being
// refused as a flag `scan` does not act on.
const [command = 'help', ...rest] = options.help ? [] : positionals;

/**
 * The synopsis out of this file's own header. Read once rather than where it is printed, because an argument error
 * wants it as much as `help` does: a complaint about a flag is most useful beside the list the flag was not on.
 */
const USAGE = readFileSync(new URL(import.meta.url), 'utf8')
  .match(/Usage[^]*?\n \*\n[^]*?\n \*\n/)?.[0]
  .replace(/^ \* ?/gm, '');

/**
 * Which flags each command acts on. `parseArgs` takes one flat set of options, so nothing else says where a flag
 * belongs: `parse --out inventory.jsonl` wrote nothing and said nothing about it. Stated once here, so the rejection
 * below and the usage block above cannot drift apart without a test noticing.
 *
 * `--config` is on all three but splits two ways: `scan` and `snap` drive the phone out of it, reading `swipes`,
 * `waits` and `scrollBand`, where `parse` reaches `overlay` alone and only through `report`. The fields are named so
 * the claim can be grepped for. `--serial` and `--user` stop at `snap` because `parse` opens no device. `--scroll` is
 * the scan's alone, a `snap` taking a scroll capture every time.
 */
const HONOURED: Record<string, readonly string[]> = {
  scan: [
    'out',
    'search',
    'limit',
    'skip',
    'flags',
    'tags',
    'no-moves',
    'scroll',
    'keep-screens',
    'config',
    'serial',
    'user',
    'refresh',
    'verbose',
  ],
  snap: ['search', 'verbose', 'refresh', 'config', 'serial', 'user'],
  parse: ['verbose', 'refresh', 'config'],
};

/**
 * The flags actually typed, which `options` cannot answer: `parseArgs` fills in every flag carrying a `default`, so
 * `out`, `no-moves`, `scroll`, `refresh` and `verbose` are in it whether or not anyone asked for them. `argv` is the
 * only place that still knows the difference, and taking the name up to the `=` is what makes `--out=x` read the same
 * as `--out x`.
 */
const passed = process.argv.slice(2).flatMap((arg) => /^--([a-z-]+)/.exec(arg)?.[1] ?? []);

// `hasOwn` rather than the lookup alone, because a plain object inherits from `Object.prototype`: `HONOURED.toString`
// answers a function, which is truthy, so `toString --verbose` reached `.includes` on it and threw where it should have
// fallen through to the usage. Only ever with a flag alongside, an empty list never invoking the filter.
const honoured = Object.hasOwn(HONOURED, command) ? HONOURED[command] : undefined;
const ignored = honoured ? passed.filter((flag) => !honoured.includes(flag)) : [];

// Only for a command that has a list: `help` and a typo fall through to the usage below, which says more than this can.
if (ignored.length > 0) {
  console.error(`${command} does not act on ${ignored.map((flag) => `--${flag}`).join(', ')}\n`);
  console.error(USAGE);
  process.exit(1);
}

/**
 * Why `--search` cannot be used, or null where it can or was not given. Asked before the phone is opened: a term `type`
 * will not send, or one longer than the box can be cleared of, is one the phone would be driven to storage and into the
 * search box for before anything said so.
 *
 * Asked of every string the command will type, not the term alone: a scan's flag passes type `costume&TERM`, up to nine
 * characters more, and a term that fits the clear while that does not leaves the rest prepended to the next search —
 * whose own `🔍(N)` then vouches for the narrower set it found.
 */
function refusedSearch(term: string | undefined, passes: readonly Flag[]): string | null {
  if (term === undefined) {
    return null;
  }

  for (const pass of [null, ...passes]) {
    const unsent = unsearchable(pass === null ? term : `${pass}&${term}`);

    if (unsent !== null) {
      return pass === null ? `--search ${unsent}` : `--search, as the ${pass} pass types it, ${unsent}`;
    }
  }

  // The one term `unsearchable` passes and `--search` cannot use: `typeable` is `*`-quantified, so both `''` and a run
  // of spaces satisfy it. An empty search matches everything, which would snap whatever the unfiltered grid happens to
  // show first and exit 0 — a capture under a name claiming it is something else. `--search "$TERM"` with `TERM` unset
  // is how it arrives. A whitespace-only term is worse still: `search` types the space, so the `term === ''` test that
  // closes the suggestions panel is skipped, and `firstTile` falls back to its blind tap onto the first Recent chip —
  // opening whatever was searched for last.
  if (term.trim() === '') {
    return '--search needs a term; an empty one matches everything, so it would name nothing';
  }

  return null;
}

// Parsed for `scan` alone, the one command `HONOURED` lets `--flags` reach, so that `help --flags x` prints the usage.
const flags = command === 'scan' && options.flags !== undefined ? parseFlags(options.flags) : DEFAULT_FLAGS;

// Only for a command that searches: `help` has no list to have filtered `--search` out, and prints the usage regardless.
const refused = honoured?.includes('search') ? refusedSearch(options.search, command === 'scan' ? flags : []) : null;

if (refused !== null) {
  console.error(`${command}: ${refused}`);
  process.exit(1);
}

// Ahead of `iconsFor`, which is the only thing that reads it, and up here rather than beside each of its three calls
// because progress is narrated until this says otherwise: a call made late leaves the preamble in a run that asked for
// quiet. `cli.test.mts` is what notices, the quiet half of its `--verbose` test failing on exactly that.
showProgress(options.verbose);

// The CLI reads with the Tesseract on `PATH`; the Inventory page installs the WebAssembly build in its place.
useEngine(tesseractCli);

// Read here rather than in `configWith`, `config.mts` being shared with the browser, which has no file to read.
// `--user` goes over the file's `"user"`, as a flag typed for one run should over a file kept for every run.
const config = {
  ...(options.config === undefined ? DEFAULTS : configWith(JSON.parse(readFileSync(options.config, 'utf8')))),
  ...(options.user === undefined ? {} : { user: count('user', options.user, 0) }),
};

/** The colour each source is printed in, so that a value read off the screen and one worked out never look alike. */
const SOURCE_STYLE = { 'read': 'cyan', 'worked out': 'magenta' } as const satisfies Record<Source, string>;

/** Styled where stdout takes colour, which `styleText` decides: not for a pipe, nor under `NO_COLOR`. */
const paint = (style: Parameters<typeof styleText>[0], text: string) =>
  styleText(style, text, { stream: process.stdout });

/** Whether the key to those colours has been printed, which a run wants once however many screens it reports. */
let keyed = false;

/** The key to those colours, once, and only where they are shown: without them it would describe nothing on the page. */
function key() {
  if (!keyed && paint('cyan', 'read') !== 'read') {
    console.log(`${paint('cyan', 'read off the screen')}, ${paint('magenta', 'worked out from what was read')}`);
  }

  keyed = true;
}

let wardrobe: Promise<Wardrobe | null> | null = null;

/**
 * Pikachu's icons drawn into one frame for its costume, read the first time a Pikachu is: some 200 icons that a scan
 * or a `parse` of anything else never needs.
 */
const wardrobeOn = (data: GameData) => () => (wardrobe ??= wardrobeFor(data, cachedIcon(CACHE, options.refresh)));

/**
 * Everything each reader makes of one screenshot, for tuning: `readScreen` does the reading, which the Inventory page
 * shares, and this prints it. The answer first, each field once and coloured by where it came from; then, for
 * `--verbose`, the lines OCR found and the `Detail`, `Overlay` and `Identity` the answer was drawn from.
 */
async function report(image: Image, data: GameData, icons: ReadonlyMap<Form, Colourings>) {
  const read = await readScreen(image, data, icons, config.overlay, wardrobeOn(data));
  key();

  const { facts, notes } = answer(read);
  const width = Math.max(...facts.map((f) => f.label.length));

  for (const { label, value, source } of facts) {
    console.log(
      `${label.padEnd(width)}  ${source === null ? paint('dim', value) : paint(SOURCE_STYLE[source], value)}`,
    );
  }

  for (const note of notes) {
    console.log(`note: ${note}`);
  }

  // What every reader was handed and what each made of it, below the answer rather than ahead of it: a person tuning a
  // reader wants these, and the same names meaning different things in each — `cp`, `levels`, `form` — is why they are
  // not the answer.
  if (options.verbose) {
    const dump = (found: readonly Line[]) => {
      for (const l of found) {
        console.log(`  ${dumped(l)}`);
      }
    };

    // Both passes where there were two, and labelled, since the point of the flag is to show which lines a reader was
    // actually handed: a field read wrong is in the screen's set and a move read wrong is in the stitch's.
    if (read.whole === read.lines) {
      dump(read.lines);
    } else {
      console.log('  --- the screen, which every reader but the moves was given');
      dump(read.lines);
      console.log('  --- the whole stitch, which the moves were read off');
      dump(read.whole);
    }

    console.log('detail:', read.detail);
    console.log('moves:', read.moves);
    console.log('overlay box:', read.box ?? NO_BOX);
    console.log('overlay:', read.overlay ?? NO_OVERLAY);
    console.log('identity:', printable(read.identity));
  }

  // Handed back rather than only printed, so that `snap` can refuse a screen on what was already read instead of
  // parsing it a second time; a Tesseract run is the slowest thing here.
  return read;
}

/**
 * `held` is the shell the touchscreen is made on, which the caller closes once the scan is over, however it ends.
 */
async function scan(held: Transport) {
  // Ahead of the phone, so a typo fails before anything is driven.
  const limit = count('limit', options.limit, Infinity);
  const skip = count('skip', options.skip, 0);
  const out = options.out;
  const term = options.search;

  // The rows a skip has to land just past, read before the phone is driven, since a skip with nothing to check its
  // landing against is one that lands short by every swipe it dropped and says nothing: the rows written next repeat
  // the last ones under numbers that have moved on.
  let behind: Landmark[] = [];

  if (skip > 0) {
    try {
      behind = landmarksBefore(readFileSync(out, 'utf8'), skip);
    } catch (error) {
      const why = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'it does not exist' : said(error);
      throw new Error(`--skip ${skip} checks where it lands against row ${skip} of ${out}, but ${why}`, {
        cause: error,
      });
    }
  }

  const device = new Device(adbCli(options.serial));
  await device.check();
  const data = await loadGameData(CACHE, options.refresh);
  const icons = await iconsFor(CACHE, data, options.refresh);

  // The chips under the HP say which tags a Pokémon carries, so this is a vocabulary rather than a list to search for:
  // the names are the user's own, and only something to match against can say that `Shiny SJ` is the `Shiny` chip with
  // its `✦` read as letters. Storage's own TAGS tab is where they come from.
  const tags = (options.tags ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const screens = options['keep-screens'];
  const shot = await device.screenshot();
  const { tap, swipe, dismiss, closeDetail, search, matches, matched, stored, firstTile } = storage(
    device,
    config,
    data,
    shot,
  );

  // The swipe from one Pokémon to the next on a touchscreen of the scan's own, the one `pnpm battle` drives the field
  // with. `input swipe` went nowhere 3 to 5 times in 40 on a Pixel 4 XL with Android 13, at every wait and height
  // `--config` offers, and nothing a walk reads can tell a dropped swipe from the end of storage: the same Pokémon is
  // on the screen either way, and two of one species differ by less of the panel than a still screen does from itself
  // — Unown B and Unown ! by 0.48%, against 0.54%. Where the phone will not have it, `input swipe` it is, with the
  // game's counts below for `walk` to tell its drops from the end by, and to catch a pass they still cut short.
  const touch = await touchscreen(held).catch((error: unknown) => {
    const reason = said(error);
    console.error(`${reason}; swiping with \`input swipe\` instead, which can drop a swipe and cut a pass short`);

    return null;
  });

  const drag = async ([from, to]: [Point, Point], wait: number) => {
    if (touch) {
      await touch.swipe(from, to, NEXT_MS);
      await sleep(wait);
    } else {
      await swipe([from, to], wait);
    }
  };

  const boxes = new OverlayBoxes(config.overlay ?? null, findOverlay, readOverlay);

  if (screens) {
    mkdirSync(screens, { recursive: true });
  }

  // `carry` for the one artifact that needs it: a stitch, whose own height is not the height the phone drew.
  const keep = (name: string, image: Image, carry: Readonly<Record<string, string>> = {}) => {
    if (screens) {
      writeFileSync(join(screens, `${name}.png`), encodePng(image, carry));
    }
  };

  interface Reading {
    detail: Detail;
    overlay: Overlay | null;
    key: string | null;

    /** Worked out while reading, since a reading is only accepted once something fits it; the row writer reuses it. */
    id: Identity;

    /** The screenshot this reading was read from, which the `-detail` screen has to be to account for its row. */
    image: Image;

    /**
     * The last screenshot taken, which is `image` on every reading but one `bestOf` kept from an earlier attempt. The
     * scroll owes `scrollFrames` a frame still on the screen and measures its swipe against one, where an attempt back
     * is a `config.waits.swipe` and a `settled` older than that.
     *
     * Where the two differ the stitch is a later read of the screen than the row beside it, which the row says, since
     * the stitch is the capture a fixture is promoted from and the row is what a reader would take its claims for.
     */
    latest: Image;

    /**
     * How much of this reading is in doubt, as a score to be got to zero. Recorded with the reading rather than worked
     * out again when two are compared: `boxes.box` is found part way through a pass, and a score that moved with it
     * would rank an earlier attempt differently for what a later one went on to learn.
     */
    faults: number;
  }

  const overlayOf = async (image: Image, sweep: boolean) => {
    const known = boxes.box;
    const overlay = await boxes.overlayOn(image, sweep);

    if (!known && boxes.box) {
      console.error(`  found PGSharp's overlay at ${JSON.stringify(boxes.box)}`);
    }

    return overlay;
  };

  /**
   * One detail screen: the game's own text, and PGSharp's overlay over it. A screen still settling reads as a Pokémon
   * with no HP at all, or as one whose overlay has not been drawn yet, so both are worth another look rather than one
   * — a single bad read costs a whole member of a flag pass, and a member missed there is a Pokémon the full pass will
   * never learn was in the search. An `xxl` pass over a search the game said held five marked four, and the one it
   * dropped was the only one of them the full pass went on to read.
   *
   * A note `identify` raised is worth another look as well, and it is the only one of them that says the screen read
   * *whole* and wrongly: a CP the settled form and level do not derive, a level shortlist no HP can be, a form the
   * overlay names that no species has. Only the notes a second read could clear count (`clearable`): `unseparated` is
   * reported and not chased, those forms sharing every number the screen prints, so what would settle them is a field
   * the game never drew. `screens.test.mts` pins that split.
   *
   * `could also be …` is counted with the rest, but only on a reading that has IVs: with none the search narrows on
   * types alone and 21 of the game master's 1,024 species answer it for ever, so counting those would read every
   * Deoxys, Dialga and Lycanroc three times on every pass for an answer no further look can change. It is kept because
   * the case it is for is a nickname, which sends the search across every species, and a Pokémon the numbers cannot
   * then separate is exactly the one worth looking at twice.
   *
   * What the stricter test costs if the last attempt is the one taken is a row rather than a note, which is why the
   * reading kept is `bestOf`'s and not this loop's: a reading accepted before is now read again, a second look can come
   * back worse, and one whose HP goes unread has no key at all — three of those in a row stop the pass. That decision
   * sits there so `attempts.test.mts` can assert it, which `phone.test.mts` cannot: a scan driven against recordings
   * shows what it wrote and not how many looks it took to get there.
   */
  const readDetail = async (): Promise<Reading> => {
    let latest: Image | null = null;
    let lost: number | null = null;

    // Minus `latest`, which is this function's to answer rather than an attempt's: an attempt only knows its own.
    const best = await bestOf<Omit<Reading, 'latest'>>(
      READ_ATTEMPTS,
      ({ faults }) => faults,
      async (attempt) => {
        // Give the screen time to move on before looking again, which `settled` does not: it waits for the screen to
        // stop moving, and an overlay PGSharp has not drawn yet is a still screen.
        if (attempt > 0) {
          await sleep(config.waits.swipe);
        }

        const image = await settled(device);
        latest = image;
        const lines = await readLines(image);
        const detail = await parseDetail(lines, data, image);

        // A dialog a dropped drag opened, which the swipe to this Pokémon did nothing over, or one the game raised on
        // its own. Closed here, so the next attempt reads the screen beneath it, and this one counted as unread however
        // much of it did read: the HP above `New Mega Level available!` reads, and a row keyed by it would carry the
        // Max, moves, shadow and purified the dialog hides as blanks that look like answers.
        const covered = dialogOpen(lines, image);

        if (covered) {
          await dismiss();
        }

        // Only a detail screen is worth a sweep, and on a retry only where the attempt before it lost a field. Sweeps
        // that find nothing are rationed over the whole run, so one granted on every attempt buys three tries of the
        // same `findOverlay` on one Pokémon where the ration was five tries spread over five — and `findOverlay` is
        // what varies by phone, its own docblock measuring it at nine of twelve captures from one and none from
        // another.
        const overlay = detail.hp === null || covered ? null : await overlayOf(image, lost === null || lost > 0);
        const key = covered ? null : keyOf(detail, overlay);
        const id = identify(data, detail, overlay, artworkIn(image, boxes.box, icons));

        // The key above the other two, not beside them: a reading with no key is the one `walk` counts as a miss and
        // writes `detail screen not read`, so it must lose to any reading that got the HP however much else that one
        // lost. The overlay's clause is the conditional one, since where no box has been found at all there is nothing
        // to wait for; a form that fits is the surest of the three, the name, the types, the HP and the IVs agreeing
        // being what a half-read screen cannot fake.
        const keyless = Number(key === null);
        const fields = Number(overlay === null && boxes.box !== null) + Number(id.form === null);

        // Notes only where the overlay read, because the ones raised without IVs are the ones no further read can
        // clear: with `iv === null` the search narrows on types alone, and 21 of the game master's 1,024 species then
        // answer `could also be …` for ever. Counting those would read every one of them three times on every pass.
        // `clearable` is the same argument applied to one note more: `unseparated` is reported, never chased.
        const notes = overlay === null ? 0 : clearable(id);

        lost = keyless + fields;

        return { detail, overlay, id, key, image, faults: faultsOf(keyless, fields, notes) };
      },
    );

    // The freshest screenshot, not the winning attempt's: `bestOf` hands back the whole of whichever reading ranked
    // best, and an earlier one's screen has been swiped against since.
    return { ...best, latest: latest ?? best.image };
  };

  /**
   * Opens the first Pokémon the grid shows and reads it, answering a reading with no key when there is none — a search
   * that matched nothing — or when it would not read.
   */
  const openFirst = async (grid: readonly Line[]) => {
    await tap(firstTile(grid), config.waits.swipe);

    // Through `readDetail` for its retry: the tile opens with an animation that outlasts one wait, and a screen read
    // while it is still running is indistinguishable from a grid with nothing in it.
    return readDetail();
  };

  const [grab, drop] = config.swipes.next;
  const next = () => drag([grab, drop], config.waits.swipe);
  const back = () => drag([drop, grab], config.waits.swipe);

  /**
   * Each Pokémon from the one open, `first` being that one's reading where `openFirst` has already made it, of `total`
   * the game counts, which is how a swipe that went nowhere is told from the end. Answers how many it visited, for
   * `shortfall` to hold against that count.
   */
  const walk = async (
    visit: (reading: Reading, index: number) => Promise<void>,
    total: number | null,
    max: number,
    from = 0,
    first?: Reading,
  ) => {
    let visited = 0;

    if (from > 0) {
      // Blind and at half the wait, which is quick and drops swipes: a skip of 136 landed 9 short. `land` is what makes
      // up for them, finding the rows already written and stepping on past them.
      for (let i = 0; i < from; i++) {
        await drag([grab, drop], config.waits.swipe / 2);
      }

      const reach = reachOf(from);
      let off: number;

      try {
        off = await land({ read: readDetail, next, back }, behind, (r) => landmarkOf(r.detail, r.overlay), reach);
      } catch (error) {
        throw new Error(`--skip ${from} could not find where to start: ${said(error)}`, { cause: error });
      }

      if (off > 0) {
        console.error(`  the skip landed ${off} short of row ${from + 1}, so it stepped on past row ${from}`);
      }
    }

    const counted = async (reading: Reading, index: number) => {
      visited++;
      await visit(reading, index);
    };

    await stepThrough({ read: readDetail, next, back }, counted, max, from, from === 0 ? first : undefined, total);
    await closeDetail();

    return visited;
  };

  // The flag passes come first, so that the full pass can write each row complete as it goes.
  const marked = new Map<Flag, Marks>();

  for (const flag of flags) {
    const marks = new Marks();
    const grid = await search(term === undefined ? flag : `${flag}&${term}`);
    const first = await openFirst(grid);

    if (first.key !== null) {
      const total = matches(grid);
      const visited = await walk(async ({ detail, overlay }) => marks.add(detail, overlay), total, Infinity, 0, first);
      const short = shortfall(flag, visited, total);

      // Thrown rather than left null: what cut this pass short would cut the full pass short too, which is hours of
      // phone time to find that out in.
      if (short) {
        throw new Error(`${short}; marking only those would write \`false\` against the rest`);
      }
    } else if (matched(grid)) {
      // The search matched Pokémon and the first would not read, which is not the answer a search matching nothing
      // gives: marking nothing would write `false` against every Pokémon the search holds. So the field is left null
      // instead.
      console.error(`${flag}: the first Pokémon would not read, so this field is left null`);
      continue;
    }

    console.error(`${flag}: ${marks.size}`);
    marked.set(flag, marks);
  }

  const grid = await search(term ?? '');
  const first = await openFirst(grid);

  if (first.key === null) {
    const empty = term === undefined ? 'storage looks empty' : `--search ${JSON.stringify(term)} matched nothing`;

    throw new Error(`${empty}, or the first Pokémon did not open; try \`pnpm inventory snap\` to see why`);
  }

  // Emptied of an earlier scan's rows, a skip adding to them instead. Only once the full pass has a first Pokémon open,
  // so that a run which cannot start leaves the earlier scan where it was.
  if (skip === 0) {
    writeFileSync(out, '');
  }

  let written = 0;
  const started = Date.now();

  // Read off the grid before the walk leaves it, both to tell a dropped swipe from the end and to check the pass after.
  const total = term === undefined ? stored(grid) : matches(grid);

  const visited = await walk(
    async (reading, index) => {
      const { detail, overlay, id: read, image } = reading;
      const name = String(index + 1).padStart(5, '0');
      const notes: string[] = [];
      let moves: Moves = { fast: null, charged: [] };
      const iv = overlay?.iv ?? null;
      keep(`${name}-detail`, image);

      // Null for a flag not asked for, one whose pass would not read or a screen with no key to match it by, rather
      // than a `false` nothing checked.
      const flag = (f: Flag): Mark => marked.get(f)?.take(detail, overlay) ?? null;

      // Each pass's flag taken once, since `take` uses the match up.
      const passes = { shadow: flag('shadow'), purified: flag('purified') };

      // Identified again where the fields say whether this is shadow or purified, which is all that rules out a form
      // the game only hands out as a shadow, and which the reading `walk` took could not know. A function, since a
      // screen asking no stardust is settled again off the screen the moves are read from.
      const settle = (powerUp: number | null) => {
        const shade = shaded(passes, shadowOf(data, { ...detail, powerUp }, read.levels));
        const id =
          shade.shadowed === null
            ? read
            : identify(data, detail, overlay, artworkIn(image, boxes.box, icons), null, shade.shadowed);

        return { ...shade, id };
      };

      let settled = settle(detail.powerUp);

      // Taken whatever the screen says, so that a match the pass holds for this Pokémon is used up here rather than
      // left to mark another. The caption is the screen stating it, where the pass can have been cut short.
      const passed = flag('lucky');
      const lucky = detail.lucky || passed;

      if (detail.hp === null) {
        notes.push('detail screen not read');
      }

      if (overlay === null) {
        notes.push(boxes.box ? 'overlay not read' : 'no PGSharp overlay found; is its IV display switched on?');
      }

      if (!options['no-moves']) {
        // From a reading rather than this one, since `movesOf` looks again from a fresh one where the screen scrolled
        // down was another Pokémon's.
        const look = async ({ image, latest }: Reading, steps: number) => {
          let scrolled: Image;

          // The screen the overlay is read off, which in a stitch is its last frame: the first is the detail screen.
          let shown: Image;
          let back: number;

          if (options.scroll) {
            // The same two halves `snap` takes: the screenshot already in hand as the first frame, rather than a
            // second photograph of a screen that has moved on, and the height it was drawn at recorded on the stitch.
            //
            // `latest` rather than `image`, since the frame handed over is the one `scrollFrames` does not wait for and
            // the reading may have come from an attempt before it.
            //
            // Under the plain name, the stitch being the capture and `-detail` above the frame the row was read from.
            // `name` here is the scan's own index, so a capture kept for the corpus is still renamed to the Pokémon it
            // shows; what the plain name buys is that the suffix is no longer part of what has to come off.
            const capture = await scrollFrames(device, latest);
            scrolled = stitch(capture.frames, capture.offsets, config.scrollBand);
            shown = capture.frames.at(-1) ?? latest;
            back = capture.offsets.reduce((a, b) => a + b, 0);
            keep(name, scrolled, { Viewport: `${latest.width}x${latest.height}` });

            // So the stitch and this row are a pair or say they are not. A fixture is promoted from the stitch while
            // its expectations are derived from the committed png, so nothing downstream would report the two having
            // been read a `config.waits.swipe` apart — and the readings that need a second look are the ones the
            // corpus is collected for.
            if (latest !== image) {
              notes.push('the capture kept for this row is a later read of the screen than the row itself');
            }

            if (capture.lost) {
              notes.push(`the scroll lost its place after frame ${capture.frames.length}`);
            }
          } else {
            // One step of the `--scroll` branch's capture, at its speed, so that the shift lands inside what
            // `offsetBetween` looks for. Half the screen at `input swipe`'s 300ms moved a Pixel 4 XL's panel as far as
            // 0.69 of the screen, to its foot or flung past the finger, where the band reaches 0.41: 38 rows of 40
            // went unmeasured. The step still brings the moves up from the panel's foot to about two-thirds of the way
            // down, and `steps` of them is what `reachMoves` asks for where one did not.
            //
            // A look after the first starts from a fresh screenshot rather than `latest`, since `scrollUp` stops short
            // of the top on purpose and what is measured has to be what it scrolls back.
            const [from, to] = scrollStep(config.scrollBand, latest.width, latest.height);
            scrolled = steps === 1 ? latest : await device.screenshot();
            back = 0;

            for (let step = 0; step < steps; step++) {
              const before = scrolled;

              await device.swipe(from, to, SCROLL_DRAG_MS);
              await sleep(config.waits.scroll);
              scrolled = await device.screenshot();

              // Measured against the screen before the swipe, on the same footing as the `--scroll` branch above and
              // `latest` for the same reason. What the drag asked for is no bound on what it got: the panel flings a
              // little past the finger, or has less than the step left to give, and the distance that matters is the
              // one it actually moved.
              const moved = offsetBetween(before, scrolled, config.scrollBand);
              back += moved ?? from[1] - to[1];

              // A fling past half the step again is more than `offsetBetween` looks for. Falling back to the drag can
              // overshoot the top where the panel had less than that to give, so it is recorded rather than hidden.
              if (moved === null && !notes.includes(UNMEASURED_SWIPE)) {
                notes.push(UNMEASURED_SWIPE);
              }
            }

            // The screen the moves were read from, so a second look replaces the first's.
            keep(`${name}-moves`, scrolled);
            shown = scrolled;
          }

          // Read while the phone scrolls back, since nothing that follows depends on the moves. Awaited with the
          // swipes, so that a read failing before the phone is back is a rejection here rather than an unhandled one.
          let dialog = false;
          let cutOff = false;
          let measures = '';
          const found = ocr(scrolled).then((lines) => {
            dialog = dialogOpen(lines, scrolled);
            cutOff = !options.scroll && movesCutOff(lines, scrolled);

            // Not off a stitch, whose first frame is the detail screen the reading came from and so vouches for it
            // whatever the frames below it show.
            measures = options.scroll ? '' : measuresIn(lines);

            return parseMoves(lines, data, settled.id.form, scrolled);
          });

          // Only where the detail screen's overlay read, there being nothing to hold this one to otherwise, and without
          // a sweep: they are rationed, and the moves screen is no place to spend one.
          const seen = overlay ? overlayOf(shown, false) : Promise.resolve(null);

          // A panel above `POWER UP` can push it below the plain screen's foot, as Necrozma's fusion panel does, and
          // then the screen scrolled down for the moves is where its stardust is.
          const power = detail.powerUp === null ? powerUpOn(scrolled) : Promise.resolve(null);
          await Promise.all([found, seen, power, scrollUp(device, shot, back)]);

          // The swipe to the moves dropped as a tap and opened something. The drags back up did nothing over it — they
          // run down the margin, where no dialog has a button — so it is closed before the swipe to the next Pokémon,
          // which would do nothing either. Nor is it looked past, the screen read having been the dialog's.
          if (dialog) {
            await dismiss();
            notes.push('a dialog opened on the swipe to the moves and was closed');
          }

          return { moves: await found, cutOff: cutOff && !dialog, overlay: await seen, measures, powerUp: await power };
        };

        // The stardust off any look of one reach, since the step further down that a second look takes can scroll
        // `POWER UP` off the top. Per reach, so a look `movesOf` threw away for showing another Pokémon keeps none.
        const reach = async (from: Reading) => {
          let powerUp: number | null = null;
          const last = await reachMoves(async (steps) => {
            const found = await look(from, steps);
            powerUp = found.powerUp ?? powerUp;

            return found;
          });

          return { ...last, powerUp };
        };

        const took = await movesOf(reading, reach, { read: readDetail, next });
        const below = took.look?.powerUp ?? null;
        moves = took.look?.moves ?? moves;

        if (took.note) {
          notes.push(took.note);
        }

        if (moves.fast === null || moves.charged.length === 0) {
          notes.push('moves not fully read');
        }

        if (below !== null) {
          settled = settle(below);
        }
      }

      const { shadow, purified, id } = settled;
      notes.push(...settled.notes);

      // The search's answer taken once, since `take` uses the match up, and handed to the artwork: a Pikachu the search
      // did not find wears no costume, and one it found is not the plain one. Any other species is named only by the
      // search, so it gets every costume it has, which is the most the screen says — or null, unknown, where it has
      // none the game data names or its species is unread, since an empty list would say it wears none.
      const costumed = flag('costume');
      const worn = await costumeIn(image, boxes.box, id, wardrobeOn(data), costumed);
      const named = [...new Set(data.costumes.filter((c) => c.dex === id.form?.dex).map((c) => c.name))];
      const costume =
        worn.costume ??
        (costumed === null || id.form?.dex === DEX ? null : costumed ? (named.length > 0 ? named : null) : []);

      if (worn.note) {
        notes.push(worn.note);
      }

      // A chip that matches nothing named is kept as it read rather than dropped, since a misread is worth seeing.
      const carried = detail.tags.map((t) => (tags.length > 0 ? (closest(t, tags, (n) => n, 0.3) ?? t) : t));

      const row: Row = {
        index: index + 1,

        // A nickname says nothing of the species, so a Pokémon `identify` could not place is left null rather than
        // filed under it.
        species: id.form?.species ?? (id.nickname === null ? detail.name : null),

        nickname: id.nickname,
        dex: id.form?.dex ?? null,
        form: settledForm(id),
        gender: detail.gender,
        favourite: detail.favourite,
        tags: carried,
        costume,
        shiny: flag('shiny'),
        lucky,
        size: detail.size,
        shadow,
        purified,
        max: detail.max,
        cp: id.cp ?? detail.cp,
        hp: detail.hp,
        levels: id.levels,
        iv,
        moves,
        weight: detail.weight,
        height: detail.height,
        types: detail.types,
        notes: [...notes, ...id.notes],
      };

      appendFileSync(out, `${JSON.stringify(row)}\n`);
      written++;

      const each = (Date.now() - started) / written / 1000;
      const ivText = iv ? ivsOf(iv) : '?';
      console.error(
        `#${index + 1} ${row.species ?? '?'} CP ${row.cp ?? '?'} ${ivText} L${row.levels.join(' / ') || '?'}` +
          ` (${each.toFixed(1)}s each)${row.notes.length > 0 ? ` — ${row.notes.join('; ')}` : ''}`,
      );
    },
    total,
    limit,
    skip,
    first,
  );

  console.error(`Wrote ${written} Pokémon to ${out}`);

  const short = shortfall('the full pass', visited, total, skip, limit);

  if (short) {
    throw new Error(`${short}; \`--skip ${skip + visited}\` carries on from the next one`);
  }
}

/**
 * A screenshot of a screen that has stopped moving, which is what a fixed wait after a swipe can only guess at. The
 * cost is one extra screenshot where the screen was already still, and the gain is that a scan slowed down by anything
 * — a phone thinking, an animation that ran long — waits for it rather than reading through it.
 */
async function settled(device: Device): Promise<Image> {
  let previous = await device.screenshot();

  for (let attempt = 1; attempt < SETTLE_ATTEMPTS; attempt++) {
    const image = await device.screenshot();

    if (difference(previous, image, SETTLE_BAND.from, SETTLE_BAND.to) < SETTLE_CHANGE) {
      return image;
    }

    previous = image;
  }

  return previous;
}

/** What a scroll capture took, and what `stitch` and the way back up need from it. */
interface Capture {
  frames: Image[];

  /** The shift between each consecutive pair, as `stitch` takes them, and what they sum to is the way back up. */
  offsets: number[];

  /** Whether it stopped on two frames that would not line up, rather than on reaching the end. */
  lost: boolean;
}

/**
 * Every frame of the screen from here to its bottom, dragging half the scrolling band at a time — `SCROLL_STEP`, kept
 * within what `offsetBetween` looks for — and waiting for each frame to settle. Stops on a frame that has not moved,
 * which is what reaching the end looks like; on one that will not line up, which is left out; or at `SCROLL_FRAMES`,
 * so a screen that never stops moving is a short capture rather than a scan that does not come back.
 *
 * It does not scroll back up: `scrollUp` does, by what the offsets sum to. The last drag always moved nothing, so what
 * it dragged is no part of the way back.
 *
 * `taken` stands in for the first frame, so the stitch holds the screen the caller already has rather than a second
 * photograph of it — shot twice seconds apart, the two differ over about half their rows as the artwork animates and
 * PGSharp redraws. What it buys is one identity: `crop(stitch, 0, 0, width, bandFoot)` is that screen row for row.
 *
 * **It is the one frame not waited for, so the caller owes it** still being what the phone is showing. A stale one
 * does not corrupt the stitch quietly: `offsetBetween` refuses the pair, so `lost` comes back true and the capture is
 * one frame long.
 */
async function scrollFrames(device: Device, taken?: Image): Promise<Capture> {
  const band = config.scrollBand;
  const first = taken ?? (await settled(device));
  const [from, to] = scrollStep(band, first.width, first.height);
  const frames = [first];
  const offsets: number[] = [];

  while (frames.length < SCROLL_FRAMES) {
    await device.swipe(from, to, SCROLL_DRAG_MS);
    const next = await settled(device);
    const moved = offsetBetween(frames.at(-1) as Image, next, band);

    if (moved === null) {
      return { frames, offsets, lost: true };
    }

    if (moved === 0) {
      break;
    }

    frames.push(next);
    offsets.push(moved);
  }

  return { frames, offsets, lost: false };
}

/**
 * Back up the screen by `pixels`, which is the distance it was measured to have scrolled. `screen` is any screenshot,
 * for its size.
 *
 * **A drag longer than the screen has scrolled does not stop at the top.** Once the content is there the game reads
 * the rest of the finger's travel as a swipe to dismiss and closes the panel, so asking for more than was scrolled
 * ends on the map and the swipe to the next Pokémon lands on nothing. One drag covers 0.55 of the height where a
 * detail screen scrolls 711 pixels of 2244, so a swipe per drag asked for roughly three times too much.
 *
 * Undershooting is the safe direction, the panel resetting when the game draws the next Pokémon. That is the scan's
 * invariant and not every caller's — one with no next Pokémon has to measure what is left and ask again, as `snap`
 * does.
 */
async function scrollUp(device: Device, screen: Image, pixels: number) {
  if (pixels <= 0) {
    return;
  }

  const [from, to] = config.swipes.scrollUp.map(([x, y]): Point => [x * screen.width, y * screen.height]) as [
    Point,
    Point,
  ];
  const reach = to[1] - from[1];

  // As few drags as the configured swipe reaches in, each an equal share, one drag covering only what fits on screen.
  const drags = Math.ceil(pixels / reach);
  const part = pixels / drags / reach;
  const end: Point = [from[0] + (to[0] - from[0]) * part, from[1] + reach * part];

  for (let i = 0; i < drags; i++) {
    // At the capture's own drag speed, and for its reason: a quick drag flings on past where the finger stopped, which
    // on the way back means landing above what `pixels` asked for and spending the overshoot on the dismiss gesture.
    await device.swipe(from, end, SCROLL_DRAG_MS);
    await sleep(config.waits.scroll);
  }
}

/**
 * A screenshot of whatever the phone is showing, read out field by field and saved, which is the tool for working out
 * why a scan misread something.
 *
 * It **refuses a capture a scan could not have used** rather than printing a page of nulls and exiting 0: the map, a
 * Pokémon with PGSharp's overlay off, and a scroll that lost its place. Nothing beyond those three is checked, so the
 * exit status says the capture is worth keeping rather than that every field came out. A missing HP is reported as a
 * missing HP and not as a screen that is not a detail screen, the two being indistinguishable from here.
 *
 * It takes a **scroll capture of every screen it can confirm**, and that stitch is what `NAME.png` is left holding.
 * The foot of a detail screen is below the phone, so the moves a misread was looking at are in no plain screenshot.
 * One file rather than two, the screen being recoverable from the stitch: `screenIn` crops to the `Viewport` written
 * on it. The plain screenshot keeps the name only where the overlay did not read, which is how the corpus's three
 * negatives were taken — so `NAME.png` is the best capture that could be had, and a fixture is committed unchanged.
 *
 * **A name that already holds a capture is left alone** where this run cannot better it, which is the whole of why
 * the screen is not written up front; `held` says why.
 *
 * What confirms a detail screen is the overlay rather than the HP — three numbers separated by slashes are a thing
 * only PGSharp draws — so the HP misreading, which is the case a snap is taken for, does not withhold the stitch.
 * Where the overlay did not read, the map and a detail screen cannot be told apart, and scrolling the map drags the
 * phone for nothing.
 *
 * It **puts the panel back where it found it**, which `--scroll` leaves to the scan: `scrollUp`'s undershoot is safe
 * only for a caller the game will draw another Pokémon for, and nothing redraws the panel after a snap. The way back
 * is asked for again until it is had, and said out loud rather than refused where it cannot be.
 *
 * **`--search` drives the phone to the Pokémon** instead of taking whatever is showing, which is what makes a capture
 * reproducible. Storage is somewhere only a game in front can be driven to, so the launch comes with it — see
 * `toStorage`. An empty grid is refused before anything is written, for the reason `held` gives, and the game master's
 * load comes forward so a cold-cache run with no network fails having written nothing.
 *
 * On a free name the screen is grabbed and written first, then read, then checked. Writing first is what makes a snap
 * of a broken phone useful, the readers being able to throw rather than read nothing. That write is a floor rather
 * than an artifact of its own, the stitch going over it wherever one can be had.
 *
 * Reading before any drag keeps a scroll capture of the wrong screen from driving the phone for nothing, and the game
 * master is loaded after the grab, `iconsFor` taking long enough on a cold cache for the phone to blank the screen.
 */
async function snap() {
  const name = rest[0] ?? new Date().toISOString().replaceAll(':', '-');

  const device = new Device(adbCli(options.serial));
  await device.check();

  const path = join(CACHE, 'snaps', `${name}.png`);

  // Whether this name already holds a capture, which decides when the screen may be written. One file means the screen
  // and the stitch share a path, so writing the screen up front — which is what keeps a snap of a phone nothing can be
  // read off from saving nothing — would truncate a good stitch a previous run saved, and the refusal below returns
  // before the new one is assembled.
  //
  // So the up-front write is held back wherever there is something to lose, and the screen reaches the file only on a
  // name that was free. A refused re-snap then leaves the earlier capture alone and says so, and a refused first snap
  // still lands — which is how the corpus's three negatives were taken.
  const held = existsSync(path);

  // What both refusals that write nothing end on, named once because the guarantee is one guarantee: the file under
  // this name is whatever the last run to get past here put there. `--search` has made this promise all along.
  const kept = 'nothing was written, so a snap already saved under this name is still the one that was there';

  const write = (image: Image, carry: Readonly<Record<string, string>> = {}) => {
    mkdirSync(join(CACHE, 'snaps'), { recursive: true });
    writeFileSync(path, encodePng(image, carry));
    console.log(`Saved ${path} (${image.width}×${image.height})`);
  };

  const refuse = (...whys: readonly string[]) => {
    for (const why of whys) {
      console.error(`snap: ${why}`);
    }

    process.exitCode = 1;
  };

  // At most one load however many things below want it. `--search` wants it before the grab, `toStorage` reading the
  // screen to tell the storage grid from a detail screen; without one nothing wants it until after, and that order is
  // deliberate — the screen was set up by hand there, and a cold `loadGameData` fetches 23 MB before `iconsFor` spends
  // minutes on the icons, long enough for the phone to blank what was set up for the snap.
  let loaded: GameData | null = null;
  const gameData = async () => (loaded ??= await loadGameData(CACHE, options.refresh));

  // Driven to the Pokémon rather than taking what is showing, which is what makes a capture reproducible: the search
  // names what it wanted, where a screen set up by hand records nothing about which Pokémon that was.
  if (options.search !== undefined) {
    const { tap, search, matches, matched, firstTile } = storage(
      device,
      config,
      await gameData(),
      await device.screenshot(),
    );
    const grid = await search(options.search);

    // Checked before the grab, which is the one place something beats writing first: a grid with no Pokémon in it is
    // one `firstTile` taps blind, so what would be written over `NAME.png` is a screenshot of the storage grid — and
    // the refusals below would then blame the HP and the overlay without ever saying the search was what failed. The
    // re-snap of a Pokémon since powered up or traded away is exactly when it happens, which is to say when the fixture
    // being overwritten is the one still wanted.
    //
    // Which of the two it was goes unsaid, for the reason the missing HP above does: a grid whose first label misread
    // and a search that matched nothing cannot be told apart from here, and neither is a screen to snap.
    // The game's own count first, which says which of the two it was where `tileLabel` alone could not. A grid whose
    // first label misread still carries the counter, so only a search that really matched nothing is refused here.
    const found = matches(grid);

    if (!matched(grid)) {
      refuse(
        found === 0
          ? `--search ${JSON.stringify(options.search)} matched nothing, which the grid's own counter says`
          : `--search ${JSON.stringify(options.search)} left a grid with neither a counter nor a CP label in it`,
        kept,
      );

      return;
    }

    await tap(firstTile(grid), config.waits.swipe);
  }

  // Settled, so that what is read is the screen rather than the middle of an animation it was drawing.
  const image = await settled(device);

  if (!held) {
    write(image);
  }

  const data = await gameData();
  const read = await report(image, data, await iconsFor(CACHE, data, options.refresh));

  const refused = refusals(read);

  if (refused.length > 0) {
    refuse(...refused);
  }

  // The refusal above says the capture is not one a scan could have used; this says there is nothing to scroll. Only
  // the overlay separates the two, per the doc: a screen whose HP alone misread is scrolled, refusal and all.
  //
  // Nothing more is written on the way out. On a free name the screen is already down, which is the capture; on a name
  // that was held, the run has produced no stitch and the screen it did produce is the worse of the two, so what was
  // there stays and the status says which it is.
  if (read.overlay === null) {
    if (held) {
      refuse(kept);
    }

    return;
  }

  // The whole screen stitched out of as many frames as it takes. The report above ran on the unstitched screen — it is
  // all there was then — so what the report read is not what lands on disk here. This write is the only one on an
  // accepted capture, going over the screen on a free name and being the first on a name that was held.
  const capture = await scrollFrames(device, image);
  const total = capture.offsets.reduce((a, b) => a + b, 0);
  const scrolled = `${capture.offsets.join(' + ') || 0} = ${total} pixels`;

  // `Viewport` is the one thing a stitch cannot say about itself: its own `IHDR` height is as many frames as the screen
  // took, so the height the phone drew is unrecoverable from the file, and the file is the only place that travels with
  // it. Written on the stitch alone, a screen's own height being that number already — which is why the plain
  // screenshot left under this name where the overlay did not read carries no chunk at all.
  //
  // It buys the height and not the pixels, and `stitch`'s layout is why: rows down to the band's foot are frame 1
  // verbatim, the rows after it are the next frame's revealed content, and the screen's own floating buttons were
  // appended at the far end. So `screenIn` gives every reader an image of the height it was measured against — which is
  // what a fixture rests on — while the crop that *is* the screen row for row stops short at the foot, 1997 rows of
  // 2244 here. `stitch.test.mts` pins both halves of that.
  //
  // Said before the write rather than after it, so that the two `Saved` lines this run prints against the one path are
  // not consecutive: the second is the stitch going over the screen, and back to back they would read as a repeat.
  console.log(`Stitched ${capture.frames.length} frames, scrolling ${scrolled} past the first.`);
  write(stitch(capture.frames, capture.offsets, config.scrollBand), {
    Viewport: `${image.width}x${image.height}`,
  });
  await scrollUp(device, image, total);

  // The way back measured rather than assumed, against the screenshot already in hand, and asked for again by whatever
  // the last drag left: `scrollUp` undershoots on purpose and no next Pokémon is coming to reset the panel. It stops
  // within `SCROLL_BACK_FLOOR` of where it started, or where a pass no longer gains — the test `scrollFrames` ends on,
  // and what keeps this from dragging for ever at a panel that will not move.
  const floor = image.height * SCROLL_BACK_FLOOR;
  const scrolledPast = async () => offsetBetween(image, await settled(device), config.scrollBand);
  let left = await scrolledPast();

  while (left !== null && left > floor) {
    await scrollUp(device, image, left);
    const after = await scrolledPast();

    if (after === null || after >= left) {
      left = after;
      break;
    }

    left = after;
  }

  // Said rather than refused: the capture is written and is what the snap was taken for, so the status goes on meaning
  // it is worth keeping. What a panel left down costs is the next snap of this screen, which nothing here can fix and
  // whoever takes it should hear about.
  if (left === null) {
    console.error('snap: the screen stopped lining up with the one captured, so the phone was left off the Pokémon');
  } else if (left > floor) {
    console.error(`snap: the panel is left ${left} pixels down, so another snap of this screen would be shifted`);
  }

  // A capture that lost its place is short by however much it had left to go, and a stitch of one frame is the screen
  // over again, carrying a `Viewport` the same height as itself. Either is a picture of something that was on the
  // screen, so it is kept and refused rather than thrown away — but it is not the whole screen a snap saves, and the
  // status has to say so.
  if (capture.lost) {
    refuse(`the scroll lost its place after frame ${capture.frames.length}, so the stitch is short`);
  }
}

// Last, so that everything above is initialised before anything runs.
if (command === 'scan') {
  // Held open for the scan's touchscreen, which goes with it, and so closed however the scan ends: open, it would keep
  // the process waiting on it after the last row.
  const held = adbHeld(options.serial);

  try {
    await scan(held);
  } finally {
    held.close();
  }
} else if (command === 'snap') {
  await snap();
} else if (command === 'parse' && rest.length > 0) {
  const data = await loadGameData(CACHE, options.refresh);
  const icons = await iconsFor(CACHE, data, options.refresh);

  // Ahead of the first header rather than under it, being about every screen below.
  key();

  for (const path of rest) {
    console.log(`\n=== ${basename(path)}`);
    await report(decodePng(readFileSync(path)), data, icons);
  }
} else {
  (command === 'help' ? console.log : console.error)(USAGE);
  process.exit(command === 'help' ? 0 : 1);
}
