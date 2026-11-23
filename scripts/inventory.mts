#!/usr/bin/env node

/**
 * `scan` writes every Pokémon in storage as JSON Lines, one object per Pokémon: species, form, costume, shiny, lucky,
 * size, Dynamax or Gigantamax, CP, HP, level, IVs and moves, with the raw game IDs each was derived from beside it. It
 * reads them off PGSharp's export rather than the screen — the whole account, decoded, which PGSharp writes to a file
 * on the phone once its inventory export is switched on in its own settings — so a box that took the walk a day comes
 * over in the time it takes to pull and parse. `snap`, `parse` and `dex` still read the screen with Tesseract: `dex` to
 * walk the Pokédex, which the export does not carry, and `snap` and `parse` to read a single detail screen as the
 * Inventory page does, bound to go with that page in a later change.
 *
 * The export is `/sdcard/Download/PGSharp/PGSStats.json`, read with `cat` over the shell and turned into rows by
 * `src/tools/inventory/snapshot.mts`: the species is the number the game gives it, the form is named off the export's
 * own form name, the level is the exact CP multiplier, and shininess, luckiness, size, shadow, purified, Dynamax,
 * Gigantamax, the moves and the tags come straight off it. Everything the walk used to work out from the screen — the
 * IVs off PGSharp's overlay, the form from the HP, shadow from the stardust a power-up costs — the export states
 * outright.
 *
 * A scroll capture drags the screen up until it stops moving and stitches the frames into one tall image, which is how
 * a screen longer than the phone is seen whole. The stitch is **not** given to the other readers, and that is a limit
 * rather than an oversight: the star corner, the overlay sweep, the tag band and the artwork are each anchored on a
 * fraction of the image's height. `parseMoves` is the one reader that is not, being anchored on `GYMS & RAIDS`, and
 * `powerUpOn` finds its row by the label wherever it is, for a screen that ends above it.
 *
 * `snap` and `parse` read a single detail screen and print what each reader makes of it, for working out why a reader
 * went wrong — a job the scan, reading exact values off the export, no longer has, so they go with the Inventory page
 * they share their readers with. Every tap position, swipe and delay is in `DEFAULTS` and can
 * be overridden from a JSON file passed as `--config`, with positions as fractions of the screen so one file suits any
 * phone of the same shape. Each prints its answer — species, form, CP, HP, level, IVs and moves, once each, coloured by
 * whether it was read off the screen or worked out from what was — with the notes that qualify it. `--verbose` adds the
 * lines OCR found with their boxes, which is what separates a field left empty because no text was read there from one
 * left empty because a reader anchored on the wrong line, and what each reader made of them. A snap saves the whole
 * screen stitched out of a scroll, or the plain screenshot where PGSharp's overlay did not read, which is where nothing
 * is scrolled at all; one that fails leaves a capture already saved under its name as it was. `--search` is what lets a
 * capture name the Pokémon it wants rather than take a screen set up by hand.
 *
 * PGSharp is a modified client, and reading the game's data out of it — like driving the phone for the others — breaks
 * Niantic's terms of service. These only read, but the risk to the account is the user's to weigh.
 *
 * Usage, from the repository root, with the phone plugged in and USB debugging on; `snap`, `parse` and `dex` also want
 * Pokémon GO open and in English:
 *
 *   pnpm inventory scan [OPTIONS]
 *     Pull PGSharp's inventory export off the phone and write one line of JSON for each stored Pokémon. Switch the
 *     export on in PGSharp's settings first.
 *
 *     --out FILE   write to FILE rather than inventory.jsonl, replacing what it held
 *     also the shared --serial and --refresh
 *
 *   pnpm inventory snap [OPTIONS] [NAME]
 *     Save the screen as .cache/inventory/snaps/NAME.png, named for the time when NAME is not given, and print what
 *     each reader makes of it. Fails unless it is a detail screen carrying PGSharp's overlay.
 *
 *     --search TERM       open the first Pokémon storage's own search matches, as --search '+burmy & cp196'
 *     also the shared --config, --serial, --user, --refresh and --verbose
 *
 *   pnpm inventory parse [OPTIONS] FILE.png…
 *     Print what each reader makes of screenshots already saved. Needs no phone.
 *
 *     also the shared --config, --refresh and --verbose
 *
 *   pnpm inventory dex [OPTIONS]
 *     Walk the Pokédex and write one line of JSON for each species, then check the record against the counts each
 *     tab prints. Fails naming each region and tab that disagrees, keeping the lines it wrote.
 *
 *     --out FILE          write to FILE rather than pokedex.jsonl
 *     --from N, --to M    walk only numbers N to M, replacing just their lines of --out
 *     --keep-screens DIR  save each screen read to DIR
 *     also the shared --config, --serial, --user, --refresh and --verbose
 *
 * Shared options:
 *
 *   --config FILE    take taps, swipes and waits from FILE, over `DEFAULTS` in `src/tools/inventory/config.mts`
 *   --serial SERIAL  the phone to drive, where more than one is plugged in
 *   --user N         the Android user whose copy of the game to drive: 0 personal, 10 a work profile
 *   --refresh        download the game data again rather than use a copy less than a week old
 *   --verbose        narrate reading the form icons, and for snap and parse print what OCR read and each raw reading
 *
 * A flag a command does not list is refused rather than ignored. `help`, or `--help` beside any command, prints this.
 */

