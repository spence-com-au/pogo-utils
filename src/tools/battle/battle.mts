/**
 * What `run` keeps of one battle, made afresh on the battle's first frame: a field added here cannot carry over from
 * one battle into the next, as one kept beside the battle and left out of its reset would.
 */

import { type GameData } from '../inventory/game-master.mts';
import { type Colour } from './minigame.mts';
import { NO_STAGE_PAIR, NO_STAGES, type Side, type StagePair, type Stages } from './damage.mts';
import { Energy, Hits, OurEnergy, type Hold, type Matchup } from './energy.mts';
import { Steady } from './health.mts';
import { type Point, type Size } from './layout.mts';
import { type Meta } from './meta.mts';
import { type Card } from './party.mts';
import { Player } from './play.mts';
import { unseen, type Reading, type Sighting } from './read.mts';
import { type State } from './recognise.mts';
import { type Reporter } from './reporter.mts';
import { type Switch } from './strategy.mts';

/** Energy of ours on the bench: the charged moves lit as it left the field, and the Pokémon as then read. */
export interface Bank {
  moves: string[];
  own: Side;
}

export class Battle {
  /** What to do about each frame, made for the frames' size, which every frame of a run shares. */
  readonly player: Player;

  // The slots of ours that have fainted, and the slot last sent in, by a switch prompt's answer or a bench card's tap:
  // the party's first card until then.
  readonly fainted = new Set<number>();
  sent = 0;

  // What the switch prompt showing was decided to be answered with, once, on its first frame: who fainted and who goes
  // in, and why. Decided again on a later frame, the first tap having moved `sent`, a retap would go to another card.
  prompt:
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
  caught: { slot: number; told: boolean } | undefined;

  // Each side's shields as the HUD last showed them, never more than the last count, a shield once spent staying spent.
  theirShields = 2;
  ourShields = 2;

  // Whether the opponent's switch just read is still to be answered, and the switch of ours chosen, tapped on the first
  // frame `Player` lets a bench card be once the opponent's newcomer has flown in, at `landing`: a counter to the
  // opponent's switch, or a switch to bank energy, `strip` where it is to draw a shield. Once tapped, the switch is
  // checked by the first read `SWITCHED_MS` on to name ours, or failing that to read its CP: the one tapped away from
  // still out is the tap refused, which leaves it out. And whether a tap has been dropped since the newcomer came in.
  answer = false;
  counter: (Switch & { at: Point; strip: boolean }) | undefined;
  landing = -Infinity;
  dropped = false;

  // Whether the opponent out came in by a switch rather than after a faint, and so has its switch timer to run before
  // it can switch away from ours; and the opponent ours last stayed in against, doomed, rather than switch from.
  switchedIn = false;
  stayedFor: string | null = null;
  switching:
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

  // Whether the opponent's energy is counted from a known point: the zero a battle starts at, for a lead never gone from
  // the field, or a throw since it came in whose banner settled what the throw cost. One sent in from the bench may
  // carry energy banked that the count cannot see, so it is not, until it throws.
  anchored = true;

  // The energy each of ours left the field with by a switch, as the charged moves lit as it went, and the Pokémon as it
  // was then read, which a finish is judged by: it keeps the energy on the bench, and throws as it comes back in. The
  // slot sent in to draw a shield with its own, which is not switched away again to draw another. And how soon another
  // switch to bank energy may be tried, by our switch timer and its refusals, and when a switch of ours last went
  // through, which alone starts the timer: a tap refused more than `TIMER_MS` after one, or with none, is taken as
  // dropped.
  readonly banked = new Map<number, Bank>();
  stripping: number | undefined;
  calmAt = -Infinity;
  swappedAt = -Infinity;

  // How many Pokémon each side has left as the HUD's Poké Balls last showed it, never more than the last count, a faint
  // being for good; null until read. `leftAtName` is the opponent's count when its name was first read, which a lower
  // count when the name changes says it fainted rather than switched out.
  left: { own: number | null; opponent: number | null } = { own: null, opponent: null };
  leftAtName: number | null = null;

  // How many of ours the Poké Balls showed left when the last switch prompt showed: three, before any has. And when a
  // frame last showed one, `FLICKER_MS` after which it is gone.
  promptedAt = 3;
  switchAt = -Infinity;

  // The opponent a fuller bar said was replaced, its name cleared to be read again, until the newcomer's is: what the
  // newcomer is told as having replaced.
  departed: string | null = null;

  // Each side's HP as decided on from the bars read, a misread held back, and a bar not drawn on this frame keeping what
  // an earlier one showed. The opponent's is the last one's until a newcomer's bar is drawn, which the camera does on
  // most frames.
  readonly steady = new Steady();

  // The opponent's energy, counted off the hits on our bar, and the matchup as last read and how many frames the shield
  // prompt has shown for: a prompt gone is their charged move thrown, once it held as long as `Player` waits to answer
  // one, a prompt sliding past matching for a frame or two on its own. With none of our shields left a throw puts up no
  // prompt, and how many frames its countdown has shown for since the fight last did counts it instead.
  readonly energy: Energy;
  matchup: Matchup | undefined;
  prompted = 0;
  unprompted = 0;

  // Our fast moves' hits on the opponent's bar, measured as its on ours are, and whom a hold of our charged moves for
  // the next was last told for: told once, rather than on every frame it lasts, until a throw ends it.
  readonly hits = new Hits();
  sparing: string | null | undefined;

