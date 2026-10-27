/**
 * Plays Pokémon GO's trainer battles on an Android phone over `adb`, watching the screen as H.264 from `screenrecord`
 * rather than screenshot by screenshot — a screenshot takes longer than a turn. Team Leader training is what it is built
 * against: a battle with nothing at stake, which is where its timing and its reading of the screen are tuned. GO Battle
 * League plays the same battles against other trainers, with the game's Recommended Battle Party.
 *
 * Usage, from the repository root, with the phone plugged in, USB debugging on and Pokémon GO in English:
 *
 *   pnpm battle run --leader blanche|candela|spark --league great|ultra|master [--count N] [--serial SERIAL]
 *                   [--keep-frames DIR] [--verbose]
 *   pnpm battle run --mode gbl --league LEAGUE [--party NAME] [--count N] [--serial SERIAL] [--keep-frames DIR]
 *                   [--verbose]
 *                       play Team Leader or GO Battle League battles one after another, from the map or anywhere
 *                       between the result of one battle and the start of the next, until `N` have finished or
 *                       Ctrl-C; stops where nothing on screen has been recognised for 20s. GO Battle League stops at
 *                       the end of a set with a reward to collect, the encounter among them, which is left to be
 *                       caught by hand.
 *                       `DIR` is given the frames from a second before each faint, ours or theirs, and each shield
 *                       prompt to a second after it, named by when they were seen and for what, as
 *                       `0012.437s-shield.png`, and the last frames before a run stops for nothing recognised.
 *                       `LEAGUE` is how the title of one league on now starts, as `ultra` or `fantasy cup`, and
 *                       `NAME` a party saved for it, which is battled with rather than whichever the screen opens
 *                       on; one not saved stops the run.
 *                       On a terminal, which it takes over until it stops, a table shows the battle, ours at the
 *                       left and the opponent's at the right, and what each side does under it, with how the run
 *                       stands above it and the menus it taps through below, and the phone's screen down the left
 *                       where the terminal draws Kitty graphics and is wide enough; `--verbose` writes the same as
 *                       lines where stderr is not a terminal, each after how long the run has gone on
 *   pnpm battle record [--seconds N] [--serial SERIAL] OUT
 *                       save `N` seconds (30 unless given, at most 180) of the screen to `OUT` as the raw H.264
 *                       a battle decodes, which is what the recognition fixtures are cut from
 *   A flag handed to a command whose line omits it is refused rather than ignored — see `HONOURED`.
 *   `help`, or `--help` beside any command, prints this.
 *
 * Automating input breaks Niantic's terms of service, and unlike `pnpm inventory` this does not only read: it taps
 * through battles. Run it on an account whose loss you would accept.
 */

import { ICON_BASE, POGO_ASSETS } from '../src/pokedex/icons.ts';
import { LEADERS, LEAGUES, type Mode } from '../src/tools/battle/menus.mts';
import { loadMeta } from '../src/tools/battle/meta.mts';
import { silhouetteOfIcon, type Icon } from '../src/tools/battle/party.mts';
import { pictures } from '../src/tools/battle/kitty.mts';
import { live, plain } from '../src/tools/battle/report.mts';
import { Lost, run, type Clock, type Phone } from '../src/tools/battle/run.mts';
import { RECORD_LIMIT_S, Screen, screenrecord, streamSize } from '../src/tools/battle/stream.mts';
import { adbCli, adbHeld } from '../src/tools/inventory/adb-cli.mts';
import { Device } from '../src/tools/inventory/adb.mts';
import { CACHE, cachedAs, loadGameData } from '../src/tools/inventory/download.mts';
import { type GameData } from '../src/tools/inventory/game-master.mts';
import { tesseractCli } from '../src/tools/inventory/ocr-cli.mts';
import { useEngine } from '../src/tools/inventory/ocr.mts';
import { decodePng, encodePng, type Image } from '../src/tools/inventory/png.mts';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'mode': { type: 'string', default: 'training' },
    'leader': { type: 'string' },
    'league': { type: 'string' },
    'party': { type: 'string' },
    'count': { type: 'string' },
    'keep-frames': { type: 'string' },
    'verbose': { type: 'boolean', default: false },
    'seconds': { type: 'string', default: '30' },
    'serial': { type: 'string' },
    'help': { type: 'boolean', default: false },
  },
});

// `--help` stands in for the command rather than going beside it, so `run --help` prints the usage instead of being
// refused as a flag `run` does not act on.
const [command = 'help', ...rest] = options.help ? [] : positionals;

