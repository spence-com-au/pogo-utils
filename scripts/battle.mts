/**
 * Plays Pokémon GO's trainer battles on an Android phone over `adb`, watching the screen as H.264 from `screenrecord`
 * rather than screenshot by screenshot — a screenshot takes longer than a turn. Team Leader training is what it is built
 * against: a battle with nothing at stake, which is where its timing and its reading of the screen are tuned. GO Battle
 * League plays the same battles against other trainers, with the game's Recommended Battle Party.
 *
 * On a terminal, which a run takes over until it stops, a table shows the battle, ours at the left and the opponent's
 * at the right, and what each side does under it, with how the run stands above it and the menus it taps through
 * below, and the phone's screen down the left where the terminal draws Kitty graphics and is wide enough, unless
 * `--no-graphics` leaves it out. `--verbose` writes the same as lines where stderr is not a terminal, each after how
 * long the run has gone on.
 *
 * `--keep-frames DIR` is given the frames from a second before each faint, ours or theirs, and each shield prompt to a
 * second after it, named by when they were seen and for what, as `0012.437s-shield.png`, and the last frames before a
 * run stops for nothing recognised. `--keep-video FILE` is given the whole of the screen the run watched, battles and
 * menus alike, as the MPEG-TS video `mpv FILE` or `ffplay FILE` plays, its time the seconds since the run began that
 * `--verbose` and the frames' names are timed by. It is the H.264 the run decodes, kept rather than recorded twice:
 * about 15 MB a minute at most, and less for a still screen.
 *
 * Automating input breaks Niantic's terms of service, and unlike `pnpm inventory` this does not only read: it taps
 * through battles. Run it on an account whose loss you would accept.
 *
 * Usage, from the repository root, with the phone plugged in, USB debugging on and Pokémon GO in English:
 *
 *   pnpm battle run [OPTIONS]
 *     Play Team Leader or GO Battle League battles one after another, from the map or anywhere between one battle's
 *     result and the next one's start, until Ctrl-C or --count. Stops where nothing on screen has been recognised
 *     for 20s, and GO Battle League at the end of a set with a reward to collect, which is left to be caught by hand.
 *
 *     --mode MODE        training against a Team Leader, or gbl for GO Battle League (training when not given)
 *     --leader LEADER    the Team Leader to train against: blanche, candela or spark
 *     --league LEAGUE    great, ultra or master for training; for gbl, how the title of a league on now starts, as
 *                        ultra or fantasy cup
 *     --party NAME       for gbl, a party saved for the league to battle with rather than whichever the screen opens
 *                        on; one not saved stops the run
 *     --count N          stop once N battles have finished
 *     --keep-frames DIR  save the frames around each faint and shield prompt, and before a stop, to DIR
 *     --keep-video FILE  save everything the run watched to FILE as MPEG-TS video, about 15 MB a minute at most
 *     --no-graphics      leave the phone's screen out of the terminal's table
 *     --verbose          write the table as timed lines where stderr is not a terminal
 *     --serial SERIAL    the phone to drive, where more than one is plugged in
 *
 *   pnpm battle record [OPTIONS] OUT
 *     Save the screen to OUT as the raw H.264 a battle decodes, which is what the recognition fixtures are cut from.
 *
 *     --seconds N        how long to record, from 1 to 180 (30 when not given)
 *     --serial SERIAL    the phone to drive, where more than one is plugged in
 *
 * Kept frames and video show the account's trainer names, so neither is to be committed as it is.
 *
 * A flag a command does not list is refused rather than ignored. `help`, or `--help` beside any command, prints this.
 */

import { said } from '../src/errors.ts';
import { formIcons, silhouettesFor, typeIcons, type Download } from '../src/tools/battle/assets.mts';
import { loadMeta } from '../src/tools/battle/meta.mts';
import { readOptions } from '../src/tools/battle/options.mts';
import { type Icon } from '../src/tools/battle/party.mts';
import { pictures } from '../src/tools/battle/node/kitty.mts';
import { live, plain } from '../src/tools/battle/node/report.mts';
import { phoneOf } from '../src/tools/battle/phone.mts';
import { ending } from '../src/tools/battle/reporter.mts';
import { keepFrames } from '../src/tools/battle/node/keep-frames.mts';
import { keepVideo } from '../src/tools/battle/node/keep-video.mts';
import { Lost, run, type Clock } from '../src/tools/battle/run.mts';
import { RECORD_LIMIT_S, streamSize } from '../src/tools/battle/record-command.mts';
import { Screen } from '../src/tools/battle/screen.mts';
import { putStayOn, readStayOn, stayOnUsb } from '../src/tools/battle/stay-on.mts';
import { feed, screenrecord } from '../src/tools/battle/node/stream.mts';
import { adbCli, adbHeld } from '../src/core/node/adb-cli.mts';
import { Device } from '../src/core/adb.mts';
import { touchscreen } from '../src/core/touchscreen.mts';
import { CACHE, cachedAs, loadGameData } from '../src/core/node/download.mts';
import { type GameData } from '../src/core/game-master.mts';
import { useEngine } from '../src/core/ocr.mts';
import { MODEL, MODEL_SHA256, tesseractWasm } from '../src/core/ocr-wasm.mts';
import { createHash } from 'node:crypto';
import { createWriteStream, readFileSync } from 'node:fs';
import { constants } from 'node:os';
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
    'keep-video': { type: 'string' },
    'no-graphics': { type: 'boolean', default: false },
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
  .match(/Usage[^]*?(?=\n \*\/)/)?.[0]
  .replace(/^ \* ?/gm, '');