  // Where winning charge-move priority kept a throw for fear of fainting from going a fast move sooner, what it was told
  // for, the opponent, its move and its energy: told once, rather than on every frame until the next hit.
  prioritised: string | undefined;

  // The hold of a bait in a mirror as last told: told once, as the bait lights alone, until a throw ends it.
  mirrored: string | undefined;

  // Our own energy, counted per party slot off the fight's time at the fast move its card was read with.
  readonly ourEnergy: OurEnergy;

  // The colour of the bubbles the minigame now showing draws, that of the move last tapped, where its type is known.
  bubbleColour: Colour | undefined;

  // The battle as last read off the HUD, its names, CPs, types and our move labels, and when the last read of it began.
  seen: Sighting = unseen();
  readAt = -Infinity;

  // When we last had a faint, a switch prompt or its answer, after which for `STALE_MS` the HUD may name the one that
  // fainted.
  faintAt = -Infinity;

  // The battle's names, CPs, move labels and types being read, if they are: off the frame of `at`, and onto the `seen`
  // it began from. Begun before `seen` was cleared, for a newcomer of theirs or a faint or a switch of ours, it is of
  // the Pokémon before, and is never merged: its name or CP would stand for the one sent in.
  sighting: (Reading<Sighting> & { at: number; from: Sighting }) | undefined;

  // The charged moves each opponent has been seen to use this battle, by species, off the banner after each throw; and
  // until when the banner is looked for, when it last was, and whether a read of it is under way.
  readonly theirMoves = new Map<string, Set<string>>();
  bannerUntil = -Infinity;
  bannerAt = -Infinity;
  bannerReading = false;

  // The shield prompt showing, if one is, and why its shield is taken or kept: told once it is answered, by a tap or
  // by the prompt going untapped.
  offered: { why: string; taken: boolean } | undefined;

  // Our charged move last thrown, which a shield the opponent takes is taken against.
  thrown: string | undefined;

  // Our charged move tapped and not yet seen to play, by its button's x, and why it was tapped: told as thrown, and its
  // stats moved, only once it plays. The opponent's move on the same turn can drop the tap, its button lighting again
  // with the energy kept, or hold the throw back until after theirs, its minigame coming with no tap of its own; and a
  // faint of either side's before it plays loses it. Since when the HUD has shown none of our buttons lit, unbroken, as
  // a minigame does throughout, and since when the button tapped has shown lit again, untapped.
  pending: { move: string | undefined; x: number; why: string | undefined } | undefined;
  unlit: number | undefined;
  relit: number | undefined;

  // When one of the opponent's Poké Balls last went grey, its faint hiding our buttons while it picks its next.
  theirFaintAt = -Infinity;

  // The move chosen that lowers our defense, held until the opponent's charged move has landed: how long since the hold
  // began, which a release and a second hold before a throw both keep, of this move or another, our energy growing
  // whichever is picked, counted only across the fight's own frames, back to back, where alone our fast moves gain it;
  // the frame and the time last counted; and whether it is held now. Ended by a throw of ours playing, ours fainting, a
  // switch of ours seen to have gone through or the result screen; a tap dropped, a throw or a switch, leaves it running.
  // `weigh` asks the hold again as it was last weighed, but for the time waited: what a switch under way leaves it to.
  deferring:
    | {
        move: string;
        waited: number;
        frame: number;
        at: number;
        held: boolean;
        weigh: (waited: number) => Hold | undefined;
      }
    | undefined;

  // The attack and defense stages of the Pokémon out on each side, as the charged moves thrown have moved them: ours
  // from each we throw, theirs off the banner after each of their throws.
  stages: StagePair = NO_STAGE_PAIR;

  // Each part of the stretch the battle has been off its field for, if it is: what showed, and from when. Told once the
  // field is back, if it ran `OFF_MS`.
  off: { state: State | 'minigame'; what: string; from: number }[] = [];

  readonly #log: Reporter['event'];

  /** A battle fought on frames of `screen`'s size, by `party` as last read off the party screen. */
  constructor(
    screen: Size,
    data: GameData,
    meta: Meta | null | undefined,
    party: readonly Card[],
    log: Reporter['event'],
  ) {
    this.player = new Player(screen);
    this.energy = new Energy(data, meta);
    this.ourEnergy = new OurEnergy(
      data,
      party.map((card) => card.moves?.fast),
    );
    this.#log = log;
  }

  /** Ends a hold with the move it held for, told where it was held. */
  undefer(why: string): void {
    if (this.deferring?.held) {
      this.#log(`no longer holding ${this.deferring.move}`, 'own', why);
    }

    this.deferring = undefined;
  }

  /** Drops the throw tapped and not yet seen to play, told where there is one. */
  drop(why: string): void {
    if (this.pending) {
      this.#log(`${this.pending.move ?? 'our charged move'} not thrown`, 'own', why);
      this.pending = undefined;
    }
  }

  /**
   * Forgets ours: the Pokémon of ours sent in next has moves of its own, perhaps a name, its own CP and HP, and no stages
   * moved, all read again at once. A read finding no label keeps the moves it merges onto, so any left would stand for
   * its own.
   */
  forgetOwn(): void {
    this.seen = { ...this.seen, own: null, ownCp: null, ownTypes: null, moves: new Map() };
    this.steady.forget('own');
    this.stages = { ...this.stages, own: NO_STAGES };
    this.readAt = -Infinity;
    this.counter = undefined;
  }
}
