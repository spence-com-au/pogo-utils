/**
 * `pnpm inventory` driven as a subprocess, against a phone that is recordings: the script is run as a person runs it,
 * with only the `adb` on its `PATH` replaced. `phone.test.mts` reaches the row a scan writes off the export it pulls,
 * and the `phone-dex-*.test.mts` the walk a dex makes, which the script wires together from parts the other suites test
 * one at a time.
 *
 * The phone lives in the test's process and the `adb` is a stub forwarding to it, so a test sees every call the script
 * made and decides what the phone does next. A held shell is the one thing it refuses, there being no `/dev/uhid` on a
 * recording: a walk swipes with `input swipe` instead, which it says, and which is what a phone that will not have the
 * touchscreen gets.
 */

import { GAME_MASTER_CACHE, ICON_CACHE } from '../../../core/node/download.mts';
import { tesseractCli } from '../../../core/node/ocr-cli.mts';
import { useEngine } from '../../../core/ocr.mts';
import { type GameData } from '../../../core/game-master.mts';
import { execFile, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, type TestContext } from 'vitest';

const run = promisify(execFile);

const SCRIPT = fileURLToPath(new URL('../../../../scripts/inventory.mts', import.meta.url));
const FIXTURES = new URL('../fixtures/', import.meta.url);
const DATA = JSON.parse(
  readFileSync(new URL('../../../../data/game-master.json', import.meta.url), 'utf8'),
) as GameData;

/** Four minutes where the default is one, a run reading a dozen screens and sharing the machine with the others. */
export const SLOW = 240_000;

export const recording = (name: string) => new Uint8Array(readFileSync(new URL(name, FIXTURES)));

/** What the `adb` stub hands each call to: a phone, which answers with a status and its output. */
interface Answering {
  answer(args: readonly string[]): { status: number; out: Uint8Array };
}

/** The PNG's height, which follows the signature, the first chunk's length and name, and the width. */
export const heightOf = (png: Uint8Array) => new DataView(png.buffer, png.byteOffset).getUint32(20);

/** The PNG's width, just ahead of its height. */
export const widthOf = (png: Uint8Array) => new DataView(png.buffer, png.byteOffset).getUint32(16);

/** Which way a swipe went, as the game reads one: along the longer of its two axes. */
export function direction([x1 = 0, y1 = 0, x2 = 0, y2 = 0]: readonly number[]) {
  const [dx, dy] = [x2 - x1, y2 - y1];

  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
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

// Called as the module is imported, so each test file importing it is given a `bin` of its own and clears it away.
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
export async function harness(
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

    // `scan` reads the export in one pull and takes no `--config`; the walk commands lay their taps over `DEFAULTS`.
    const config = args[0] === 'scan' ? [] : ['--config', 'config.json'];
    const pending = run(process.execPath, [SCRIPT, ...args, ...config], { cwd, env });

    started.push(pending.child);

    const done = await pending.then(
      (ok) => ({ code: 0, ...ok }),
      (error: Ran) => error,
    );

    return { code: done.code, stdout: done.stdout, stderr: done.stderr };
  };

  return { cwd, inventory };
}