/** Which flags each command acts on, for the reason `inventory.mts` gives beside its own. */
const HONOURED: Record<string, readonly string[]> = {
  run: ['mode', 'leader', 'league', 'party', 'count', 'serial', 'keep-frames', 'keep-video', 'no-graphics', 'verbose'],
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

/** What `assets.mts` and `meta.mts` fetch, kept under `dir` for a week as the game master is. */
const cache =
  (dir: string): Download =>
  (file, url, decode) =>
    cachedAs(dir, file, url, false, decode);

/**
 * Every form's outline, which the party screen is read against, outlined from the icons out of the game master the run
 * reads rather than read from the vended `data/silhouettes.json` the site publishes, so a form released since the last
 * vend is read on its card from the day this game master names it. One that cannot be had leaves its form unmatched
 * rather than stopping the run.
 */
async function silhouettes(data: GameData): Promise<Icon[]> {
  const wanted = formIcons(data).size;
  const read = await silhouettesFor(data, cache(join(CACHE, 'icons')));

  if (read.size < wanted) {
    console.error(`${wanted - read.size} of ${wanted} form icons could not be had; those forms go unmatched`);
  }

  // None at all is every party read against nothing. Where no form even names an icon, it is the listing of the artwork
  // that failed, which `loadGameData` reports and carries on from: `pnpm inventory` loses only its narrowing by artwork.
  if (read.size === 0) {
    throw new Error('no form icon could be had, so no party could be read');
  }

  return [...read.values()];
}

if (command === 'run') {
  if (rest.length > 0) {
    fail('run takes no arguments beyond its flags');
  }

  let asked: ReturnType<typeof readOptions>;

  try {
    asked = readOptions(options);
  } catch (error) {
    fail(said(error));
  }

  const { mode, count } = asked;

  // Taps and swipes go through one held shell, six swipes a second being too many to start a process for each; the
  // settings put back on every way out go a process each, so that a shell gone with the connection still tries.
  const transport = adbCli(options.serial);
  const held = adbHeld(options.serial);
  const device = new Device(held);
  await device.check();

  // OCR in long-lived tesseract.js workers rather than a `tesseract` started for each read, which spent most of its
  // 100ms of CPU loading the model: a worker reads a battle's band for about 30ms. Two, so a banner read never waits on
  // the names and moves, the one other read a battle can have under way. The model is the Inventory page's, cached for
  // a week beside the game master and checked as it is read off disk, so a copy cut short fails here and is fetched
  // again next run rather than failing the first read mid-run.
  const tessdata = join(CACHE, 'tessdata');
  await cachedAs(tessdata, 'eng.traineddata', `${MODEL}/eng.traineddata`, false, (bytes) => {
    if (createHash('sha256').update(bytes).digest('hex') !== MODEL_SHA256) {
      throw new Error("not tessdata_fast 4.1.0's model");
    }
  });
  const ocr = tesseractWasm({ langPath: tessdata, workers: 2, cache: false });
  useEngine(ocr);

  // Which move is worth the most per energy, out of the game master `pnpm inventory` downloads and caches for a week.
  const data = await loadGameData(CACHE);

  const icons = await silhouettes(data);

  // The type icons are 18 small files, cached beside the form icons.
  const types = await typeIcons(data, cache(join(CACHE, 'types')));

  // What GO Battle League's players run in the league, out of PvPoke's rankings; Training allows for every move. Loaded
  // for `--league` before the run, and again by the run for the title of the league it taps.
  const metaOf = (league: string, warn: (line: string) => void) => loadMeta(cache(CACHE), data, league, warn);
  const meta = mode.mode === 'gbl' ? await metaOf(mode.league, (line) => console.error(line)) : null;

  // Awake for as long as it runs: the setting is read first and put back as found on every way out, `restore` and the
  // signal handler in place before it is changed.
  const before = await readStayOn(transport);

  // A phone gone, unplugged mid-battle, cannot be put back: said in a line rather than thrown over the error that
  // stopped the run.
  const restore = () =>
    putStayOn(transport, before).then(
      () => undefined,
      (error: unknown) => console.error(`stay_on_while_plugged_in not put back to ${before}: ${said(error)}`),
    );
  let screen: Screen | undefined;

  // A terminal is drawn the panel whether or not `--verbose` asks; anything else is written lines, and only if it does.
  // The phone goes beside it where the terminal can draw it, asked over stdin, the terminal's own answers coming there;
  // with `--no-graphics` the terminal is not asked, and is left as one that cannot.
  const drawn =
    process.stderr.isTTY && process.stdin.isTTY && !options['no-graphics']
      ? await pictures(process.stdin, process.stderr)
      : undefined;

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

  const dir = options['keep-frames'];
  const frames = dir === undefined ? undefined : keepFrames(dir, started, clock.now);

  const videoFile = options['keep-video'];
  let kept: ReturnType<typeof keepVideo> | undefined;

  if (videoFile !== undefined) {
    try {
      kept = keepVideo(videoFile, started, clock.now);
    } catch (error) {
      console.error(`could not write ${videoFile}: ${said(error)}`);
      process.exit(1);
    }
  }

  // Ctrl-C closes the held shell while the run is still sending to it: what then fails is no error of the run's, and
  // the setting is put back by the handler alone. A `kill`, a `timeout` or the terminal closed stops it the same way,
  // since nothing else would put the setting back, and the next run would take the one left behind as the one found.
  // The first signal alone is handled, so a second still stops a run whose way out hangs.
  let interrupted = false;
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

  // What both the ways out let go of, the signal handler and `finally`, which an interrupted run reaches both of.
  const release = () => {
    frames?.flush();
    screen?.close();
    kept?.close();
    held.close();
  };

  const stop = (signal: (typeof signals)[number]) => {
    signals.forEach((other) => process.off(other, stop));
    interrupted = true;
    panel?.done();
    release();
    void restore().finally(() => process.exit(128 + constants.signals[signal]));
  };

  signals.forEach((signal) => process.on(signal, stop));

  try {
    await stayOnUsb(transport);

    // A screenshot for the screen's size, which the stream takes its shape from.
    const size = streamSize(await device.screenshot());
    const recording = new Screen(() => {
      const recorded = screenrecord(options.serial, size);

      return feed(kept ? kept.watch(recorded) : recorded, size);
    });
    screen = recording;
    const touch = await touchscreen(held);

    const phone = phoneOf(recording, device, touch);

    // Started once the phone has a frame to draw, so the panel's first draw already has the phone beside it.
    await recording.first();

    const tally = await run(
      phone,
      { mode, data, icons, typeIcons: types, meta, metaOf, count, ...(frames && { keep: frames.keep }) },
      clock,
      report,
    ).finally(() => panel?.done());

    ending(tally, count).forEach((line) => console.log(line));
  } catch (error) {
    // The terminal back first, from a run that failed before it began as from one that failed in it: the reason written
    // into the screen taken over would go with it.
    panel?.done();
    process.exitCode = 1;

    if (!interrupted) {
      console.error(said(error));
    }

    if (error instanceof Lost) {
      frames?.last(error.frames);
    }
  } finally {
    release();
    await ocr.terminate();

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
    console.error(`could not read the screen's size: ${said(error)}`);
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

  const file = createWriteStream(out);

  // An OUT that cannot be written fails here, with `adb` still recording into a pipe nobody reads, which would keep the
  // script alive until `--seconds` ran out. It is waited for once killed, so that the script has reaped it on exit
  // rather than leave a zombie for whatever adopts it, which can take seconds to.
  try {
    await pipeline(recording.stdout, file);
  } catch (error) {
    recording.kill();
    console.error(`could not write ${out}: ${said(error)}`);
    await exited;
    process.exit(1);
  }

  const code = await exited;

  // `screenrecord` refuses with exit 0 and its reason on stderr, so nothing written is the failure to look for too. The
  // bytes are counted on the way out rather than read back, since OUT can be a pipe, which reading back would wait on
  // for good while this script holds its write end.
  if (code !== 0 || file.bytesWritten === 0) {
    console.error(`screenrecord failed: ${stderr.trim() || `exit ${code}, nothing recorded`}`);
    process.exit(1);
  }
} else {
  (command === 'help' ? console.log : console.error)(USAGE);
  process.exit(command === 'help' ? 0 : 1);
}
