/**
 * The menus between battles, from a battle's result round to the next USE THIS PARTY: read off full screenshots, beside
 * the battle, once the stream has shown none for a while, and tapped or scrolled through. The party screen's cards are
 * read on the way, off the selection screen, for the moves each brings.
 */

import { type GameData } from '../../core/game-master.mts';
import { type Image } from '../../core/png.mts';
import { type Size } from './layout.mts';
import {
  CAPS,
  carousel,
  CAROUSEL,
  readMenu,
  readOutcome,
  searchParty,
  type Menu,
  type Mode,
  type Outcome,
} from './menus.mts';
import { type Meta } from './meta.mts';
import { cardAt, readCps, readParty, type Card, type Icon } from './party.mts';
import { type Phone } from './phone.mts';
import { settle, type Reading } from './read.mts';
import { type Reporter } from './reporter.mts';
import type { Clock, Options } from './run.mts';
import { readCard } from './selection.mts';

/**
 * How long a screen must read as `other` before it is screenshot as a menu. A battle shows `other` for a second or two
 * at a time — a banner over the HUD, the opponent's charged move — and a screenshot costs one, with OCR on top. The read
 * runs beside the battle rather than holding it up: awaited, it left the battle unplayed for as long as the screenshot
 * and OCR took after every charged move, the loop learning only then that the battle had come back.
 */
export const MENU_AFTER_MS = 1_500;

/** How long a menu's tap is given to animate into the next screen before that is screenshot. */
const MENU_SETTLE_MS = 1_500;

/**
 * How many reads in a row GO Battle League's card has to show BATTLE greyed out before the run stops for its reward.
 * One was taken on a Pixel 8 Pro as the Battle tab slid in, 1.5s after the main menu's tap, its BATTLE not yet green:
 * the run stopped with a set there to play. A read a settle later finds it lit, where a reward is waiting it does not.
 */
const NO_BATTLE_READS = 2;

/** How long the Battle tab's scroll takes, in milliseconds: long enough to be a drag rather than a tap. */
const SCROLL_MS = 400;

/**
 * A menu read off a screenshot: what it showed, whether it ended the battle before it, and the battle's outcome where
 * the menu is its result and the verdict was read.
 */
export interface Read {
  screenshot: Image;
  menu: Menu;
  ended: boolean;
  outcome: Outcome | undefined;
}

/** How the menus tell the run of progress made, which holds off `LOST_MS`, and ask it whether it is lost already. */
export interface Watch {
  progress(): void;
  lost(): boolean;
}

/** What `act` made of a menu: tapped or scrolled, the run to stop with GO Battle League's reward, or lost. */
export type Acted = 'acted' | 'stop' | 'lost' | undefined;

export class MenuReader {
  readonly #phone: Phone;
  readonly #clock: Clock;
  readonly #mode: Mode;
  readonly #data: GameData;
  readonly #icons: readonly Icon[];
  readonly #metaOf: Options['metaOf'];
  readonly #log: Reporter['event'];
  readonly #watch: Watch;

  // Since when the screen has read as `other`, if it has, and the menu read under way, if any: settled once its
  // screenshot is taken and read, or failed. The screenshot of a result is read for the battle's outcome too.
  #otherSince: number | undefined;
  #reading: Reading<Read> | undefined;

  // What the screen was last read as for `report.status`: `other` from when it began to, and the menu read since.
  #screen = 'other';

  // Whether the last result read had its verdict still fading in, how many reads in a row have shown GO Battle League's
  // BATTLE greyed out, and where a search of the party carousel has got to.
  #faded = false;
  #noBattle = 0;
  #search = carousel();

  // The party as the party screen last showed it, with the moves of each card the selection screen was read for.
  #party: Card[] = [];

