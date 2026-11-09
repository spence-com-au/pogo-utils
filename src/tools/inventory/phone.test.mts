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
import { GAME_MASTER_CACHE, ICON_CACHE } from '../../core/node/download.mts';
import { type GameData } from '../../core/game-master.mts';
import { decodePng, encodePng, screenIn } from '../../core/png.mts';
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

/** The PNG's height, which follows the signature, the first chunk's length and name, and the width. */
const heightOf = (png: Uint8Array) => new DataView(png.buffer, png.byteOffset).getUint32(20);

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
  bin = mkdtempSync(join(tmpdir(), 'inventory-phone-'));
  writeFileSync(join(bin, 'adb'), STUB);
  chmodSync(join(bin, 'adb'), 0o755);
});

afterAll(() => rmSync(bin, { recursive: true }));

/**
 * The cache a run reads, so that it reaches no network and knows `species`, and a `--config` with nothing waited for:
 * a recording has no animation to let settle. The game master is the vended one cut back to those species and written
 * as the download is — a template for each form and each move it holds — so nothing in it is transcribed, and what
 * `loadGameData` makes of it is what the readers' own tests are given.
 */
function seed(cwd: string, species: readonly string[]) {
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
    ]),
  );
  writeFileSync(join(cache, 'english.json'), JSON.stringify({ data: [] }));
  writeFileSync(join(cache, ICON_CACHE), JSON.stringify({ tree: [] }));
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
async function harness({ onTestFinished }: TestContext, phone: Phone, species: readonly string[]) {
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

  seed(cwd, species);

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
