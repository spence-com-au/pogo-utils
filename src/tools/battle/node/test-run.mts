/**
 * The whole loop against a scripted phone, for the `run-*.test.mts`: recorded frames of each screen, moved on by a tap
 * in the right place and by nothing else, under a clock that only advances when the run waits or the phone works, on
 * which a screenshot or an OCR read takes as long as it would on a real phone. A tap anywhere a screen does not answer
 * leaves it where it is, which is how a wrong tap shows: the run stalls, and ends `Lost`.
 *
 * The tests are spread over several files, each a few of the run's concerns, so that the runners take them side by
 * side rather than one file's worth of scripted battles one after another.
 */

import { type GameData } from '../../../core/game-master.mts';
import { decodePng, type Image } from '../../../core/png.mts';
import { useEngine, type Engine } from '../../../core/ocr.mts';
import { wasmEngine } from '../../../core/node/test-wasm.mts';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import { afterAll } from 'vitest';
import { silhouetteOfIcon } from '../party.mts';
import { type Point } from '../layout.mts';
import { type Fight, type Reporter } from '../reporter.mts';
import { type Phone } from '../phone.mts';
import { GAME_ALONE } from '../overlay.mts';
import { LOST_MS, run, type Clock, type Options } from '../run.mts';

/**
 * How long Tesseract takes over a band of a battle's frame, in milliseconds: 33 on average over 112 bands of two live
 * Training battles on a Pixel 4 XL, so `readBattle`'s two take about 70ms.
 */
export const OCR_MS = 35;

/**
 * Tesseract's answer to each read, by the band and how it was asked, kept across a file's tests: the scripted battles
 * read the same few fixture frames over and over, 1316 reads of 74 distinct bands over all the `run-*.test.mts`, and
 * Tesseract answers a band the same way every time, so asking it again would spend most of a file's time on answers
 * already had. A remembered read still takes `ocrMs` on the scripted clock, which is the only time a run sees.
 */
const READS = new Map<string, Promise<string>>();

// Started as the module is imported, so each test file importing it has an engine and a `READS` of its own.
const engine = wasmEngine();
afterAll(() => engine.terminate());

const tsv: Engine['tsv'] = (image, psm, whitelist) => {
  const key = `${createHash('sha1').update(image.data).digest('hex')} ${image.width} ${psm} ${whitelist}`;
  let read = READS.get(key);

  if (!read) {
    read = engine.tsv(image, psm, whitelist);
    READS.set(key, read);
  }

  return read;
};

export const DATA = JSON.parse(
  readFileSync(new URL('../../../../data/game-master.json', import.meta.url), 'utf8'),
) as GameData;

export const fixture = (name: string) =>
  decodePng(readFileSync(fileURLToPath(new URL(`../fixtures/${name}.png`, import.meta.url))));

/**
 * The first of `scenes` showing what a kept frame does. A kept frame is a copy, a stream's frame lasting only until the
 * next, so it is told by its pixels: a scene showing the same fixture as an earlier one is named as the earlier.
 */
export const sceneShowing = (scenes: Record<string, Scene>, frame: Image) =>
  Object.keys(scenes).find((name) => Buffer.from(scenes[name]?.frame.data ?? []).equals(frame.data));

/** A reporter keeping what a run tells it: each event after the side it is of, and the battle as each status had it. */
export function recorder(): Reporter & { events: string[]; fights: Fight[] } {
  const events: string[] = [];
  const fights: Fight[] = [];

  return {
    events,
    fights,
    event: (line, side, why) => events.push(`${side ?? 'run'}: ${line}${why ? `: ${why}` : ''}`),
    status: ({ fight }) => fight && fights.push(fight),
  };
}

/** The icons `party.test.mts` reads the party screens against. */
export const ICONS = readdirSync(new URL('../fixtures/icons/', import.meta.url)).map((icon) => ({
  species: DATA.forms.find((form) => form.icon === icon)?.species ?? icon,
  silhouette: silhouetteOfIcon(fixture(`icons/${icon.replace(/[.]png$/, '')}`)),
}));

/** The game's icon for each type, by the game master's type names. */
const TYPE_ICONS = Object.fromEntries(
  DATA.types.map((type) => [type, fixture(`types/POKEMON_TYPE_${type.toUpperCase()}`)]),
);

export interface Scene {
  frame: Image;
  screenshot?: Image;

  /** Where a tap moves the phone on from here, and to which scene: one place, or each of several. */
  tap?: { at: Point; to: string } | readonly { at: Point; to: string }[];