import { said } from '../src/errors.ts';
import { adbCli, adbHeld } from '../src/core/node/adb-cli.mts';
import { Device, type Transport } from '../src/core/adb.mts';
import { signatureOfIcon, signaturesFor, type Colourings } from '../src/tools/inventory/artwork.mts';
import { configWith, DEFAULTS, type Point } from '../src/tools/inventory/config.mts';
import { wardrobeFor, type Wardrobe } from '../src/tools/inventory/costume.mts';
import { CACHE, cachedIcon, loadGameData } from '../src/core/node/download.mts';
import { type Form, type GameData } from '../src/core/game-master.mts';
import { tesseractCli } from '../src/core/node/ocr-cli.mts';
import { useEngine, type Line } from '../src/core/ocr.mts';
import { decodePng, encodePng, type Image } from '../src/core/png.mts';
import { showProgress } from '../src/tools/inventory/progress.mts';
import {
  answer,
  dumped,
  NO_BOX,
  NO_OVERLAY,
  printable,
  readScreen,
  refusals,
  type Source,
} from '../src/tools/inventory/report.mts';
import { LAST_DEX } from '../src/pokemon/generations.ts';
import { pokedex, TABS, type Entry } from '../src/tools/inventory/pokedex-walk.mts';
import { parseSnapshot, rowsOf } from '../src/tools/inventory/snapshot.mts';
import { scrollFrames, scrollUp, settled } from '../src/tools/inventory/scroll.mts';
import { offsetBetween, stitch } from '../src/tools/inventory/stitch.mts';
import { storage, unsearchable } from '../src/tools/inventory/storage.mts';
import { touchscreen } from '../src/core/touchscreen.mts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs, styleText } from 'node:util';

/**
 * How far down the panel may be left after a snap has dragged it back, as a fraction of the screen's height, under
 * which another drag is not asked for. A finger travelling less than the system's touch slop — 8dp, around 24 pixels on
 * the phone `SCREEN_BAND` was measured on — arrives as a tap rather than a drag, and a tap on a detail screen opens
 * something. So this is where a drag stops being one, and what it leaves is under a line of the panel's own text.
 */
const SCROLL_BACK_FLOOR = 0.012;

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'out': { type: 'string', default: 'inventory.jsonl' },
    'keep-screens': { type: 'string' },
    'search': { type: 'string' },
    'from': { type: 'string' },
    'to': { type: 'string' },
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
  .match(/Usage[^]*?(?=\n \*\/)/)?.[0]
  .replace(/^ \* ?/gm, '');

/**
 * Which flags each command acts on. `parseArgs` takes one flat set of options, so nothing else says where a flag
 * belongs: `parse --out inventory.jsonl` wrote nothing and said nothing about it. Stated once here, so the rejection
 * below and the usage block above cannot drift apart without a test noticing.
 *
 * `--config` is on `snap` and `dex`, which drive the phone out of it, reading `taps`, `swipes`, `waits` and
 * `scrollBand`, and on `parse`, which reaches `overlay` alone and only through `report`; the fields are named so the
 * claim can be grepped for. `scan` reads the whole account from PGSharp's export in one pull, so it takes none of the
 * walk's flags — only where to write and which phone to read.
 */
const HONOURED: Record<string, readonly string[]> = {
  scan: ['out', 'serial', 'refresh'],
  snap: ['search', 'verbose', 'refresh', 'config', 'serial', 'user'],
  parse: ['verbose', 'refresh', 'config'],
  dex: ['out', 'from', 'to', 'keep-screens', 'config', 'serial', 'user', 'refresh', 'verbose'],
};

/**
 * The flags actually typed, which `options` cannot answer: `parseArgs` fills in every flag carrying a `default`, so
 * `out`, `refresh` and `verbose` are in it whether or not anyone asked for them. `argv` is the only place that still
 * knows the difference, and taking the name up to the `=` is what makes `--out=x` read the same as `--out x`.
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
 */
function refusedSearch(term: string | undefined): string | null {
  if (term === undefined) {
    return null;
  }

  const unsent = unsearchable(term);

  if (unsent !== null) {
    return `--search ${unsent}`;
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

/** A flag's whole-number value, or `fallback` where it was not given; refused where it is not a whole number. */
function count(option: string, value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const n = Number(value);

  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`--${option} takes a whole number, not ${value}`);
  }

  return n;
}

