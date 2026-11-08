/**
 * What to do about each frame of a battle, given which state `recognise` read it as. Swipe for fast moves, throw the
 * charged move the caller names the moment it is ready — or, where it names none, whichever is ready first — take a
 * shield offered unless the caller says not to, send in the card it names, or the first, and switch to the bench card
 * it names. Which move is worth throwing, which shield worth taking and who to send in is `strategy.mts`'s to say.
 *
 * Pure, so that every rule here is tested without a phone: `next` takes the state and the time and answers an action,
 * which the caller performs. Positions are fractions of the screen, as everywhere else the phone is driven.
 *
 * Measured on a supervised battle against Candela, which the strategy won: a swipe's touch fires a fast move just as a
 * tap does, so one action serves both the fight and the charged-move minigame, whose bubbles a swipe pops on the way
 * through.
 */

import { around, BOTTOM, place, type Area, type Size } from './layout.mts';
import { FINGER } from './menus.mts';
import { type State } from './recognise.mts';

export type Point = readonly [x: number, y: number];

export type Action =
  | { kind: 'swipe'; from: Point; to: Point; ms: number }
  | { kind: 'tap'; at: Point; what: 'charged' | 'shield' | 'switch' | 'bench' }
  | { kind: 'wait' };

/**
 * Where each prompt is answered, measured on the footage at 360×760: the Protect Shield under its prompt, and the
 * switch prompt's two cards, centred at x 0.32 and 0.67 in `switch-glaceon`. When one Pokémon is left the card is
 * centred instead and the first card's tap misses it, which costs nothing — the game sends that one in when its
 * countdown runs out. A charged move is thrown wherever its lit button was found, there being one or two of them.
 * Both prompts are pinned to the foot, so each is down as widths from it, which a `Player` places for the screen it is
 * given.
 */
export const TAPS = {
  shield: [0.5, -0.38],
  switch: [0.33, -0.2744],
} as const satisfies Record<string, Point>;

export const SWITCH_CARDS: readonly Point[] = [TAPS.switch, [0.67, -0.2744]];

/**
 * The bench's cards down the right edge mid-battle, top first: those not out and not fainted, in party order, a lone
 * one at the top as in `battle-one-shield`. Centred 0.055 widths above each card's HP strip, which runs at y 0.6335 and
 * 0.7276 on the Pixel 4 XL's fixtures and 0.6265 and 0.7157 on the Pixel 8 Pro's: pinned at the middle of the screen,
 * `layout.mts`'s anchor from the two coming to 0.500 for both, and so 0.2818 and 0.4805 widths below it on either. A
 * tap on one switches it in at once, with nothing to confirm; on the switch timer, which darkens both cards, it does
 * nothing.
 */
export const BENCH = [
  [0.903, 0.227],
  [0.903, 0.426],
] as const satisfies readonly Point[];

/** Where the bench is pinned down the screen. */
export const BENCH_ANCHOR = 0.5;

/**
 * Where the battle taps, for `overlay.mts`: the Protect Shield, the switch prompt's cards and the bench's, a fingertip
 * around each. The charged moves' buttons are `recognise.mts`'s, read before they are tapped, and the swipes go around
 * PGSharp's overlay rather than refuse it.
 */
export function areas(screen: Size): Area[] {
  const tap = (at: Point, anchor: number) => around(at, FINGER, anchor, screen);

  return [
    { name: 'the Protect Shield', boxes: [tap(TAPS.shield, BOTTOM)] },
    { name: "the switch prompt's cards", boxes: SWITCH_CARDS.map((card) => tap(card, BOTTOM)) },
    { name: "the bench's cards", boxes: BENCH.map((card) => tap(card, BENCH_ANCHOR)) },
  ];
}

/** What the caller has decided about a frame, which `next` acts on. */
export interface Choices {
  /** Where the frame's lit charged-move buttons are, as `readyButtons` finds them. */
  ready?: readonly Point[];