  // Each card as the party screen showed it when it was last tried on the selection screen, by silhouette and CP, of
  // which `party` holds what was read: a GO Battle League set comes back to the party screen before every battle, and
  // reading three cards takes 33s or more. A card is the one tried before where its silhouette names the same species
  // and its CP is the same or went unread this time, OCR having missed one CP of 24. One tried and not read is not
  // tried again, a search or a panel that failed once being likely to fail again at some 11s a battle; nor are those
  // after one that stopped the reading, the selection screen not opening or not closing being what they would meet too.
  // One passed over for its CP going unread was never tried, and is tried once its CP is read, so each held has its CP.
  #lastTried: ({ species: string | null; cp: number } | undefined)[] = [];

  // The league's CP cap, which a CP read over it is a misread of: Training's by its league, GO Battle League's as its
  // party screen states it, and until then as PvPoke has the league tapped, or `--league` before one is. `undefined`
  // until known, and then every shield is taken.
  #cap: number | null | undefined;

  // The meta of the league being played, and the title of the league card it is the meta of, none until one is tapped.
  #meta: Meta | null | undefined;
  #metaFor: string | undefined;

  constructor(
    phone: Phone,
    clock: Clock,
    { mode, data, icons, meta, metaOf }: Pick<Options, 'mode' | 'data' | 'icons' | 'meta' | 'metaOf'>,
    log: Reporter['event'],
    watch: Watch,
  ) {
    this.#phone = phone;
    this.#clock = clock;
    this.#mode = mode;
    this.#data = data;
    this.#icons = icons;
    this.#metaOf = metaOf;
    this.#log = log;
    this.#watch = watch;
    this.#cap = mode.mode === 'training' ? CAPS[mode.league] : meta?.cap;
    this.#meta = meta;
  }

  /** The party as last read, each card with its moves where the selection screen showed them. */
  get party(): readonly Card[] {
    return this.#party;
  }

  /** The league's CP cap: `null` for none, and `undefined` until known. */
  get cap(): number | null | undefined {
    return this.#cap;
  }

  /** The meta of the league being played: as the run was given it, until a league card is tapped. */
  get meta(): Meta | null | undefined {
    return this.#meta;
  }

  /** What the screen was last read as, between battles. */
  get screen(): string {
    return this.#screen;
  }

  /** The battle is back: whatever the read under way finds, it is of a screen the battle has since come back from. */
  leave(): void {
    this.#otherSince = undefined;
    this.#reading = undefined;
  }