  /** Where a hold here shows something, and what. */
  hold?: { at: Point; shows: Image };

  /** What a search typed here finds, and to which scene that moves the phone on. */
  search?: { text: string; to: string } | readonly { text: string; to: string }[];

  /** How many swipes move the phone on from here, and to which scene. */
  swipes?: { count: number; to: string };

  /** How long the scene lasts on its own before moving on, in milliseconds. */
  lasts?: { ms: number; to: string };

  /** What `uiautomator dump` writes here: the game alone, unless PGSharp's overlay is drawn over it. */
  views?: string;

  /** The screen standing still through the scene, as the phone sends no frame while nothing on it moves: one frame. */
  still?: boolean;
}

/** How long a hold takes, in milliseconds: longer than any `phoneOf` in `src/tools/battle/phone.mts` makes. */
const HOLD_MS = 4000;

/**
 * How often the phone sends a frame, in milliseconds: 30 a second, as it does throughout a battle, where kept videos of
 * live runs go no longer than 0.3s without one around a shield prompt.
 */
export const FRAME_MS = 33;

/** Whether a touch at `at` lands on what is drawn at `target`. */
const near = (target: Point, at: Point) => Math.abs(target[0] - at[0]) < 0.05 && Math.abs(target[1] - at[1]) < 0.04;

/**
 * A phone playing `scenes` from `start`, and the clock it runs on. Each OCR read takes `ocrMs` of it, given the time the
 * read began: `OCR_MS` unless a test slows it.
 */
export function scripted(
  scenes: Record<string, Scene>,
  start: string,
  ocrMs: (at: number) => number = () => OCR_MS,
  viewsMs = 0,
): {
  phone: Phone;
  clock: Clock;
  taps: string[];
  holds: string[];
  searches: string[];
  strokes: { scene: string; from: Point; to: Point; at: number }[];

  /** Each scene the phone moved on to, and when. */
  visits: { scene: string; at: number }[];
} {
  let time = 0;
  let current = start;
  let entered = 0;
  let swiped = 0;
  const taps: string[] = [];
  const holds: string[] = [];
  const searches: string[] = [];
  const strokes: { scene: string; from: Point; to: Point; at: number }[] = [];
  const visits: { scene: string; at: number }[] = [];

  // Screenshots taken and OCR begun, not yet handed back: each takes time on the run's clock, a screenshot a second and
  // a read `ocrMs`, which passes as the run waits or the phone works rather than holding the run up, as on a real
  // phone while the stream goes on. A read is handed back once that time has passed, the clock waiting there for the
  // real one to finish.
  const developing: { due: number; deliver: () => unknown }[] = [];

  // How many times the clock has moved, and whether it is moving now. A run at work comes back to the phone or the clock
  // before anything else has a turn, so one that has not by then has finished with reads still under way, which the
  // clock moves on through so that they are not left pending. `run` never awaits a read itself, but one that did would
  // be waiting on it here, and would see the read take its time, as on a real phone, rather than hang.
  let moves = 0;
  let advancing = false;

  async function advance(ms: number) {
    moves++;
    advancing = true;
    time += ms;

    for (const work of developing.filter(({ due }) => due <= time).sort((a, b) => a.due - b.due)) {
      developing.splice(developing.indexOf(work), 1);
      await work.deliver();
    }

    // Whatever follows on from what was handed back has run before the run looks at the phone again.
    await setImmediate();
    advancing = false;
    idle();
  }

  function idle() {
    const at = moves;

    void setImmediate().then(() => {
      const next = Math.min(...developing.map(({ due }) => due));

      if (moves === at && !advancing && next < Infinity) {
        void advance(next - time);
      }
    });
  }

  useEngine({
    tsv: (...args) => {
      const read = tsv(...args);
      const due = time + ocrMs(time);

      // Failing before it is due, a read fails where it is handed back rather than as a rejection nothing handles.
      read.catch(() => {});

      return new Promise((resolve, reject) => {
        developing.push({ due, deliver: () => read.then(resolve, reject) });
        idle();
      });
    },
  });

  const go = (to: string) => {
    current = to;
    entered = time;
    swiped = 0;
    visits.push({ scene: to, at: time });
  };

  const scene = () => {
    const now = scenes[current];

    if (!now) {
      throw new Error(`no scene ${current}`);
    }

    if (now.lasts && time - entered >= now.lasts.ms) {
      go(now.lasts.to);
      return scene();
    }

    return now;
  };

  // The scene's picture, sent afresh every `FRAME_MS` unless the scene stands still, as the stream sends frames: a
  // frame read twice is one turn of the loop coming round before the next, never a second look at the screen.
  let sent: { frame: Image; of: Scene; at: number } | undefined;

  const phone: Phone = {
    frame: () => {
      const of = scene();

      if (sent?.of !== of || (!of.still && time - sent.at >= FRAME_MS)) {
        sent = { frame: { ...of.frame }, of, at: time };
      }

      return sent.frame;
    },
    screenshot: () => {
      const { frame, screenshot } = scene();

      return new Promise((resolve) =>
        developing.push({ due: time + 1000, deliver: () => resolve(screenshot ?? frame) }),
      );
    },
    tap: async (at) => {
      await advance(30);
      const target = [scene().tap ?? []].flat().find((tap) => near(tap.at, at));
      taps.push(current);

      if (target) {
        go(target.to);
      }
    },
    views: () => {
      const { views = GAME_ALONE } = scene();

      // After `viewsMs`, at once unless a test says otherwise, where on a phone it takes some 4s: scenes timed from the
      // run's start would otherwise have moved on before its first frame, the run waiting on its first dump. Handed back
      // on a turn of the clock all the same, with nothing else to move it before then.
      return new Promise((resolve) => {
        developing.push({ due: time + viewsMs, deliver: () => resolve(views) });
        idle();
      });
    },
    hold: async (at) => {
      const { hold, frame, screenshot } = scene();
      holds.push(current);
      await advance(HOLD_MS);

      return hold && near(hold.at, at) ? hold.shows : (screenshot ?? frame);
    },
    search: async (text) => {
      await advance(30);
      const found = [scene().search ?? []].flat().find((search) => search.text === text);
      searches.push(text);

      if (found) {
        go(found.to);
      }
    },
    swipe: async (from, to, ms) => {
      strokes.push({ scene: current, from, to, at: time });
      await advance(ms + 30);
      const { swipes } = scene();

      if (swipes && ++swiped >= swipes.count) {
        go(swipes.to);
      }
    },
  };

  const clock: Clock = { now: () => time, sleep: advance };

  return { phone, clock, taps, holds, searches, strokes, visits };
}

