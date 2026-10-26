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

import { BOTTOM, place, type Size } from './layout.mts';
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

  /** Which of the switch prompt's cards to send in. */
  card?: Point;

  /**
   * A bench card to switch in mid-fight, tapped in place of the fight's swipe and ahead of a lit charged move, the switch
   * keeping that move's energy, but never through the minigame.
   */
  bench?: Point;

  /**
   * The swipes through the minigame's bubbles on this frame, as `bubbleSwipes` finds them, the first swiped. None found
   * waits through the minigame's lead-in, there being nothing to pop yet, and sweeps rows after it; undefined, where the
   * bubbles' colour is not known, sweeps rows throughout.
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

/** How long one swipe takes, in milliseconds: short, so a fast move fires about six times a second. */
const SWIPE_MS = 80;

/**
 * Consecutive frames a state has to hold before a tap answers it. A prompt sliding in or out matches for a frame or two
 * on its own — two such frames turned up in 6,364 of a recorded battle — and a charged move is answered sooner because
 * it does not animate in.
 */
const SETTLE: Partial<Record<State, number>> = { charged: 2, shield: 3, switch: 3 };

/**
 * How long a tap is given to take before the same state is answered again, in milliseconds; a charged move's is given
 * `THROW_MS` until its throw plays. The button stays lit for a few frames after a charged move is thrown, and the
 * prototype tapped it five times over 200ms where once would do.
 */
const RETAP_MS = 1000;

/**
 * How long a charged move's tap is given to be thrown before the button, still lit, is tapped again, in milliseconds.
 * The throw waits for the fast move under way to finish, its button lit meanwhile, and a fast move takes up to five
 * 500ms turns. `RETAP_MS` retapped three of a live run's 15 throws, finding the button still lit a second on: Shadow
 * Sneak at 130.1s and 131.2s, Ancient Power at 433.4s and 434.5s, Frenzy Plant at 473.9s and 474.9s. Each was one throw,
 * the battle read again 13s after the first tap, as after the throws tapped once (12.1s to 12.5s).
 */
const THROW_MS = 3000;

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

  /** What to do about a frame read as `state`, at `now` milliseconds. */
  next(
    state: State,
    now: number,
    { ready = [], best, shield = true, card = this.#taps.switch, bench, bubbles }: Choices = {},
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

    // A charged move thrown is the minigame next, inside frames that read as `battle` throughout, and over once the
    // throw itself plays, which does not.
    if (state !== 'battle' && state !== 'charged') {
      this.#minigame = false;
    }

    const throwable = best === undefined ? ready : ready.filter(([x]) => x === best);

    // Before a lit move is thrown: the switch is made to keep that energy on the bench.
    if (bench && !this.#minigame && (state === 'battle' || state === 'charged')) {
      return { kind: 'tap', at: bench, what: 'bench' };
    }

    if (state === 'battle' || (state === 'charged' && throwable.length === 0)) {
      if (this.#tapped?.state === 'charged' && now - this.#tapped.at < HOLD_MS) {
        return { kind: 'wait' };
      }

      const [through] = this.#minigame ? (bubbles ?? []) : [];

      if (through) {
        return { kind: 'swipe', from: through[0], to: through[1], ms: SWIPE_MS };
      }

      if (this.#minigame && bubbles && this.#tapped && now - this.#tapped.at < LEAD_IN_MS) {
        return { kind: 'wait' };
      }

      const swipes = this.#minigame ? MINIGAME : FIGHT;
      const swipe = swipes[this.#swipes++ % swipes.length];

      return swipe ? { kind: 'swipe', from: swipe[0], to: swipe[1], ms: SWIPE_MS } : { kind: 'wait' };
    }

    if (state === 'other' || (state === 'shield' && !shield) || this.#streak < (SETTLE[state] ?? 0)) {
      return { kind: 'wait' };
    }

    // A charged move's tap holds until its throw is seen to play, ending the minigame, or until `THROW_MS` has passed.
    const retap = state === 'charged' && this.#minigame ? THROW_MS : RETAP_MS;

    if (this.#tapped?.state === state && now - this.#tapped.at < retap) {
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

    this.#tapped = { state, at: now };
    this.#minigame = true;

    return { kind: 'tap', at: first, what: state };
  }
}