  /**
   * The x of the button worth throwing: while another is lit and it is not, the fight goes on, the energy kept for it.
   * Without one, of two the one that lit first is thrown, and the left where they lit together.
   */
  best?: number;

  /** Whether a shield offered is taken: declined, the prompt is left to run out. */
  shield?: boolean;

  /**
   * Whether the caller takes a throw of ours to be playing on this frame, swiped as a minigame from then until the throw
   * plays though no tap here began it: a throw the opponent's came ahead of plays after theirs with no tap of its own,
   * and a frame of no fight early in a minigame ends the one a tap began.
   */
  minigame?: boolean;

  /** Which of the switch prompt's cards to send in. */
  card?: Point;

  /**
   * A bench card to switch in mid-fight, tapped in place of the fight's swipe and ahead of a lit charged move, the
   * switch keeping that move's energy, but never through the minigame.
   */
  bench?: Point;

  /**
   * The swipes through the minigame's bubbles on this frame, as `bubbleSwipes` finds them, the first swiped. None found
   * waits through the minigame's lead-in, there being nothing to pop yet, and once this minigame's have been found since
   * its throw was taken to be playing, there being none left; otherwise it sweeps rows, the finder perhaps missing the
   * move's bubbles. Those found once they have been gone `OVER_MS` are waited through too, being the move playing out.
   * Undefined, where the bubbles' colour is not known, sweeps rows throughout.
   */
  bubbles?: readonly (readonly [Point, Point])[];
}

/**
 * The fight's swipe, across the middle of the field and back. It stays clear of what a touch there would press instead:
 * the bench's switch buttons down the right edge, at x > 0.8 between y 0.53 and 0.70, and the charged-move buttons
 * along the bottom.
 */
const FIGHT: readonly (readonly [Point, Point])[] = [
  [
    [0.15, 0.42],
    [0.7, 0.5],
  ],
  [
    [0.7, 0.5],
    [0.15, 0.42],
  ],
];

/**
 * The minigame's swipes where its bubbles are not found, row after row across the lower two thirds and back. Its
 * bubbles are wherever the move puts them — Shadow Sneak's in the middle, Psychic's between y 0.55 and 0.95 — and the
 * fight's one band reached only `NICE!` against Psychic's, the rows `GREAT!`. Nothing is pressed by accident here: the
 * minigame draws neither the bench nor the button.
 */
const MINIGAME: readonly (readonly [Point, Point])[] = [0.4, 0.52, 0.64, 0.76, 0.88].flatMap((y, row) => {
  const ends: [Point, Point] = [
    [0.05, y],
    [0.95, y + 0.04],
  ];

  return [row % 2 === 0 ? ends : ([ends[1], ends[0]] as [Point, Point])];
});

/**
 * How long after a charged move's tap its minigame's bubbles are waited for, in milliseconds, before rows are swept
 * instead. In a recorded Crunch the first bubbles came 2.1s after the throw began, behind `Get Ready!`; a minigame
 * whose bubbles are not found after that is swept as before rather than not swiped at all.
 */
const LEAD_IN_MS = 2_500;

/**
 * How long the minigame's bubbles go unfound before they are over, in milliseconds, once found for `BUBBLES_MS`:
 * anything found after is the move playing out, which strikes the opponent with things of its type's colour —
 * Avalanche's ice chunks, Outrage's smoke, Thunderbolt's lightning. Over 218 throws of 17 kept runs, no stretch of
 * bubbles was broken for more than 0.36s, and 129 had the move found 0.5s or more after the last of them, each looked
 * at under its `used` banner or just before it. Found sooner, it is swiped as before.
 */
const OVER_MS = 500;

/**
 * How long the bubbles have to have been found, unbroken by `OVER_MS`, for that to end them, in milliseconds. A throw
 * can be taken to be playing before its minigame begins, as when the opponent's faint hides our buttons, and whatever
 * the fight shows meanwhile is found as bubbles: 0.8s and 1.3s of it in kept runs, and the `Get Ready!` after, with
 * none found, would have ended a minigame not yet begun. Every stretch the move came after ran 2.5s at the least.
 */