/** The modes most tests play: Blanche's Training battles and GO Battle League, both in the Ultra League. */
export const ULTRA = { mode: 'training', leader: 'blanche', league: 'ultra' } as const;
export const GBL = { mode: 'gbl', league: 'ultra' } as const;

/** `run` over the game master and the icons the fixtures are read against, which a test varies only by naming them. */
export const play = (
  phone: Phone,
  options: Partial<Options> & Pick<Options, 'mode'>,
  clock: Clock,
  report?: Reporter,
) => run(phone, { data: DATA, icons: ICONS, typeIcons: TYPE_ICONS, ...options }, clock, report);

/** One battle and the way back round to the next, as recorded against Blanche in the Ultra League. */
export function battleAndBack(): Record<string, Scene> {
  const menu = (name: string, tap: Scene['tap'], lasts?: Scene['lasts']): Scene => ({
    frame: fixture(name),
    ...(tap && { tap }),
    ...(lasts && { lasts }),
  });

  return {
    training: menu('menu-training', { at: [0.26, 0.8], to: 'intro' }),
    intro: menu('menu-intro', { at: [0.5, 0.733], to: 'league' }),
    league: menu('menu-league', { at: [0.55, 0.58], to: 'party' }),
    party: menu('menu-party', { at: [0.5, 0.87], to: 'loading' }),
    loading: { frame: fixture('other-vs-fade'), lasts: { ms: 4000, to: 'fight' } },
    fight: { frame: fixture('battle-deoxys'), swipes: { count: 30, to: 'charged' } },
    charged: { frame: fixture('charged-shadow-sneak'), tap: { at: [0.499, 0.889], to: 'minigame' } },
    minigame: { frame: fixture('playing-minigame-giratina'), swipes: { count: 40, to: 'won' } },
    won: { frame: fixture('other-win'), screenshot: fixture('menu-unknown-medal'), lasts: { ms: 8000, to: 'result' } },
    result: menu('menu-result', { at: [0.5, 0.935], to: 'training' }),
  };
}

