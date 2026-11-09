/**
 * Team Leader or GO Battle League battles one after another: `Player` through each battle, read off the stream frame by
 * frame, and `readMenu` between them, read off full screenshots, from the result round to the next USE THIS PARTY.
 *
 * Driven through the `Phone` in `phone.mts` rather than `adb`, so a test can stand a scripted phone in for a real one.
 */

import { said } from '../../errors.ts';
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
import { cardAt, readCps, readParty, type Card, type Icon } from './party.mts';
import { BOTTOM, place, type Size } from './layout.mts';
import { readCard } from './selection.mts';
import { BENCH, BENCH_ANCHOR, SWITCH_CARDS } from './play.mts';
import { bubbleSwipes, typeColour, type Colour } from './minigame.mts';
import { readHealth } from './health.mts';
import { merge, readBanner, readBattle, settle, type Reading } from './read.mts';
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
  clearerOf,
  counterOf,
  nextOut,
  refugeOf,
  resisterOf,
  stripperOf,
  typesOf,
  type Pick,
  type Switch,
} from './strategy.mts';
import { afterThrow, chargePriority, finisher, NO_STAGES, wouldFaint, wouldShield, type Verdict } from './damage.mts';
import { iconColour, readTypes } from './typing.mts';
import { holding, spare, untilTheirsLands, wornDown, type Matchup } from './energy.mts';
import { type Meta } from './meta.mts';
import { checkOverlay, named, swipeAround, swipesAround } from './overlay.mts';
import { type Phone } from './phone.mts';
import { type Fight, type Reporter } from './reporter.mts';
import { Battle } from './battle.mts';

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
 * How long the HUD must show none of our charged-move buttons lit, unbroken, for a throw tapped to be playing, in
 * milliseconds: its minigame draws none, from `Get Ready!` on. Over the 11 GO Battle League battles the user recorded
 * on a Pixel 8 Pro, every minigame ran 5.1s at the least and mostly 8–11s, and nothing else after a tap ran longer than
 * 2.4s, the banner after the opponent's move the longest. The opponent picking its next after fainting to our fast move
 * runs longer, 6s live, but its Poké Ball going grey tells it apart. The minigame's bubbles are no sign of their own:
 * Fly's are found on its own lit button in `charged-pixel8-fly`, and on the sky behind
 * `playing-banner-pixel8-charizard`.
 */
const PLAYING_MS = 3_500;

/**
 * How long after the fight's last frame one with none of our charged moves' names drawn is still the fight, in
 * milliseconds. A fast move's flash can wash out the foot of the screen, names and all, as the fight goes on: Lugia's did
 * for up to 0.46s at a time in a kept run. A charged move under way straight from the fight, the opponent's `Attack
 * incoming!` or a faint, is played as the fight for as long, its swipes and the energy counted meanwhile for nothing; one
 * after a prompt or the HUD hidden, as the opponent's move after a shield is, is told at once, and so is one of our own
 * minigame, which our tap begins as its button goes.
 */
const FLASH_MS = 600;

/**
 * How long the button of a throw tapped must stay lit and untapped, once the opponent's move or any other frame that
 * is not the fight's has come between, for the tap to have been dropped, in milliseconds. A throw the opponent's came
 * ahead of, and that plays after theirs, shows its button lit for a tenth of a second as the HUD comes back.
 */
const RELIT_MS = 1_000;

/**
 * How long after one of the opponent's Poké Balls goes grey no charged move of ours is thrown, in milliseconds: its
 * faint hides our buttons while it picks its next, and a button tapped as it fades out is a throw that never plays.
 * Live, Metagross's went grey on a frame with Outrage still lit, the next 51ms later showing none, and Outrage tapped
 * on it was told as thrown 3.5s into the pick. Through the rest of the pick nothing is lit to throw.
 */
const FADING_MS = 500;

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

/**
 * How long after its last frame the switch prompt is still taken to be up, in milliseconds: still owed its answer, and
 * our side still forgotten on its frames. Sliding in or out, it reads as the fight for the odd frame. Replayed off a
 * live run's video, Palkia's prompt showed for a frame, read as the fight for the next 113ms, showed for half a second,
 * read as the fight for 90ms and showed for a last frame, its frames 152ms apart at the most, at a frame each 25–40ms.
 * Ended by the first frame of the fight, its later frames were owed nothing: none was tapped, and none forgot our side.
 * About three times that gap leaves room for a run slower to take frames than the video. Held past the prompt's end it
 * costs nothing, the fight played meanwhile and no faint coming so soon after one, the newcomer taking 1.5s to fly in.
 */
const FLICKER_MS = 500;

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

/** Whether a frame shows the HUD: the fight, or a charged move under way. */
const hudUp = (state: State) => state === 'battle' || state === 'charged' || state === 'playing';

/** How many battles finished, and of those how many the result said were won and lost; the rest went unread. */
export interface Tally {
  battles: number;
  won: number;
  lost: number;
}