/** The synopsis out of this file's own header, as `inventory.mts` reads its own. */
const USAGE = readFileSync(new URL(import.meta.url), 'utf8')
  .match(/Usage[^]*?\n \*\n[^]*?\n \*\n/)?.[0]
  .replace(/^ \* ?/gm, '');

/** Which flags each command acts on, for the reason `inventory.mts` gives beside its own. */
const HONOURED: Record<string, readonly string[]> = {
  run: ['mode', 'leader', 'league', 'party', 'count', 'serial', 'keep-frames', 'verbose'],
  record: ['seconds', 'serial'],
};

const passed = process.argv.slice(2).flatMap((arg) => /^--([a-z-]+)/.exec(arg)?.[1] ?? []);
const honoured = Object.hasOwn(HONOURED, command) ? HONOURED[command] : undefined;
const ignored = honoured ? passed.filter((flag) => !honoured.includes(flag)) : [];

/** Fails with the usage rather than driving the phone, for anything a command cannot take. */
function fail(message: string): never {
  console.error(`${message}\n`);
  console.error(USAGE);
  process.exit(1);
}

if (ignored.length > 0) {
  fail(`${command} does not act on ${ignored.map((flag) => `--${flag}`).join(', ')}`);
}

/**
 * The game's own icon for each type, which the minigame's bubbles and the HUD's type icons are told by: 18 small files,
 * cached beside the form icons. A type whose icon cannot be had is swiped at in rows, as before the bubbles were aimed
 * at, and its icon in the HUD is read as no type.
 */
async function typeIcons(data: GameData): Promise<Record<string, Image>> {
  const read = await Promise.all(
    data.types.map(async (type) => {
      const file = `POKEMON_TYPE_${type.toUpperCase()}.png`;

      try {
        const icon = await cachedAs(join(CACHE, 'types'), file, `${POGO_ASSETS}Images/Types/${file}`, false, decodePng);

        return [[type, icon] as const];
      } catch {
        return [];
      }
    }),
  );

  return Object.fromEntries(read.flat());
}

/**
 * Every form's outline, which the party screen is read against: each icon the game draws, some 1,300 files and 40 MB
 * on the first run, cached beside the ones `pnpm inventory` keeps. One that cannot be had leaves its form unmatched
 * rather than stopping the run.
 */
async function silhouettes(data: GameData): Promise<Icon[]> {
  const icons = [...new Map(data.forms.flatMap((form) => (form.icon ? [[form.icon, form.species]] : []))).entries()];
  const read: Icon[] = [];
  let missing = 0;

  for (let at = 0; at < icons.length; at += 16) {
    const batch = icons.slice(at, at + 16).map(async ([icon, species]) => {
      try {
        const silhouette = await cachedAs(join(CACHE, 'icons'), icon, ICON_BASE + icon, false, (bytes) =>
          silhouetteOfIcon(decodePng(bytes)),
        );
        read.push({ species, silhouette });
      } catch {
        missing++;
      }
    });

    await Promise.all(batch);
  }

  if (missing > 0) {
    console.error(`${missing} of ${icons.length} form icons could not be had; those forms go unmatched`);
  }

  // None at all is every party read against nothing. Where no form even names an icon, it is the listing of the artwork
  // that failed, which `loadGameData` reports and carries on from: `pnpm inventory` loses only its narrowing by artwork.
  if (read.length === 0) {
    throw new Error('no form icon could be had, so no party could be read');
  }

  return read;
}

function oneOf<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T {
  const found = allowed.find((option) => option === value);

  return found ?? fail(`--${name} takes one of ${allowed.join(', ')}`);
}

