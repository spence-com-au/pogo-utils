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
import { opponentShields, ownShields, pokemonLeft, readyButtons, recognise, type State } from './recognise.mts';
import { activeOf, bestButton, bestLit, counterOf, nextOut, typesOf, type Pick } from './strategy.mts';
import { afterThrow, finisher, NO_STAGES, wouldFaint, type Stages, type Verdict } from './damage.mts';
import { iconColour, readTypes } from './typing.mts';
import { Energy, type Matchup } from './energy.mts';
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
 * How often the battle's names and move labels are read again, in milliseconds. A read holds the loop up for about
 * 220ms, a fast move's worth, and what it reads changes only when a Pokémon on either side does.
 */
const READ_MS = 3_000;

/**
 * How long after a shield prompt the banner naming the move is looked for, and how often, in milliseconds. The banner
 * follows the move's animation, a shield's included: 2.4s after a prompt for Groudon's Solar Beam, past 3.9s for a
 * Rhyperior's, the wall still up at the last of twelve reads. Read beside the battle rather than holding it up, as the
 * menu is, the battle having often come back by then.
 */
const BANNER_MS = 8_000;
const BANNER_EVERY_MS = 300;

/**
 * How much fuller than before the opponent's bar must read to be a newcomer's, as a fraction of it: ten times the pixel
 * the bar is read to, so a misread does not pass for one.
 */
const NEWCOMER = 0.1;

/** How many frames the shield prompt must show for to be counted as the opponent's throw, as `Player` settles on it. */
const THROWN = 3;

/**
 * How long after a bench card's tap our HUD is read again to see whether the switch took, in milliseconds. Recorded on
 * the Pixel 4 XL, the bench showed the switch by 135.5s and the HUD, hidden behind a banner meanwhile, came back naming
 * the newcomer at 136.3s; a read before then could still find the Pokémon tapped away from.
 */
const SWITCHED_MS = 2_000;

/**
 * How long a battle must be off its field — the minigame, a prompt, a charged move playing — before it is told how long
 * and what showed, in milliseconds, which the battle's line, written only as it changes, leaves unexplained otherwise:
 * live, 10–20s went by without a line. Longer than a banner over the HUD, a second or two, and shorter than a charged
 * move, whose minigame alone waits 2.5s for its first bubbles.
 */
const OFF_MS = 3_000;

/** Frames kept for a run that gets lost, about the last three seconds of it at one frame in ten. */
const KEPT_FRAMES = 10;

/**
 * How long either side of a faint or a shield prompt its frames are handed to `keep`, in milliseconds: long enough for
 * the prompt sliding in and how it was answered, or the HUD before and after the faint.
 */
const AROUND_MS = 1_000;

/** Pokémon left by the Poké Balls, a faint being for good: the lower of the count before and a read, either if null. */
const fewer = (was: number | null, read: number | null) =>
  read === null ? was : was === null ? read : Math.min(was, read);

/**
 * A menu read run beside the battle: `done` once its screenshot has been taken and read, or has failed. The result's
 * screenshot is read for the battle's outcome too.
 */
interface Reading {
  done?: { screenshot: Image; menu: Menu; outcome: Outcome | undefined } | { error: unknown };
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

  // The menu read under way, if any: settled once its screenshot is taken and read, or failed.
  let reading: Reading | undefined;
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

  // Whether the opponent's switch just read is still to be answered, and the counter of ours chosen for it, tapped on
  // the first frame `Player` lets a bench card be. Once tapped, the switch is checked: our HUD's CP unchanged after
  // `SWITCHED_MS` is the switch timer having refused the tap, which leaves the one tapped away from out.
  let answer = false;
  let counter: { slot: number; why: string; at: Point } | undefined;
  let switching: { from: number; to: string; cp: number | null; at: number; stages: Stages } | undefined;

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
  // one, a prompt sliding past matching for a frame or two on its own.
  let energy = new Energy(data, meta);
  let matchup: Matchup | undefined;
  let prompted = 0;

  // The colour of the bubbles the minigame now showing draws, that of the move last thrown, where its type is known.
  let bubbleColour: Colour | undefined;
  let seen: Sighting = unseen();
  let readAt = -Infinity;

  // The charged moves each opponent has been seen to use this battle, by species, off the banner after each prompt.
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