/** `image` with each box, as `[left, top, right, bottom]` in widths, filled with `colour`. */
export function painted(image: Image, colour: readonly number[], ...boxes: (readonly number[])[]): Image {
  const data = image.data.slice();

  for (const [left = 0, top = 0, right = 0, bottom = 0] of boxes) {
    for (let y = Math.round(top * image.width); y < bottom * image.width; y++) {
      for (let x = Math.round(left * image.width); x < right * image.width; x++) {
        data.set([...colour, 255], (y * image.width + x) * 4);
      }
    }
  }

  return { ...image, data };
}

/** `image` with the box, as `[left, top, right, bottom]` in widths, copied from `from`, a frame of the same size. */
export function pasted(
  image: Image,
  from: Image,
  [left = 0, top = 0, right = 0, bottom = 0]: readonly number[],
): Image {
  const data = image.data.slice();

  for (let y = Math.round(top * image.width); y < bottom * image.width; y++) {
    const start = (y * image.width + Math.round(left * image.width)) * 4;
    const end = (y * image.width + Math.round(right * image.width)) * 4;
    data.set(from.data.subarray(start, end), start);
  }

  return { ...image, data };
}

/** Where our first Poké Ball is on the Pixel 4 XL's frames, as a box for `painted`. */
export const FIRST_BALL = [0.045, 0.19, 0.071, 0.215];

/** Where the opponent's Poké Balls are on the Pixel 4 XL's frames, as boxes for `painted`. */
export const THEIR_BALLS = [0.842, 0.892, 0.944].map((x) => [x - 0.01, 0.192, x + 0.01, 0.213]);

/** Where the banner is on the Pixel 8 Pro's frames, Charizard's in full, as a box for `pasted`. */
export const PILL = [0.15, 0.6, 0.85, 0.82];

/**
 * The minigame of `battleAndBack` with our first Poké Ball and all the opponent's painted red, as the frames thrown
 * from are: one grey on either side would be read as a faint, the opponent's taking the throw for one that never plays.
 */
export const minigameNoneFainted = (): Scene => ({
  frame: painted(fixture('playing-minigame-giratina'), [200, 60, 60], FIRST_BALL, ...THEIR_BALLS),
  swipes: { count: 40, to: 'won' },
});

/**
 * The same Giratina against Mamoswine, our shields spent and its two up, our grey Poké Ball painted red and each frame
 * then `paint`ed, through Mamoswine's Powder Snow taking our bar, repainted, down each of `bars` 200ms apart once the
 * battle's first read has named it, Shadow Sneak's button painted unlit; and then `lit`, our bar at the last of `bars`
 * and the button lit. Five hits, 40 energy, and one for the count afford Ancient Power's 45, which takes 27% of a
 * rank-1 Giratina, where Bulldoze, the hardest Mamoswine is run with in `MAMOSWINE_RUN`, takes 43%: less than 1/1.4 of
 * 76%, and not of 54%. `ours` is the frame with our bar run on to `px`.
 */
export function sneaking(
  bars: readonly number[],
  lit: Omit<Scene, 'frame'>,
  paint = (image: Image) => image,
): { scenes: Record<string, Scene>; ours: (px: number) => Image } {
  const balls = paint(painted(fixture('charged-shadow-sneak'), [200, 60, 60], FIRST_BALL));

  // Our fill run on to `px` of the bar's 100 at 360 wide, red under 20 as the game draws a bar that low, and dark beyond
  // it; and Shadow Sneak's button unlit, as in `run-baits.test.mts`'s test of fast moves finishing the opponent.
  const ours = (px: number) =>
    painted(
      painted(balls, [105, 91, 41], [22 / 360, 220 / 360, 122 / 360, 225 / 360]),
      px < 20 ? RED : [26, 255, 187],
      [22 / 360, 220 / 360, (22 + px) / 360, 225 / 360],
    );
  const unlit = (image: Image) => painted(image, [107, 105, 112], [140 / 360, 635 / 360, 220 / 360, 676 / 360]);
  const names = bars.map((_, i) => (i === 0 ? 'fight' : `hit${i}`));
  const hits = bars.map((px, i): [string, Scene] => [
    names[i] ?? '',
    { frame: unlit(ours(px)), lasts: { ms: i === 0 ? 400 : 200, to: names[i + 1] ?? 'lit' } },
  ]);

  return {
    scenes: {
      ...battleAndBack(),
      ...Object.fromEntries(hits),
      lit: { frame: ours(bars.at(-1) ?? 0), ...lit },
      minigame: minigameNoneFainted(),
    },
    ours,
  };
}

/** The same with the foot painted dark over our buttons and their names, as a charged move under way leaves it. */
export const unnamed = () => painted(xerneas(), [20, 26, 30], [0, 1.85, 1, 802 / 360]);