if (command === 'run') {
  if (rest.length > 0) {
    fail('run takes no arguments beyond its flags');
  }

  const mode: Mode =
    oneOf('mode', options.mode, ['training', 'gbl']) === 'training'
      ? {
          mode: 'training',
          leader: oneOf('leader', options.leader, LEADERS),
          league: oneOf('league', options.league, LEAGUES),
        }
      : {
          mode: 'gbl',
          league: options.league?.trim() || fail('--mode gbl takes --league, as `ultra` or `fantasy cup`'),
          ...(options.party !== undefined && {
            party: options.party.trim() || fail('--party takes the name of a party saved for the league'),
          }),
        };

  if (mode.mode === 'gbl' && options.leader !== undefined) {
    fail('--leader is for training; GO Battle League has no leader');
  }

  if (mode.mode === 'training' && options.party !== undefined) {
    fail('--party is for GO Battle League; Training battles with the recommended party');
  }

  const count = options.count === undefined ? Infinity : Number(options.count);

  if (count !== Infinity && (!Number.isInteger(count) || count < 1)) {
    fail('--count takes a whole number of battles, 1 or more');
  }

  // Taps and swipes go through one held shell, six swipes a second being too many to start a process for each; the
  // settings put back on every way out go a process each, so that a shell gone with the connection still tries.
  const transport = adbCli(options.serial);
  const held = adbHeld(options.serial);
  const device = new Device(held);
  await device.check();
  useEngine(tesseractCli);

  // Which move is worth the most per energy, out of the game master `pnpm inventory` downloads and caches for a week.
  const data = await loadGameData(CACHE);
  const icons = await silhouettes(data);
  const types = await typeIcons(data);

  // What GO Battle League's players run in the league, out of PvPoke's rankings; Training allows for every move.
  const meta = mode.mode === 'gbl' ? await loadMeta(CACHE, data, mode.league) : null;

  // Awake for as long as it runs: a screen gone dark mid-battle reads as nothing recognised and ends the run. The
  // setting is read first and put back as found on every way out, `restore` and the Ctrl-C handler in place before it
  // is changed, and checked to be the number Android stores, since it goes back through the shell.
  const awake = new TextDecoder().decode(
    await transport.shell(['settings', 'get', 'global', 'stay_on_while_plugged_in']),
  );
  const before = /^\d+$/.test(awake.trim()) ? awake.trim() : '0';

  // A phone gone, unplugged mid-battle, cannot be put back: said in a line rather than thrown over the error that
  // stopped the run.
  const restore = () =>
    transport.shell(['settings', 'put', 'global', 'stay_on_while_plugged_in', before]).then(
      () => undefined,
      (error: unknown) =>
        console.error(
          `stay_on_while_plugged_in not put back to ${before}: ${error instanceof Error ? error.message : String(error)}`,
        ),
    );
  let screen: Screen | undefined;

  // A terminal is drawn the panel whether or not `--verbose` asks; anything else is written lines, and only if it does.
  // The phone goes beside it where the terminal can draw it, asked over stdin, the terminal's own answers coming there.
  const drawn = process.stderr.isTTY && process.stdin.isTTY ? await pictures(process.stdin, process.stderr) : undefined;

  // The frame, or none once the recording has failed: `run` hears of that from `phone.frame` and stops, where thrown
  // from a redraw it would be uncaught and leave the phone's setting unrestored.
  const frame = () => {
    try {
      return screen?.latest()?.image;
    } catch {
      return undefined;
    }
  };

  // The run's clock, which the written lines are timed by too, from here.
  const clock: Clock = { now: () => performance.now(), sleep };
  const started = clock.now();

  const panel = process.stderr.isTTY ? live(process.stderr, drawn && { pictures: drawn, frame }) : undefined;
  const report =
    panel ??
    (options.verbose
      ? plain(
          (line) => console.error(line),
          () => clock.now() - started,
        )
      : undefined);

  // The frames `run` keeps around each faint and shield prompt, named by when they were seen on the same clock the
  // lines are timed by, `0012.437s-shield.png`, so they sort into the log. Written one a turn of the event loop rather
  // than as they are handed over: an encode takes 10ms to 40ms and a second's frames come at once, which would hold up
  // the answer to the very prompt they show. Whatever is still queued when the run ends is written then.
  const dir = options['keep-frames'];
  const queued: { frame: Image; at: number; event: string }[] = [];
  let written = 0;

  const write =
    dir === undefined
      ? undefined
      : ({ frame, at, event }: (typeof queued)[number]) => {
          const name = `${((at - started) / 1000).toFixed(3).padStart(8, '0')}s-${event}.png`;
          writeFileSync(join(dir, name), encodePng(frame));
          written++;
        };

  const writeNext = () => {
    const next = queued.shift();

    if (next && write) {
      write(next);
      setImmediate(writeNext);
    }
  };

  const keep =
    write &&
    ((frame: Image, at: number, event: string) => {
      if (queued.push({ frame, at, event }) === 1) {
        setImmediate(writeNext);
      }
    });

  const flush = () => {
    if (write) {
      queued.splice(0).forEach(write);
    }

    if (written > 0) {
      console.error(`kept ${written} frames around faints and shield prompts in ${dir}`);
    }
  };

  if (dir !== undefined) {
    mkdirSync(dir, { recursive: true });
  }

  // Ctrl-C closes the held shell while the run is still sending to it: what then fails is no error of the run's, and
  // the setting is put back by the handler alone.
  let interrupted = false;

  process.once('SIGINT', () => {
    interrupted = true;
    panel?.done();
    flush();
    screen?.close();
    held.close();
    void restore().finally(() => process.exit(130));
  });

  try {
    await transport.shell(['svc', 'power', 'stayon', 'usb']);

    // A screenshot for the screen's size, which every tap is a fraction of and the stream takes its shape from.
    const shot = await device.screenshot();
    const at = ([x, y]: readonly [number, number]): [number, number] => [x * shot.width, y * shot.height];
    const size = streamSize(shot);
    const recording = new Screen(() => screenrecord(options.serial, size), size);
    screen = recording;

    const phone: Phone = {
      frame: () => recording.latest()?.image,
      screenshot: () => device.screenshot(),
      tap: (point) => device.tap(at(point)),
      swipe: (from, to, ms) => device.swipe(at(from), at(to), ms),
    };

    await recording.first();

    // Told once the phone has a frame to draw, so the panel's first draw already has the phone beside it.
    if (meta) {
      report?.event(
        `opponents' moves as PvPoke ranks ${meta.cup} at ${meta.cap ?? 'any'} CP: ${meta.movesets.size} species`,
      );
    }

    const { battles, won, lost } = await run(
      phone,
      { mode, data, icons, typeIcons: types, meta, count, ...(keep && { keep }) },
      clock,
      report,
    ).finally(() => panel?.done());
    const unread = battles - won - lost;
    const outcomes = [`${won} won`, `${lost} lost`, ...(unread > 0 ? [`${unread} unread`] : [])];
    const tally = `${outcomes.slice(0, -1).join(', ')} and ${outcomes.at(-1)}`;

    console.log(`${battles} battle${battles === 1 ? '' : 's'} finished: ${tally}`);

    if (battles < count) {
      console.log('GO Battle League has no battle to offer until its reward is collected');
    }
  } catch (error) {
    // The terminal back first, from a run that failed before it began as from one that failed in it: the reason written
    // into the screen taken over would go with it.
    panel?.done();
    process.exitCode = 1;

    if (!interrupted) {
      console.error(error instanceof Error ? error.message : String(error));
    }

    if (error instanceof Lost && dir) {
      error.frames.forEach((frame, i) =>
        writeFileSync(join(dir, `${String(i).padStart(2, '0')}.png`), encodePng(frame)),
      );
      console.error(`kept the last ${error.frames.length} frames in ${dir}`);
    }
  } finally {
    flush();
    screen?.close();
    held.close();

    if (!interrupted) {
      await restore();
    }
  }
} else if (command === 'record') {
  const [out, ...extra] = rest;
  const seconds = Number(options.seconds);

  if (out === undefined || extra.length > 0) {
    fail('record takes one OUT file');
  }

  // `screenrecord` caps a recording rather than refusing a longer one, which would save less than was asked for.
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > RECORD_LIMIT_S) {
    fail(`--seconds takes a whole number from 1 to ${RECORD_LIMIT_S}, screenrecord's own limit`);
  }

  // The size `screenrecord` records at, an override where one is set and the screen's own otherwise, for the stream's
  // shape: what a battle would decode.
  let sizes: string;

  try {
    sizes = new TextDecoder().decode(await adbCli(options.serial).shell(['wm', 'size']));
  } catch (error) {
    console.error(`could not read the screen's size: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const [, width, height] = /Override size: (\d+)x(\d+)/.exec(sizes) ?? /Physical size: (\d+)x(\d+)/.exec(sizes) ?? [];

  if (!width || !height) {
    console.error(`wm size answered ${JSON.stringify(sizes.trim())} rather than the screen's size`);
    process.exit(1);
  }

  const recording = screenrecord(options.serial, streamSize({ width: Number(width), height: Number(height) }), seconds);
  let stderr = '';
  recording.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

  // `error` rather than `close` where `adb` could not start, which with no listener would be an uncaught exception.
  const exited = new Promise<number | null>((resolve) => {
    recording.once('close', resolve);
    recording.once('error', (error) => {
      stderr ||= error.message;
      resolve(null);
    });
  });

  console.error(`recording ${seconds}s to ${out}`);

  // An OUT that cannot be written fails here, with `adb` still recording into a pipe nobody reads, which would keep the
  // script alive until `--seconds` ran out.
  try {
    await pipeline(recording.stdout, createWriteStream(out));
  } catch (error) {
    recording.kill();
    console.error(`could not write ${out}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const code = await exited;

  // `screenrecord` refuses with exit 0 and its reason on stderr, so an empty file is the failure to look for too.
  if (code !== 0 || readFileSync(out).length === 0) {
    console.error(`screenrecord failed: ${stderr.trim() || `exit ${code}, nothing recorded`}`);
    process.exit(1);
  }
} else {
  console.log(USAGE);
  process.exit(command === 'help' ? 0 : 1);
}