  // The attack and defense stages of the Pokémon out on each side, as the charged moves thrown have moved them: ours
  // from each we throw, theirs off the banner after each prompt. A move of theirs thrown while we hold no shields shows
  // no prompt and so goes uncounted, which costs nothing, there being no shield left to decide on.
  let stages: { own: Stages; their: Stages } = { own: NO_STAGES, their: NO_STAGES };

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

    if (battling) {
      const now = clock.now();
      const part = state === 'battle' || state === 'charged' ? (player.minigame ? 'minigame' : undefined) : state;
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
          minigame: `the minigame for our ${thrown ?? 'charged move'}`,
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

    if (offered && state !== 'shield') {
      if (!offered.taken) {
        log('kept shield', 'own', offered.why);
      }

      offered = undefined;
    }

    // The move just thrown at us, named once it lands, whether or not the shield was taken: the banner is drawn over the
    // battle and over the frames that read as neither, so it is looked for on both.
    if (state === 'shield') {
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

      // One banner a prompt, the read stopping at the first that names a move: so each is one throw of theirs, its
      // stages moved unless the thrower has since gone.
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
        player = new Player(frame);
        seen = unseen();
        readAt = -Infinity;
        fainted = new Set();
        sent = 0;
        caught = undefined;
        theirShields = 2;
        ourShields = 2;
        answer = false;
        counter = undefined;
        switching = undefined;
        left = { own: null, opponent: null };
        leftAtName = null;
        promptedAt = 3;
        departed = null;
        steady = new Steady();
        energy = new Energy(data, meta);
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

      // The Pokémon sent in next has moves of its own, perhaps a name, its own CP and HP, and no stages moved. A switch of
      // ours under way is overtaken by the faint, whatever the HUD shows next being the card sent in.
      if (state === 'switch') {
        seen = { ...seen, own: null, ownCp: null, ownTypes: null, moves: new Map() };
        steady.forget('own');
        stages = { ...stages, own: NO_STAGES };
        readAt = -Infinity;
        counter = undefined;
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
      }

      if ((state === 'battle' || state === 'charged') && !player.minigame && clock.now() - readAt >= READ_MS) {
        readAt = clock.now();
        const named = seen.opponent;
        const before = named ?? departed;

        // Only a species the HUD has named narrows the labels: the party's guess at a nicknamed one is what the labels
        // correct, through `activeOf`, and narrowed to it they could never show it wrong.
        const shown = readTypes(frame, badges);
        const read = {
          ...(await readBattle(frame, data, undefined, seen.own)),
          ownTypes: shown.own,
          opponentTypes: shown.opponent,
        };

        seen = merge(seen, read);

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
            counter = undefined;
          }

          leftAtName = left.opponent;
          departed = null;
        }

        if (switching && seen.ownCp !== null && clock.now() - switching.at >= SWITCHED_MS) {
          if (seen.ownCp === switching.cp) {
            sent = switching.from;
            stages = { ...stages, own: switching.stages };
            log(`${switching.to} not sent in: the switch timer is running`, 'own');
          }

          switching = undefined;
        }
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
        const gone = activeOf(data, party, fainted, seen.moves.values(), sent);

        if (gone !== undefined) {
          fainted.add(gone);
          caught = prompt ? caught : { slot: gone, told: state !== 'switch' };

          if (state !== 'switch') {
            log(`${seen.own ?? party[gone] ?? '?'} fainted`, 'own', 'one fewer of our Poké Balls');
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

      if ((state !== 'battle' && state !== 'charged') || player.minigame) {
        energy.pause();
      } else if (bar !== null) {
        energy.read(clock.now(), bar, facing);
      }

      // What the opponent can afford: the energy counted, and a fast move's more for a hit the count missed.
      const estimate = energy.estimate(facing);
      const affordable = estimate ? estimate.energy + estimate.gain : undefined;

      // Taken only where the opponent's hardest charged move would faint us: a hit we survive is eaten, the shield kept
      // for one we would not. Hardest of those it can afford, where its energy is counted. A league whose cap went
      // unread takes every shield, as anything else unknown does.
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
      const shield = ourShields > 0 && verdict.faints;

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
      const now =
        pick && !shield && verdict.faints && verdict.afforded !== undefined
          ? bestLit(data, seen.moves, lit, ownTypes, theirTypes, { lastHit })
          : undefined;
      const held = pick && seen.moves.get(pick.x);

      // A finish before a throw for fear of fainting: the opponent gone, its hit that would faint us never comes, where
      // the move worth the most could leave it standing to land it.
      const throwing: Pick | undefined =
        finish ??
        (pick && now !== undefined && now !== pick.x
          ? {
              x: now,
              bait: false,
              why: `${verdict.afforded} would faint us, ${affordable} energy affords it; not holding for ${held}`,
            }
          : pick);
      const best = throwing?.x;

      if (state === 'shield' && !offered?.taken) {
        offered = { why: verdict.why, taken: false };
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
        const chosen = nextOut(data, party, out, them, meta);
        const next = chosen?.slot;
        const measured =
          next === undefined ? undefined : SWITCH_CARDS[[...party.keys()].filter((i) => !out.has(i)).indexOf(next)];
        const card = measured && place(measured, BOTTOM, frame);

        prompt = { fainted: gone, next, why: chosen?.why, card, answered: false, told: caught?.told ?? false };
        caught = undefined;
      }

      // The opponent's switch answered once, on the first frame the bench is drawn for: by a counter of ours where one is
      // benched, the bench's cards being the slots not fainted bar the one out, in party order.
      if (answer && slot !== undefined && (state === 'battle' || state === 'charged') && !player.minigame) {
        answer = false;
        const chosen = counterOf(data, party, slot, us, fainted, them, meta);
        const measured =
          chosen && BENCH[[...party.keys()].filter((i) => i !== slot && !fainted.has(i)).indexOf(chosen.slot)];

        counter = chosen && measured && { ...chosen, at: place(measured, BENCH_ANCHOR, frame) };
      }

      const card = prompt?.card;
      const bubbles = player.minigame && bubbleColour ? reads.bubbleSwipes(frame, bubbleColour) : undefined;

      // A charged move tapped before the last one's throw has played is that throw retried, told and counted once.
      const pending = player.minigame;
      const played = player.next(state, clock.now(), {
        ready,
        best,
        shield,
        ...(card && { card }),
        ...(counter && { bench: counter.at }),
        ...(bubbles && { bubbles }),
      });

      // With none of ours left to send in, by the Poké Balls or the faints counted, what reads as the switch prompt is
      // not one: after the last faint, a run took the result coming in for one and tapped it.
      const nobody = state === 'switch' && (left.own === 0 || (party.length > 0 && prompt?.next === undefined));
      const action = nobody ? ({ kind: 'wait' } as const) : played;

      if (action.kind === 'swipe') {
        await phone.swipe(action.from, action.to, action.ms);
      } else if (action.kind === 'tap') {
        if (action.what === 'charged' && pending) {
          log(`tap ${thrown ?? 'a charged move'} again`, 'own', 'its button still lit');
        } else if (action.what === 'charged') {
          thrown = seen.moves.get(action.at[0]);
          const [user, target] = afterThrow(data.combat[thrown ?? ''], stages.own, stages.their);
          stages = { own: user, their: target };
          log(`threw ${thrown ?? 'a charged move'}`, 'own', action.at[0] === best ? throwing?.why : undefined);
        } else if (action.what === 'shield') {
          // Told once, a retap a second later being the same answer to the same prompt.
          if (!offered?.taken) {
            log('took shield', 'own', verdict.why);
          }

          offered = { why: verdict.why, taken: true };
        } else if (action.what === 'bench' && counter && slot !== undefined) {
          // Taken to have gone in until the HUD says otherwise, the newcomer read afresh as after a faint.
          const to = party[counter.slot] ?? '?';

          log(`switching to ${to} against ${seen.opponent ?? 'the opponent'}`, 'own', counter.why);
          switching = { from: slot, to, cp: seen.ownCp, at: clock.now(), stages: stages.own };
          sent = counter.slot;
          counter = undefined;
          seen = { ...seen, own: null, ownCp: null, ownTypes: null, moves: new Map() };
          steady.forget('own');
          stages = { ...stages, own: NO_STAGES };
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
          }

          if (prompt.next !== undefined) {
            sent = prompt.next;
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

    if (otherSince === undefined) {
      otherSince = clock.now();
      screen = 'other';
    }

    if (clock.now() - otherSince >= MENU_AFTER_MS && !reading) {
      const started: Reading = {};
      const result = battling;
      reading = started;

      void (async () => {
        const screenshot = await phone.screenshot();

        const menu = await readMenu(screenshot, { ...mode, result });

        return { screenshot, menu, outcome: menu.screen === 'result' ? await readOutcome(screenshot) : undefined };
      })().then(
        (done) => (started.done = done),
        (error: unknown) => (started.done = { error }),
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