// Only for a command that searches: `help` has no list to have filtered `--search` out, and prints the usage regardless.
const refused = honoured?.includes('search') ? refusedSearch(options.search) : null;

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
function colourKey() {
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

/** The colourings of every form the artwork could settle, its icons out of the same cache. */
const iconsFor = (data: GameData) =>
  signaturesFor(data, async (file) => signatureOfIcon(await cachedIcon(CACHE, options.refresh)(file)));

/**
 * Everything each reader makes of one screenshot, for tuning: `readScreen` does the reading, which the Inventory page
 * shares, and this prints it. The answer first, each field once and coloured by where it came from; then, for
 * `--verbose`, the lines OCR found and the `Detail`, `Overlay` and `Identity` the answer was drawn from.
 */
async function report(image: Image, data: GameData, icons: ReadonlyMap<Form, Colourings>) {
  const read = await readScreen(image, data, icons, config.overlay, wardrobeOn(data));
  colourKey();

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

const PGSTATS = '/sdcard/Download/PGSharp/PGSStats.json';

/**
 * The whole box as `inventory.jsonl`, read off PGSharp's export rather than the screen: every Pokémon the game has in
 * hand, decoded, read with `cat` over the shell and turned into the rows the walk used to read one detail screen at a
 * time. The export is switched on in PGSharp's own settings, and a phone without it there fails naming it, having
 * written nothing. The game master's load follows the pull, so a cold-cache run with no network fails before it writes.
 */
async function scan() {
  const device = new Device(adbCli(options.serial));

  // So that an unplugged, unauthorised or offline phone is named as that rather than reported as a missing export.
  await device.check();

  let text: string;

  // `Device.read` runs `cat` over the shell, which carries its exit status back, so a file the phone does not have
  // fails here rather than reading back as `cat`'s own message — the likely cause, the phone having answered `check`
  // above. But a slow link timing out or an export too big for the read's buffer fail here too, so the underlying
  // reason leads and the export hint is only offered, not asserted. A present-but-corrupt export is not caught here:
  // it reads fine and fails the parse below, a different thing to say than that there is nothing to read.
  try {
    text = new TextDecoder().decode(await device.read(PGSTATS));
  } catch (error) {
    const reason = said(error);

    throw new Error(
      `could not read the export off the phone: ${reason} — switch PGSharp's inventory export on if it is off`,
      { cause: error },
    );
  }

  const snapshot = parseSnapshot(text);
  const data = await loadGameData(CACHE, options.refresh);
  const rows = rowsOf(snapshot, data);

  writeFileSync(options.out, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : ''));
  console.error(`Wrote ${rows.length} Pokémon to ${options.out}`);
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
 * It **puts the panel back where it found it**: `scrollUp`'s undershoot is safe only for a caller the game will draw
 * another Pokémon for, and nothing redraws the panel after a snap. The way back is asked for again until it is had, and
 * said out loud rather than refused where it cannot be.
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

  const write = (picture: Image, carry: Readonly<Record<string, string>> = {}) => {
    mkdirSync(join(CACHE, 'snaps'), { recursive: true });
    writeFileSync(path, encodePng(picture, carry));
    console.log(`Saved ${path} (${picture.width}×${picture.height})`);
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
  const read = await report(image, data, await iconsFor(data));

  const reasons = refusals(read);

  if (reasons.length > 0) {
    refuse(...reasons);
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
  const capture = await scrollFrames(device, config, image);
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
  await scrollUp(device, config, image, total);

  // The way back measured rather than assumed, against the screenshot already in hand, and asked for again by whatever
  // the last drag left: `scrollUp` undershoots on purpose and no next Pokémon is coming to reset the panel. It stops
  // within `SCROLL_BACK_FLOOR` of where it started, or where a pass no longer gains — the test `scrollFrames` ends on,
  // and what keeps this from dragging for ever at a panel that will not move.
  const floor = image.height * SCROLL_BACK_FLOOR;
  const scrolledPast = async () => offsetBetween(image, await settled(device), config.scrollBand);
  let left = await scrolledPast();

  while (left !== null && left > floor) {
    await scrollUp(device, config, image, left);
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

/**
 * The numbers `--from` and `--to` cover, read ahead of the phone so a typo is refused before anything is driven or
 * leased. Neither given is every number there is.
 */
function dexRange() {
  const from = count('from', options.from, 1);
  const to = count('to', options.to, LAST_DEX);

  if (from < 1 || from > to || from > LAST_DEX) {
    throw new Error(
      `--from ${from} --to ${to} covers no species: --from is at least 1, no more than --to and no more than ${LAST_DEX}`,
    );
  }

  return { from, to };
}

/**
 * Walks the Pokédex from `from` to `to` and writes a line for each species it reaches, then checks the whole record
 * against what the game counts. The file is rewritten as each line is read, each species read replacing its own line
 * and every other line left as it was, so a run cut short keeps what it read and leaves the rest of the record alone;
 * and it is not touched until the first entry has been read, so a run that cannot start leaves an earlier one where it
 * was.
 *
 * `held` is the shell the touchscreen is made on, which the caller closes once the walk is over.
 */
async function dex(held: Transport, { from, to }: ReturnType<typeof dexRange>) {
  const out = passed.includes('out') ? options.out : 'pokedex.jsonl';
  const device = new Device(adbCli(options.serial));
  await device.check();
  const data = await loadGameData(CACHE, options.refresh);

  // The touchscreen because `input swipe` drops a swipe in ten, and a dropped one reads here as the end of the Pokédex.
  const touch = await touchscreen(held).catch((error: unknown) => {
    console.error(
      `${said(error)}; swiping with \`input swipe\` instead, which can drop a swipe and end the walk early`,
    );

    return null;
  });

  // In fractions of the screen, which the touchscreen takes as they are and `input swipe` wants in pixels.
  const { width, height } = await device.screenshot();
  const drag = async (start: Point, end: Point, ms: number) =>
    touch
      ? touch.swipe(start, end, ms)
      : device.swipe([start[0] * width, start[1] * height], [end[0] * width, end[1] * height], ms);

  const screens = options['keep-screens'];

  if (screens) {
    mkdirSync(screens, { recursive: true });
  }

  const { walk, tally } = pokedex({
    device,
    config,
    data,
    icon: cachedIcon(CACHE, options.refresh),
    drag,
    keep: (name, image) => screens && writeFileSync(join(screens, `${name}.png`), encodePng(image)),
    say: console.error,
  });

  const earlier: Entry[] = existsSync(out)
    ? readFileSync(out, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Entry)
    : [];
  const read = new Map<number, Entry>();

  // The record as far as the walk has got: each species read replaces its own line, and every other line stays as it
  // was. A species the walk did not read is one it passed over, never reached, or stopped on, and from here those look
  // alike; only reading it says anything new about it, and a line gone stale is the count's to name.
  const record = () => [...earlier.filter((e) => !read.has(e.dex)), ...read.values()].sort((a, b) => a.dex - b.dex);

  for await (const entry of walk(from, to)) {
    read.set(entry.dex, entry);
    writeFileSync(
      out,
      record()
        .map((e) => `${JSON.stringify(e)}\n`)
        .join(''),
    );

    const registered = TABS.slice(1)
      .filter((tab) => tab.counts(entry))
      .map((tab) => tab.label.toLowerCase());
    const forms = entry.forms.length > 1 ? `, ${entry.forms.length} forms` : '';
    const costumes = entry.costumes.length > 0 ? `, ${entry.costumes.length} costumes` : '';
    console.error(
      `#${entry.dex} ${entry.species} ${entry.caught ? 'caught' : 'seen'}${forms}${costumes}` +
        `${registered.length > 0 ? ` — ${registered.join(', ')}` : ''}${entry.notes.length > 0 ? ` (${entry.notes.join('; ')})` : ''}`,
    );
  }

  console.error(`Wrote ${read.size} species to ${out}; checking them against the Pokédex's own counts`);

  const { mismatches, unread } = await tally(record());

  for (const { tab, regions } of unread) {
    console.error(`  ${tab}: no count read for ${regions.join(', ')}, so the record there was not checked`);
  }

  for (const { tab, region, game, record: written } of mismatches) {
    console.error(`  ${tab} in ${region}: the game counts ${game}, the record ${written}`);
  }

  if (mismatches.length > 0) {
    throw new Error(
      `the record disagrees with the game in ${mismatches.length} place${mismatches.length === 1 ? '' : 's'}; ` +
        `every line read is kept in ${out}, and a region outside --from and --to that disagrees is one to walk again`,
    );
  }
}

// Last, so that everything above is initialised before anything runs.
if (command === 'scan') {
  await scan();
} else if (command === 'dex') {
  const range = dexRange();
  const held = adbHeld(options.serial);

  try {
    await dex(held, range);
  } finally {
    held.close();
  }
} else if (command === 'snap') {
  await snap();
} else if (command === 'parse' && rest.length > 0) {
  const data = await loadGameData(CACHE, options.refresh);
  const icons = await iconsFor(data);

  // Ahead of the first header rather than under it, being about every screen below.
  colourKey();

  for (const path of rest) {
    console.log(`\n=== ${basename(path)}`);
    await report(decodePng(readFileSync(path)), data, icons);
  }
} else {
  (command === 'help' ? console.log : console.error)(USAGE);
  process.exit(command === 'help' ? 0 : 1);
}
