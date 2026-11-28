/**
 * The Pokédex as `pnpm inventory dex` walks it, over the captures under `fixtures/pokedex/`, read by the real
 * Tesseract, for the `phone-dex-*.test.mts` to drive through `harness`. Which screen answers what is all it models,
 * and of where a tap lands no more than which control it is on: a walk tapping the wrong tile fails nothing here,
 * that being the readers' own tests to say.
 *
 * Each walk reads every tab's list and an entry or three, some sixty reads by Tesseract, and three together on a CI
 * runner shared with the rest of the suite took longer than `SLOW` apiece. So a file's walks run one at a time, and
 * the walks are spread over several files, which the runners take side by side.
 */

import { CATEGORIES, countsOn, listLines, regionIn, type Category } from '../pokedex.mts';
import { TABS, type Entry } from '../pokedex-walk.mts';
import { direction, heightOf, recording, widthOf } from './test-phone.mts';
import { decodePng, type Image } from '../../../core/png.mts';
import { LAST_DEX } from '../../../pokemon/generations.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** What a captured region list counts. */
export const countsIn = async (image: Image) => countsOn(await listLines(image), image);

/** Where the Pokédex is, as far as `dex` drives it, `other` being what a tap on the main menu's button opened. */
type Screen = 'popup' | 'map' | 'menu' | 'list' | 'grid' | 'entry' | 'other';

/** A pop-up the game puts over the map: its capture, and how far down the screen the middle of its LATER is. */
interface Popup {
  capture: string;
  later: number;
}

/** The Weekly Challenge's pop-up and a research encounter's, as the game raised them one after the other (#1046). */
export const POPUPS: readonly Popup[] = [
  { capture: 'popup-challenge', later: 0.78 },
  { capture: 'popup-encounter', later: 0.71 },
];

/**
 * Each tab's region list as the phone draws it, a screenshot a drag down it: the POKÉMON tab's whole, the rest the
 * top alone, where a drag goes nowhere.
 */
export const LISTS = [
  ['tab-pokemon-0', 'tab-pokemon-1', 'tab-pokemon-2'],
  ...['shiny', 'lucky', 'xxl', 'xxs', 'gmax', 'mega', 'shadow', 'purified', 'perfect'].map((tab) => [`tab-${tab}-0`]),
];

/** Bulbasaur's, Ivysaur's and Venusaur's entries, each a screenshot a drag down it from its top to its `SEE ALL`. */
export const ENTRIES = ['bulbasaur', 'ivysaur', 'venusaur'].map((species) => [0, 1, 2].map((at) => `${species}-${at}`));

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
export class Pokedex {
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
export const KANTO_ICONS = [1, 2, 3].flatMap((dex) => [
  `pm${dex}.icon.png`,
  `pm${dex}.cJAN_2020_NOEVOLVE.icon.png`,
  `pm${dex}.cSPRING_2020_NOEVOLVE.icon.png`,
]);

/**
 * The three lines the walk writes off the captures. Bulbasaur's third costume is its Fall 2019, whose icon the seeded
 * listing leaves out, so it is no costume the run knows of and is recorded as the third tile rather than named as the
 * nearer of the two it does: the never-guessing a costume nothing names gets.
 */
export const FIRST_THREE = [
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

export const linesIn = (cwd: string) =>
  readFileSync(join(cwd, 'pokedex.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Entry);

/**
 * A record agreeing with every count the captured lists print, around the first three as the walk reads them: for
 * each region and tab, as many species as the list counts are given the tab's category, the first three's own counted
 * first. What the lists print is read off them by `countsOn`, whose own test pins what it reads.
 */
export async function agreeing(): Promise<Entry[]> {
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