const BUBBLES_MS = 2_000;

/** How long one swipe takes, in milliseconds: short, so a fast move fires about six times a second. */
const SWIPE_MS = 80;

/**
 * Consecutive frames a state has to hold before a tap answers it. A prompt sliding in or out matches for a frame or two
 * on its own — two such frames turned up in 6,364 of a recorded battle — and a charged move is answered sooner because
 * it does not animate in.
 */
const SETTLE: Partial<Record<State, number>> = { charged: 2, shield: 3, switch: 3 };

/**
 * How long a tap is given to take before the same state is answered again, in milliseconds. The button stays lit for a
 * few frames after a charged move is thrown, and the prototype tapped it five times over 200ms where once would do. A
 * throw also waits for the fast move under way, up to five 500ms turns, its button lit meanwhile, so a retap a second
 * on can be the same throw still waiting: three of a live run's 15 throws were tapped twice so, and each was one throw,
 * which `run` tells once. It is retapped even so, there being no telling a throw waiting from a tap dropped while the
 * button stays lit: held for 3s instead, a dropped Overheat was retapped 0.1s before Entei fainted, its energy lost and
 * the shield it would have drawn kept for the rest of the battle.
 */
const RETAP_MS = 1000;

/**
 * How long nothing is swiped after a charged move is tapped, in milliseconds. A swipe straight after the tap looked to
 * cost the throw: in one recorded battle 20 taps threw about 8 moves, the button going dark for a few frames after each
 * tap — read as `battle`, and so swiped at — and then lighting again with nothing thrown. The minigame's bubbles take
 * longer than this to arrive, behind `Get Ready!`, so nothing is lost by waiting.
 */
const HOLD_MS = 700;

export class Player {
  readonly #taps: { shield: Point; switch: Point };
  #state: State | undefined;
  #streak = 0;
  #minigame = false;
  #tapped: { state: State; at: number } | undefined;
  #swipes = 0;

  /** Whether the caller has taken the throw to be playing since the minigame began, as `minigame` says. */
  #playing = false;

  /**
   * The stretch of the minigame under way that its bubbles have been found over, unbroken by `OVER_MS`, since its throw
   * was taken to be playing, after which a frame with none is its bubbles over rather than missed. The move then plays
   * out, read as `playing` until a frame of it that hides the HUD, with nothing to pop and no fast move to fire: in a
   * kept run, `bubbleSwipes` found Avalanche's bubbles from 114.14s to 119.35s, never losing them for more than 0.3s,
   * and rows were swept on from there through `Kyogre used Avalanche!` until 121.7s. Found before then, they may be no
   * minigame's: live, after an Outrage tapped went unthrown, Kyurem having fainted to our fast move, the shards of its
   * faint were found as Outrage's bubbles.
   */
  #found: { from: number; to: number } | undefined;

  /** Whether the bubbles found have been gone `OVER_MS` after `BUBBLES_MS` of them, after which none are swiped. */
  #over = false;

  /** When each lit charged-move button lit, by its x, for as long as it stays lit. */
  readonly #lit = new Map<number, number>();

  /** `screen` is the frames' size, which the prompts' taps are placed on. */
  constructor(screen: Size) {
    this.#taps = { shield: place(TAPS.shield, BOTTOM, screen), switch: place(TAPS.switch, BOTTOM, screen) };
  }

  /** Whether the charged-move minigame is being swiped at, which nothing else should hold up. */
  get minigame(): boolean {
    return this.#minigame;
  }

  /**
   * Forgets the minigame of a charged move tapped that will not be thrown, either side having fainted first with no
   * prompt to end it: ours as when the last of ours is sent in, or the opponent's as it picks its next. The fight goes
   * on in frames read as `battle` throughout: live, Kyogre fainted moments after tapping Avalanche, and Dragonite stood
   * through 5s of the fight, a single frame as it was sent in, 1.5s after the tap, having been found as Avalanche's
   * bubbles.
   */
  forget(): void {
    this.#minigame = false;
    this.#playing = false;
    this.#found = undefined;
    this.#over = false;
  }

