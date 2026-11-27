#!/usr/bin/env node

/**
 * `scan` writes every Pokémon in storage as JSON Lines, one object per Pokémon: species, form, costume, shiny, lucky,
 * size, Dynamax or Gigantamax, CP, HP, level, IVs and moves, with the raw game IDs each was derived from beside it. It
 * reads them off PGSharp's export rather than the screen — the whole account, decoded, which PGSharp writes to a file
 * on the phone once its inventory export is switched on in its own settings — so a box that took the walk a day comes
 * over in the time it takes to pull and parse. `dex` still reads the screen with Tesseract, to walk the Pokédex, which
 * the export does not carry.
 *
 * The export is `/sdcard/Download/PGSharp/PGSStats.json`, read with `cat` over the shell and turned into rows by
 * `src/tools/inventory/snapshot.mts`: the species is the number the game gives it, the form is named off the export's
 * own form name, the level is the exact CP multiplier, and shininess, luckiness, size, shadow, purified, Dynamax,
 * Gigantamax, the moves and the tags come straight off it. Everything the walk used to work out from the screen — the
 * IVs off PGSharp's overlay, the form from the HP, shadow from the stardust a power-up costs — the export states
 * outright.
 *
 * PGSharp is a modified client, and reading the game's data out of it — like driving the phone for `dex` — breaks
 * Niantic's terms of service. These only read, but the risk to the account is the user's to weigh.
 *
 * Usage, from the repository root, with the phone plugged in and USB debugging on; `dex` also wants Pokémon GO open and
 * in English:
 *
 *   pnpm inventory scan [OPTIONS]
 *     Pull PGSharp's inventory export off the phone and write one line of JSON for each stored Pokémon. Switch the
 *     export on in PGSharp's settings first.
 *
 *     --out FILE   write to FILE rather than inventory.jsonl, replacing what it held
 *     also the shared --serial and --refresh
 *
 *   pnpm inventory dex [OPTIONS]
 *     Walk the Pokédex and write one line of JSON for each species, then check the record against the counts each
 *     tab prints. Fails naming each region and tab that disagrees, keeping the lines it wrote.
 *
 *     --out FILE          write to FILE rather than pokedex.jsonl
 *     --from N, --to M    walk only numbers N to M, replacing just their lines of --out
 *     --keep-screens DIR  save each screen read to DIR
 *     also the shared --config, --serial, --user and --refresh
 *
 * Shared options:
 *
 *   --config FILE    take taps, swipes and waits from FILE, over `DEFAULTS` in `src/tools/inventory/config.mts`
 *   --serial SERIAL  the phone to drive, where more than one is plugged in
 *   --user N         the Android user whose copy of the game to drive: 0 personal, 10 a work profile
 *   --refresh        download the game data again rather than use a copy less than a week old
 *
 * A flag a command does not list is refused rather than ignored. `help`, or `--help` beside any command, prints this.
 */

import { said } from '../src/errors.ts';
import { adbCli, adbHeld } from '../src/core/node/adb-cli.mts';
import { Device, type Transport } from '../src/core/adb.mts';
import { configWith, DEFAULTS, type Point } from '../src/tools/inventory/config.mts';
import { CACHE, cachedIcon, loadGameData } from '../src/core/node/download.mts';
import { tesseractCli } from '../src/core/node/ocr-cli.mts';
import { useEngine } from '../src/core/ocr.mts';
import { encodePng } from '../src/core/png.mts';
import { LAST_DEX } from '../src/pokemon/generations.ts';
import { pokedex, TABS, type Entry } from '../src/tools/inventory/pokedex-walk.mts';
import { PGSTATS } from '../src/tools/inventory/pgstats.mts';
import { parseSnapshot, rowsOf } from '../src/tools/inventory/snapshot.mts';
import { touchscreen } from '../src/core/touchscreen.mts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'out': { type: 'string', default: 'inventory.jsonl' },
    'keep-screens': { type: 'string' },
    'from': { type: 'string' },
    'to': { type: 'string' },
    'config': { type: 'string' },
    'serial': { type: 'string' },
    'user': { type: 'string' },
    'refresh': { type: 'boolean', default: false },
    'help': { type: 'boolean', default: false },
  },
});

// `--help` stands in for the command rather than going beside it, so `scan --help` prints the usage instead of being
// refused as a flag `scan` does not act on.
const [command = 'help'] = options.help ? [] : positionals;

/**
 * The synopsis out of this file's own header. Read once rather than where it is printed, because an argument error
 * wants it as much as `help` does: a complaint about a flag is most useful beside the list the flag was not on.
 */
const USAGE = readFileSync(new URL(import.meta.url), 'utf8')
  .match(/Usage[^]*?(?=\n \*\/)/)?.[0]
  .replace(/^ \* ?/gm, '');

/**
 * Which flags each command acts on. `parseArgs` takes one flat set of options, so nothing else says where a flag
 * belongs: `scan --keep-screens DIR` would read the export and say nothing about a flag it does not act on. Stated once
 * here, so the rejection below and the usage block above cannot drift apart without a test noticing.
 *
 * `--config` is on `dex` alone, which drives the phone out of it, reading `taps`, `swipes` and `waits`; the fields are
 * named so the claim can be grepped for. `scan` reads the whole account from PGSharp's export in one
 * pull, so it takes none of the
 * walk's flags — only where to write and which phone to read.
 */
const HONOURED: Record<string, readonly string[]> = {
  scan: ['out', 'serial', 'refresh'],
  dex: ['out', 'from', 'to', 'keep-screens', 'config', 'serial', 'user', 'refresh'],
};

/**
 * The flags actually typed, which `options` cannot answer: `parseArgs` fills in every flag carrying a `default`, so
 * `out` and `refresh` are in it whether or not anyone asked for them. `argv` is the only place that still knows the
 * difference, and taking the name up to the `=` is what makes `--out=x` read the same as `--out x`.
 */
const passed = process.argv.slice(2).flatMap((arg) => /^--([a-z-]+)/.exec(arg)?.[1] ?? []);

// `hasOwn` rather than the lookup alone, because a plain object inherits from `Object.prototype`: `HONOURED.toString`
// answers a function, which is truthy, so `toString --refresh` reached `.includes` on it and threw where it should have
// fallen through to the usage. Only ever with a flag alongside, an empty list never invoking the filter.
const honoured = Object.hasOwn(HONOURED, command) ? HONOURED[command] : undefined;
const ignored = honoured ? passed.filter((flag) => !honoured.includes(flag)) : [];

// Only for a command that has a list: `help` and a typo fall through to the usage below, which says more than this can.
if (ignored.length > 0) {
  console.error(`${command} does not act on ${ignored.map((flag) => `--${flag}`).join(', ')}\n`);
  console.error(USAGE);
  process.exit(1);
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

// The CLI reads with the Tesseract on `PATH`; the pages install the WebAssembly build in its place.
useEngine(tesseractCli);

// Read here rather than in `configWith`, `config.mts` being shared with the browser, which has no file to read.
// `--user` goes over the file's `"user"`, as a flag typed for one run should over a file kept for every run.
const config = {
  ...(options.config === undefined ? DEFAULTS : configWith(JSON.parse(readFileSync(options.config, 'utf8')))),
  ...(options.user === undefined ? {} : { user: count('user', options.user, 0) }),
};

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
} else {
  (command === 'help' ? console.log : console.error)(USAGE);
  process.exit(command === 'help' ? 0 : 1);
}
