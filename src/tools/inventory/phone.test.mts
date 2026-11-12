/**
 * `pnpm inventory scan` and `snap` driven as a subprocess, against a phone that is recordings: the script is run as a
 * person runs it, with only the `adb` on its `PATH` replaced. `cli.test.mts` reaches the rest of the script — `parse`
 * and the refusals that come before any phone is opened — and this reaches what needs one: the flag passes, the
 * `--skip` landing, the row a scan writes and the capture a snap leaves, which the script wires together from parts the
 * other suites test one at a time.
 *
 * The phone is `Phone`, three panels answering the taps, swipes and keys as the game does — a tap on storage opens the
 * first Pokémon, a swipe sideways moves to the next, a swipe up scrolls to the moves — over the captures committed
 * under `fixtures/`, read by the real Tesseract. It lives in this process and the `adb` is a stub forwarding to it, so
 * a test sees every call the script made and decides what the phone does next. Which panel answers what is all it
 * models, and of where a tap lands no more than whether it is below the box: a script tapping the wrong tile fails
 * nothing here, that being the readers' own tests to say.
 *
 * A held shell is the one thing it refuses, there being no `/dev/uhid` on a recording: `scan` swipes with
 * `input swipe` instead, which it says, and which is what a phone that will not have the touchscreen gets.
 *
 * Each of these reads a screen or several under Tesseract, a second or two apiece, so they run side by side and are
 * given longer than the default.
 */

import { KEY } from '../../core/adb.mts';
import { CATEGORIES, countsOn, listLines, regionIn, SIZES, type Category } from './pokedex.mts';
import { TABS, type Entry } from './pokedex-walk.mts';
import { GAME_MASTER_CACHE, ICON_CACHE } from '../../core/node/download.mts';
import { tesseractCli } from '../../core/node/ocr-cli.mts';
import { useEngine } from '../../core/ocr.mts';
import { type GameData } from '../../core/game-master.mts';
import { decodePng, encodePng, screenIn, type Image } from '../../core/png.mts';
import { LAST_DEX } from '../../pokemon/generations.ts';
import { execFile, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, test, type TestContext } from 'vitest';

const run = promisify(execFile);

const SCRIPT = fileURLToPath(new URL('../../../scripts/inventory.mts', import.meta.url));
const FIXTURES = new URL('fixtures/', import.meta.url);
const DATA = JSON.parse(readFileSync(new URL('../../../data/game-master.json', import.meta.url), 'utf8')) as GameData;

/** Four minutes where the default is one, a run reading a dozen screens and sharing the machine with the others. */
const SLOW = 240_000;

const recording = (name: string) => new Uint8Array(readFileSync(new URL(name, FIXTURES)));

/** What a captured region list counts. */
const countsIn = async (image: Image) => countsOn(await listLines(image), image);

/** The storage grid before a search, and after one. */
const GRID = 'storage/grid.png';
const SEARCHED = 'storage/searched.png';

/** A Pokémon as the phone shows it: its detail screen, and the one a swipe up from there scrolls to, with its moves. */
interface Pokemon {
  detail: string;
  moves?: string;
}

const ELGYEM: Pokemon = { detail: 'moves/elgyem-detail.png', moves: 'moves/elgyem-moves.png' };
const ROGGENROLA: Pokemon = { detail: 'moves/roggenrola-detail.png' };

/** What a tap on a tile opens where the game opens nothing readable: storage again, as a tap it dropped does. */
const NOTHING: Pokemon = { detail: SEARCHED };

type Panel = 'storage' | 'detail' | 'moves';

/** What the `adb` stub hands each call to: a phone, which answers with a status and its output. */
interface Answering {
  answer(args: readonly string[]): { status: number; out: Uint8Array };
}

/** The PNG's height, which follows the signature, the first chunk's length and name, and the width. */
const heightOf = (png: Uint8Array) => new DataView(png.buffer, png.byteOffset).getUint32(20);

/** The PNG's width, just ahead of its height. */
const widthOf = (png: Uint8Array) => new DataView(png.buffer, png.byteOffset).getUint32(16);

/** Which way a swipe went, as the game reads one: along the longer of its two axes. */
function direction([x1 = 0, y1 = 0, x2 = 0, y2 = 0]: readonly number[]) {
  const [dx, dy] = [x2 - x1, y2 - y1];

  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
}

/** Made by the first search that needs it, and kept. */
let empty: Uint8Array | undefined;

/**
 * What storage draws for a search that matched nothing: `SEARCHED` with its counter and its tiles painted out, which
 * leaves the tabs, the box and no `CP` to open.
 */
function emptied(): Uint8Array {
  const image = decodePng(recording(SEARCHED));

  for (const [left, top, right, bottom] of [
    [400, 150, 600, 215],
    [0, 380, image.width, image.height],
  ] as const) {
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        image.data.set([240, 240, 240, 255], (y * image.width + x) * 4);
      }
    }
  }

  return encodePng(image);
}

/**
 * The game as far as a scan or a snap drives it: storage, a Pokémon's detail screen and the moves below it. `storage`
 * says which Pokémon a search holds, in the order the grid lists them, so that what a scan opens and what a swipe leads
 * to are the test's to give.
 */
class Phone {
  /** Every call the script made but a screenshot, as `adb` was given it. */
  readonly calls: string[] = [];

  /** The panel showing, which a test reads for where the script left the phone. */
  panel: Panel;

  readonly #storage: (term: string) => readonly Pokemon[];
  #term = '';
  #open = 0;

  constructor(panel: Panel, storage: (term: string) => readonly Pokemon[]) {
    this.panel = panel;
    this.#storage = storage;
  }

  /** The swipes made, as which way each went. */
  get swipes() {
    return this.calls
      .filter((call) => call.startsWith('shell input swipe '))
      .map((call) => direction(call.split(' ').slice(3).map(Number)));
  }

  screen(): Uint8Array {
    if (this.panel === 'storage') {
      return this.#term === ''
        ? recording(GRID)
        : this.#storage(this.#term).length === 0
          ? (empty ??= emptied())
          : recording(SEARCHED);
    }

    const pokemon = this.#storage(this.#term)[this.#open] ?? NOTHING;
    const shown = this.panel === 'detail' ? pokemon.detail : pokemon.moves;

    if (shown === undefined) {
      throw new Error('the phone was scrolled to moves it has no recording of');
    }

    return recording(shown);
  }