  /** What to do about a frame read as `state`, at `now` milliseconds. */
  next(
    state: State,
    now: number,
    { ready = [], best, shield = true, minigame = false, card = this.#taps.switch, bench, bubbles }: Choices = {},
  ): Action {
    this.#streak = state === this.#state ? this.#streak + 1 : 1;
    this.#state = state;

    for (const x of this.#lit.keys()) {
      if (!ready.some(([rx]) => rx === x)) {
        this.#lit.delete(x);
      }
    }

    for (const [x] of ready) {
      if (!this.#lit.has(x)) {
        this.#lit.set(x, now);
      }
    }

    // A charged move thrown is the minigame next, inside frames that read as `playing` throughout, and over once the
    // throw itself plays and hides the HUD; as is a frame the caller says is a minigame, though no tap here began it.
    if (state !== 'battle' && state !== 'charged' && state !== 'playing') {
      this.forget();
    } else if (minigame) {
      this.#minigame = true;
      this.#playing = true;
    }

    const throwable = best === undefined ? ready : ready.filter(([x]) => x === best);

    // Before a lit move is thrown: the switch is made to keep that energy on the bench.
    if (bench && !this.#minigame && (state === 'battle' || state === 'charged')) {
      return { kind: 'tap', at: bench, what: 'bench' };
    }

    if (state === 'battle' || state === 'playing' || (state === 'charged' && throwable.length === 0)) {
      // A charged move under way other than our minigame — the opponent's, or ours yet to come behind it — fires no
      // fast move and draws no bubbles: in a kept run, swipes landed through Garchomp's Sand Tomb and through the
      // `Get Ready!` of our throw held behind it.
      if (state === 'playing' && !this.#minigame) {
        return { kind: 'wait' };
      }

      if (this.#tapped?.state === 'charged' && now - this.#tapped.at < HOLD_MS) {
        return { kind: 'wait' };
      }

      const [through] = this.#minigame && !this.#over ? (bubbles ?? []) : [];

      if (through) {
        if (this.#playing) {
          this.#found =
            this.#found && now - this.#found.to < OVER_MS ? { ...this.#found, to: now } : { from: now, to: now };
        }

        return { kind: 'swipe', from: through[0], to: through[1], ms: SWIPE_MS };
      }

      // Judged on a frame with none found, so that a loop held up for a moment does not end the bubbles on its own.
      this.#over ||=
        this.#found !== undefined && this.#found.to - this.#found.from >= BUBBLES_MS && now - this.#found.to >= OVER_MS;

      if (this.#minigame && bubbles && (this.#found || (this.#tapped && now - this.#tapped.at < LEAD_IN_MS))) {
        return { kind: 'wait' };
      }

      const swipes = this.#minigame ? MINIGAME : FIGHT;
      const swipe = swipes[this.#swipes++ % swipes.length];

      return swipe ? { kind: 'swipe', from: swipe[0], to: swipe[1], ms: SWIPE_MS } : { kind: 'wait' };
    }

    if (state === 'other' || (state === 'shield' && !shield) || this.#streak < (SETTLE[state] ?? 0)) {
      return { kind: 'wait' };
    }

    if (this.#tapped?.state === state && now - this.#tapped.at < RETAP_MS) {
      return { kind: 'wait' };
    }

    if (state !== 'charged') {
      this.#tapped = { state, at: now };

      return { kind: 'tap', at: state === 'switch' ? card : this.#taps[state], what: state };
    }

    const first = [...throwable].sort(([a], [b]) => (this.#lit.get(a) ?? now) - (this.#lit.get(b) ?? now) || a - b)[0];

    if (!first) {
      return { kind: 'wait' };
    }

    this.forget();
    this.#tapped = { state, at: now };
    this.#minigame = true;

    return { kind: 'tap', at: first, what: state };
  }
}
