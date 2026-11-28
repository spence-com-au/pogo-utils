/**
 * `pnpm inventory scan` driven as a subprocess through `test-phone.mts`, against a phone that is recordings.
 * `cli.test.mts` reaches the rest of the script, the refusals that come before any phone is opened, and this reaches
 * the row a scan writes off the export it pulls; the `phone-dex-*.test.mts` reach the walk a dex makes.
 *
 * The phone is `Phone`, three panels answering the taps, swipes and keys as the game does — a tap on storage opens the
 * first Pokémon, a swipe sideways moves to the next, a swipe up scrolls to the moves — over the captures committed
 * under `fixtures/`. Which panel answers what is all it models, and of where a tap lands no more than whether it is
 * below the box.
 */

import { direction, harness, heightOf, recording, SLOW } from './node/test-phone.mts';
import { KEY } from '../../core/adb.mts';
import { decodePng, encodePng } from '../../core/png.mts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

/** The storage grid before a search, and after one. */
const GRID = 'storage/grid.png';
const SEARCHED = 'storage/searched.png';

/** A Pokémon as the phone shows it: its detail screen, and the one a swipe up from there scrolls to, with its moves. */
interface Pokemon {
  detail: string;
  moves?: string;
}

/** What a tap on a tile opens where the game opens nothing readable: storage again, as a tap it dropped does. */
const NOTHING: Pokemon = { detail: SEARCHED };

type Panel = 'storage' | 'detail' | 'moves';

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
 * The game as far as a walk drives it: storage, a Pokémon's detail screen and the moves below it. `storage`
 * says which Pokémon a search holds, in the order the grid lists them, so that what a scan opens and what a swipe leads
 * to are the test's to give.
 */
class Phone {
  /** Every call the script made but a screenshot, as `adb` was given it. */
  readonly calls: string[] = [];

  /** The panel showing, which a test reads for where the script left the phone. */
  panel: Panel;

  /** What `shell cat` answers with: PGSharp's export, which the scan reads instead of walking the screen. */
  export: Uint8Array = new Uint8Array();

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

    if (command === 'shell' && rest[0] === 'cat') {
      // `adb shell cat` carries its exit status back on shell protocol 2, as the real one does: 0 with the file, 1 with
      // `cat`'s own message for a file the phone does not have.
      return this.export.length > 0
        ? { status: 0, out: this.export }
        : { status: 1, out: new TextEncoder().encode(`cat: ${rest[1]}: No such file or directory\n`) };
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

/** The rows a scan wrote, one JSON object to a line. */
const rowsIn = (cwd: string) =>
  readFileSync(join(cwd, 'inventory.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe.concurrent('scan', () => {
  test(
    "reads PGSharp's export off the phone and writes a row for each stored Pokémon",
    { timeout: SLOW },
    async (context) => {
      const phone = new Phone('storage', () => []);

      // One Elgyem and an egg, written with bare strings for the 64-bit ids so the parse keeps them exact. The moves are
      // left at 0: the seeded game master numbers its moves from 1000, so a real move number would not resolve here, and
      // `snapshot.test.mts` holds the number-to-name mapping against the whole game master instead.
      phone.export = new TextEncoder().encode(
        JSON.stringify({
          tags: [{ id: '111', name: 'Keepers' }],
          pokemons: [
            {
              id: '5550000000000000001',
              pokemonId: 605,
              nickname: '',
              cp: 295,
              cpMultiplier: 0.5974,
              additionalCpMultiplier: 0,
              individualAttack: 11,
              individualDefense: 13,
              individualStamina: 8,
              maxStamina: 57,
              move1: 0,
              move2: 0,
              move3: 0,
              weightKg: 7.6,
              heightM: 0.46,
              size: 3,
              favorite: false,
              isLucky: false,
              isEgg: false,
              pokemonTagIds: ['111'],
              pokemonDisplay: {
                form: 0,
                formName: 'ElgyemNormal',
                costume: 0,
                gender: 1,
                shiny: false,
                alignment: 0,
                breadModeEnum: 0,
              },
            },
            { id: '5550000000000000002', isEgg: true, pokemonDisplay: null },
          ],
        }),
      );

      const { cwd, inventory } = await harness(context, phone, ['Elgyem']);
      const { code, stderr } = await inventory('scan');

      expect(code, stderr).toBe(0);
      expect(stderr).toContain('Wrote 1 Pokémon to inventory.jsonl');

      const rows = rowsIn(cwd);

      // The egg is left out, the one Pokémon comes over with its fields resolved against the game master the run
      // loaded, and the raw game IDs are kept beside it.
      expect(rows.length).toBe(1);
      expect(rows[0]).toMatchObject({
        index: 1,
        species: 'Elgyem',
        dex: 605,
        cp: 295,
        levels: [20],
        iv: { attack: 11, defense: 13, stamina: 8 },
        weight: 7.6,
        height: 0.46,
        tags: ['Keepers'],
        raw: { pokemonId: 605, id: '5550000000000000001' },
      });

      // It reads the export off the phone and walks nothing.
      expect(phone.swipes).toStrictEqual([]);
    },
  );

  test('fails naming the export where the phone does not have it', async (context) => {
    // The export left unset, so `shell cat` answers as it does for a file that is not there.
    const phone = new Phone('storage', () => []);
    const { inventory } = await harness(context, phone, []);
    const { code, stderr } = await inventory('scan');

    expect(code).toBe(1);
    expect(stderr).toContain('/sdcard/Download/PGSharp/PGSStats.json');
    expect(stderr).toContain("switch PGSharp's inventory export on");
  });
});
