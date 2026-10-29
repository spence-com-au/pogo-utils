/**
 * Team Leader or GO Battle League battles one after another: `Player` through each battle, read off the stream frame by
 * frame, and `readMenu` between them, read off full screenshots, from the result round to the next USE THIS PARTY.
 *
 * Driven through `Phone` rather than `adb`, so a test can stand a scripted phone in for a real one.
 */

import { type GameData } from '../inventory/game-master.mts';
import { type Image } from '../inventory/png.mts';
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
import { readParty, type Icon } from './party.mts';
import { BOTTOM, place } from './layout.mts';
import { BENCH, BENCH_ANCHOR, Player, SWITCH_CARDS, type Point } from './play.mts';
import { bubbleSwipes, typeColour, type Colour } from './minigame.mts';
import { readHealth, Steady } from './health.mts';
import { merge, readBanner, readBattle, unseen, type Sighting } from './read.mts';
import {
  countdown,
  opponentShields,
  ownShields,
  pokemonLeft,
  readyButtons,
  recognise,
  type State,
} from './recognise.mts';
import {
  activeOf,
  beforeFainting,
  bestButton,
  counterOf,
  nextOut,
  refugeOf,
  stripperOf,
  typesOf,
  type Pick,
  type Switch,
} from './strategy.mts';
import {
  afterThrow,
  finisher,
  NO_STAGES,
  wouldFaint,
  wouldShield,
  type Side,
  type Stages,
  type Verdict,
} from './damage.mts';
import { iconColour, readTypes } from './typing.mts';
import { Energy, Hits, spare, type Matchup } from './energy.mts';
import { type Meta } from './meta.mts';
import { type Fight, type Reporter } from './report.mts';

export interface Phone {
  /** The latest frame of the stream, or `undefined` before the first. */
  frame(): Image | undefined;
  screenshot(): Promise<Image>;
  tap(at: Point): Promise<void>;
  swipe(from: Point, to: Point, ms: number): Promise<void>;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/**
 * How long nothing may be recognised before the run stops, in milliseconds. Twice the 10s first planned, because a
 * recorded battle's end ran 10s from its last frame to the ✓ that can be tapped — `YOU WIN!`, the stardust, a medal's
 * ring — with nothing on screen that is either a battle or a menu.
 */
export const LOST_MS = 20_000;

/**
 * How long a screen must read as `other` before it is screenshot as a menu. A battle shows `other` for a second or two
 * at a time — a banner over the HUD, the opponent's charged move — and a screenshot costs one, with OCR on top. The read
 * runs beside the battle rather than holding it up: awaited, it left the battle unplayed for as long as the screenshot
 * and OCR took after every charged move, the loop learning only then that the battle had come back.
 */
const MENU_AFTER_MS = 1_500;

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
 * How often the battle's names and move labels are read again, from when the last read began, in milliseconds: what it
 * reads changes only when a Pokémon on either side does. A read takes about 220ms, a fast move's worth, so it runs
 * beside the battle rather than holding it up, which would leave every frame meanwhile unplayed, no swipe going out and
 * a prompt or a lit button seen late.
 */
const READ_MS = 3_000;

/**
 * How long after a shield prompt, or the countdown of a throw with no shield of ours left to prompt for, the banner
 * naming the move is looked for, and how often, in milliseconds. The banner follows the move's animation, a shield's
 * included: 2.4s after a prompt for Groudon's Solar Beam, past 3.9s for a Rhyperior's, the wall still up at the last of
 * twelve reads, and read 2.1s after the countdown for Greninja's Hydro Cannon. Read beside the battle rather than
 * holding it up, as the menu is, the battle having often come back by then.
 */
const BANNER_MS = 8_000;
const BANNER_EVERY_MS = 300;

/**
 * How much fuller than before the opponent's bar must read to be a newcomer's, as a fraction of it: ten times the pixel
 * the bar is read to, so a misread does not pass for one.
 */
const NEWCOMER = 0.1;

/**
 * How many frames the shield prompt must show for to be counted as the opponent's throw, as `Player` settles on it, and
 * the countdown where the throw puts up no prompt, none of our shields being left.
 */
const THROWN = 3;

/**
 * How long the fight must show none of our charged-move buttons lit, unbroken, for a throw tapped to be playing, in
 * milliseconds: its minigame draws none, from `Get Ready!` on. Over the 11 GO Battle League battles the user recorded
 * on a Pixel 8 Pro, every minigame ran 5.1s at the least and mostly 8–11s, and nothing else after a tap ran longer than
 * 2.4s, the banner after the opponent's move the longest. The minigame's bubbles are no sign of their own: Fly's are
 * found on its own lit button in `charged-pixel8-fly`, and on the sky behind `battle-banner-pixel8-charizard`.
 */
const PLAYING_MS = 3_500;

/**
 * How long the button of a throw tapped must stay lit and untapped, once the opponent's move or any other frame that
 * is not the fight's has come between, for the tap to have been dropped, in milliseconds. A throw the opponent's came
 * ahead of, and that plays after theirs, shows its button lit for a tenth of a second as the HUD comes back.
 */
const RELIT_MS = 1_000;

/**
 * How long after a bench card's tap our HUD is read again to see whether the switch took, in milliseconds. Recorded on
 * the Pixel 4 XL, the bench showed the switch by 135.5s and the HUD, hidden behind a banner meanwhile, came back naming
 * the newcomer at 136.3s; a read before then could still find the Pokémon tapped away from.
 */
const SWITCHED_MS = 2_000;

/**
 * How long after a read first names a newcomer of the opponent's a bench card's tap waits, in milliseconds: until the
 * newcomer has flown in, under `Go, Dragonite!` across the field, through which the game drops the tap. Recorded in GO
 * Battle League on both phones, the banner was last drawn 2.0s after the HUD first named Magmar, Kyurem and Garchomp,
 * 1.9s after Articuno, and 1.5s after Dragonite, our charged move hiding the HUD until then: the game master's
 * three-turn `flyinDurationTurns`, 1.5s, shown half a second after the HUD changes. The read names the newcomer no
 * sooner than the HUD does. Both counters tapped the moment the newcomer was read went in under the banner, and did
 * nothing.
 */
const FLY_IN_MS = 2_000;

/**
 * How long after a switch of ours another to bank energy is not tried, and a tap refused is taken as the switch timer's
 * rather than dropped, in milliseconds: our switch timer, which is not read off the screen, and a tap it refuses costs
 * the turn it is made in. The game master's `quickSwapCooldownDurationSeconds` is 45. Live, the bench's cards were
 * still half dark with it 40s after a switch, so it may stand still through charged moves; a timer running longer has
 * its refusal taken as a dropped tap, tried once more at the cost of a turn, after which `REFUSED_MS` more go by.
 */
const TIMER_MS = 45_000;

/**
 * How long after the switch timer refused a switch of ours, or a second tap was dropped against the same newcomer,
 * another to bank energy is not tried, in milliseconds.
 */
const REFUSED_MS = 10_000;

/**
 * How long a battle must be off its field — the minigame, a prompt, a charged move playing — before it is told how long
 * and what showed, in milliseconds, which the battle's line, written only as it changes, leaves unexplained otherwise:
 * live, 10–20s went by without a line. Longer than a banner over the HUD, a second or two, and shorter than a charged
 * move, whose minigame alone waits 2.5s for its first bubbles.
 */
const OFF_MS = 3_000;

/**
 * How long after a faint of ours, a switch prompt's frame or its answer the HUD may go on naming the one that fainted, in
 * milliseconds. Live, Palkia's name stood 2.7s after its Poké Ball went grey, until half a second after the prompt was
 * answered. Past it, a name the HUD reads is the one out's, even of a fainted species: a second of it on the team, or
 * a faint `activeOf` pinned on the wrong slot. Within it the name cannot tell those from the HUD's, so they go by the
 * party's name alone, their CP and labels unread and their lit buttons unthrown, until it is up.
 */
const STALE_MS = 3_000;

/** Frames kept for a run that gets lost, about the last three seconds of it at one frame in ten. */
const KEPT_FRAMES = 10;

/**
 * How long either side of a faint or a shield prompt its frames are handed to `keep`, in milliseconds: long enough for
 * the prompt sliding in and how it was answered, or the HUD before and after the faint.
 */
const AROUND_MS = 1_000;

/** Energy of ours on the bench: the charged moves lit as it left the field, and the Pokémon as then read. */
interface Bank {
  moves: string[];
  own: Side;
}

/** Pokémon left by the Poké Balls, a faint being for good: the lower of the count before and a read, either if null. */
const fewer = (was: number | null, read: number | null) =>
  read === null ? was : was === null ? read : Math.min(was, read);

/** A read run beside the battle: `done` once it has finished, or failed, the failure thrown where the read is used. */
interface Reading<T> {
  done?: T | { error: unknown };
}

/** Sets `reading`'s `done` once `read` has finished or failed. */
function settle<T>(reading: Reading<T>, read: Promise<T>): void {
  void read.then(
    (done) => (reading.done = done),
    (error: unknown) => (reading.done = { error }),
  );
}

/** How many battles finished, and of those how many the result said were won and lost; the rest went unread. */
export interface Tally {
  battles: number;
  won: number;
  lost: number;
}

/** `ms` milliseconds in seconds to a tenth, `11.2s`. */
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/**
 * `read` worked out once for each frame and whatever else it is handed, however many turns of the loop the frame stays
 * the latest. The loop comes round every 20ms, faster than `screenrecord`'s 30 frames a second, and the screen standing
 * still sends none at all, so the same frame was read again and again: a core of the computer's kept busy for nothing.
 * What a read answers is never changed by those it is handed to, so the one answer serves each turn.
 */
function perFrame<Rest extends unknown[], T>(read: (frame: Image, ...rest: Rest) => T) {
  let last: { frame: Image; rest: Rest; answer: T } | undefined;

  return (frame: Image, ...rest: Rest): T => {
    if (last?.frame !== frame || rest.some((arg, i) => arg !== last?.rest[i])) {
      last = { frame, rest, answer: read(frame, ...rest) };
    }

    return last.answer;
  };
}

export class Lost extends Error {
  readonly frames: readonly Image[];