/**
 * Xerneas, its card read as Geomancy, fights Garchomp for 3s and goes on to `after`'s `next`: the phone's strokes, and
 * every status told, with the screen it was told on and our energy as counted.
 */
export async function fightThen(after: Record<string, Scene>) {
  const { phone, clock, strokes } = scripted(
    { ...masterParty(), fight: { frame: xerneas(), lasts: { ms: 3000, to: 'next' } }, ...after },
    'party',
  );
  const report = recorder();
  const told: { screen: string; energy: number | undefined }[] = [];

  await play(phone, { mode: { mode: 'training', leader: 'blanche', league: 'master' }, count: 1 }, clock, {
    ...report,
    status: (status) => {
      report.status(status);
      told.push({ screen: status.screen, energy: status.fight?.ourEnergy?.energy });
    },
  });

  return { strokes, told };
}

/**
 * Where Charizard's full bar runs on under the "Go, Magmar!" bubble on `battle-charizard-magmar`, from 93% to the
 * outline, its fill dimmed there, which `readHealth` leaves unread: painted as the bar left empty, it reads 93%.
 */
export const CHARIZARD_BUBBLE = [116 / 360, 243 / 360, 121 / 360, 249 / 360];

/** Charizard against Magmar as `battle-charizard-magmar` shows them, with Charizard's bar ending at 93%. */
export const charizard = () => painted(fixture('battle-charizard-magmar'), [52, 86, 97], CHARIZARD_BUBBLE);

/** Where Charizard's bar ends on `charizard`, at 93%, and two points of it short of there, as a box. */
const CHARIZARD_HIT = [114 / 360, 243 / 360, 117 / 360, 248 / 360];

/** As `CHARIZARD_HIT`, but eight points of Charizard's bar. */
export const CHARIZARD_HARD_HIT = [108 / 360, 243 / 360, 117 / 360, 248 / 360];

/** Where the right of our two shields is on the Pixel 4 XL's frames, as a box for `painted`: it goes first. */
export const OUR_SECOND_SHIELD = [0.273, 0.2, 0.289, 0.218];

/**
 * The next of ours sent in after a faint, Mamoswine's minigame standing for it flying in: the HUD up and no button
 * drawn yet, nothing to swipe at, until the battle is won.
 */
export const flyingIn = (): Scene => ({ frame: fixture('playing-minigame-mamoswine'), lasts: { ms: 2000, to: 'won' } });

/**
 * GO Battle League from the map: its card's BATTLE at the top of the Battle tab, the welcome before a set, the league,
 * the recommended party, and an opponent found for longer than `LOST_MS`, then NEXT BATTLE on the result, back to the
 * league.
 */
export function league(): Record<string, Scene> {
  return {
    ...battleAndBack(),
    map: { frame: fixture('menu-map'), tap: { at: [0.5, 0.932], to: 'main' } },
    main: { frame: fixture('menu-main'), tap: { at: [0.777, 0.5975], to: 'tab' } },
    tab: { frame: fixture('menu-gbl-battle-tab'), tap: { at: [0.3, 0.843], to: 'welcome' } },
    welcome: { frame: fixture('menu-gbl-welcome'), tap: { at: [0.3, 0.895], to: 'league' } },
    league: { frame: fixture('menu-gbl-league'), tap: { at: [0.54, 0.43], to: 'party' } },
    party: { frame: fixture('menu-gbl-party'), tap: { at: [0.5, 0.87], to: 'matching' } },
    matching: { frame: fixture('menu-gbl-matchmaking'), lasts: { ms: LOST_MS * 2, to: 'fight' } },
    result: { frame: fixture('menu-gbl-result'), tap: { at: [0.5, 0.854], to: 'league' } },
  };
}

/**
 * The party screen of Origin Palkia, Metagross and Xerneas, then Blanche's battle and the way back round. `MISREAD`
 * reads Palkia's card as Mamoswine, which a search by that and its CP finds nothing pink of, Palkia being found by its
 * CP alone. Metagross's search finds nothing pink either way. Each search shows what `search` names, and the one
 * cleared or searched over goes back to the unsearched screen. `cancel` is the tap the selection screen answers beside
 * its search field: CANCEL, back to the party screen, unless a test has it answer another. The way back round comes to
 * the party screen again with Xerneas's CP painted out, as OCR misses one now and then.
 */