const copyOf = (image: Image): Image => ({ ...image, data: image.data.slice() });

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

  if (meta) {
    log(`opponents' moves as PvPoke ranks ${meta.cup} at ${meta.cap ?? 'any'} CP: ${meta.movesets.size} species`);
  }

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
  let battles = 0;
  const outcomes: Record<Outcome, number> = { won: 0, lost: 0 };
  let battling = false;
  let known = clock.now();
  let otherSince: number | undefined;
  let noBattle = 0;
  let faded = false;
  let search = carousel();

  // The menu read under way, if any: settled once its screenshot is taken and read, or failed. The screenshot of a result
  // is read for the battle's outcome too.
  let reading: Reading<{ screenshot: Image; menu: Menu; ended: boolean; outcome: Outcome | undefined }> | undefined;

  // PGSharp's overlay as the phone's views show it, waited for before the run taps anything and checked against the
  // first frame. It is looked for again as each battle ends, its star being as readily opened or dragged between battles
  // as before them. What was found, clear of what is read, is what the battle's swipes go around.
  const views = await phone.views();
  let first = phone.frame();

  while (!first) {
    await clock.sleep(20);
    first = phone.frame();
  }

  let panels = checkOverlay(views, first);
  log(`PGSharp's overlay: ${named(panels)}, clear of what is read`);
  let frames = 0;

  // A frame off the stream is good only until the next comes, its memory then decoded into again, so a frame kept past
  // its turn of the loop is a copy, told apart from the turn's own frame by the one it was copied from.
  const kept: Image[] = [];
  let keptFrom: Image | undefined;

  // For `keep`: the last `AROUND_MS` of frames, each with when it was first seen, so an event can hand over what led up
  // to it, and the event still handing over what follows it, until when. A frame goes once, to the first event it is
  // near, however many it is near.
  const recent: { frame: Image; from: Image; at: number }[] = [];
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

  let party: Card[] = [];

  // Each card as the party screen showed it when it was last tried on the selection screen, by silhouette and CP, of
  // which `party` holds what was read: a GO Battle League set comes back to the party screen before every battle, and
  // reading three cards takes 33s or more. A card is the one tried before where its silhouette names the same species
  // and its CP is the same or went unread this time, OCR having missed one CP of 24. One tried and not read is not
  // tried again, a search or a panel that failed once being likely to fail again at some 11s a battle; nor are those
  // after one that stopped the reading, the selection screen not opening or not closing being what they would meet too.
  // One passed over for its CP going unread was never tried, and is tried once its CP is read, so each held has its CP.
  let lastTried: ({ species: string | null; cp: number } | undefined)[] = [];

  const sameCard = (was: (typeof lastTried)[number], card: Card) =>
    was !== undefined && was.species === card.species && (card.cp === null || was.cp === card.cp);

  // `cards` with the moves of each card in `slots` merged in, read off the selection screen in turn as `readCard` reads
  // them, and whether the party screen is showing again. Stops at one that left anything but the party screen showing,
  // nothing more being tapped then.
  const readCards = async (cards: readonly Card[], slots: readonly number[], screen: Size) => {
    const read = [...cards];

    for (const slot of slots) {
      const card = read[slot];

      if (card?.cp === null || card === undefined) {
        log(`card ${slot + 1} unread: its CP unread`);
        continue;
      }

      const sleep = (ms: number) => clock.sleep(ms);
      const { species, cp } = card;
      const { panel, why, back } = await readCard(phone, sleep, cardAt(slot, screen), { species, cp }, data);
      known = clock.now();

      if (panel) {
        const { species: name, ...moves } = panel;
        read[slot] = { ...card, species: name, moves };
        log(`${name ?? '?'} CP ${cp}: ${moves.fast ?? '?'} / ${moves.charged.join(', ')}`);
      } else {
        log(`card ${slot + 1} unread: ${why ?? '?'}`);
      }

      if (!back) {
        return { cards: read, back };
      }
    }

    return { cards: read, back: true };
  };

  // The battle under way, or the last one played: made afresh on each battle's first frame, and before any for the
  // frames' size, which every frame of a run shares.
  let battle = new Battle(first, data, meta, party, log);

  // The league's CP cap, which a CP read over it is a misread of: Training's by its league, GO Battle League's as its
  // party screen states it, and until then as PvPoke has the league named. `undefined` until known, and then every
  // shield is taken.
  let cap: number | null | undefined = mode.mode === 'training' ? CAPS[mode.league] : meta?.cap;

  // The state of the frame before, which the shield prompt's showing is told from: the opponent's charged move.
  let last: State = 'other';

  // When `recognise` last read the fight, which a frame with none of our buttons' names drawn within `FLASH_MS` of is
  // taken to go on, unless anything else came between.
  let foughtAt = -Infinity;

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

    if (frames++ % 10 === 0 && keptFrom !== frame) {
      keptFrom = frame;
      kept.push(copyOf(frame));
      kept.splice(0, kept.length - KEPT_FRAMES);
    }

    if (keep && recent.at(-1)?.from !== frame) {
      const at = clock.now();
      const copy = copyOf(frame);
      recent.push({ frame: copy, from: frame, at });

      while ((recent[0]?.at ?? at) < at - AROUND_MS) {
        recent.shift();
      }

      if (keeping && at <= keeping.until) {
        hand(copy, at, keeping.event);
      }
    }

    // A switch prompt follows a faint of ours, which the Poké Balls show by its first frame: one more of them grey than
    // when the last prompt showed. Anything else matching it is another dark screen, taken as `other` so nothing is
    // tapped: a charged move's burst over a night field matched with all three red, and answering it had Mewtwo fainted
    // while it fought on for 26s. A frame whose balls go unread is judged by the count last read, which shows a faint by
    // then; with none read this battle, nothing has shown one.
    const recognised = reads.recognise(frame);
    const remaining = battling ? fewer(battle.left.own, reads.pokemonLeft(frame).own) : null;
    const owed = battle.prompt !== undefined || (remaining !== null && remaining < battle.promptedAt);

    if (recognised === 'battle' || recognised === 'charged') {
      foughtAt = clock.now();
    } else if (recognised !== 'playing') {
      foughtAt = -Infinity;
    }

    const flash = recognised === 'playing' && clock.now() - foughtAt < FLASH_MS && !battle.player.minigame;
    const state = recognised === 'switch' && !owed ? 'other' : flash ? 'battle' : recognised;

    // A battle begins afresh on its first frame, before anything that frame shows is counted to it.
    if (state !== 'other' && !battling) {
      log(`battle ${battles + 1} started`);
      battle = new Battle(frame, data, meta, party, log);
    }

    const theirName = () => battle.seen.opponent ?? 'the opponent';

    if (state === 'shield' && last !== 'shield') {
      log(`${theirName()} threw a charged move`, 'opponent');
      around('shield');
    }

    // The switch prompt is our faint as surely as a Poké Ball gone, and may show where the HUD's are not read.
    if (state === 'switch' && last !== 'switch') {
      around('faint-own');
    }

    last = state;
    battle.unlit = state === 'battle' || state === 'playing' ? (battle.unlit ?? clock.now()) : undefined;

    if (battling) {
      const now = clock.now();

      // A button lit is the fight, whatever `Player` waits on: the minigame draws none, and a throw tapped and still lit
      // is waiting on a fast move or was dropped. Live, a dropped Overheat's lit button was told as its minigame. A
      // charged move under way is told as the HUD hidden is, a move often hiding it for part of its playing.
      const part = (
        {
          battle: battle.player.minigame ? 'minigame' : undefined,
          charged: undefined,
          playing: battle.player.minigame ? 'minigame' : 'other',
          shield: 'shield',
          switch: 'switch',
          other: 'other',
        } as const
      )[state];
      const [start] = battle.off;

      if (!part) {
        if (start && now - start.from >= OFF_MS) {
          // Each part's own time only where there is more than the one, whose time is the stretch's.
          const parts = battle.off.map(({ what, from }, i) =>
            battle.off.length > 1 ? `${what} (${seconds((battle.off[i + 1]?.from ?? now) - from)})` : what,
          );

          log(`off the battle for ${seconds(now - start.from)}`, undefined, parts.join(', then '));
        }

        battle.off = [];
      } else if (part !== battle.off.at(-1)?.state) {
        // What the screen shows besides the battle and its prompts says nothing of itself, so is named by what came
        // before it: with nothing before it, the HUD up is a throw on its way or a faint, and the HUD hidden with no
        // shield of ours left most likely the opponent's charged move, which puts up no prompt once there is no shield
        // to answer it with.
        const before = battle.off.at(-1)?.state;
        const what = {
          minigame: `the minigame for our ${(battle.pending ? battle.pending.move : battle.thrown) ?? 'charged move'}`,
          shield: 'the shield prompt',
          switch: 'the switch prompt',
          other:
            before === 'switch'
              ? 'the next of ours coming in'
              : before
                ? 'the charged move playing'
                : state === 'playing'
                  ? 'our charged moves hidden'
                  : battle.ourShields === 0
                    ? `likely ${theirName()}'s charged move, none of our shields left to prompt for`
                    : 'neither the battle nor a prompt',
        }[part];

        battle.off.push({ state: part, what, from: now });
      }
    }

    if (state !== 'shield' && battle.prompted >= THROWN && battle.matchup) {
      battle.energy.threw(battle.matchup, battle.theirMoves.get(battle.matchup.opponent.species ?? ''));
    }

    battle.prompted = state === 'shield' ? battle.prompted + 1 : 0;

    // With none of our shields left, the opponent's throw puts up no prompt, only its countdown: counted once it has
    // shown for as many frames as a prompt must since the fight last showed, in a row or not, and once only until the
    // fight shows again, so that a wing across the countdown for a frame or two splits no throw in two. Asked only of
    // what was recognised as `other`, not of a switch prompt taken for `other` above, which carries one of its own.
    const countingDown = battling && recognised === 'other' && battle.ourShields === 0 && reads.countdown(frame);

    battle.unprompted = hudUp(state) ? 0 : battle.unprompted + (countingDown ? 1 : 0);

    // The countdown hides the HUD, so it and the animation after it read as `other`: it is the battle going on, however
    // many throws in a row, and each of its frames holds off `LOST_MS` as the fight's do.
    if (countingDown) {
      known = clock.now();
    }

    if (countingDown && battle.unprompted === THROWN) {
      log(`${theirName()} threw a charged move`, 'opponent', 'none of our shields left to prompt for');

      if (battle.matchup) {
        battle.energy.threw(battle.matchup, battle.theirMoves.get(battle.matchup.opponent.species ?? ''));
      }
    }

    if (battle.offered && state !== 'shield') {
      if (!battle.offered.taken) {
        log('kept shield', 'own', battle.offered.why);
      }

      battle.offered = undefined;
    }

    // The move just thrown at us, named once it lands, whether or not a shield was taken or there was one to take: the
    // banner is drawn over the battle and over the frames that read as neither, so it is looked for on both.
    if (state === 'shield' || countingDown) {
      battle.bannerUntil = clock.now() + BANNER_MS;
    } else if (
      battle.seen.opponent &&
      !battle.bannerReading &&
      !battle.player.minigame &&
      clock.now() < battle.bannerUntil &&
      clock.now() - battle.bannerAt >= BANNER_EVERY_MS
    ) {
      battle.bannerAt = clock.now();
      battle.bannerReading = true;

      // Kept in the battle's own record, which a read finishing after the next battle has begun leaves alone. The move
      // named settles what the throw cost the opponent, which until now was counted as its cheapest.
      const fought = battle;
      const { opponent } = battle.seen;

      // One banner a throw, prompted or counted down, the read stopping at the first that names a move: so each is one
      // throw of theirs, its stages moved unless the thrower has since gone.
      void readBanner(frame, data, fought.seen)
        .then((move) => {
          if (move) {
            const used = fought.theirMoves.get(opponent) ?? new Set();
            fought.theirMoves.set(opponent, used.add(move));
            const settled = fought.energy.named(opponent, move);
            fought.bannerUntil = -Infinity;
            log(`${opponent} has ${[...used].join(' and ')}`, 'opponent');

            if (fought.seen.opponent === opponent) {
              fought.anchored ||= settled;
              const [user, target] = afterThrow(data.combat[move], fought.stages.their, fought.stages.own);
              fought.stages = { own: target, their: user };
            }
          }
        })
        .catch((error: unknown) => log(`banner not read: ${said(error)}`))
        .finally(() => (fought.bannerReading = false));
    }

    if (state !== 'other') {
      // Never more than the last count, a shield once spent staying spent: a banner over the HUD reads as one of theirs
      // held, and leaves ours unread.
      if (hudUp(state)) {
        const held = Math.min(battle.theirShields, reads.opponentShields(frame));

        if (held < battle.theirShields) {
          log(`${theirName()} shielded${battle.thrown ? ` our ${battle.thrown}` : ''}`, 'opponent');
        }

        battle.theirShields = held;
        battle.ourShields = Math.min(battle.ourShields, reads.ownShields(frame) ?? battle.ourShields);
      }

      // The switch prompt leaves the Poké Balls in view, ours already showing the faint it follows.
      if (state !== 'shield') {
        const balls = reads.pokemonLeft(frame);
        const counted = {
          own: fewer(battle.left.own, balls.own),
          opponent: fewer(battle.left.opponent, balls.opponent),
        };

        for (const side of ['own', 'opponent'] as const) {
          if ((counted[side] ?? Infinity) < (battle.left[side] ?? -Infinity)) {
            around(`faint-${side}`);
          }
        }

        // The opponent fainting begins its pick, and a throw of ours still to play, tapped before our fast move fainted
        // it, never plays: its button lights again once the newcomer is in. Live, Dragonite tapped Outrage at 867.0s,
        // Mewtwo's Poké Ball went grey at 867.5s and Outrage lit again as Kyogre came in at 873.3s, the pick taken for
        // its minigame and told as thrown at 870.8s.
        if ((counted.opponent ?? Infinity) < (battle.left.opponent ?? -Infinity)) {
          battle.theirFaintAt = clock.now();

          if (battle.pending) {
            battle.drop(`${theirName()} fainted first`);
            battle.player.forget();
          }
        }

        battle.left = counted;
      }

      // The battle's read, once it is back, merged before anything this frame shows can clear `seen`: it was read off an
      // earlier frame, which showed what it read.
      if (battle.sighting?.done && battle.sighting.from === battle.seen) {
        const { done: read, at } = battle.sighting;
        battle.sighting = undefined;

        if ('error' in read) {
          throw read.error;
        }

        // Judged by which of the two our HUD names, where the read names either and they differ, before our CP:
        // Palkia's `CP 4673` read as `CP 44673`, and so as no CP at all, for 16s after its switch was dropped, its name
        // read throughout. Judged ahead of a newcomer of theirs the same read names, so that a drop counts against the
        // one it was tapped against. A read begun too soon to judge by has the next begin as soon as one can.
        if (battle.switching && at - battle.switching.at >= SWITCHED_MS) {
          const { own, ownCp } = read;
          const was = party[battle.switching.from]?.species;
          const byName = own !== null && was !== battle.switching.to && (own === was || own === battle.switching.to);
          const stayed = byName ? own === was : ownCp === null ? undefined : ownCp === battle.switching.cp;

          if (stayed) {
            battle.sent = battle.switching.from;
            battle.stages = { ...battle.stages, own: battle.switching.stages };
            battle.banked.delete(battle.switching.from);
            battle.stripping = battle.switching.stripping;

            if (battle.switching.bank) {
              battle.banked.set(battle.switching.slot, battle.switching.bank);
            }

            // Refused by the timer, the next switch to bank energy waits `REFUSED_MS`, as it does after a second tap
            // dropped against the same newcomer, something besides its flying in being in the way. The first dropped,
            // the switch is decided again as though never tapped, an opponent switched in answered afresh.
            const timer = battle.switching.at - battle.swappedAt < TIMER_MS;
            const retry = !timer && !battle.dropped;

            battle.dropped ||= !timer;
            battle.calmAt = retry ? battle.switching.calm : clock.now() + REFUSED_MS;
            battle.answer ||= retry && battle.switchedIn;
            log(
              `${battle.switching.to} not sent in`,
              'own',
              timer
                ? 'the switch timer is running'
                : `taken as dropped, no switch of ours in the last ${TIMER_MS / 1_000}s`,
            );
          }

          if (stayed === false) {
            battle.swappedAt = battle.switching.at;
            battle.undefer('ours switched out');
          }

          if (stayed !== undefined) {
            battle.switching = undefined;
          }
        } else if (battle.switching) {
          battle.readAt = Math.min(battle.readAt, battle.switching.at + SWITCHED_MS - READ_MS);
        }

        const prior = battle.seen.opponent;
        const before = prior ?? battle.departed;

        // The HUD goes on naming one of ours after it faints, through the switch prompt and the frames between the
        // prompt's that read as the fight. Our side of a read begun then naming one fainted is of that HUD, and is
        // dropped and read again at once, as `forgetOwn` has it: merged, Palkia's name stood for Xerneas for as long as
        // it fought, `Xemeas` matching no species to replace it, and Xerneas's labels were matched among Palkia's moves,
        // none of them read. Left to `READ_MS`, the one sent in would go unnamed until it was up.
        const fallen =
          at - battle.faintAt < STALE_MS &&
          read.own !== null &&
          [...battle.fainted].some((slot) => party[slot]?.species === read.own);

        battle.seen = merge(
          battle.seen,
          fallen ? { ...read, own: null, ownCp: null, ownTypes: null, moves: new Map() } : read,
        );

        if (fallen) {
          battle.readAt = -Infinity;
        }

        if (battle.seen.opponent !== null && battle.seen.opponent !== before) {
          // A CP kept from while another species was named is that one's, which a switch the bar did not catch leaves
          // standing: Gengar went on at Charizard's CP 2285 for fifteen reads. One read alongside the new name is its.
          if (prior !== null) {
            battle.seen = { ...battle.seen, opponentCp: read.opponentCp, opponentTypes: read.opponentTypes };
          }

          if (before !== null) {
            const gone =
              battle.leftAtName !== null && battle.left.opponent !== null && battle.left.opponent < battle.leftAtName;

            log(
              gone ? `${before} fainted; sent in ${battle.seen.opponent}` : `switched to ${battle.seen.opponent}`,
              'opponent',
            );
            battle.stages = { ...battle.stages, their: NO_STAGES };
            battle.answer = !gone;
            battle.switchedIn = !gone;
            battle.anchored = false;
            battle.counter = undefined;
            battle.landing = at + FLY_IN_MS;
            battle.dropped = false;
          }

          battle.leftAtName = battle.left.opponent;
          battle.departed = null;
        }
      }

      // A throw of the one before's still to play never will. A switch of ours under way is overtaken by the faint,
      // whatever the HUD shows next being the card sent in. Which of the two fainted cannot be told, the CP that would
      // say whether the switch took being cleared with the HUD, so neither is trusted to have banked: the one switched
      // from loses what the switch banked, which would have it sent back in to finish if it was the one that fainted,
      // and the one switched to gets back what it had. The switch timer is taken to run from it, as it does if it took.
      if (state === 'switch') {
        battle.drop(`${battle.seen.own ?? 'ours'} fainted first`);
        battle.undefer('ours fainted');
        battle.forgetOwn();
        battle.faintAt = clock.now();
        battle.switchAt = battle.faintAt;

        if (battle.switching) {
          battle.swappedAt = battle.switching.at;
          battle.banked.delete(battle.switching.from);

          if (battle.switching.bank) {
            battle.banked.set(battle.switching.slot, battle.switching.bank);
          }
        }

        battle.switching = undefined;
      }

      // Read at the shield prompt as well as through the fight: the prompt hides the HUD, but not the bars.
      const bars = state !== 'switch' && !battle.player.minigame ? reads.readHealth(frame) : undefined;
      const theirs = battle.steady.health.opponent;

      if (bars) {
        battle.steady.read(frame, bars);
      }

      const health = battle.steady.health;

      // A bar of theirs fuller than the last is a newcomer's, HP never coming back, sent in with the HUD up throughout:
      // what was read of the one before is not its, and is read again at once rather than standing for up to `READ_MS`,
      // the newcomer's hits counted to the energy of the one it replaced. Measured on the HP decided on, a misread low
      // being no HP for the next steady reading to rise from.
      if (theirs !== null && health.opponent !== null && health.opponent - theirs >= NEWCOMER) {
        battle.departed = battle.seen.opponent ?? battle.departed;
        battle.seen = { ...battle.seen, opponent: null, opponentCp: null, opponentTypes: null };
        battle.readAt = -Infinity;
        battle.energy.pause();
        battle.hits.pause();
      }

      // One read at a time, but for one dropped as of the Pokémon before, which is left to finish unmerged as the next
      // begins.
      if (
        battle.sighting?.from !== battle.seen &&
        hudUp(state) &&
        !battle.player.minigame &&
        clock.now() - battle.readAt >= READ_MS
      ) {
        battle.readAt = clock.now();
        battle.sighting = { at: battle.readAt, from: battle.seen };

        // Only a species the HUD has named narrows the labels: the party's guess at a nicknamed one is what the labels
        // correct, through `activeOf`, and narrowed to it they could never show it wrong.
        const shown = readTypes(frame, badges);

        settle(
          battle.sighting,
          readBattle(frame, data, undefined, battle.seen.own).then((read) => ({
            ...read,
            ownTypes: shown.own,
            opponentTypes: shown.opponent,
          })),
        );
      }

      // The prompt is gone once no frame has shown it for `FLICKER_MS`, not at the first frame of the fight, which may
      // be the prompt sliding in or out. Gone unanswered, the game's timer having picked, it still owes the faint the
      // Poké Balls caught on it.
      const over = clock.now() - battle.switchAt >= FLICKER_MS;

      if (
        over &&
        battle.prompt?.fainted !== undefined &&
        !battle.prompt.answered &&
        !battle.prompt.told &&
        battle.fainted.has(battle.prompt.fainted)
      ) {
        log(`${party[battle.prompt.fainted]?.species ?? '?'} fainted`, 'own', 'the switch prompt went unanswered');
      }

      battle.prompt = over ? undefined : battle.prompt;

      // One fewer of ours by the Poké Balls than the faints counted is the one out fainting, counted whether or not a
      // switch prompt is answered for it: the game's timer picks when one is not, or it goes unrecognised, and counted
      // only off our taps, every slot named after it was the one before. Told here unless this frame is the switch
      // prompt, whose answer tells it, and kept for the prompt only where none has shown yet.
      if (battle.left.own !== null && battle.left.own < party.length - battle.fainted.size) {
        // A move read that none of ours still standing can hold is a misread, which says nothing of who is out, and
        // leaves it to the one last sent in: with our name unread a label is matched among every move, and live `TIVE`,
        // the end of SUPER EFFECTIVE beneath Xerneas's Moonblast, read as Dive.
        const gone =
          activeOf(data, party, battle.fainted, battle.seen.moves.values(), battle.sent) ??
          activeOf(data, party, battle.fainted, [], battle.sent);

        if (gone !== undefined) {
          battle.drop(`${battle.seen.own ?? party[gone]?.species ?? 'ours'} fainted first`);
          battle.player.forget();
          battle.fainted.add(gone);
          battle.faintAt = clock.now();
          battle.caught = battle.prompt ? battle.caught : { slot: gone, told: state !== 'switch' };

          // The prompt forgot it already; with none, as for the last one sent in, nothing else does.
          if (state !== 'switch') {
            log(`${battle.seen.own ?? party[gone]?.species ?? '?'} fainted`, 'own', 'one fewer of our Poké Balls');
            battle.undefer('ours fainted');
            battle.forgetOwn();
          }
        }
      }

      // A nickname in the HUD leaves the species to the party: whichever slot is out. Its card's moves are ours only
      // where the HUD names no other species than the card.
      const slot = activeOf(data, party, battle.fainted, battle.seen.moves.values(), battle.sent);
      const ourCard = slot === undefined ? undefined : party[slot];
      const own = battle.seen.own ?? ourCard?.species ?? null;
      const ours =
        ourCard && (battle.seen.own === null || battle.seen.own === ourCard.species) ? ourCard.moves : undefined;
      const us = { species: own, types: battle.seen.ownTypes };
      const them = { species: battle.seen.opponent, types: battle.seen.opponentTypes };
      const facing: Matchup = {
        own: { ...us, cp: battle.seen.ownCp },
        opponent: { ...them, cp: battle.seen.opponentCp },
        cap: cap ?? null,
      };

      battle.matchup = facing;

      // Only the fight's own frames count our fast moves: the shield prompt, a charged move under way and a switch pause
      // them. In a kept run, our energy was counted from 52 to 91 through Garchomp's Sand Tomb and the `Get Ready!` of
      // ours after it. The opponent's hits on our bar are counted through a charged move under way too, bar our
      // minigame: ours sent in shows no button until it has flown in, and in a kept run Tyranitar's fast move landed on
      // Dragonite 0.2s before its button was drawn. A frame with our bar not found does neither, the drop across it
      // still the fight's. A frame that did find it counts the HP decided on, a misread's drop and the rise back from it
      // being no hits.
      const bar = bars && bars.own !== null ? health.own : null;
      const theirBar = bars && bars.opponent !== null ? health.opponent : null;
      const fighting = (state === 'battle' || state === 'charged') && !battle.player.minigame;

      if (!hudUp(state) || battle.player.minigame) {
        battle.energy.pause();
      } else if (bar !== null) {
        battle.energy.read(clock.now(), bar, facing);
      }

      if (!fighting) {
        battle.hits.pause();
        battle.ourEnergy.pause();
      } else {
        // Our fast moves gain energy only for the one whose card's moves are ours, the one out.
        if (slot !== undefined && ours) {
          battle.ourEnergy.read(slot, clock.now());
        } else {
          battle.ourEnergy.pause();
        }

        if (theirBar !== null) {
          battle.hits.read(clock.now(), theirBar, facing);
        }
      }

      // What the opponent can afford: the energy counted, and a fast move's more for a hit the count missed.
      const estimate = battle.energy.estimate(facing);
      const affordable = estimate ? estimate.energy + estimate.gain : undefined;

      // Whether the opponent's hardest charged move would faint us: hardest of those it can afford, where its energy is
      // counted. A league whose cap went unread takes every shield, as anything else unknown does. Taken also by
      // PvPoke's rules, `wouldShield`'s: against any move that would take 1/1.4 of what is left, and against a hit that
      // leaves too little for the fast moves before the next.
      const verdict: Verdict =
        cap === undefined
          ? { faints: true, why: "the league's cap unread" }
          : wouldFaint(data, facing.own, facing.opponent, health.own, cap, {
              meta,
              seen: battle.theirMoves.get(battle.seen.opponent ?? ''),
              affordable,
              stages: battle.stages,
            });

      // Kept, whatever the verdict, where the hit measured off our bar says their next fast move faints us anyway.
      const shielding = wouldShield(data, verdict, health.own, battle.ourShields, {
        step: battle.energy.step,
        hit: battle.energy.measured(facing, battle.stages),
        estimate,
      });
      const shield = battle.ourShields > 0 && shielding.shield;

      // One more of the opponent's fast moves fainting us, which no shield stops.
      const fast = battle.energy.fastFaints(facing, health.own, battle.stages);

      // Charge-move priority: where both sides throw on the same turn, the higher attack throws first, and a hit that
      // faints the other leaves its move never thrown. So with none of our shields left, where ours is not sure to win
      // it, the throw for fear of a fainting move the count affords, below, goes a fast move sooner: once one more of
      // the opponent's fast moves would afford the move, so that ours lands before a tie can arise. Asked only where
      // that fear is not already in force, and only on the count's word, as it is. Where ours wins, nothing changes,
      // and the fast move it saved is told.
      const priority = cap === undefined ? undefined : chargePriority(data, facing.own, facing.opponent, cap);
      const sooner =
        priority &&
        estimate &&
        affordable !== undefined &&
        battle.ourShields === 0 &&
        !(verdict.faints && verdict.afforded !== undefined)
          ? wouldFaint(data, facing.own, facing.opponent, health.own, cap ?? null, {
              meta,
              seen: battle.theirMoves.get(battle.seen.opponent ?? ''),
              affordable: affordable + estimate.gain,
              stages: battle.stages,
            })
          : undefined;
      const prioritising =
        priority && estimate && sooner?.faints && sooner.afforded !== undefined
          ? {
              wins: priority.wins,
              why: `${priority.why}, ${sooner.afforded} affordable after one more ${estimate.fast}`,
              key: `${battle.seen.opponent ?? ''} ${sooner.afforded} ${estimate.energy}`,
            }
          : undefined;
      const losing = prioritising && !prioritising.wins ? prioritising.why : undefined;

      // With no shield left, a hit that would faint us makes this throw our last, so what it does to our own stats is
      // past mattering, and so does a fast move that would, whatever the shields. The shield's verdict, unknowns and an
      // unread cap counting as fainting here too: guessed wrong, either way it costs no more than the stages of one
      // move, where telling a guess from a read would take `Verdict` saying which it is. So too where a lost CMP has
      // the fainting move a fast move away.
      const lastHit = (battle.ourShields === 0 && verdict.faints) || fast !== undefined || losing !== undefined;
      const ownTypes = typesOf(data, us);
      const theirTypes = typesOf(data, them);
      const ready = state === 'charged' ? reads.readyButtons(frame) : [];
      const lit = ready.map(([x]) => x);
      const mirror = own !== null && own === battle.seen.opponent ? own : undefined;
      const pick = bestButton(data, battle.seen.moves, ownTypes, theirTypes, {
        bait: battle.theirShields > 0,
        lastHit,
        mirror,
        lit,
      });

      // A lit button proves at least its move's cost, which a count run short is raised to.
      if (slot !== undefined && ours) {
        for (const move of lit.flatMap((x) => battle.seen.moves.get(x) ?? [])) {
          battle.ourEnergy.lit(slot, move);
        }
      }

      // The throw pending plays once its minigame has run `PLAYING_MS`, `Player` swiping it as one where the opponent's
      // move, or a frame of no fight early in the minigame, ended the wait for it that its tap began. Its button lit
      // again for `RELIT_MS` once that wait has ended, and not tapped again, is the tap dropped, its energy kept.
      const playing =
        battle.pending !== undefined && battle.unlit !== undefined && clock.now() - battle.unlit >= PLAYING_MS;
      battle.relit =
        battle.pending && !battle.player.minigame && lit.includes(battle.pending.x)
          ? (battle.relit ?? clock.now())
          : undefined;

      if (battle.pending && playing) {
        const [user, target] = afterThrow(
          data.combat[battle.pending.move ?? ''],
          battle.stages.own,
          battle.stages.their,
        );
        battle.stages = { own: user, their: target };
        battle.thrown = battle.pending.move;

        if (slot !== undefined && battle.pending.move !== undefined) {
          battle.ourEnergy.threw(slot, battle.pending.move);
        }

        battle.undefer(`${battle.pending.move ?? 'a charged move'} thrown`);
        log(`threw ${battle.pending.move ?? 'a charged move'}`, 'own', battle.pending.why);
        battle.pending = undefined;
      } else if (battle.relit !== undefined && clock.now() - battle.relit >= RELIT_MS) {
        battle.drop('its button lit again with no minigame');
      }

      // A lit move that would finish the opponent goes now, whatever is held for: a turn waited is a hit taken. Live, a
      // Swampert held for Earthquake while Hydro Cannon could have finished a Giratina at 12%, and fainted first. Not
      // while the league's cap is unread, which would leave a CP misread over it to be built as if it were read.
      const finish =
        cap === undefined
          ? undefined
          : finisher(
              data,
              battle.seen.moves,
              lit,
              facing.own,
              facing.opponent,
              health.opponent,
              battle.theirShields,
              cap,
              battle.stages,
            );

      // No shield to be taken against a move the opponent's counted energy already affords and that would faint us, or
      // its next fast move fainting us whatever the shields, and there may be no time left to hold energy for the move
      // chosen: the lit button worth the most goes now, a shield drawn or damage dealt being better than fainting with
      // the energy stored. Only on the count's word or a fast hit measured or modelled, a faint feared for something
      // unknown being no sign that one is coming.
      const afforded =
        !shield && verdict.faints && verdict.afforded !== undefined
          ? `${verdict.afforded} would faint us, ${affordable} energy affords it`
          : losing;

      // Seen sooner than either, where our energy is counted: the move chosen filling only after their fast moves have
      // worn us down.
      const counted = slot !== undefined && ours ? battle.ourEnergy.estimate(slot) : null;
      const picked = pick && battle.seen.moves.get(pick.x);
      const worn =
        fast === undefined && afforded === undefined && picked
          ? wornDown(data, picked, counted, health.own, battle.energy.step, estimate, theirName())
          : undefined;
      const fears = [fast, afforded, worn].filter((fear) => fear !== undefined);
      const now =
        pick && fears.length > 0
          ? beforeFainting(data, battle.seen.moves, lit, ownTypes, theirTypes, pick, fears.join('; '), { lastHit })
          : undefined;

      // Won, the throw a lost CMP would have made now, told once: the move it would have thrown as our last hit, as a
      // lost one counts it. Not where a finish or another fear throws anyway.
      const withheld =
        pick && prioritising?.wins && battle.prioritised !== prioritising.key && !finish && fears.length === 0
          ? beforeFainting(data, battle.seen.moves, lit, ownTypes, theirTypes, pick, prioritising.why, {
              lastHit: true,
            })
          : undefined;

      if (withheld && prioritising) {
        log(`not throwing ${battle.seen.moves.get(withheld.x) ?? 'a charged move'} yet`, 'own', prioritising.why);
        battle.prioritised = prioritising.key;
      }

      // A finish before a throw for fear of fainting: the opponent gone, its hit that would faint us never comes, where
      // the one lit worth the most could leave it standing to land it.
      const throwing: Pick | undefined = finish ?? now ?? pick;

      // While a read of the `seen` now held is under way, no lit button is thrown if any is unnamed, for as long as the
      // read takes, about 220ms: thrown unnamed, a move could be the weaker of two, and its minigame's bubbles would be
      // of no colour known. That covers one of ours sent in after a faint with energy banked, lit at once and read at
      // once, but not one switched in from the bench, whose first read waits out `SWITCHED_MS`. Nor a named move that is
      // to go now, a finish or a throw for fear of fainting, the turn waited being what either is thrown to save.
      const naming =
        (finish ?? now) === undefined &&
        battle.sighting?.from === battle.seen &&
        lit.some((x) => !battle.seen.moves.has(x));

      // Ahead of any throw about to go, finish or not: fast moves that finish an opponent with another to come before it
      // can throw leave the energy lit for the next, as a player held Brave Bird for a Mewtwo while Galarian Moltres's
      // fast moves finished a Giratina at 15%. Held by handing `Player` nothing to throw. Never once a throw is tapped and
      // not yet played: a banner read landing meanwhile can lower the count into a hold, which would stop a lost tap's
      // retap, the counts it rests on staying paused until the throw plays. Nor where the next fast move would faint us:
      // `spare` weighs their fast moves by the step measured, where `fastFaints` may have found one hit enough by the
      // model at the stages as they stand, and a Pokémon fainted carries no energy on.
      const going = !battle.player.minigame && lit.some((x) => throwing === undefined || x === throwing.x);
      const spared =
        going && fast === undefined
          ? spare(
              data,
              {
                matchup: facing,
                hp: health,
                shields: battle.theirShields,
                left: battle.left.opponent,
                steps: { ours: battle.hits.step, theirs: battle.energy.step },
                estimate,
                seen: battle.theirMoves.get(battle.seen.opponent ?? ''),
                fast: ours?.fast,
              },
              meta,
            )
          : undefined;

      if (spared !== undefined && battle.sparing !== battle.seen.opponent) {
        const names = lit.flatMap((x) => battle.seen.moves.get(x) ?? []);

        log(`holding ${names.length > 0 ? names.join(' and ') : 'our charged moves'} for the next`, 'own', spared);
        battle.sparing = battle.seen.opponent;
      }

      // A hold lasts only as long as our energy grows through it: the fight's own frames, one after another.
      if (battle.deferring && fighting) {
        battle.deferring.waited += battle.deferring.frame === frames - 1 ? clock.now() - battle.deferring.at : 0;
        battle.deferring.frame = frames;
        battle.deferring.at = clock.now();
      }

      // With none of our shields left, the move chosen, where it lowers our defense, waits for the charged move the
      // opponent's counted energy affords to land, where we would survive it, so that it lands on our defense as it
      // stands. Only once it is lit, and never once tapped, as for the hold above; never for a finish or a throw for fear
      // of fainting, which go at once. Told as it begins and as it ends. Not weighed afresh while a switch of ours is under
      // way, which leaves who is out unknown: a hold then stands as it was last weighed, its time limit running, in force
      // but for a finish or a fear, until the switch is seen to take, ending it, or to be refused.
      const deferrable =
        spared === undefined &&
        throwing === pick &&
        pick &&
        lit.includes(pick.x) &&
        !battle.pending &&
        !battle.switching
          ? battle.seen.moves.get(pick.x)
          : undefined;
      const ongoing = deferrable !== undefined && battle.deferring?.move === deferrable ? battle.deferring : undefined;
      const opponent = theirName();
      const weigh = (waited: number) =>
        deferrable === undefined
          ? undefined
          : untilTheirsLands(data, deferrable, us, opponent, battle.ourShields, verdict, shielding, affordable, waited);

      const standing =
        battle.switching !== undefined && battle.deferring?.held === true && throwing === pick
          ? battle.deferring
          : undefined;
      const rule = standing ? standing.weigh(standing.waited) : weigh(battle.deferring?.waited ?? 0);
      const hold = holding(rule, fears);
      const current = ongoing ?? standing;

      if (ongoing) {
        ongoing.weigh = weigh;
      }

      if (deferrable !== undefined && hold?.held && !ongoing?.held) {
        // A hold of another move ends as this one begins, the move chosen having changed under it.
        if (battle.deferring?.held) {
          log(`no longer holding ${battle.deferring.move}`, 'own', `${deferrable} picked`);
        }

        log(`holding ${deferrable}`, 'own', hold.why);
        battle.deferring = {
          move: deferrable,
          waited: battle.deferring?.waited ?? 0,
          frame: frames,
          at: clock.now(),
          held: true,
          weigh,
        };
      } else if (current?.held && hold && !hold.held) {
        log(`no longer holding ${current.move}`, 'own', hold.why);
        current.held = false;
      } else if (battle.deferring?.held && !ongoing && lit.length > 0 && !battle.switching) {
        // Another throw taking over, on a frame with a button lit rather than one hidden by a throw or a prompt; not the
        // held move still chosen, its button misread unlit for a frame. Not while a switch of ours is under way, which
        // tells the hold's end once it is seen to go through.
        const instead =
          finish?.why ??
          now?.why ??
          spared ??
          (picked !== battle.deferring.move ? `${picked ?? 'another'} picked` : undefined);

        if (instead !== undefined) {
          log(`no longer holding ${battle.deferring.move}`, 'own', instead);
          battle.deferring.held = false;
        }
      }

      // The button to throw, none while a hold is on: `Player` is handed nothing lit to throw then, and nothing is told
      // as thrown.
      const best = spared === undefined && !hold?.held ? throwing?.x : undefined;

      // A bait held in a mirror for the move it stands in for, told as its button lights alone.
      const bait = throwing === pick ? pick?.held : undefined;
      const baiting =
        bait !== undefined && lit.includes(bait)
          ? `holding ${battle.seen.moves.get(bait)} for ${picked} to light`
          : undefined;

      if (baiting !== undefined && baiting !== battle.mirrored) {
        log(baiting, 'own', pick?.why);
        battle.mirrored = baiting;
      }

      if (state === 'shield' && !battle.offered?.taken) {
        battle.offered = { why: shielding.why, taken: false };
      }

      fight = {
        own: { species: own, cp: battle.seen.ownCp, hp: health.own, shields: battle.ourShields, left: battle.left.own },
        opponent: {
          species: battle.seen.opponent,
          cp: battle.seen.opponentCp,
          hp: health.opponent,
          shields: battle.theirShields,
          left: battle.left.opponent,
        },
        moves: [...battle.seen.moves.values()],
        throwing: (best !== undefined && battle.seen.moves.get(best)) || undefined,
        bait: throwing?.bait ?? battle.theirShields > 0,
        shield,
        ...(estimate && { energy: { energy: estimate.energy, fast: estimate.fast } }),
        ...(counted && { ourEnergy: { energy: counted.energy, fast: counted.fast } }),
      };
      battling = true;
      known = clock.now();
      screen = state;
      status();
      otherSince = undefined;

      // Whatever the read under way finds, it is of a screen the battle has since come back from.
      reading = undefined;

      // The switch prompt's cards are the slots not fainted bar the one out, in party order.
      if (state === 'switch' && !battle.prompt) {
        battle.promptedAt = battle.left.own ?? battle.promptedAt;
        const gone = battle.caught?.slot ?? slot;
        const out = new Set([...battle.fainted, ...(gone === undefined ? [] : [gone])]);

        // Which benched slot's banked energy finishes the opponent as it lands, as a lit move of the one out would.
        const league = cap;
        const finishing = new Map(
          league === undefined
            ? []
            : [...battle.banked].flatMap(([waiting, bank]) => {
                const moves = new Map(bank.moves.map((move, i) => [i, move]));
                const lands = finisher(
                  data,
                  moves,
                  moves.keys(),
                  bank.own,
                  facing.opponent,
                  health.opponent,
                  battle.theirShields,
                  league,
                  { own: NO_STAGES, their: battle.stages.their },
                );
                const move = lands && moves.get(lands.x);

                return move === undefined ? [] : [[waiting, move] as const];
              }),
        );
        const chosen = nextOut(data, party, out, them, meta, finishing);
        const next = chosen?.slot;
        const measured =
          next === undefined ? undefined : SWITCH_CARDS[[...party.keys()].filter((i) => !out.has(i)).indexOf(next)];
        const card = measured && place(measured, BOTTOM, frame);

        battle.prompt = {
          fainted: gone,
          next,
          why: chosen?.why,
          card,
          answered: false,
          told: battle.caught?.told ?? false,
        };
        battle.caught = undefined;
      }

      // Where a benched slot's card is, the bench's cards being the slots not fainted bar the one out, in party order.
      const benched = (chosen: Switch | undefined, strip: boolean) => {
        const measured =
          chosen && BENCH[[...party.keys()].filter((i) => i !== slot && !battle.fainted.has(i)).indexOf(chosen.slot)];

        return chosen && measured && { ...chosen, at: place(measured, BENCH_ANCHOR, frame), strip };
      };

      // The moves lit, which a switch banks: the energy for each stays with ours on the bench.
      const banking = lit.flatMap((x) => battle.seen.moves.get(x) ?? []);

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
      const aimed = best !== undefined && lit.includes(best) ? battle.seen.moves.get(best) : undefined;
      const feared =
        battle.ourShields === 0 && battle.theirShields > 0 && aimed !== undefined && cap !== undefined
          ? wouldFaint(data, facing.own, facing.opponent, health.own, cap, {
              meta,
              seen: battle.theirMoves.get(battle.seen.opponent ?? ''),
              stages: battle.stages,
            })
          : undefined;
      const doomed = feared !== undefined && feared.faints && feared.hardest !== undefined;

      // The opponent's switch answered once, on the first frame the bench is drawn for and again where its tap is
      // dropped, by a counter of ours where one is benched; and for as long as the newcomer stays out, its switch timer
      // spent, ours threatened by it banks a move lit by switching to one safe from it, whenever one lights. Neither
      // where a lit move would finish the newcomer, the bench tap going ahead of the throw, nor where ours is doomed,
      // which is logged once per opponent.
      const stay = (chosen: Switch | undefined) => {
        if (chosen && doomed) {
          if (battle.stayedFor !== theirName()) {
            battle.stayedFor = theirName();
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

      if (battle.answer && slot !== undefined && fighting && !battle.switching) {
        battle.answer = false;
        battle.counter =
          finish || slot === battle.stripping
            ? undefined
            : stay(counterOf(data, party, slot, us, battle.fainted, them, meta));
      }

      if (
        !battle.counter &&
        !battle.switching &&
        !finish &&
        battle.switchedIn &&
        fighting &&
        banking.length > 0 &&
        slot !== undefined &&
        slot !== battle.stripping &&
        clock.now() >= battle.calmAt
      ) {
        battle.counter = stay(refugeOf(data, party, slot, us, battle.fainted, them, meta));
      }

      // A lit move that would finish the opponent but for its shield is kept, and a benched slot with energy banked
      // sent in to draw the shield: ours throws it once the shields are gone, sent back in after the one sent faints
      // where it took the last. Not from a slot sent in to draw one itself, which throws rather than switch away again,
      // nor while the switch timer may still be running from a switch it refused.
      if (
        !battle.counter &&
        !battle.switching &&
        !doomed &&
        fighting &&
        slot !== undefined &&
        slot !== battle.stripping &&
        battle.theirShields > 0 &&
        cap !== undefined &&
        clock.now() >= battle.calmAt
      ) {
        const blocked = finisher(
          data,
          battle.seen.moves,
          lit,
          facing.own,
          facing.opponent,
          health.opponent,
          0,
          cap,
          battle.stages,
        );
        const moves = new Map([...battle.banked].map(([waiting, bank]) => [waiting, bank.moves]));
        const chosen = blocked && stripperOf(data, party, slot, battle.fainted, moves, them, meta);
        const held = blocked && battle.seen.moves.get(blocked.x);

        battle.counter = benched(chosen && { ...chosen, why: `${chosen.why}; ${held ?? 'ours'} ${blocked.why}` }, true);
      }

      // While the opponent's count is anchored, ours switches to a benched Pokémon resisting the charged move of the
      // opponent's that hits it super effectively, one fast move before the count affords it: that fast move lands on
      // the newcomer, and so does the throw. Fired with shields or without, the switch costing the switch timer rather
      // than a shield, and whether or not ours is doomed, the hit it would faint to going to the newcomer instead. Not
      // where a lit move would finish the opponent, which goes instead, nor where one is to be thrown now, which goes
      // first, the fight standing still through a throw so that the opponent gains nothing meanwhile; a lit move held
      // for another is banked by the switch, as the refuge banks one. Not inside `TIMER_MS` of a switch of ours, as no
      // switch is, a faint starting no timer.
      const throwingNow = spared === undefined && !hold?.held && lit.some((x) => best === undefined || x === best);

      if (
        !battle.counter &&
        !battle.switching &&
        !finish &&
        !battle.pending &&
        !throwingNow &&
        fighting &&
        battle.anchored &&
        slot !== undefined &&
        estimate &&
        affordable !== undefined &&
        clock.now() >= battle.calmAt
      ) {
        const chosen = resisterOf(
          data,
          party,
          slot,
          us,
          battle.fainted,
          them,
          battle.theirMoves.get(battle.seen.opponent ?? ''),
          meta,
        );
        const due = chosen && affordable >= chosen.cost;

        battle.counter = due
          ? benched(
              { ...chosen, why: `${chosen.move} affordable after one more ${estimate.fast}; ${chosen.why}` },
              false,
            )
          : undefined;
      }

      // Ours with its attack or defense dropped, by its own throw once it has played or by the opponent's that the
      // banner named, switches to a benched Pokémon safe from every move the opponent may hold, which clears the drop
      // and banks whatever is lit: ours comes back whole, its energy kept. Players in three of four championship finals
      // did so. Never into a Pokémon the opponent could farm energy off, so with none safe it stays in. It gives way to
      // whatever the other switches give way to: a lit move that would finish the opponent, a throw tapped and not yet
      // played, ours doomed, and our last hit, after which a drop no longer matters; and to the other switches
      // themselves, and our switch timer. Not from a slot sent in to draw a shield, which throws rather than switch away.
      if (
        !battle.counter &&
        !battle.switching &&
        !finish &&
        !battle.pending &&
        !lastHit &&
        fighting &&
        slot !== undefined &&
        slot !== battle.stripping &&
        clock.now() >= battle.calmAt
      ) {
        battle.counter = stay(clearerOf(data, party, slot, us, battle.stages.own, battle.fainted, them, meta));
      }

      // A switch decided on while the opponent's newcomer flies in is tapped once it has, nothing thrown meanwhile: the
      // energy lit is the switch's to bank. Given up where a lit move comes to finish the newcomer, or ours comes to be
      // doomed, meanwhile, which none of the switches is decided on; doomed, it is told as staying in.
      if (battle.counter && clock.now() < battle.landing && (finish || doomed)) {
        battle.counter = doomed ? stay(battle.counter) : undefined;
      }

      const flying = battle.counter !== undefined && clock.now() < battle.landing;
      const fading = clock.now() - battle.theirFaintAt < FADING_MS;
      const card = battle.prompt?.card;

      // The bubbles swiped around PGSharp's overlay, those it covers at both ends left out before one is chosen.
      const bubbles =
        (battle.player.minigame || playing) && battle.bubbleColour
          ? swipesAround(reads.bubbleSwipes(frame, battle.bubbleColour), panels, frame)
          : undefined;

      const played = battle.player.next(state, clock.now(), {
        ready: spared === undefined && !naming && !flying && !hold?.held && !fading ? ready : [],
        best,
        shield,
        minigame: playing,
        ...(card && { card }),
        ...(battle.counter && !flying && { bench: battle.counter.at }),
        ...(bubbles && { bubbles }),
      });

      // With none of ours left to send in, by the Poké Balls or the faints counted, what reads as the switch prompt is
      // not one: after the last faint, a run took the result coming in for one and tapped it.
      const nobody =
        state === 'switch' && (battle.left.own === 0 || (party.length > 0 && battle.prompt?.next === undefined));
      const action = nobody ? ({ kind: 'wait' } as const) : played;

      // A swipe is begun clear of PGSharp's overlay, which would take one begun on it for its own, and is not made at
      // all where both its ends are covered: a bubble or a fast move missed rather than the star dragged.
      const begun = action.kind === 'swipe' ? swipeAround([action.from, action.to], panels, frame) : undefined;

      if (action.kind === 'swipe' && begun) {
        await phone.swipe(...begun, action.ms);
      } else if (action.kind === 'tap') {
        // A charged move tapped again before its throw has played is that throw retried, told and counted once; another
        // tapped instead is a throw of its own.
        if (action.what === 'charged' && battle.pending?.x === action.at[0]) {
          log(`tap ${battle.pending.move ?? 'a charged move'} again`, 'own', 'its button still lit');
        } else if (action.what === 'charged') {
          const move = battle.seen.moves.get(action.at[0]);

          battle.drop(`${move ?? 'another'} tapped instead`);
          battle.sparing = undefined;
          battle.mirrored = undefined;
          battle.pending = { move, x: action.at[0], why: action.at[0] === best ? throwing?.why : undefined };
        } else if (action.what === 'shield') {
          // Told once, a retap a second later being the same answer to the same prompt.
          if (!battle.offered?.taken) {
            log('took shield', 'own', shielding.why);
          }

          battle.offered = { why: shielding.why, taken: true };
        } else if (action.what === 'bench' && battle.counter && slot !== undefined) {
          // Taken to have gone in until the HUD says otherwise, the newcomer read afresh as after a faint.
          const to = party[battle.counter.slot]?.species ?? '?';
          const banks = banking.length > 0 ? `, banking ${banking.join(' and ')}` : '';

          battle.drop(`switched to ${to} first`);
          log(
            `switching to ${to} against ${battle.seen.opponent ?? 'the opponent'}${banks}`,
            'own',
            battle.counter.why,
          );
          battle.switching = {
            from: slot,
            slot: battle.counter.slot,
            to,
            cp: battle.seen.ownCp,
            at: clock.now(),
            stages: battle.stages.own,
            bank: battle.banked.get(battle.counter.slot),
            stripping: battle.stripping,
            calm: battle.calmAt,
          };
          battle.banked.delete(battle.counter.slot);
          battle.banked.set(slot, { moves: banking, own: facing.own });
          battle.stripping = battle.counter.strip ? battle.counter.slot : undefined;
          battle.calmAt = clock.now() + TIMER_MS;
          battle.sent = battle.counter.slot;
          battle.forgetOwn();
          battle.readAt = clock.now() - READ_MS + SWITCHED_MS;
        } else {
          log(`tap ${action.what}`, 'own');
        }

        await phone.tap(action.at);

        if (action.what === 'charged') {
          const type = data.combat[battle.seen.moves.get(action.at[0]) ?? '']?.type;
          battle.bubbleColour = type === undefined ? undefined : bubbleColours[type];
        }

        // Once a prompt: a retap, a second later, is the same answer to it.
        if (action.what === 'switch' && battle.prompt && !battle.prompt.answered) {
          battle.prompt.answered = true;

          if (battle.prompt.fainted !== undefined) {
            battle.fainted.add(battle.prompt.fainted);
            battle.faintAt = clock.now();
          }

          if (battle.prompt.next !== undefined) {
            battle.sent = battle.prompt.next;
            battle.banked.delete(battle.prompt.next);
            battle.stripping = undefined;
            const gone =
              battle.prompt.fainted === undefined || battle.prompt.told
                ? ''
                : `${party[battle.prompt.fainted]?.species ?? '?'} fainted; `;

            log(`${gone}sending in ${party[battle.prompt.next]?.species ?? '?'}`, 'own', battle.prompt.why);
          }
        }
      } else {
        await clock.sleep(20);
      }

      continue;
    }

    battle.player.next(state, clock.now());
    battle.energy.pause();
    battle.hits.pause();
    battle.ourEnergy.pause();

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

          // Any menu after a battle ends it, not only its result: GO Battle League has gone from a faint straight to its
          // card, with no verdict to read.
          const ended = result && menu.screen !== 'unknown';

          // The verdict fades in over a ✓ already teal, which is all a result after a battle is known by: the demo
          // battle's first frame of its result has `YOU WIN!` half drawn, too faint to read, and a run that screenshot
          // it there counted its win unread. The game holds the result until it is tapped, so a verdict unread is read
          // again off a second screenshot, a frame or more later, before the battle is counted without it.
          const verdict = async () => (await readOutcome(screenshot)) ?? readOutcome(await phone.screenshot());

          return {
            screenshot,
            menu,
            ended,
            outcome: ended && menu.screen === 'result' ? await verdict() : undefined,
          };
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

      // The verdict fades in a frame after the result's ✓ is drawn, so a read can catch the ✓ alone, as the demo clip's
      // frame 4913 shows it. That read is passed over for the next, and only a result unread twice running is counted
      // without its verdict.
      const fading: boolean = done.ended && read.screen === 'result' && !done.outcome && !faded;
      faded = fading;

      // GO Battle League never comes back to the map of itself once a battle has been played: a Poké Ball there is the
      // reward encounter's, which is left for the player rather than tapped.
      let menu: Menu =
        fading || (read.screen === 'map' && mode.mode === 'gbl' && battles > 0) ? { screen: 'unknown' } : read;
      screen = menu.screen;

      // Greyed out read after read, not once among others.
      if (menu.screen !== 'no-battle') {
        noBattle = 0;
      }

      // Counted before the screen is acted on: a set's last battle can end on the card with no battle left, where the run
      // stops. A result left over from before the run, from a battle it never played, is tapped past but not counted.
      if (done.ended && menu.screen !== 'unknown') {
        battles++;
        battling = false;
        battle.undefer('the battle ended');

        if (done.outcome) {
          outcomes[done.outcome]++;
        }

        const unread = menu.screen === 'result' ? 'its result unread' : 'with no result';
        log(`battle ${battles} ${done.outcome ?? `finished, ${unread}`}`);

        // The last battle wanted ending with no result leaves the screen it ended on alone: BATTLE on GO Battle League's
        // card would start another. Its result's ✓ is tapped as ever.
        if (battles >= count && menu.screen !== 'result') {
          return { battles, ...outcomes };
        }

        // Looked for again before anything on the screen after the battle is tapped, a card or BATTLE: each would land on
        // whatever of PGSharp's lies over it, and looked for beside the loop, the next battle could start first. Not after
        // the last battle wanted, which leaves only its ✓ to tap and nothing to read.
        if (battles < count) {
          panels = checkOverlay(await phone.views(), screenshot);
        }
      }

      const silhouettes = menu.screen === 'party' && 'tap' in menu ? readParty(screenshot, icons) : [];

      if (menu.screen === 'party' && 'tap' in menu) {
        if (mode.mode === 'gbl' && menu.cap !== undefined) {
          cap = menu.cap;
        }

        log(`party: ${silhouettes.map((species) => species ?? '?').join(', ')}`);
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

      // The party to be used, each card read off the selection screen unless it is the card last tried there, whose
      // moves, if any were read, are kept. Where a card left anything but the party screen showing, the screen is read
      // afresh rather than USE THIS PARTY tapped at it. The CPs are off the read `readMenu` made, where it made one.
      if (menu.screen === 'party' && 'tap' in menu) {
        const cps = menu.cps ?? (await readCps(screenshot));
        const cards = silhouettes.map((species, slot) => ({ species, cp: cps[slot] ?? null }));
        const tried = cards.map((card, slot) => (sameCard(lastTried[slot], card) ? party[slot] : undefined));
        const stale = cards.flatMap((_, slot) => (tried[slot] ? [] : [slot]));

        lastTried = cards.map((card, slot) => {
          const was = tried[slot] && lastTried[slot];

          return was ? { ...card, cp: card.cp ?? was.cp } : card.cp === null ? undefined : { ...card, cp: card.cp };
        });
        party = cards.map((card, slot) => tried[slot] ?? card);

        if (stale.length > 0) {
          const selection = await readCards(party, stale, screenshot);
          party = selection.cards;
          menu = selection.back ? menu : { screen: 'unknown' };
        }
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