  constructor(frames: readonly Image[]) {
    super(`nothing recognised for ${LOST_MS / 1000}s; stopped rather than tap at a screen it does not know`);
    this.frames = frames;
  }
}

export interface Options {
  mode: Mode;
  data: GameData;

  /** Every form's silhouette with its species, which the party screen's cards are read against. */
  icons: readonly Icon[];

  /**
   * The game's icon for each type, by type name: the colour the minigame's bubbles of the type are drawn in, as
   * `typeColour` reads it, and the colour the HUD's icons of it are told by, as `iconColour` does. A type left out has
   * its bubbles swiped at in rows, and its icon read as no type.
   */
  typeIcons: Readonly<Record<string, Image>>;

  /**
   * What GO Battle League's players run in the league being played, which narrows the opponent's charged moves to
   * theirs for shielding and for who goes in. Absent, as in Training, every move its species can hold is allowed for.
   */
  meta?: Meta | null;
  count?: number;

  /**
   * Handed each frame from `AROUND_MS` before a faint or a shield prompt to `AROUND_MS` after it, once, with the time
   * on the run's clock it was first seen and what happened: `shield`, `faint-own` or `faint-opponent`.
   */
  keep?: (frame: Image, at: number, event: string) => void;
}

/**
 * Plays `count` battles, or until stopped, starting from the map or anywhere between the result of one battle and the
 * start of the next. Answers how many battles finished, fewer than `count` where GO Battle League has no battle to
 * offer until its reward is collected by hand, and how many were won and lost. Throws `Lost` with the last few frames
 * when nothing has been recognised for `LOST_MS`.
 */
export async function run(
  phone: Phone,
  { mode, data, icons, typeIcons, meta, count = Infinity, keep }: Options,
  clock: Clock,
  report: Reporter = { event: () => {}, status: () => {} },
): Promise<Tally> {
  const log = (line: string, side?: 'own' | 'opponent', why?: string) => report.event(line, side, why);
  const coloursBy = (colour: (icon: Image) => Colour) =>
    Object.fromEntries(Object.entries(typeIcons).map(([type, icon]) => [type, colour(icon)]));
  const bubbleColours = coloursBy(typeColour);
  const badges = coloursBy(iconColour);
  const reads = {
    recognise: perFrame(recognise),
    pokemonLeft: perFrame(pokemonLeft),
    opponentShields: perFrame(opponentShields),
    ownShields: perFrame(ownShields),
    readHealth: perFrame(readHealth),
    readyButtons: perFrame(readyButtons),
    countdown: perFrame(countdown),
    bubbleSwipes: perFrame(bubbleSwipes),
  };
  let player: Player | undefined;
  let battles = 0;
  const outcomes: Record<Outcome, number> = { won: 0, lost: 0 };
  let battling = false;
  let known = clock.now();
  let otherSince: number | undefined;
  let noBattle = 0;
  let search = carousel();

  // The menu read under way, if any: settled once its screenshot is taken and read, or failed. The screenshot of a result
  // is read for the battle's outcome too.
  let reading: Reading<{ screenshot: Image; menu: Menu; outcome: Outcome | undefined }> | undefined;
  let frames = 0;
  const kept: Image[] = [];

  // For `keep`: the last `AROUND_MS` of frames, each with when it was first seen, so an event can hand over what led up
  // to it, and the event still handing over what follows it, until when. A frame goes once, to the first event it is
  // near, however many it is near.
  const recent: { frame: Image; at: number }[] = [];
  const handed = new WeakSet<Image>();
  let keeping: { event: string; until: number } | undefined;

  const hand = (frame: Image, at: number, event: string) => {
    if (keep && !handed.has(frame)) {
      handed.add(frame);
      keep(frame, at, event);
    }
  };

  const around = (event: string) => {
    for (const { frame, at } of recent) {
      hand(frame, at, event);
    }

    keeping = { event, until: clock.now() + AROUND_MS };
  };

  let party: (string | null)[] = [];
  let fainted = new Set<number>();
  let sent = 0;

  // What the switch prompt showing was decided to be answered with, once, on its first frame: who fainted and who goes
  // in, and why. Decided again on a later frame, the first tap having moved `sent`, a retap would go to another card.
  let prompt:
    | {
        fainted: number | undefined;
        next: number | undefined;
        why: string | undefined;
        card: Point | undefined;
        answered: boolean;

        /** Whether its faint has been told already, as the Poké Balls caught it before the prompt showed. */
        told: boolean;
      }
    | undefined;

  // The slot whose faint the Poké Balls caught, until a switch prompt shows for it, and whether that was told: the slot
  // out by then is the next one, so the prompt is for this one instead. The balls go grey as it faints, by the prompt's
  // first frame at the latest, so a later faint's replaces this one even where the prompt for it never showed.
  let caught: { slot: number; told: boolean } | undefined;
  let theirShields = 2;
  let ourShields = 2;

  // Whether the opponent's switch just read is still to be answered, and the switch of ours chosen, tapped on the first
  // frame `Player` lets a bench card be once the opponent's newcomer has flown in, at `landing`: a counter to the
  // opponent's switch, or a switch to bank energy, `strip` where it is to draw a shield. Once tapped, the switch is
  // checked by the first read `SWITCHED_MS` on to name ours, or failing that to read its CP: the one tapped away from
  // still out is the tap refused, which leaves it out. And whether a tap has been dropped since the newcomer came in.
  let answer = false;
  let counter: (Switch & { at: Point; strip: boolean }) | undefined;
  let landing = -Infinity;
  let dropped = false;

  // Whether the opponent out came in by a switch rather than after a faint, and so has its switch timer to run before
  // it can switch away from ours; and the opponent ours last stayed in against, doomed, rather than switch from.
  let switchedIn = false;
  let stayedFor: string | null = null;
  let switching:
    | {
        from: number;
        slot: number;
        to: string;
        cp: number | null;
        at: number;
        stages: Stages;

        /** What the slot switched to had banked, given back to it where the switch is refused. */
        bank: Bank | undefined;

        /** The slot sent in to draw a shield before this switch, still out where the switch is refused. */
        stripping: number | undefined;

        /** How soon another switch to bank energy could be tried before this one, again so where its tap is dropped. */
        calm: number;
      }
    | undefined;

  // The energy each of ours left the field with by a switch, as the charged moves lit as it went, and the Pokémon as it
  // was then read, which a finish is judged by: it keeps the energy on the bench, and throws as it comes back in. The
  // slot sent in to draw a shield with its own, which is not switched away again to draw another. And how soon another
  // switch to bank energy may be tried, by our switch timer and its refusals, and when a switch of ours last went
  // through, which alone starts the timer: a tap refused more than `TIMER_MS` after one, or with none, is taken as
  // dropped.
  let banked = new Map<number, Bank>();
  let stripping: number | undefined;
  let calmAt = -Infinity;
  let swappedAt = -Infinity;

  // How many Pokémon each side has left as the HUD's Poké Balls last showed it, never more than the last count, a faint
  // being for good; null until read. `leftAtName` is the opponent's count when its name was first read, which a lower
  // count when the name changes says it fainted rather than switched out.
  let left: { own: number | null; opponent: number | null } = { own: null, opponent: null };
  let leftAtName: number | null = null;

  // How many of ours the Poké Balls showed left when the last switch prompt showed: three, before any has.
  let promptedAt = 3;

  // The opponent a fuller bar said was replaced, its name cleared to be read again, until the newcomer's is: what the
  // newcomer is told as having replaced.
  let departed: string | null = null;

  // The league's CP cap, which a CP read over it is a misread of: Training's by its league, GO Battle League's as its
  // party screen states it, and until then as PvPoke has the league named. `undefined` until known, and then every
  // shield is taken.
  let cap: number | null | undefined = mode.mode === 'training' ? CAPS[mode.league] : meta?.cap;

  // Each side's HP as decided on from the bars read, a misread held back, and a bar not drawn on this frame keeping what
  // an earlier one showed. The opponent's is the last one's until a newcomer's bar is drawn, which the camera does on
  // most frames.
  let steady = new Steady();

  // The opponent's energy, counted off the hits on our bar, and the matchup as last read and how many frames the shield
  // prompt has shown for: a prompt gone is their charged move thrown, once it held as long as `Player` waits to answer
  // one, a prompt sliding past matching for a frame or two on its own. With none of our shields left a throw puts up no
  // prompt, and how many frames its countdown has shown for since the fight last did counts it instead.
  let energy = new Energy(data, meta);
  let matchup: Matchup | undefined;

  // Our fast moves' hits on the opponent's bar, measured as its on ours are, and whom a hold of our charged moves for
  // the next was last told for: told once, rather than on every frame it lasts, until a throw ends it.
  let hits = new Hits();
  let sparing: string | null | undefined;
  let prompted = 0;
  let unprompted = 0;

  // The colour of the bubbles the minigame now showing draws, that of the move last tapped, where its type is known.
  let bubbleColour: Colour | undefined;
  let seen: Sighting = unseen();
  let readAt = -Infinity;

  // When we last had a faint, a switch prompt or its answer, after which for `STALE_MS` the HUD may name the one that
  // fainted.
  let faintAt = -Infinity;

  // The battle's names, CPs, move labels and types being read, if they are: off the frame of `at`, and onto the `seen`
  // it began from. Begun before `seen` was cleared, for a newcomer of theirs, a faint or a switch of ours or the next
  // battle, it is of the Pokémon before, and is never merged: its name or CP would stand for the one sent in.
  let sighting: (Reading<Sighting> & { at: number; from: Sighting }) | undefined;

  // The charged moves each opponent has been seen to use this battle, by species, off the banner after each throw.
  let theirMoves = new Map<string, Set<string>>();
  let bannerUntil = -Infinity;
  let bannerAt = -Infinity;
  let bannerReading = false;

  // The state of the frame before, which the shield prompt's showing is told from: the opponent's charged move.
  let last: State = 'other';

  // The shield prompt showing, if one is, and why its shield is taken or kept: told once it is answered, by a tap or
  // by the prompt going untapped.
  let offered: { why: string; taken: boolean } | undefined;

  // Our charged move last thrown, which a shield the opponent takes is taken against.
  let thrown: string | undefined;

  // Our charged move tapped and not yet seen to play, by its button's x, and why it was tapped: told as thrown, and its
  // stats moved, only once it plays. The opponent's move on the same turn can drop the tap, its button lighting again
  // with the energy kept, or hold the throw back until after theirs, its minigame coming with no tap of its own; and a
  // faint of ours before it plays loses it. Since when the fight has shown none of our buttons lit, unbroken, as a
  // minigame does throughout, and since when the button tapped has shown lit again, untapped.
  let pending: { move: string | undefined; x: number; why: string | undefined } | undefined;
  let unlit: number | undefined;
  let relit: number | undefined;

  const drop = (why: string) => {
    if (pending) {
      log(`${pending.move ?? 'our charged move'} not thrown`, 'own', why);
      pending = undefined;
    }
  };

  // The attack and defense stages of the Pokémon out on each side, as the charged moves thrown have moved them: ours
  // from each we throw, theirs off the banner after each of their throws.
  let stages: { own: Stages; their: Stages } = { own: NO_STAGES, their: NO_STAGES };

  // The Pokémon of ours sent in next has moves of its own, perhaps a name, its own CP and HP, and no stages moved, all
  // read again at once. A read finding no label keeps the moves it merges onto, so any left would stand for its own.
  const forgetOwn = () => {
    seen = { ...seen, own: null, ownCp: null, ownTypes: null, moves: new Map() };
    steady.forget('own');
    stages = { ...stages, own: NO_STAGES };
    readAt = -Infinity;
    counter = undefined;
  };

  // Each part of the stretch the battle has been off its field for, if it is: what showed, and from when. Told once the
  // field is back, if it ran `OFF_MS`, and dropped with the battle's end, the menus after it being no stretch of it.
  let off: { state: State | 'minigame'; what: string; from: number }[] = [];

  // What the screen was last recognised as, and the battle as last read, for `report.status`.
  let screen = 'other';
  let fight: Fight | undefined;
  const status = () =>
    report.status({
      battles,
      count,
      screen,
      lostIn: LOST_MS - (clock.now() - known),
      lostAfter: LOST_MS,
      fight,
    });

  while (battles < count) {
    const frame = phone.frame();

    if (!frame) {
      await clock.sleep(20);
      continue;
    }

    // Made for the frames' size, which every frame of a run shares, and made again for each battle.
    player ??= new Player(frame);

    if (frames++ % 10 === 0 && kept.at(-1) !== frame) {
      kept.push(frame);
      kept.splice(0, kept.length - KEPT_FRAMES);
    }

    if (keep && recent.at(-1)?.frame !== frame) {
      const at = clock.now();
      recent.push({ frame, at });

      while ((recent[0]?.at ?? at) < at - AROUND_MS) {
        recent.shift();
      }

      if (keeping && at <= keeping.until) {
        hand(frame, at, keeping.event);
      }
    }

    // A switch prompt follows a faint of ours, which the Poké Balls show by its first frame: one more of them grey than
    // when the last prompt showed. Anything else matching it is another dark screen, taken as `other` so nothing is
    // tapped: a charged move's burst over a night field matched with all three red, and answering it had Mewtwo fainted
    // while it fought on for 26s. A frame whose balls go unread is judged by the count last read, which shows a faint by
    // then; with none read this battle, nothing has shown one.
    const recognised = reads.recognise(frame);
    const ours = battling ? fewer(left.own, reads.pokemonLeft(frame).own) : null;
    const owed = prompt !== undefined || (ours !== null && ours < promptedAt);
    const state = recognised === 'switch' && !owed ? 'other' : recognised;
    const theirName = () => seen.opponent ?? 'the opponent';

    if (state === 'shield' && last !== 'shield') {
      log(`${theirName()} threw a charged move`, 'opponent');
      around('shield');
    }

    // The switch prompt is our faint as surely as a Poké Ball gone, and may show where the HUD's are not read.
    if (state === 'switch' && last !== 'switch') {
      around('faint-own');
    }

    last = state;
    unlit = state === 'battle' ? (unlit ?? clock.now()) : undefined;

    if (battling) {
      const now = clock.now();

      // A button lit is the fight, whatever `Player` waits on: the minigame draws none, and a throw tapped and still lit
      // is waiting on a fast move or was dropped. Live, a dropped Overheat's lit button was told as its minigame.
      const part =
        state === 'charged' ? undefined : state === 'battle' ? (player.minigame ? 'minigame' : undefined) : state;
      const [first] = off;

      if (!part) {
        if (first && now - first.from >= OFF_MS) {
          // Each part's own time only where there is more than the one, whose time is the stretch's.
          const parts = off.map(({ what, from }, i) =>
            off.length > 1 ? `${what} (${seconds((off[i + 1]?.from ?? now) - from)})` : what,
          );

          log(`off the battle for ${seconds(now - first.from)}`, undefined, parts.join(', then '));
        }

        off = [];
      } else if (part !== off.at(-1)?.state) {
        // What the screen shows besides the battle and its prompts says nothing of itself, so is named by what came
        // before it: with nothing before it and no shield of ours left, it is most likely the opponent's charged move,
        // which puts up no prompt once there is no shield to answer it with.
        const before = off.at(-1)?.state;
        const what = {
          minigame: `the minigame for our ${(pending ? pending.move : thrown) ?? 'charged move'}`,
          shield: 'the shield prompt',
          switch: 'the switch prompt',
          other:
            before === 'switch'
              ? 'the next of ours coming in'
              : before
                ? 'the charged move playing'
                : ourShields === 0
                  ? `likely ${theirName()}'s charged move, none of our shields left to prompt for`
                  : 'neither the battle nor a prompt',
        }[part];

        off.push({ state: part, what, from: now });
      }
    }

    if (state !== 'shield' && prompted >= THROWN && matchup) {
      energy.threw(matchup, theirMoves.get(matchup.opponent.species ?? ''));
    }

    prompted = state === 'shield' ? prompted + 1 : 0;

    // With none of our shields left, the opponent's throw puts up no prompt, only its countdown: counted once it has
    // shown for as many frames as a prompt must since the fight last showed, in a row or not, and once only until the
    // fight shows again, so that a wing across the countdown for a frame or two splits no throw in two. Asked only of
    // what was recognised as `other`, not of a switch prompt taken for `other` above, which carries one of its own.
    const countingDown = battling && recognised === 'other' && ourShields === 0 && reads.countdown(frame);

    unprompted = state === 'battle' || state === 'charged' ? 0 : unprompted + (countingDown ? 1 : 0);

    if (countingDown && unprompted === THROWN) {
      log(`${theirName()} threw a charged move`, 'opponent', 'none of our shields left to prompt for');

      if (matchup) {
        energy.threw(matchup, theirMoves.get(matchup.opponent.species ?? ''));
      }
    }

    if (offered && state !== 'shield') {
      if (!offered.taken) {
        log('kept shield', 'own', offered.why);
      }

      offered = undefined;
    }

    // The move just thrown at us, named once it lands, whether or not a shield was taken or there was one to take: the
    // banner is drawn over the battle and over the frames that read as neither, so it is looked for on both.
    if (state === 'shield' || countingDown) {
      bannerUntil = clock.now() + BANNER_MS;
    } else if (
      seen.opponent &&
      !bannerReading &&
      !player.minigame &&
      clock.now() < bannerUntil &&
      clock.now() - bannerAt >= BANNER_EVERY_MS
    ) {
      bannerAt = clock.now();
      bannerReading = true;

      // Kept in the battle's own record, which a read finishing after the next battle has begun leaves alone. The move
      // named settles what the throw cost the opponent, which until now was counted as its cheapest.
      const { opponent } = seen;
      const moves = theirMoves;
      const counting = energy;

      // One banner a throw, prompted or counted down, the read stopping at the first that names a move: so each is one
      // throw of theirs, its stages moved unless the thrower has since gone.
      void readBanner(frame, data, seen)
        .then((move) => {
          if (move) {
            const known = moves.get(opponent) ?? new Set();
            moves.set(opponent, known.add(move));
            counting.named(opponent, move);
            bannerUntil = -Infinity;
            log(`${opponent} has ${[...known].join(' and ')}`, 'opponent');

            if (moves === theirMoves && seen.opponent === opponent) {
              const [user, target] = afterThrow(data.combat[move], stages.their, stages.own);
              stages = { own: target, their: user };
            }
          }
        })
        .catch((error: unknown) => log(`banner not read: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => (bannerReading = false));
    }

    if (state !== 'other') {
      if (!battling) {
        log(`battle ${battles + 1} started`);
        offered = undefined;
        thrown = undefined;
        pending = undefined;
        player = new Player(frame);
        seen = unseen();
        readAt = -Infinity;
        faintAt = -Infinity;
        fainted = new Set();
        sent = 0;
        caught = undefined;
        theirShields = 2;
        ourShields = 2;
        answer = false;
        switchedIn = false;
        stayedFor = null;
        counter = undefined;
        landing = -Infinity;
        dropped = false;
        switching = undefined;
        banked = new Map();
        stripping = undefined;
        calmAt = -Infinity;
        swappedAt = -Infinity;
        left = { own: null, opponent: null };
        leftAtName = null;
        promptedAt = 3;
        departed = null;
        steady = new Steady();
        energy = new Energy(data, meta);
        hits = new Hits();
        sparing = undefined;
        theirMoves = new Map();
        bannerUntil = -Infinity;
        stages = { own: NO_STAGES, their: NO_STAGES };
      }

      // Never more than the last count, a shield once spent staying spent: a banner over the HUD reads as one of theirs
      // held, and leaves ours unread.
      if (state === 'battle' || state === 'charged') {
        const held = Math.min(theirShields, reads.opponentShields(frame));

        if (held < theirShields) {
          log(`${theirName()} shielded${thrown ? ` our ${thrown}` : ''}`, 'opponent');
        }

        theirShields = held;
        ourShields = Math.min(ourShields, reads.ownShields(frame) ?? ourShields);
      }

      // The switch prompt leaves the Poké Balls in view, ours already showing the faint it follows.
      if (state !== 'shield') {
        const balls = reads.pokemonLeft(frame);
        const counted = { own: fewer(left.own, balls.own), opponent: fewer(left.opponent, balls.opponent) };

        for (const side of ['own', 'opponent'] as const) {
          if ((counted[side] ?? Infinity) < (left[side] ?? -Infinity)) {
            around(`faint-${side}`);
          }
        }

        left = counted;
      }

      // The battle's read, once it is back, merged before anything this frame shows can clear `seen`: it was read off an
      // earlier frame, which showed what it read.
      if (sighting?.done && sighting.from === seen) {
        const { done: read, at } = sighting;
        sighting = undefined;

        if ('error' in read) {
          throw read.error;
        }

        // Judged by which of the two our HUD names, where the read names either and they differ, before our CP:
        // Palkia's `CP 4673` read as `CP 44673`, and so as no CP at all, for 16s after its switch was dropped, its name
        // read throughout. Judged ahead of a newcomer of theirs the same read names, so that a drop counts against the
        // one it was tapped against. A read begun too soon to judge by has the next begin as soon as one can.
        if (switching && at - switching.at >= SWITCHED_MS) {
          const { own, ownCp } = read;
          const was = party[switching.from];
          const byName = own !== null && was !== switching.to && (own === was || own === switching.to);
          const stayed = byName ? own === was : ownCp === null ? undefined : ownCp === switching.cp;

          if (stayed) {
            sent = switching.from;
            stages = { ...stages, own: switching.stages };
            banked.delete(switching.from);
            stripping = switching.stripping;

            if (switching.bank) {
              banked.set(switching.slot, switching.bank);
            }

            // Refused by the timer, the next switch to bank energy waits `REFUSED_MS`, as it does after a second tap
            // dropped against the same newcomer, something besides its flying in being in the way. The first dropped,
            // the switch is decided again as though never tapped, an opponent switched in answered afresh.
            const timer = switching.at - swappedAt < TIMER_MS;
            const retry = !timer && !dropped;

            dropped ||= !timer;
            calmAt = retry ? switching.calm : clock.now() + REFUSED_MS;
            answer ||= retry && switchedIn;
            log(
              `${switching.to} not sent in`,
              'own',
              timer
                ? 'the switch timer is running'
                : `taken as dropped, no switch of ours in the last ${TIMER_MS / 1_000}s`,
            );
          }

          if (stayed === false) {
            swappedAt = switching.at;
          }

          if (stayed !== undefined) {
            switching = undefined;
          }
        } else if (switching) {
          readAt = Math.min(readAt, switching.at + SWITCHED_MS - READ_MS);
        }

        const named = seen.opponent;
        const before = named ?? departed;

        // The HUD goes on naming one of ours after it faints, through the switch prompt and the frames between the
        // prompt's that read as the fight. Our side of a read begun then naming one fainted is of that HUD, and is
        // dropped and read again at once, as `forgetOwn` has it: merged, Palkia's name stood for Xerneas for as long as
        // it fought, `Xemeas` matching no species to replace it, and Xerneas's labels were matched among Palkia's moves,
        // none of them read. Left to `READ_MS`, the one sent in would go unnamed until it was up.
        const fallen =
          at - faintAt < STALE_MS && read.own !== null && [...fainted].some((slot) => party[slot] === read.own);

        seen = merge(seen, fallen ? { ...read, own: null, ownCp: null, ownTypes: null, moves: new Map() } : read);

        if (fallen) {
          readAt = -Infinity;
        }

        if (seen.opponent !== null && seen.opponent !== before) {
          // A CP kept from while another species was named is that one's, which a switch the bar did not catch leaves
          // standing: Gengar went on at Charizard's CP 2285 for fifteen reads. One read alongside the new name is its.
          if (named !== null) {
            seen = { ...seen, opponentCp: read.opponentCp, opponentTypes: read.opponentTypes };
          }

          if (before !== null) {
            const gone = leftAtName !== null && left.opponent !== null && left.opponent < leftAtName;

            log(gone ? `${before} fainted; sent in ${seen.opponent}` : `switched to ${seen.opponent}`, 'opponent');
            stages = { ...stages, their: NO_STAGES };
            answer = !gone;
            switchedIn = !gone;
            counter = undefined;
            landing = at + FLY_IN_MS;
            dropped = false;
          }

          leftAtName = left.opponent;
          departed = null;
        }
      }

      // A throw of the one before's still to play never will. A switch of ours under way is overtaken by the faint,
      // whatever the HUD shows next being the card sent in. Which of the two fainted cannot be told, the CP that would
      // say whether the switch took being cleared with the HUD, so neither is trusted to have banked: the one switched
      // from loses what the switch banked, which would have it sent back in to finish if it was the one that fainted,
      // and the one switched to gets back what it had. The switch timer is taken to run from it, as it does if it took.
      if (state === 'switch') {
        drop(`${seen.own ?? 'ours'} fainted first`);
        forgetOwn();
        faintAt = clock.now();

        if (switching) {
          swappedAt = switching.at;
          banked.delete(switching.from);

          if (switching.bank) {
            banked.set(switching.slot, switching.bank);
          }
        }

        switching = undefined;
      }

      // Read at the shield prompt as well as through the fight: the prompt hides the HUD, but not the bars.
      const bars = state !== 'switch' && !player.minigame ? reads.readHealth(frame) : undefined;
      const theirs = steady.health.opponent;

      if (bars) {
        steady.read(bars);
      }

      const health = steady.health;

      // A bar of theirs fuller than the last is a newcomer's, HP never coming back, sent in with the HUD up throughout:
      // what was read of the one before is not its, and is read again at once rather than standing for up to `READ_MS`,
      // the newcomer's hits counted to the energy of the one it replaced. Measured on the HP decided on, a misread low
      // being no HP for the next steady reading to rise from.
      if (theirs !== null && health.opponent !== null && health.opponent - theirs >= NEWCOMER) {
        departed = seen.opponent ?? departed;
        seen = { ...seen, opponent: null, opponentCp: null, opponentTypes: null };
        readAt = -Infinity;
        energy.pause();
        hits.pause();
      }

      // One read at a time, but for one dropped as of the Pokémon before, which is left to finish unmerged as the next
      // begins.
      if (
        sighting?.from !== seen &&
        (state === 'battle' || state === 'charged') &&
        !player.minigame &&
        clock.now() - readAt >= READ_MS
      ) {
        readAt = clock.now();
        sighting = { at: readAt, from: seen };

        // Only a species the HUD has named narrows the labels: the party's guess at a nicknamed one is what the labels
        // correct, through `activeOf`, and narrowed to it they could never show it wrong.
        const shown = readTypes(frame, badges);

        settle(
          sighting,
          readBattle(frame, data, undefined, seen.own).then((read) => ({
            ...read,
            ownTypes: shown.own,
            opponentTypes: shown.opponent,
          })),
        );
      }

      // A prompt gone unanswered, the game's timer having picked, still owes the faint the Poké Balls caught on it.
      if (
        state !== 'switch' &&
        prompt?.fainted !== undefined &&
        !prompt.answered &&
        !prompt.told &&
        fainted.has(prompt.fainted)
      ) {
        log(`${party[prompt.fainted] ?? '?'} fainted`, 'own', 'the switch prompt went unanswered');
      }

      prompt = state === 'switch' ? prompt : undefined;

      // One fewer of ours by the Poké Balls than the faints counted is the one out fainting, counted whether or not a
      // switch prompt is answered for it: the game's timer picks when one is not, or it goes unrecognised, and counted
      // only off our taps, every slot named after it was the one before. Told here unless a prompt is showing, whose
      // answer tells it, and kept for the prompt only where none has shown yet.
      if (left.own !== null && left.own < party.length - fainted.size) {
        // A move read that none of ours still standing can hold is a misread, which says nothing of who is out, and
        // leaves it to the one last sent in: with our name unread a label is matched among every move, and live `TIVE`,
        // the end of SUPER EFFECTIVE beneath Xerneas's Moonblast, read as Dive.
        const gone =
          activeOf(data, party, fainted, seen.moves.values(), sent) ?? activeOf(data, party, fainted, [], sent);

        if (gone !== undefined) {
          drop(`${seen.own ?? party[gone] ?? 'ours'} fainted first`);
          fainted.add(gone);
          faintAt = clock.now();
          caught = prompt ? caught : { slot: gone, told: state !== 'switch' };

          // The prompt forgot it already; with none, as for the last one sent in, nothing else does.
          if (state !== 'switch') {
            log(`${seen.own ?? party[gone] ?? '?'} fainted`, 'own', 'one fewer of our Poké Balls');
            forgetOwn();
          }
        }
      }

      // A nickname in the HUD leaves the species to the party: whichever slot is out.
      const slot = activeOf(data, party, fainted, seen.moves.values(), sent);
      const own = seen.own ?? (slot === undefined ? null : (party[slot] ?? null));
      const us = { species: own, types: seen.ownTypes };
      const them = { species: seen.opponent, types: seen.opponentTypes };
      const facing: Matchup = {
        own: { ...us, cp: seen.ownCp },
        opponent: { ...them, cp: seen.opponentCp },
        cap: cap ?? null,
      };

      matchup = facing;

      // Only the fight's own frames count hits: the shield prompt, the minigame and a switch pause it. A frame of the
      // fight with our bar not found does neither, the drop across it still the fight's. A frame that did find it counts
      // the HP decided on, a misread's drop and the rise back from it being no hits.
      const bar = bars && bars.own !== null ? health.own : null;
      const theirBar = bars && bars.opponent !== null ? health.opponent : null;

      if ((state !== 'battle' && state !== 'charged') || player.minigame) {
        energy.pause();
        hits.pause();
      } else {
        if (bar !== null) {
          energy.read(clock.now(), bar, facing);
        }

        if (theirBar !== null) {
          hits.read(clock.now(), theirBar, facing);
        }
      }

      // What the opponent can afford: the energy counted, and a fast move's more for a hit the count missed.
      const estimate = energy.estimate(facing);
      const affordable = estimate ? estimate.energy + estimate.gain : undefined;

      // Whether the opponent's hardest charged move would faint us: hardest of those it can afford, where its energy is
      // counted. A league whose cap went unread takes every shield, as anything else unknown does. Taken also by
      // PvPoke's rules, `wouldShield`'s: against any move that would take 1/1.4 of what is left, and against a hit that
      // leaves too little for the fast moves before the next.
      const verdict: Verdict =
        cap === undefined
          ? { faints: true, why: "the league's cap unread" }
          : wouldFaint(
              data,
              facing.own,
              facing.opponent,
              health.own,
              cap,
              meta,
              theirMoves.get(seen.opponent ?? ''),
              affordable,
              stages,
            );
      const shielding = wouldShield(data, verdict, health.own, ourShields, { step: energy.step, estimate });
      const shield = ourShields > 0 && shielding.shield;

      // With no shield left, a hit that would faint us makes this throw our last, so what it does to our own stats is
      // past mattering. The shield's verdict, unknowns and an unread cap counting as fainting here too: guessed wrong,
      // either way it costs no more than the stages of one move, where telling a guess from a read would take `Verdict`
      // saying which it is.
      const lastHit = ourShields === 0 && verdict.faints;
      const ownTypes = typesOf(data, us);
      const theirTypes = typesOf(data, them);
      const pick = bestButton(data, seen.moves, ownTypes, theirTypes, { bait: theirShields > 0, lastHit });
      const ready = state === 'charged' ? reads.readyButtons(frame) : [];
      const lit = ready.map(([x]) => x);

      // The throw pending plays once its minigame has run `PLAYING_MS`, `Player` swiping it as one where the opponent's
      // move, or a frame of no fight early in the minigame, ended the wait for it that its tap began. Its button lit
      // again for `RELIT_MS` once that wait has ended, and not tapped again, is the tap dropped, its energy kept.
      const playing = pending !== undefined && unlit !== undefined && clock.now() - unlit >= PLAYING_MS;
      relit = pending && !player.minigame && lit.includes(pending.x) ? (relit ?? clock.now()) : undefined;

      if (pending && playing) {
        const [user, target] = afterThrow(data.combat[pending.move ?? ''], stages.own, stages.their);
        stages = { own: user, their: target };
        thrown = pending.move;
        log(`threw ${pending.move ?? 'a charged move'}`, 'own', pending.why);
        pending = undefined;
      } else if (relit !== undefined && clock.now() - relit >= RELIT_MS) {
        drop('its button lit again with no minigame');
      }

      // A lit move that would finish the opponent goes now, whatever is held for: a turn waited is a hit taken. Live, a
      // Swampert held for Earthquake while Hydro Cannon could have finished a Giratina at 12%, and fainted first. Not
      // while the league's cap is unread, which would leave a CP misread over it to be built as if it were read.
      const finish =
        cap === undefined
          ? undefined
          : finisher(data, seen.moves, lit, facing.own, facing.opponent, health.opponent, theirShields, cap, stages);

      // No shield to be taken against a move the opponent's counted energy already affords and that would faint us, and
      // there may be no time left to hold energy for the move chosen: the lit button worth the most goes now, a shield
      // drawn or damage dealt being better than fainting with the energy stored. Only on the count's word, a faint feared
      // for something unknown being no sign that one is coming.
      const fear = `${verdict.afforded} would faint us, ${affordable} energy affords it`;
      const now =
        pick && !shield && verdict.faints && verdict.afforded !== undefined
          ? beforeFainting(data, seen.moves, lit, ownTypes, theirTypes, pick, fear, { lastHit })
          : undefined;

      // A finish before a throw for fear of fainting: the opponent gone, its hit that would faint us never comes, where
      // the one lit worth the most could leave it standing to land it.
      const throwing: Pick | undefined = finish ?? now ?? pick;

      // While a read of the `seen` now held is under way, no lit button is thrown if any is unnamed, for as long as the
      // read takes, about 220ms: thrown unnamed, a move could be the weaker of two, and its minigame's bubbles would be
      // of no colour known. That covers one of ours sent in after a faint with energy banked, lit at once and read at
      // once, but not one switched in from the bench, whose first read waits out `SWITCHED_MS`. Nor a named move that is
      // to go now, a finish or a throw for fear of fainting, the turn waited being what either is thrown to save.
      const naming = (finish ?? now) === undefined && sighting?.from === seen && lit.some((x) => !seen.moves.has(x));

      // Ahead of any throw about to go, finish or not: fast moves that finish an opponent with another to come before it
      // can throw leave the energy lit for the next, as a player held Brave Bird for a Mewtwo while Galarian Moltres's
      // fast moves finished a Giratina at 15%. Held by handing `Player` nothing to throw. Never once a throw is tapped and
      // not yet played: a banner read landing meanwhile can lower the count into a hold, which would stop a lost tap's
      // retap, the counts it rests on staying paused until the throw plays.
      const going = !player.minigame && lit.some((x) => throwing === undefined || x === throwing.x);
      const spared = going
        ? spare(
            data,
            {
              matchup: facing,
              hp: health,
              shields: theirShields,
              left: left.opponent,
              steps: { ours: hits.step, theirs: energy.step },
              estimate,
              seen: theirMoves.get(seen.opponent ?? ''),
            },
            meta,
          )
        : undefined;
      const best = spared === undefined ? throwing?.x : undefined;

      if (spared !== undefined && sparing !== seen.opponent) {
        const names = lit.flatMap((x) => seen.moves.get(x) ?? []);

        log(`holding ${names.length > 0 ? names.join(' and ') : 'our charged moves'} for the next`, 'own', spared);
        sparing = seen.opponent;
      }

      if (state === 'shield' && !offered?.taken) {
        offered = { why: shielding.why, taken: false };
      }

      fight = {
        own: { species: own, cp: seen.ownCp, hp: health.own, shields: ourShields, left: left.own },
        opponent: {
          species: seen.opponent,
          cp: seen.opponentCp,
          hp: health.opponent,
          shields: theirShields,
          left: left.opponent,
        },
        moves: [...seen.moves.values()],
        throwing: (best !== undefined && seen.moves.get(best)) || undefined,
        bait: throwing?.bait ?? theirShields > 0,
        shield,
        ...(estimate && { energy: { energy: estimate.energy, fast: estimate.fast } }),
      };
      battling = true;
      known = clock.now();
      screen = state;
      status();
      otherSince = undefined;

      // Whatever the read under way finds, it is of a screen the battle has since come back from.
      reading = undefined;

      // The switch prompt's cards are the slots not fainted bar the one out, in party order.
      if (state === 'switch' && !prompt) {
        promptedAt = left.own ?? promptedAt;
        const gone = caught?.slot ?? slot;
        const out = new Set([...fainted, ...(gone === undefined ? [] : [gone])]);

        // Which benched slot's banked energy finishes the opponent as it lands, as a lit move of the one out would.
        const league = cap;
        const finishing = new Map(
          league === undefined
            ? []
            : [...banked].flatMap(([waiting, bank]) => {
                const moves = new Map(bank.moves.map((move, i) => [i, move]));
                const pick = finisher(
                  data,
                  moves,
                  moves.keys(),
                  bank.own,
                  facing.opponent,
                  health.opponent,
                  theirShields,
                  league,
                  { own: NO_STAGES, their: stages.their },
                );
                const move = pick && moves.get(pick.x);

                return move === undefined ? [] : [[waiting, move] as const];
              }),
        );
        const chosen = nextOut(data, party, out, them, meta, finishing);
        const next = chosen?.slot;
        const measured =
          next === undefined ? undefined : SWITCH_CARDS[[...party.keys()].filter((i) => !out.has(i)).indexOf(next)];
        const card = measured && place(measured, BOTTOM, frame);

        prompt = { fainted: gone, next, why: chosen?.why, card, answered: false, told: caught?.told ?? false };
        caught = undefined;
      }

      // Where a benched slot's card is, the bench's cards being the slots not fainted bar the one out, in party order.
      const benched = (chosen: Switch | undefined, strip: boolean) => {
        const measured =
          chosen && BENCH[[...party.keys()].filter((i) => i !== slot && !fainted.has(i)).indexOf(chosen.slot)];

        return chosen && measured && { ...chosen, at: place(measured, BENCH_ANCHOR, frame), strip };
      };

      // The moves lit, which a switch banks: the energy for each stays with ours on the bench.
      const banking = lit.flatMap((x) => seen.moves.get(x) ?? []);

      // No shield of ours left, our HP read so low that a hit the opponent may land would faint us, the move to throw
      // lit and a shield of theirs to draw: the throw goes rather than any switch, there being little left of ours to
      // save. A faint feared rather than counted, unlike a throw for fear of fainting: an opponent switched in may
      // carry energy banked that the count, starting it at nothing, cannot see, and the counter and refuge switches
      // answer just such a one: so every move it is allowed, not only those the count affords, its banked energy
      // unseen. Live, a Zapdos threw two seconds after coming back in. But on a hit calculated, never on a guess for
      // something unread, bar their CP, which is taken as the cap as the shield takes it. And only where the move to
      // throw is lit already, so that staying in is a throw and not a swipe. Live, a Galarian Moltres at a tenth of its
      // HP stayed in against a Kyogre switched in, threw Fly into its last shield and fainted; Kyogre had none left for
      // the battle.
      const aimed = best !== undefined && lit.includes(best) ? seen.moves.get(best) : undefined;
      const feared =
        ourShields === 0 && theirShields > 0 && aimed !== undefined && cap !== undefined
          ? wouldFaint(
              data,
              facing.own,
              facing.opponent,
              health.own,
              cap,
              meta,
              theirMoves.get(seen.opponent ?? ''),
              undefined,
              stages,
            )
          : undefined;
      const doomed = feared !== undefined && feared.faints && feared.hardest !== undefined;
      const fighting = (state === 'battle' || state === 'charged') && !player.minigame;

      // The opponent's switch answered once, on the first frame the bench is drawn for and again where its tap is
      // dropped, by a counter of ours where one is benched; and for as long as the newcomer stays out, its switch timer
      // spent, ours threatened by it banks a move lit by switching to one safe from it, whenever one lights. Neither
      // where a lit move would finish the newcomer, the bench tap going ahead of the throw, nor where ours is doomed,
      // which is logged once per opponent.
      const stay = (chosen: Switch | undefined) => {
        if (chosen && doomed) {
          if (stayedFor !== theirName()) {
            stayedFor = theirName();
            log(
              `staying in against ${theirName()}`,
              'own',
              `${aimed} drawn into a shield before ${own ?? 'ours'} faints`,
            );
          }

          return undefined;
        }

        return benched(chosen, false);
      };

      if (answer && slot !== undefined && fighting && !switching) {
        answer = false;
        counter =
          finish || slot === stripping ? undefined : stay(counterOf(data, party, slot, us, fainted, them, meta));
      }

      if (
        !counter &&
        !switching &&
        !finish &&
        switchedIn &&
        fighting &&
        banking.length > 0 &&
        slot !== undefined &&
        slot !== stripping &&
        clock.now() >= calmAt
      ) {
        counter = stay(refugeOf(data, party, slot, us, fainted, them, meta));
      }

      // A lit move that would finish the opponent but for its shield is kept, and a benched slot with energy banked
      // sent in to draw the shield: ours throws it once the shields are gone, sent back in after the one sent faints
      // where it took the last. Not from a slot sent in to draw one itself, which throws rather than switch away again,
      // nor while the switch timer may still be running from a switch it refused.
      if (
        !counter &&
        !switching &&
        !doomed &&
        fighting &&
        slot !== undefined &&
        slot !== stripping &&
        theirShields > 0 &&
        cap !== undefined &&
        clock.now() >= calmAt
      ) {
        const kept = finisher(data, seen.moves, lit, facing.own, facing.opponent, health.opponent, 0, cap, stages);
        const moves = new Map([...banked].map(([waiting, bank]) => [waiting, bank.moves]));
        const chosen = kept && stripperOf(data, party, slot, fainted, moves, them, meta);
        const held = kept && seen.moves.get(kept.x);

        counter = benched(chosen && { ...chosen, why: `${chosen.why}; ${held ?? 'ours'} ${kept.why}` }, true);
      }

      // A switch decided on while the opponent's newcomer flies in is tapped once it has, nothing thrown meanwhile: the
      // energy lit is the switch's to bank. Given up where a lit move comes to finish the newcomer, or ours comes to be
      // doomed, meanwhile, which none of the switches is decided on; doomed, it is told as staying in.
      if (counter && clock.now() < landing && (finish || doomed)) {
        counter = doomed ? stay(counter) : undefined;
      }

      const flying = counter !== undefined && clock.now() < landing;
      const card = prompt?.card;
      const bubbles =
        (player.minigame || playing) && bubbleColour ? reads.bubbleSwipes(frame, bubbleColour) : undefined;
      const played = player.next(state, clock.now(), {
        ready: spared === undefined && !naming && !flying ? ready : [],
        best,
        shield,
        minigame: playing,
        ...(card && { card }),
        ...(counter && !flying && { bench: counter.at }),
        ...(bubbles && { bubbles }),
      });

      // With none of ours left to send in, by the Poké Balls or the faints counted, what reads as the switch prompt is
      // not one: after the last faint, a run took the result coming in for one and tapped it.
      const nobody = state === 'switch' && (left.own === 0 || (party.length > 0 && prompt?.next === undefined));
      const action = nobody ? ({ kind: 'wait' } as const) : played;

      if (action.kind === 'swipe') {
        await phone.swipe(action.from, action.to, action.ms);
      } else if (action.kind === 'tap') {
        // A charged move tapped again before its throw has played is that throw retried, told and counted once; another
        // tapped instead is a throw of its own.
        if (action.what === 'charged' && pending?.x === action.at[0]) {
          log(`tap ${pending.move ?? 'a charged move'} again`, 'own', 'its button still lit');
        } else if (action.what === 'charged') {
          const move = seen.moves.get(action.at[0]);

          drop(`${move ?? 'another'} tapped instead`);
          sparing = undefined;
          pending = { move, x: action.at[0], why: action.at[0] === best ? throwing?.why : undefined };
        } else if (action.what === 'shield') {
          // Told once, a retap a second later being the same answer to the same prompt.
          if (!offered?.taken) {
            log('took shield', 'own', shielding.why);
          }

          offered = { why: shielding.why, taken: true };
        } else if (action.what === 'bench' && counter && slot !== undefined) {
          // Taken to have gone in until the HUD says otherwise, the newcomer read afresh as after a faint.
          const to = party[counter.slot] ?? '?';
          const keeping = banking.length > 0 ? `, banking ${banking.join(' and ')}` : '';

          drop(`switched to ${to} first`);
          log(`switching to ${to} against ${seen.opponent ?? 'the opponent'}${keeping}`, 'own', counter.why);
          switching = {
            from: slot,
            slot: counter.slot,
            to,
            cp: seen.ownCp,
            at: clock.now(),
            stages: stages.own,
            bank: banked.get(counter.slot),
            stripping,
            calm: calmAt,
          };
          banked.delete(counter.slot);
          banked.set(slot, { moves: banking, own: facing.own });
          stripping = counter.strip ? counter.slot : undefined;
          calmAt = clock.now() + TIMER_MS;
          sent = counter.slot;
          forgetOwn();
          readAt = clock.now() - READ_MS + SWITCHED_MS;
        } else {
          log(`tap ${action.what}`, 'own');
        }

        await phone.tap(action.at);

        if (action.what === 'charged') {
          const type = data.combat[seen.moves.get(action.at[0]) ?? '']?.type;
          bubbleColour = type === undefined ? undefined : bubbleColours[type];
        }

        // Once a prompt: a retap, a second later, is the same answer to it.
        if (action.what === 'switch' && prompt && !prompt.answered) {
          prompt.answered = true;

          if (prompt.fainted !== undefined) {
            fainted.add(prompt.fainted);
            faintAt = clock.now();
          }

          if (prompt.next !== undefined) {
            sent = prompt.next;
            banked.delete(prompt.next);
            stripping = undefined;
            const gone = prompt.fainted === undefined || prompt.told ? '' : `${party[prompt.fainted] ?? '?'} fainted; `;

            log(`${gone}sending in ${party[prompt.next] ?? '?'}`, 'own', prompt.why);
          }
        }
      } else {
        await clock.sleep(20);
      }

      continue;
    }

    player.next(state, clock.now());
    energy.pause();
    hits.pause();

    if (otherSince === undefined) {
      otherSince = clock.now();
      screen = 'other';
    }

    if (clock.now() - otherSince >= MENU_AFTER_MS && !reading) {
      const result = battling;
      reading = {};

      settle(
        reading,
        (async () => {
          const screenshot = await phone.screenshot();

          const menu = await readMenu(screenshot, { ...mode, result });

          return { screenshot, menu, outcome: menu.screen === 'result' ? await readOutcome(screenshot) : undefined };
        })(),
      );
    }

    const done = reading?.done;

    if (done) {
      reading = undefined;

      if ('error' in done) {
        throw done.error;
      }

      const { screenshot, menu: read } = done;

      // GO Battle League never comes back to the map of itself once a battle has been played: a Poké Ball there is the
      // reward encounter's, which is left for the player rather than tapped.
      let menu: Menu = read.screen === 'map' && mode.mode === 'gbl' && battles > 0 ? { screen: 'unknown' } : read;
      screen = menu.screen;

      // Greyed out read after read, not once among others.
      if (menu.screen !== 'no-battle') {
        noBattle = 0;
      }

      if (menu.screen === 'party' && 'tap' in menu) {
        party = readParty(screenshot, icons);

        if (mode.mode === 'gbl' && menu.cap !== undefined) {
          cap = menu.cap;
        }

        log(`party: ${party.map((species) => species ?? '?').join(', ')}`);
      }

      // A party named is looked for along the carousel before its party is used, the search starting afresh each time the
      // party screen comes round.
      if (menu.screen === 'party' && 'tap' in menu && mode.mode === 'gbl' && mode.party !== undefined) {
        const step = searchParty(search, menu.title, mode.party);

        // A step along the carousel is progress, as a scroll of the Battle tab is not: the search ends of itself, at the
        // party or at both ends without it, where a scroll could go on for ever. Each step is a swipe, a settle and a
        // read, some 3s, so a search turning back past a few parties would otherwise run out `LOST_MS` and end lost.
        if (step === 'next' || step === 'back') {
          known = clock.now();
        }

        log(`party: ${menu.title ?? '?'} in front, looking for ${mode.party}`);
        menu =
          step === 'use'
            ? menu
            : step === 'unread'
              ? { screen: 'unknown' }
              : { screen: 'party', swipe: CAROUSEL[step] };
      } else if (menu.screen !== 'party') {
        search = carousel();
      }

      // A scroll is not progress: a tab already at its foot whose portraits go unmatched would be scrolled for ever, so
      // the scrolls count towards `LOST_MS` from the tap that opened the tab. Matchmaking is: it is waited out, however
      // long GO Battle League takes to find an opponent.
      if ('swipe' in menu) {
        if (clock.now() - known > LOST_MS) {
          throw new Lost(kept);
        }

        log(`${menu.screen}: scroll`);
        await phone.swipe(...menu.swipe, SCROLL_MS);
      } else if (menu.screen === 'matchmaking') {
        known = clock.now();
      } else if (menu.screen === 'no-battle' && ++noBattle >= NO_BATTLE_READS) {
        log('no-battle: a reward to collect');
        return { battles, ...outcomes };
      } else if ('tap' in menu) {
        log(`${menu.screen}: tap`);
        await phone.tap(menu.tap);
        known = clock.now();
      }

      if (menu.screen !== 'unknown') {
        if (menu.screen === 'result') {
          battles++;
          battling = false;
          off = [];

          if (done.outcome) {
            outcomes[done.outcome]++;
          }

          log(`battle ${battles} ${done.outcome ?? 'finished, its result unread'}`);
        }

        await clock.sleep(MENU_SETTLE_MS);
        continue;
      }
    }

    if (clock.now() - known > LOST_MS) {
      throw new Lost(kept);
    }

    status();
    await clock.sleep(50);
  }

  return { battles, ...outcomes };
}