  /** What `adb` is answered with: a status, and its stdout where that is 0 and its stderr where not. */
  answer(args: readonly string[]): { status: number; out: Uint8Array } {
    const text = (out: string) => ({ status: 0, out: new TextEncoder().encode(out) });
    const [command, ...rest] = args;

    if (command === 'exec-out') {
      return { status: 0, out: this.screen() };
    }

    this.calls.push(args.join(' '));

    if (command === 'get-state') {
      return text('device\n');
    }

    if (command === 'shell' && rest[0] === 'dumpsys' && rest[1] === 'window') {
      return text('mCurrentFocus=Window{1 u0 com.nianticlabs.pokemongo/.Main}\n');
    }

    if (command === 'shell' && rest[0] === 'input') {
      this.#input(rest[1], rest.slice(2));

      return text('');
    }

    return { status: 1, out: new TextEncoder().encode(`the phone does not know \`adb ${args.join(' ')}\`\n`) };
  }

  #input(kind: string | undefined, args: readonly string[]) {
    const numbers = args.map(Number);
    const holds = this.#storage(this.#term).length;

    if (kind === 'text') {
      this.#term = (args[0] ?? '').replaceAll("'", '').replaceAll('%s', ' ');
    } else if (kind === 'keyevent') {
      // The box is cleared by the run of deletes that comes ahead of whatever is typed into it.
      this.#term = numbers.includes(KEY.DEL) ? '' : this.#term;
    } else if (kind === 'tap') {
      // A tap below the box and the tabs is a tile's, and the one on a detail screen can only be its close button.
      if (this.panel === 'storage' && (numbers[1] ?? 0) > 0.2 * heightOf(this.screen()) && holds > 0) {
        this.panel = 'detail';
        this.#open = 0;
      } else if (this.panel === 'detail') {
        this.panel = 'storage';
      }
    } else if (kind === 'swipe') {
      const way = direction(numbers);

      if (this.panel === 'detail' && (way === 'left' || way === 'right')) {
        this.#open = Math.min(Math.max(this.#open + (way === 'left' ? 1 : -1), 0), holds - 1);
      } else if (this.panel === 'detail' && way === 'up') {
        this.panel = 'moves';
      } else if (this.panel === 'moves' && way === 'down') {
        this.panel = 'detail';
      }
    }
  }
}

/**
 * An `adb` that hands each call to the phone listening on `FAKE_PHONE`, and answers a held shell itself: as a shell
 * with no `/dev/uhid` does, failing each command at the marker line `held-shell.mts` writes after it.
 */
const STUB = `#!/usr/bin/env node
const args = process.argv.slice(2);

if (args.length === 1 && args[0] === 'shell') {
  let pending = '';

  process.stdin.on('data', (chunk) => {
    pending += chunk;

    for (let at = pending.indexOf('\\n'); at >= 0; at = pending.indexOf('\\n')) {
      const marker = /^(\\S+) \\$s"$/.exec(pending.slice(0, at))?.[1];

      pending = pending.slice(at + 1);

      if (marker) {
        process.stdout.write('no /dev/uhid on this phone\\n' + marker + ' 1\\n');
      }
    }
  });
} else {
  fetch(process.env.FAKE_PHONE, { method: 'POST', body: JSON.stringify(args) }).then(async (response) => {
    const status = Number(response.headers.get('x-status'));

    (status === 0 ? process.stdout : process.stderr).write(Buffer.from(await response.arrayBuffer()));
    process.exitCode = status;
  });
}
`;

let bin: string;

beforeAll(() => {
  // For what the test reads itself, a Pokédex's lists; the runs read with the CLI's own.
  useEngine(tesseractCli);
  bin = mkdtempSync(join(tmpdir(), 'inventory-phone-'));
  writeFileSync(join(bin, 'adb'), STUB);
  chmodSync(join(bin, 'adb'), 0o755);
});

afterAll(() => rmSync(bin, { recursive: true }));

/**
 * The cache a run reads, so that it reaches no network and knows `species`, and a `--config` with nothing waited for:
 * a recording has no animation to let settle. The game master is the vended one cut back to those species and written
 * as the download is — a template for each form, each move it holds and a genderless form's spawns — so nothing in it
 * is transcribed, and what `loadGameData` makes of it is what the readers' own tests are given.
 *
 * `icons` are the game's icons the run may match against, copied in from `fixtures/icons/` and listed as the artwork's
 * directory listing lists them, which is also what names a costume the game master does not: `pm1.cJAN_2020…` is
 * Bulbasaur's `Jan 2020`. None by default, the listing then naming nothing.
 */
function seed(cwd: string, species: readonly string[], icons: readonly string[] = []) {
  const cache = join(cwd, '.cache', 'inventory');
  const forms = DATA.forms.filter((form) => species.includes(form.species));
  const id = (move: { name: string; fast: boolean }) =>
    move.name.toUpperCase().replaceAll(' ', '_') + (move.fast ? '_FAST' : '');
  const moves = [...new Set(forms.flatMap((form) => form.moves.map(id)))];
  const type = (name: string) => `POKEMON_TYPE_${name.toUpperCase()}`;

  mkdirSync(cache, { recursive: true });
  writeFileSync(
    join(cache, GAME_MASTER_CACHE),
    JSON.stringify([
      {
        templateId: 'PLAYER_LEVEL_SETTINGS',
        data: {
          playerLevel: { cpMultiplier: DATA.cpm.filter(([level]) => Number.isInteger(level)).map(([, cpm]) => cpm) },
        },
      },
      {
        templateId: 'POKEMON_UPGRADE_SETTINGS',
        data: {
          pokemonUpgrades: {
            stardustCost: DATA.powerUp.stardust,
            shadowStardustMultiplier: DATA.powerUp.shadow,
            purifiedStardustMultiplier: DATA.powerUp.purified,
          },
        },
      },
      {
        templateId: 'LUCKY_POKEMON_SETTINGS',
        data: { luckyPokemonSettings: { powerUpStardustDiscountPercent: DATA.powerUp.lucky } },
      },
      ...moves.map((move, at) => ({ templateId: `V${1000 + at}_MOVE_${move}`, data: { moveSettings: {} } })),
      ...forms.map((form) => ({
        templateId: `V${String(form.dex).padStart(4, '0')}_POKEMON_${form.species.toUpperCase()}`,
        data: {
          pokemonSettings: {
            pokemonId: form.species.toUpperCase(),
            type: type(form.types[0] ?? ''),
            ...(form.types[1] && { type2: type(form.types[1]) }),
            stats: { baseAttack: form.attack, baseDefense: form.defense, baseStamina: form.stamina },
            quickMoves: form.moves.filter((move) => move.fast).map(id),
            cinematicMoves: form.moves.filter((move) => !move.fast).map(id),
            evolutionBranch: form.evolveCandy.map((candyCost) => ({ candyCost })),
          },
        },
      })),
      ...forms
        .filter((form) => form.genderless)
        .map((form) => ({
          templateId: `SPAWN_V${String(form.dex).padStart(4, '0')}_POKEMON_${form.species.toUpperCase()}`,
          data: { genderSettings: { gender: { genderlessPercent: 1 } } },
        })),
    ]),
  );
  writeFileSync(join(cache, 'english.json'), JSON.stringify({ data: [] }));
  writeFileSync(join(cache, ICON_CACHE), JSON.stringify({ tree: icons.map((path) => ({ path })) }));
  mkdirSync(join(cache, 'icons'), { recursive: true });

  for (const icon of icons) {
    writeFileSync(join(cache, 'icons', icon), recording(`icons/${icon}`));
  }

  writeFileSync(
    join(cwd, 'config.json'),
    JSON.stringify({ waits: { launch: 0, tap: 0, swipe: 0, scroll: 0, menu: 0, search: 0 } }),
  );
}

interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

/** Resolves once `child` has exited, which is at once for one that already has. */
const exited = (child: ChildProcess) =>
  child.exitCode === null && child.signalCode === null ? once(child, 'exit') : Promise.resolve();

/**
 * A working directory seeded for `species`, and `inventory`, which runs the script in it against `phone` and answers
 * how it ended and what it said rather than throwing on a status other than 0. Both are cleared away once the test is,
 * and a run still going by then is killed first.
 */
async function harness(
  { onTestFinished }: TestContext,
  phone: Answering,
  species: readonly string[],
  icons: readonly string[] = [],
) {
  const cwd = mkdtempSync(join(tmpdir(), 'inventory-run-'));

  const server = createServer((request, response) => {
    let body = '';

    request.on('data', (chunk: Buffer) => (body += chunk));
    request.on('end', () => {
      try {
        const { status, out } = phone.answer(JSON.parse(body) as string[]);

        response.writeHead(200, { 'x-status': String(status) }).end(out);
      } catch (error) {
        response.writeHead(200, { 'x-status': '1' }).end(String(error));
      }
    });
  });

  const started: ChildProcess[] = [];

  // A test that timed out has walked away from its run, which would go on reading a directory and a phone taken from
  // under it. So a run still going is killed, and waited for, before they are.
  onTestFinished(async () => {
    for (const child of started) {
      child.kill('SIGKILL');
    }

    await Promise.all(started.map(exited));
    server.close();
    rmSync(cwd, { recursive: true });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === 'object' ? address?.port : ''}`;

  seed(cwd, species, icons);

  const inventory = async (...args: string[]): Promise<Ran> => {
    const env = { ...process.env, PATH: `${bin}${delimiter}${process.env['PATH']}`, FAKE_PHONE: url };
    const pending = run(process.execPath, [SCRIPT, ...args, '--config', 'config.json'], { cwd, env });

    started.push(pending.child);

    const done = await pending.then(
      (ok) => ({ code: 0, ...ok }),
      (error: Ran) => error,
    );

    return { code: done.code, stdout: done.stdout, stderr: done.stderr };
  };

  return { cwd, inventory };
}

const snapped = (cwd: string, name: string) => join(cwd, '.cache', 'inventory', 'snaps', `${name}.png`);

describe.concurrent('snap', () => {
  test(
    '`--search` opens the first match, and saves the whole screen stitched out of a scroll',
    { timeout: SLOW },
    async (context) => {
      const phone = new Phone('storage', (term) => (term === 'shiny' ? [ELGYEM] : []));
      const { cwd, inventory } = await harness(context, phone, ['Elgyem']);
      const { code, stdout, stderr } = await inventory('snap', '--search', 'shiny', 'elgyem');
      const saved = decodePng(readFileSync(snapped(cwd, 'elgyem')));

      expect({ code, stderr }).toStrictEqual({ code: 0, stderr: 'Pokémon GO is already in front\n' });
      expect(stdout).toMatch(/^species {2,}Elgyem$/m);
      expect(stdout).toMatch(/^Stitched 2 frames, scrolling (\d+) = \1 pixels past the first\.$/m);

      // The screen is written first, which is what keeps a snap of a phone nothing can be read off, and the stitch goes
      // over it: two writes to the one name, the second the taller.
      expect(stdout.match(/^Saved .*elgyem\.png \(\d+×\d+\)$/gm)).toHaveLength(2);
      expect(saved.height, 'the file is the screen and not the stitch').toBeGreaterThan(screenIn(saved).height);
      expect(screenIn(saved).height).toBe(heightOf(recording(ELGYEM.detail)));

      // The term typed and the tile tapped, and only then the swipes that scroll: down to the moves and on to find the
      // end, then back up by what was measured, which leaves the panel where it began.
      const typed = phone.calls.indexOf("shell input text 'shiny'");
      const tapped = phone.calls.findIndex((call, at) => at > typed && call.startsWith('shell input tap '));

      expect(typed).toBeGreaterThan(-1);
      expect(phone.calls.findIndex((call) => call.startsWith('shell input swipe '))).toBeGreaterThan(tapped);
      expect(phone.swipes).toStrictEqual(['up', 'up', 'down']);
      expect(phone.panel, 'the panel was left scrolled down').toBe('detail');
    },
  );

  test(
    'saves the plain screen where the overlay did not read, and refuses it, scrolling nothing',
    { timeout: SLOW },
    async (context) => {
      const file = 'pgsharp-no-overlay.png';
      const phone = new Phone('detail', () => [{ detail: file }]);
      const { cwd, inventory } = await harness(context, phone, []);
      const { code, stdout, stderr } = await inventory('snap', 'plain');
      const saved = decodePng(readFileSync(snapped(cwd, 'plain')));

      expect(code).toBe(1);
      expect(stderr).toContain("snap: PGSharp's overlay was not found on it");

      // The screen as the phone showed it, and the only write: a free name takes what could be had.
      expect(Buffer.compare(saved.data, decodePng(recording(file)).data)).toBe(0);
      expect(stdout.match(/^Saved /gm)).toHaveLength(1);
      expect(phone.swipes, 'a screen the overlay is not on was scrolled').toStrictEqual([]);
    },
  );

  test(
    'leaves a capture already saved under the name as it was, where this one could not better it',
    { timeout: SLOW },
    async (context) => {
      const phone = new Phone('detail', () => [{ detail: 'pgsharp-no-overlay.png' }]);
      const { cwd, inventory } = await harness(context, phone, []);
      const path = snapped(cwd, 'kept');

      mkdirSync(join(cwd, '.cache', 'inventory', 'snaps'), { recursive: true });
      writeFileSync(path, 'a capture from an earlier run');

      const { code, stdout, stderr } = await inventory('snap', 'kept');

      expect(code).toBe(1);
      expect(stderr).toContain("snap: PGSharp's overlay was not found on it");
      expect(stderr).toContain('snap: nothing was written, so a snap already saved under this name is still the one');
      expect(readFileSync(path, 'utf8')).toBe('a capture from an earlier run');
      expect(stdout).not.toContain('Saved');
    },
  );
});

/** The rows a scan wrote, one JSON object to a line. */
const rowsIn = (cwd: string) =>
  readFileSync(join(cwd, 'inventory.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe.concurrent('scan', () => {
  test('writes the Pokémon it reads as a row, each flag as its pass left it', { timeout: SLOW }, async (context) => {
    // A search that matched nothing, one that matched and opened what would not read, and the full pass's own.
    const phone = new Phone('storage', (term) => (term === 'shiny' ? [] : term === 'lucky' ? [NOTHING] : [ELGYEM]));
    const { cwd, inventory } = await harness(context, phone, ['Elgyem']);
    const { code, stderr } = await inventory(
      'scan',
      '--flags',
      'shiny,lucky',
      '--limit',
      '1',
      '--keep-screens',
      'screens',
    );

    expect(code, stderr).toBe(0);
    expect(stderr).toContain('swiping with `input swipe` instead');
    expect(stderr).toContain('shiny: 0\n');
    expect(stderr).toContain('lucky: the first Pokémon would not read, so this field is left null');
    expect(stderr).toContain('#1 Elgyem CP 295 11/13/8 L8');
    expect(stderr).toContain('Wrote 1 Pokémon to inventory.jsonl');

    const [row, ...rest] = rowsIn(cwd);

    expect(rest).toStrictEqual([]);

    // Every column a row is written with, in the order it is: the file is what other tools read.
    expect(Object.keys(row ?? {}).join(' ')).toBe(
      'index species nickname dex form gender favourite tags costume shiny lucky size shadow ' +
        'purified max cp hp levels iv moves weight height types notes',
    );

    // What each reader made of the two screens, worked out and assembled. Where a pass ran and found nothing the field
    // is `false`; where it could not read the first Pokémon it holds it is null, which says nothing either way, as it
    // does for the costume pass that was never asked for.
    expect(row).toMatchObject({
      index: 1,
      species: 'Elgyem',
      dex: 605,
      form: null,
      cp: 295,
      hp: 57,
      levels: [8],
      iv: { attack: 11, defense: 13, stamina: 8 },
      moves: { fast: 'Astonish', charged: ['Dark Pulse'] },
      weight: 7.6,
      height: 0.46,
      types: ['Psychic'],
      shiny: false,
      lucky: null,
      costume: null,
    });

    // The detail screen it read the row off, and the one it scrolled down to for the moves, and the panel put back.
    expect(existsSync(join(cwd, 'screens', '00001-detail.png'))).toBe(true);
    expect(existsSync(join(cwd, 'screens', '00001-moves.png'))).toBe(true);
    expect(phone.swipes).toStrictEqual(['up', 'down', 'left']);
    expect(phone.panel, 'the detail screen was left open').toBe('storage');
  });

  test(
    'resumes a file with `--skip`, landing on the row after the last one it holds',
    { timeout: SLOW },
    async (context) => {
      const phone = new Phone('storage', () => [ELGYEM, ROGGENROLA]);
      const { cwd, inventory } = await harness(context, phone, ['Elgyem', 'Roggenrola']);

      // The one row of an earlier run, as much of it as the landing checks the screen against.
      const earlier = { index: 1, hp: 57, weight: 7.6, height: 0.46, iv: { attack: 11, defense: 13, stamina: 8 } };

      writeFileSync(join(cwd, 'inventory.jsonl'), `${JSON.stringify(earlier)}\n`);

      const { code, stderr } = await inventory('scan', '--flags', '', '--skip', '1', '--limit', '1', '--no-moves');

      expect(code).toBe(0);
      expect(stderr).toContain('Wrote 1 Pokémon to inventory.jsonl');

      // Appended to rather than written over, under the number it is in storage.
      const rows = rowsIn(cwd);

      expect(rows[0]).toStrictEqual(earlier);
      expect(rows.slice(1).map((row) => [row['index'], row['species']])).toStrictEqual([[2, 'Roggenrola']]);

      // One blind swipe on, then back past where it should have landed to find the row it checks against, and on again
      // over it to the next, where the walk begins.
      expect(phone.swipes.slice(0, 5)).toStrictEqual(['left', 'right', 'right', 'right', 'left']);
    },
  );

  test('refuses a `--skip` with no row to land against, before it drives the phone', async (context) => {
    const phone = new Phone('storage', () => [ELGYEM]);
    const { inventory } = await harness(context, phone, ['Elgyem']);
    const { code, stderr } = await inventory('scan', '--skip', '3');

    expect(code).toBe(1);
    expect(stderr).toContain('--skip 3 checks where it lands against row 3 of inventory.jsonl, but it does not exist');
    expect(phone.calls).toStrictEqual([]);
  });
});

/** Where the Pokédex is, as far as `dex` drives it, `other` being what a tap on the main menu's button opened. */
type Screen = 'popup' | 'map' | 'menu' | 'list' | 'grid' | 'entry' | 'other';

/** A pop-up the game puts over the map: its capture, and how far down the screen the middle of its LATER is. */
interface Popup {
  capture: string;
  later: number;
}

/** The Weekly Challenge's pop-up and a research encounter's, as the game raised them one after the other (#1046). */
const POPUPS: readonly Popup[] = [
  { capture: 'popup-challenge', later: 0.78 },
  { capture: 'popup-encounter', later: 0.71 },
];

/**
 * Each tab's region list as the phone draws it, a screenshot a drag down it: the POKÉMON tab's whole, the rest the
 * top alone, where a drag goes nowhere.
 */
const LISTS = [
  ['tab-pokemon-0', 'tab-pokemon-1', 'tab-pokemon-2'],
  ...['shiny', 'lucky', 'xxl', 'xxs', 'gmax', 'mega', 'shadow', 'purified', 'perfect'].map((tab) => [`tab-${tab}-0`]),
];

/** Bulbasaur's, Ivysaur's and Venusaur's entries, each a screenshot a drag down it from its top to its `SEE ALL`. */
const ENTRIES = ['bulbasaur', 'ivysaur', 'venusaur'].map((species) => [0, 1, 2].map((at) => `${species}-${at}`));

/**
 * The tiles of an entry the game selects at a tap, and the screenshot it shows then: Ekans's SHINY, which it draws as a
 * silhouette though the shiny is registered, and back from there the form's own. Each tile is its left, top, right and
 * bottom as fractions of the screen; a tap anywhere else on an entry selects nothing, as a tile not registered does.
 */
const SELECTS: Readonly<Record<string, readonly (readonly [number, number, number, number, string])[]>> = {
  'ekans-0': [[0.28, 0.73, 0.49, 0.87, 'ekans-shiny-0']],
  'ekans-shiny-0': [[0.03, 0.73, 0.27, 0.87, 'ekans-0']],
};

/**
 * The game as far as `pnpm inventory dex --from 1 --to 3` drives it, over the captures under `fixtures/pokedex/`: the
 * map, the main menu, a tab's list of regions, Kanto's grid and the first three entries. A tap is placed by which of
 * those is showing and by where it lands, of no more than the screen's controls and `SELECTS` do; a swipe moves along
 * the entries, one past the third going nowhere, which is the end of the Pokédex as the walk knows it, and a drag
 * scrolls a list or an entry. Any pop-ups given are over the map at the start, each put off by a tap on its LATER and
 * by nothing else, and `menuTaps` says what the phone makes of the taps on the main menu's button before one opens it.
 *
 * The tab strip is the one thing modelled rather than recorded. The tab selected sits in the middle of it but at
 * either end, as the captures draw it — POKÉMON at a fifth of the width with SHINY in the middle, ★ 100% in the middle
 * with PURIFIED at a fifth — so a tap is the tab drawn nearest it.
 */
class Pokedex {
  readonly calls: string[] = [];
  screen: Screen;
  tab = 0;
  #list = 0;
  #entry = 0;
  #frame = 0;
  readonly #entries: readonly (readonly string[])[];
  readonly #popups: Popup[];

  /**
   * What the phone makes of each tap on the main menu's button, in turn, until they run out and one opens the menu:
   * null for a tap it drops, leaving the map as it was, and a capture for one that opens that instead.
   */
  readonly menuTaps: (string | null)[] = [];

  /** The capture a tap on the main menu's button opened instead of it. */
  #other = '';

  /** The screenshot a tap on the entry put in place of its own, until a tap puts that back. */
  #over: string | null = null;

  /** Each `#over` a swipe or a drag left showing, the entry read on with it. */
  readonly unrestored: string[] = [];

  /**
   * `entries` are the entries a swipe steps along, each its screenshots from its top down, and `popups` those over the
   * map, the first on top.
   */
  constructor(entries: readonly (readonly string[])[] = ENTRIES, popups: readonly Popup[] = []) {
    this.#entries = entries;
    this.#popups = [...popups];
    this.screen = popups.length > 0 ? 'popup' : 'map';
  }

  #shown(): string {
    switch (this.screen) {
      case 'popup':
        return `pokedex/${this.#popups[0]?.capture}.png`;
      case 'map':
        return 'pokedex/map.png';
      case 'menu':
        return 'pokedex/menu.png';
      case 'grid':
        return this.tab === 1 ? 'pokedex/hoenn-shiny.png' : 'pokedex/kanto.png';
      case 'list':
        return `pokedex/${LISTS[this.tab]?.[this.#list]}.png`;
      case 'entry':
        return `pokedex/${this.#over ?? this.#entries[this.#entry]?.[this.#frame]}.png`;
      case 'other':
        return this.#other;
    }
  }

  answer(args: readonly string[]): { status: number; out: Uint8Array } {
    const text = (out: string) => ({ status: 0, out: new TextEncoder().encode(out) });
    const [command, ...rest] = args;

    if (command === 'exec-out') {
      return { status: 0, out: recording(this.#shown()) };
    }

    this.calls.push(args.join(' '));

    if (command === 'get-state') {
      return text('device\n');
    }

    if (command === 'shell' && rest[0] === 'dumpsys' && rest[1] === 'window') {
      return text('mCurrentFocus=Window{1 u0 com.nianticlabs.pokemongo/.Main}\n');
    }

    if (command === 'shell' && rest[0] === 'input') {
      const [x = 0, y = 0, x2 = 0, y2 = 0] = rest.slice(2).map(Number);

      if (rest[1] === 'tap') {
        const png = recording(this.#shown());

        this.#tap(x / widthOf(png), y / heightOf(png));
      } else if (rest[1] === 'swipe') {
        this.#swipe(direction([x, y, x2, y2]));
      }

      return text('');
    }

    return { status: 1, out: new TextEncoder().encode(`the phone does not know \`adb ${args.join(' ')}\`\n`) };
  }

  /** A tap at `x`, `y` in fractions of the screen. */
  #tap(x: number, y: number) {
    const foot = y > 0.88 && Math.abs(x - 0.5) < 0.08;

    if (this.screen === 'popup') {
      // On the LATER and clear of the button above it, CHOOSE GROUP or START ENCOUNTER, some 0.06 higher.
      if (Math.abs(x - 0.5) < 0.15 && Math.abs(y - (this.#popups[0]?.later ?? 0)) < 0.02) {
        this.#popups.shift();
        this.screen = this.#popups.length > 0 ? 'popup' : 'map';
      }
    } else if (this.screen === 'map' && foot) {
      const instead = this.menuTaps.shift();

      if (instead === undefined) {
        this.screen = 'menu';
      } else if (instead !== null) {
        [this.screen, this.#other] = ['other', instead];
      }
    } else if (this.screen === 'menu') {
      this.screen = Math.abs(x - 0.25) < 0.1 && Math.abs(y - 0.6) < 0.05 ? 'list' : 'map';
    } else if (this.screen === 'entry' && foot) {
      this.#leave();
      this.screen = 'grid';
    } else if (this.screen === 'entry') {
      const own = this.#entries[this.#entry]?.[this.#frame];
      const tile = SELECTS[this.#over ?? own ?? '']?.find(([l, t, r, b]) => x >= l && x <= r && y >= t && y <= b);

      if (tile) {
        this.#over = tile[4] === own ? null : tile[4];
      }
    } else if (this.screen === 'grid') {
      // The first row of Kanto's tiles, whose numbers are where a tap opens one; one past the third opens nothing, as
      // a species not seen does.
      const tile = Math.floor(x * 4);

      if (foot) {
        this.screen = 'map';
      } else if (x > 0.8 && y > 0.9) {
        // The REGIONS button in the corner, back to the list as it was left.
        this.screen = 'list';
      } else if (y > 0.3 && y < 0.36 && tile < this.#entries.length) {
        [this.screen, this.#entry, this.#frame] = ['entry', tile, 0];
      }
    } else if (this.screen === 'list' && y > 0.8 && y < 0.9) {
      const last = LISTS.length - 1;
      const middle = this.tab === 0 ? 1 : this.tab === last ? last : this.tab;
      const tapped = Math.max(0, Math.min(last, middle + Math.round((x - 0.5) / 0.25)));

      [this.tab, this.#list] = [tapped, 0];
    } else if (this.screen === 'list') {
      this.screen = 'grid';
    }
  }

  /** Leaves what a tap put in place of the entry's own, noting it, since nothing tapped it back. */
  #leave() {
    if (this.#over !== null) {
      this.unrestored.push(this.#over);
      this.#over = null;
    }
  }

  #swipe(way: ReturnType<typeof direction>) {
    if (this.screen === 'entry') {
      this.#leave();
    }

    if (this.screen === 'entry' && (way === 'left' || way === 'right')) {
      const next = this.#entry + (way === 'left' ? 1 : -1);

      if (next >= 0 && next < this.#entries.length) {
        [this.#entry, this.#frame] = [next, 0];
      }
    } else if (this.screen === 'entry' && way === 'up') {
      this.#frame = Math.min(this.#frame + 1, (this.#entries[this.#entry]?.length ?? 1) - 1);
    } else if (this.screen === 'list' && way === 'up') {
      this.#list = Math.min(this.#list + 1, (LISTS[this.tab]?.length ?? 1) - 1);
    } else if (this.screen === 'list' && way === 'down') {
      this.#list = Math.max(this.#list - 1, 0);
    }
  }
}

/** The icons the three species' tiles are matched against, but Bulbasaur's Fall 2019 costume's. */
const KANTO_ICONS = [1, 2, 3].flatMap((dex) => [
  `pm${dex}.icon.png`,
  `pm${dex}.cJAN_2020_NOEVOLVE.icon.png`,
  `pm${dex}.cSPRING_2020_NOEVOLVE.icon.png`,
]);

/**
 * The three lines the walk writes off the captures. Bulbasaur's third costume is its Fall 2019, whose icon the seeded
 * listing leaves out, so it is no costume the run knows of and is recorded as the third tile rather than named as the
 * nearer of the two it does: the never-guessing a costume nothing names gets.
 */
const FIRST_THREE = [
  {
    dex: 1,
    species: 'Bulbasaur',
    caught: true,
    genders: { male: true, female: true },
    forms: [
      {
        form: null,
        caught: true,
        shiny: true,
        perfect: false,
        lucky: true,
        xxl: false,
        xxs: true,
        shadow: true,
        purified: true,
      },
    ],
    costumes: ['Spring 2020', 'Jan 2020', { unidentified: 3 }],
    notes: ["costume 3 is none of Bulbasaur's icons closely enough to name"],
  },
  {
    dex: 2,
    species: 'Ivysaur',
    caught: true,
    genders: { male: true, female: false },
    forms: [
      {
        form: null,
        caught: true,
        shiny: false,
        perfect: false,
        lucky: true,
        xxl: false,
        xxs: false,
        shadow: false,
        purified: false,
      },
    ],
    costumes: [],
    notes: [],
  },
  {
    dex: 3,
    species: 'Venusaur',
    caught: true,
    genders: { male: true, female: false },
    forms: [
      {
        form: null,
        caught: true,
        shiny: false,
        perfect: false,
        lucky: true,
        xxl: false,
        xxs: false,
        mega: false,
        gmax: false,
        shadow: false,
        purified: false,
      },
    ],
    costumes: [],
    notes: [],
  },
];

const linesIn = (cwd: string) =>
  readFileSync(join(cwd, 'pokedex.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Entry);

/**
 * A record agreeing with every count the captured lists print, around the first three as the walk reads them: for
 * each region and tab, as many species as the list counts are given the tab's category, the first three's own counted
 * first. What the lists print is read off them by `countsOn`, whose own test pins what it reads.
 */
async function agreeing(): Promise<Entry[]> {
  const printed = await Promise.all(
    LISTS.map(async (frames) =>
      (await Promise.all(frames.map(async (frame) => countsIn(decodePng(recording(`pokedex/${frame}.png`)))))).flat(),
    ),
  );
  const keys = Object.keys(CATEGORIES) as Category[];
  const lines = new Map<number, Entry>(FIRST_THREE.map((entry) => [entry.dex, structuredClone(entry) as Entry]));

  printed.forEach((counted, tab) => {
    const { label, counts } = TABS[tab] as (typeof TABS)[number];
    const key = keys.find((k) => CATEGORIES[k] === label);

    for (const { region, count } of counted) {
      const rest = Array.from({ length: LAST_DEX }, (_, i) => i + 1).filter(
        (dex) => dex > 3 && regionIn(dex) === region,
      );
      const already = [...lines.values()].filter((e) => regionIn(e.dex) === region && counts(e)).length;

      for (const dex of rest.slice(0, count - already)) {
        const entry = lines.get(dex) ?? {
          dex,
          species: '',
          caught: true,
          genders: {},
          forms: [{ form: null, caught: true }],
          costumes: [],
          notes: [],
        };

        if (key) {
          (entry.forms[0] as Record<string, unknown>)[key] = true;
        }

        lines.set(dex, entry);
      }
    }
  });

  return [...lines.values()].sort((a, b) => a.dex - b.dex);
}

// One at a time rather than side by side: each walks three entries and every tab's list, some sixty reads by Tesseract,
// and three together on a CI runner shared with the rest of the suite took longer than `SLOW` apiece.
describe('dex', () => {
  test(
    'walks the first three entries, writes a line for each, and fails the count against a record of only those',
    { timeout: SLOW },
    async (context) => {
      // A fourth entry that would not read, which a walk to #3 has no reason to swipe to.
      const phone = new Pokedex([...ENTRIES, ['menu']]);
      const { cwd, inventory } = await harness(context, phone, ['Bulbasaur', 'Ivysaur', 'Venusaur'], KANTO_ICONS);
      const { code, stderr } = await inventory('dex', '--from', '1', '--to', '3');

      expect(linesIn(cwd)).toStrictEqual(FIRST_THREE);
      expect(stderr).toContain('Wrote 3 species to pokedex.jsonl');

      // Every region the lists print disagrees with a record of three species, Kanto's own included, and the lines it
      // wrote are kept for all that.
      expect(code).toBe(1);
      expect(stderr).toContain('POKÉMON in Kanto: the game counts 148, the record 3');

      // And every region whose card did not read on the POKÉMON tab's captures is said rather than passed as agreeing:
      // the tab lists all of them, so each it did not read is one the record was not checked against.
      const shown = await Promise.all(
        (LISTS[0] ?? []).map(async (frame) => countsIn(decodePng(recording(`pokedex/${frame}.png`)))),
      );
      const read = new Set(shown.flat().map((c) => c.region));
      const said = /^ {2}POKÉMON: no count read for (.*), so the record there was not checked$/m.exec(stderr)?.[1];

      expect((said?.split(', ') ?? []).sort()).toStrictEqual([...SIZES.keys()].filter((r) => !read.has(r)).sort());
      expect(stderr).toMatch(
        /the record disagrees with the game in \d+ places; every line read is kept in pokedex\.jsonl/,
      );
    },
  );

  /**
   * A range past the last species the phone has seen, which on this one is anything from #4: no tile from there opens
   * an entry, so the walk lands on the last one before it that does, Venusaur. That is outside the range, and a line
   * for it would stand beside the one a record already keeps for it.
   *
   * Begun on the SHINY tab's grid, where the POKÉMON tab in the strip reads as the main menu's label does: the grid is
   * left by its REGIONS button rather than tapped as if it were the menu.
   */
  test(
    'writes nothing for a range past the last species seen, rather than that species again',
    { timeout: SLOW },
    async (context) => {
      const phone = new Pokedex();
      [phone.screen, phone.tab] = ['grid', 1];
      const { cwd, inventory } = await harness(context, phone, ['Bulbasaur', 'Ivysaur', 'Venusaur'], KANTO_ICONS);
      const { stderr } = await inventory('dex', '--from', '4', '--to', '10');

      expect(stderr).toContain('Nothing from #4 on has been seen, the last species seen before it being #3');
      expect(stderr).toContain('Wrote 0 species to pokedex.jsonl');
      expect(existsSync(join(cwd, 'pokedex.jsonl')), 'a line was written for a species outside the range').toBe(false);
    },
  );

  /**
   * Two pop-ups over the map, each of which takes the main menu's tap and does nothing with it (#1046). Each is put off
   * with its LATER, which is the only tap the phone answers on one, and the walk goes on from the map beneath them over
   * the same range as the test above, which gets as far as the grid and no further.
   */
  test(
    'puts off the pop-ups over the map with their LATER and walks on from it',
    { timeout: SLOW },
    async (context) => {
      const phone = new Pokedex(ENTRIES, POPUPS);
      const { inventory } = await harness(context, phone, ['Bulbasaur', 'Ivysaur', 'Venusaur'], KANTO_ICONS);
      const { stderr } = await inventory('dex', '--from', '4', '--to', '10');

      expect(stderr).toContain('Nothing from #4 on has been seen, the last species seen before it being #3');
      expect(stderr.match(/a pop-up was over the map; putting it off with its LATER/g)).toHaveLength(POPUPS.length);
      expect(phone.calls).not.toContain(`shell input keyevent ${KEY.BACK}`);
    },
  );

  /**
   * A first tap on the main menu's button that the phone drops, leaving the map as it was with the button drawn where
   * it was (#1058). The walk taps it again and goes on over the same range as the test above.
   */
  test('taps the main menu again where the phone dropped the tap', { timeout: SLOW }, async (context) => {
    const phone = new Pokedex();
    phone.menuTaps.push(null);
    const { inventory } = await harness(context, phone, ['Bulbasaur', 'Ivysaur', 'Venusaur'], KANTO_ICONS);
    const { stderr } = await inventory('dex', '--from', '4', '--to', '10');

    expect(stderr).toContain('Nothing from #4 on has been seen, the last species seen before it being #3');
    expect(stderr.match(/the main menu did not open, the map left as it was; tapping it again/g)).toHaveLength(1);
  });

  /**
   * A tap on the main menu's button that opens something else, a dialog standing in for the stop a walking avatar
   * carried under the button, which draws something else where the button was. A second tap there would be a guess at
   * a screen the walk knows nothing of, so it stops having made only the one.
   */
  test(
    'stops where a tap on the main menu opened something else, without tapping again',
    { timeout: SLOW },
    async (context) => {
      const phone = new Pokedex();
      phone.menuTaps.push('dialog/persian-power-up.png');
      const { inventory } = await harness(context, phone, ['Bulbasaur', 'Ivysaur', 'Venusaur'], KANTO_ICONS);
      const { code, stderr } = await inventory('dex', '--from', '4', '--to', '10');

      expect(code).toBe(1);
      expect(stderr).toContain('the main menu did not open; open the Pokédex by hand and run again');
      expect(phone.calls.filter((call) => call.startsWith('shell input tap'))).toHaveLength(1);
    },
  );

  /**
   * A swipe from the third entry that moves the screen to one whose title does not read — the main menu, standing in for
   * an entry Tesseract makes nothing of. A second swipe would go past it and never read it, so the walk stops there and
   * says so, the three lines before it kept.
   */
  test(
    'stops on an entry whose title will not read, rather than swiping past it',
    { timeout: SLOW },
    async (context) => {
      const phone = new Pokedex([...ENTRIES, ['menu']]);
      const { cwd, inventory } = await harness(context, phone, ['Bulbasaur', 'Ivysaur', 'Venusaur'], KANTO_ICONS);
      const { code, stderr } = await inventory('dex', '--from', '1', '--to', '10');

      expect(code).toBe(1);
      expect(stderr).toContain('the entry after #3 would not read; walk on from it with --from');
      expect(linesIn(cwd).map((entry) => entry.dex)).toStrictEqual([1, 2, 3]);
    },
  );

  /**
   * A first tile that opens an entry whose title does not read, Bulbasaur's foot standing in for it. The entry is closed
   * before the next tile is tapped, which opens Ivysaur's, so the walk stops where the swipe back lands on the entry
   * that would not read rather than on finding no tile that opened one.
   */
  test(
    'closes an entry that opened with its title unread before tapping the next tile',
    { timeout: SLOW },
    async (context) => {
      const phone = new Pokedex([['bulbasaur-2'], ...ENTRIES.slice(1)]);
      const { inventory } = await harness(context, phone, ['Bulbasaur', 'Ivysaur', 'Venusaur'], KANTO_ICONS);
      const { code, stderr } = await inventory('dex', '--from', '1', '--to', '3');

      expect(code).toBe(1);
      expect(stderr).toContain('the entry before #2 would not read; walk on from it with --from');
    },
  );

  /**
   * A record agreeing with the game but for the first three, walked from 1 to 10 on a phone whose swipe from the third
   * goes nowhere: each species read replaces its line, and the lines the walk never reached, 4 to 10 among them, stay
   * as they were, since a walk ending there is what a swipe the phone dropped looks like too.
   */
  test(
    "replaces the lines it reads and leaves those it never reached, passing a record that agrees with the game's",
    { timeout: SLOW },
    async (context) => {
      const phone = new Pokedex();
      const { cwd, inventory } = await harness(context, phone, ['Bulbasaur', 'Ivysaur', 'Venusaur'], KANTO_ICONS);
      const record = await agreeing();

      // The first three as some earlier run had them, wrong, which is what the walk has to replace.
      const stale = record.map((entry) => (entry.dex <= 3 ? { ...entry, caught: false, forms: [] } : entry));
      writeFileSync(join(cwd, 'pokedex.jsonl'), stale.map((entry) => `${JSON.stringify(entry)}\n`).join(''));

      const { code, stderr } = await inventory('dex', '--from', '1', '--to', '10');

      expect(
        record.filter((entry) => entry.dex > 3 && entry.dex <= 10),
        'nothing unreached to keep',
      ).not.toStrictEqual([]);

      expect({ code, mismatched: stderr.match(/^ {2}.* in .*: the game counts .*$/gm) }).toStrictEqual({
        code: 0,
        mismatched: null,
      });
      expect(linesIn(cwd)).toStrictEqual(record);
    },
  );

  /**
   * Ekans's entry, whose SHINY tile the game draws as a silhouette though the shiny is registered (#1047). A tap
   * selects it, so the line has the shiny, and the entry is put back to the form's own before its tab is read further.
   */
  test('records a shiny whose silhouetted SHINY tile the game selects at a tap', { timeout: SLOW }, async (context) => {
    const phone = new Pokedex([['ekans-0', 'ekans-1']]);
    const { cwd, inventory } = await harness(context, phone, ['Ekans']);

    await inventory('dex', '--from', '1', '--to', '23');

    expect(linesIn(cwd)).toStrictEqual([
      {
        dex: 23,
        species: 'Ekans',
        caught: true,
        genders: { male: true, female: true },
        forms: [
          {
            form: null,
            caught: true,
            shiny: true,
            perfect: false,
            lucky: true,
            xxl: false,
            xxs: true,
            shadow: false,
            purified: false,
          },
        ],
        costumes: [],
        notes: [],
      },
    ]);
    expect(phone.unrestored, 'the tab was read on with the shiny selected').toStrictEqual([]);
  });

  /**
   * Golem's entry, seen and never caught, whose two forms are both silhouettes that no tap selects, so neither is
   * viewed: the genders are the ones the entry draws as it opens (#1070).
   */
  test('records the genders of a species with several forms and none caught', { timeout: SLOW }, async (context) => {
    const phone = new Pokedex([['golem-0']]);
    const { cwd, inventory } = await harness(context, phone, ['Golem']);

    await inventory('dex', '--from', '1', '--to', '76');

    expect(linesIn(cwd).map(({ dex, genders }) => ({ dex, genders }))).toStrictEqual([
      { dex: 76, genders: { male: false, female: false } },
    ]);
  });

  /**
   * Porygon's entry and a swipe on to Omanyte's, the step on which a full walk read Omanyte no genders (#1071). Porygon
   * draws the empty ring of a species the game master gives no gender, which is recorded as none without a second look
   * at the entry; Omanyte draws both.
   */
  test('records no genders for a genderless species without looking again', { timeout: SLOW }, async (context) => {
    const phone = new Pokedex([
      ['porygon-0', 'porygon-1'],
      ['omanyte-0', 'omanyte-1'],
    ]);
    const { cwd, inventory } = await harness(context, phone, ['Porygon', 'Omanyte']);

    await inventory('dex', '--from', '1', '--to', '138');

    expect(linesIn(cwd).map(({ dex, genders, notes }) => ({ dex, genders, notes }))).toStrictEqual([
      { dex: 137, genders: {}, notes: [] },
      { dex: 138, genders: { male: true, female: true }, notes: [] },
    ]);

    // A second look would leave Porygon for Omanyte and come back before the walk went on to it.
    expect(
      phone.calls
        .filter((call) => call.startsWith('shell input swipe '))
        .map((call) => direction(call.split(' ').slice(3).map(Number)))
        .filter((way) => way === 'left'),
      'one swipe on, from Porygon to Omanyte',
    ).toStrictEqual(['left']);
  });
});