  /**
   * A frame that is no battle's, which begins a read beside the loop once the screen has gone `MENU_AFTER_MS` with
   * none, `battling` where a battle was under way until then, so that a menu ends it. Answers a read once it is back,
   * with `battles` played so far: a failed one throws.
   */
  poll(battling: boolean, battles: number): Read | undefined {
    const now = this.#clock.now();

    if (this.#otherSince === undefined) {
      this.#otherSince = now;
      this.#screen = 'other';
    }

    if (now - this.#otherSince >= MENU_AFTER_MS && !this.#reading) {
      const result = battling;
      const phone = this.#phone;
      this.#reading = {};

      settle(
        this.#reading,
        (async () => {
          const screenshot = await phone.screenshot();

          const seen = await readMenu(screenshot, { ...this.#mode, result });

          // Any menu after a battle ends it, not only its result: GO Battle League has gone from a faint straight to its
          // card, with no verdict to read.
          const ended = result && seen.screen !== 'unknown';

          // The verdict fades in over a ✓ already teal, which is all a result after a battle is known by: the demo
          // battle's first frame of its result has `YOU WIN!` half drawn, too faint to read, and a run that screenshot
          // it there counted its win unread. The game holds the result until it is tapped, so a verdict unread is read
          // again off a second screenshot, a frame or more later, before the battle is counted without it.
          const verdict = async () => (await readOutcome(screenshot)) ?? readOutcome(await phone.screenshot());

          return {
            screenshot,
            menu: seen,
            ended,
            outcome: ended && seen.screen === 'result' ? await verdict() : undefined,
          };
        })(),
      );
    }

    const done = this.#reading?.done;

    if (!done) {
      return undefined;
    }

    this.#reading = undefined;

    if ('error' in done) {
      throw done.error;
    }

    const { menu: read } = done;

    // The verdict fades in a frame after the result's ✓ is drawn, so a read can catch the ✓ alone, as the demo clip's
    // frame 4913 shows it. That read is passed over for the next, and only a result unread twice running is counted
    // without its verdict.
    const fading: boolean = done.ended && read.screen === 'result' && !done.outcome && !this.#faded;
    this.#faded = fading;

    // GO Battle League never comes back to the map of itself once a battle has been played: a Poké Ball there is the
    // reward encounter's, which is left for the player rather than tapped.
    const menu: Menu =
      fading || (read.screen === 'map' && this.#mode.mode === 'gbl' && battles > 0) ? { screen: 'unknown' } : read;
    this.#screen = menu.screen;

    return { ...done, menu };
  }

  /**
   * Acts on a menu `poll` read: taps it or scrolls it, reading the party screen's cards on the way and searching the
   * party carousel for a party named, and gives the screen `MENU_SETTLE_MS` to move on. Answers `stop` where GO Battle
   * League has no battle to offer until its reward is collected, `lost` for a scroll with nothing known for `LOST_MS`,
   * and nothing where the screen is unknown.
   */
  async act({ screenshot, menu: read }: Read): Promise<Acted> {
    const mode = this.#mode;
    let menu = read;

    // Greyed out read after read, not once among others.
    if (menu.screen !== 'no-battle') {
      this.#noBattle = 0;
    }

    const silhouettes = menu.screen === 'party' && 'tap' in menu ? readParty(screenshot, this.#icons) : [];

    if (menu.screen === 'party' && 'tap' in menu) {
      if (mode.mode === 'gbl' && menu.cap !== undefined) {
        this.#cap = menu.cap;
      }

      this.#log(`party: ${silhouettes.map((species) => species ?? '?').join(', ')}`);
    }

    // A party named is looked for along the carousel before its party is used, the search starting afresh each time the
    // party screen comes round.
    if (menu.screen === 'party' && 'tap' in menu && mode.mode === 'gbl' && mode.party !== undefined) {
      const step = searchParty(this.#search, menu.title, mode.party);

      // A step along the carousel is progress, as a scroll of the Battle tab is not: the search ends of itself, at the
      // party or at both ends without it, where a scroll could go on for ever. Each step is a swipe, a settle and a
      // read, some 3s, so a search turning back past a few parties would otherwise run out `LOST_MS` and end lost.
      if (step === 'next' || step === 'back') {
        this.#watch.progress();
      }

      this.#log(`party: ${menu.title ?? '?'} in front, looking for ${mode.party}`);
      menu =
        step === 'use' ? menu : step === 'unread' ? { screen: 'unknown' } : { screen: 'party', swipe: CAROUSEL[step] };
    } else if (menu.screen !== 'party') {
      this.#search = carousel();
    }

    // The party to be used, each card read off the selection screen unless it is the card last tried there, whose
    // moves, if any were read, are kept. Where a card left anything but the party screen showing, the screen is read
    // afresh rather than USE THIS PARTY tapped at it. The CPs are off the read `readMenu` made, where it made one.
    if (menu.screen === 'party' && 'tap' in menu) {
      const cps = menu.cps ?? (await readCps(screenshot));
      const cards = silhouettes.map((species, slot) => ({ species, cp: cps[slot] ?? null }));
      const tried = cards.map((card, slot) => (sameCard(this.#lastTried[slot], card) ? this.#party[slot] : undefined));
      const stale = cards.flatMap((_, slot) => (tried[slot] ? [] : [slot]));

      this.#lastTried = cards.map((card, slot) => {
        const was = tried[slot] && this.#lastTried[slot];

        return was ? { ...card, cp: card.cp ?? was.cp } : card.cp === null ? undefined : { ...card, cp: card.cp };
      });
      this.#party = cards.map((card, slot) => tried[slot] ?? card);

      if (stale.length > 0) {
        const selection = await this.#readCards(this.#party, stale, screenshot);
        this.#party = selection.cards;
        menu = selection.back ? menu : { screen: 'unknown' };
      }
    }

    // Loaded before the card is tapped, so the time a fetch takes is not counted towards `LOST_MS` from the tap.
    const metaOf = this.#metaOf;

    if (
      menu.screen === 'league' &&
      'tap' in menu &&
      menu.title !== undefined &&
      menu.title !== this.#metaFor &&
      metaOf
    ) {
      this.#metaFor = menu.title;
      this.#meta = await metaOf(menu.title, this.#log);
      this.#cap = this.#meta?.cap;

      if (this.#meta) {
        this.#log(ranking(this.#meta));
      }
    }

    // A scroll is not progress: a tab already at its foot whose portraits go unmatched would be scrolled for ever, so
    // the scrolls count towards `LOST_MS` from the tap that opened the tab. Matchmaking is: it is waited out, however
    // long GO Battle League takes to find an opponent.
    if ('swipe' in menu) {
      if (this.#watch.lost()) {
        return 'lost';
      }

      this.#log(`${menu.screen}: scroll`);
      await this.#phone.swipe(...menu.swipe, SCROLL_MS);
    } else if (menu.screen === 'matchmaking') {
      this.#watch.progress();
    } else if (menu.screen === 'no-battle' && ++this.#noBattle >= NO_BATTLE_READS) {
      this.#log('no-battle: a reward to collect');
      return 'stop';
    } else if ('tap' in menu) {
      this.#log(`${menu.screen}: tap`);
      await this.#phone.tap(menu.tap);
      this.#watch.progress();
    }

    if (menu.screen === 'unknown') {
      return undefined;
    }

    await this.#clock.sleep(MENU_SETTLE_MS);
    return 'acted';
  }

  /**
   * `cards` with the moves of each card in `slots` merged in, read off the selection screen in turn as `readCard` reads
   * them, and whether the party screen is showing again. Stops at one that left anything but the party screen showing,
   * nothing more being tapped then.
   */
  async #readCards(cards: readonly Card[], slots: readonly number[], screen: Size) {
    const read = [...cards];

    for (const slot of slots) {
      const card = read[slot];

      if (card?.cp === null || card === undefined) {
        this.#log(`card ${slot + 1} unread: its CP unread`);
        continue;
      }

      const sleep = (ms: number) => this.#clock.sleep(ms);
      const { species, cp } = card;
      const { panel, why, back } = await readCard(
        this.#phone,
        sleep,
        cardAt(slot, screen),
        { species, cp },
        this.#data,
      );
      this.#watch.progress();

      if (panel) {
        const { species: name, ...moves } = panel;
        read[slot] = { ...card, species: name, moves };
        this.#log(`${name ?? '?'} CP ${cp}: ${moves.fast ?? '?'} / ${moves.charged.join(', ')}`);
      } else {
        this.#log(`card ${slot + 1} unread: ${why ?? '?'}`);
      }

      if (!back) {
        return { cards: read, back };
      }
    }

    return { cards: read, back: true };
  }
}

/** How a meta is told as the run takes it up: the cup and CP PvPoke ranks it at, and how many species it ranks. */
export const ranking = (meta: Meta) =>
  `opponents' moves as PvPoke ranks ${meta.cup} at ${meta.cap ?? 'any'} CP: ${meta.movesets.size} species`;

/** Whether `card` is the one tried before as `was`: the same species, and the same CP unless this one's went unread. */
const sameCard = (was: { species: string | null; cp: number } | undefined, card: Card) =>
  was !== undefined && was.species === card.species && (card.cp === null || was.cp === card.cp);