export function masterParty(cancel = { at: SELECTION.cancel, to: 'party' }): Record<string, Scene> {
  const unsearched = fixture('menu-pixel8-selection');
  const nothing = fixture('menu-pixel8-selection-searched');
  const selection = (slot: number, searches: { text: string; to: string }[]): Scene => ({
    frame: unsearched,
    tap: [{ at: SELECTION.search, to: `select${slot}` }, cancel],
    search: searches,
  });
  const found = (slot: number, frame: Image, held?: string): Scene => ({
    frame,
    tap: [
      { at: SELECTION.clear, to: `select${slot}` },
      { at: SELECTION.search, to: `select${slot}` },
    ],
    ...(held && { hold: { at: SELECTION.first, shows: fixture(held) } }),
  });

  const party = (frame: Image): Scene => ({
    frame,
    tap: [
      ...[0, 1, 2].map((slot) => ({ at: SELECTION.card(slot), to: `select${slot}` })),
      { at: SELECTION.use, to: 'loading' },
    ],
  });

  return {
    ...battleAndBack(),
    party: party(fixture('menu-pixel8-party-master')),
    league: { frame: fixture('menu-league'), tap: { at: [0.55, 0.58], to: 'again' } },
    again: party(MASTER_CP_UNREAD),
    select0: selection(0, [
      { text: '473&cp4673', to: 'none0' },
      { text: 'cp4673', to: 'found0' },
    ]),
    none0: found(0, nothing),
    found0: found(0, fixture('menu-pixel8-search-palkia'), 'menu-pixel8-held-palkia'),
    select1: selection(1, [
      { text: '376&cp3986', to: 'none1' },
      { text: 'cp3986', to: 'none1' },
    ]),
    none1: found(1, nothing),
    select2: selection(2, [{ text: '716&cp4275', to: 'found2' }]),
    found2: found(2, fixture('menu-pixel8-search-xerneas'), 'menu-pixel8-held-xerneas'),
  };
}

/** Our two shields' hexagons, for `painted`. */
export const HELD = [0.236, 0.281].map((x) => [x - 0.008, 0.2, x + 0.008, 0.218]);

/** Latias's fight with both our shields painted spent. */
export const shieldsSpent = () => painted(fixture('battle-latias'), [110, 80, 116], ...HELD);

/**
 * Charizard against Magmar as `charizard` shows them, then one of Magmar's fast moves landing on Charizard, a 2-point
 * step as Ember's or Karate Chop's 3 of its 149 HP is, and then `prompt`. With `spent`, Charizard has spent one of its
 * shields throughout.
 */
export function charizardHit(prompt: Image, spent = false): Record<string, Scene> {
  const fight = spent ? painted(charizard(), [111, 81, 118], OUR_SECOND_SHIELD) : charizard();

  return {
    fight: { frame: fight, lasts: { ms: 1000, to: 'hit' } },
    hit: { frame: painted(fight, [52, 86, 97], CHARIZARD_HIT), swipes: { count: 10, to: 'prompt' } },
    prompt: { frame: prompt, tap: { at: [0.5, 0.82], to: 'won' }, lasts: { ms: 3000, to: 'won' } },
  };
}

/** The red of a bar's fill as the stream draws it, for painting a bar low enough to turn red. */
export const RED = [230, 106, 96];

/**
 * Xerneas against Garchomp as in `run-baits.test.mts`'s test of a lit move going once our energy fills the move held
 * for too late, our grey Poké Ball painted red.
 */
const xerneas = () =>
  painted(fixture('battle-pixel8-xerneas-super-effective'), [200, 60, 60], [15 / 360, 69 / 360, 30 / 360, 82 / 360]);

/**
 * A Pixel 8 Pro's Master League party, each card opening the selection screen: its search field, CANCEL, the ⊗ that
 * clears a search, the cards on the party screen and the pink cell of a search's first result, as the reader places
 * them on its 1008×2244.
 */
export const SELECTION = {
  card: (slot: number): Point => [[0.231, 0.5, 0.769][slot] ?? 0.5, 0.732],
  use: [0.5, 0.872] as Point,
  search: [0.556, 0.241] as Point,
  clear: [0.92, 0.241] as Point,
  cancel: [0.278, 0.93] as Point,
  first: [0.185, 0.397] as Point,
};

/** The Master League party screen with the CP over Xerneas's card painted out, in widths. */
export const MASTER_CP_UNREAD = painted(
  fixture('menu-pixel8-party-master'),
  [255, 255, 255],
  [0.66, 1.455, 0.88, 1.52],
);
