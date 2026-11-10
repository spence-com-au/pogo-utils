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

import { around, BOTTOM, place, type Area, type Point, type Size } from './layout.mts';
import { FINGER } from './menus.mts';
import { reachable, type Bubble } from './minigame.mts';
import { type State } from './recognise.mts';

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
   * and its prompt, or the HUD hidden past `LEAD_IN_MS`, ends the minigame a tap began.
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
   * The minigame's bubbles on this frame, as `bubbleSwipes` finds them, the first of those `GONE`, `PALEST` and `POPPED`
   * keep whose swipe as aimed is `clear` swiped. None found, or none clear, waits through the minigame's lead-in, there
   * being nothing to pop yet, and once this minigame's have been found since its throw was taken to be playing, there
   * being none left; otherwise it sweeps rows, the finder perhaps missing the move's bubbles. Those found once they have
   * been gone `OVER_MS`, or once `back` says, are waited through too, being the move playing out. Undefined, where the
   * bubbles' colour is not known, sweeps rows throughout.
   */
  bubbles?: readonly Bubble[];

  /**
   * Whether a swipe can be made, PGSharp's overlay not under both its ends, judged on each bubble's swipe as `ahead`
   * aims it and the first passing swiped: one refused as it is made would be chosen again on the next frame, and the
   * next, the bubbles after it never swiped. Without it, every swipe can be made.
   */
  clear?: (swipe: readonly [Point, Point]) => boolean;

  /**
   * Whether what the minigame hides is back on this frame: the button to flee the battle, from its first frame fading
   * in, or our HP bar. Both show again as the move plays out after the bubbles, which from then are over however
   * closely what is found as them follows: Outrage's smoke, Close Combat's colour on Zamazenta's red body and Crunch's
   * up to the minigame's last frame, each less than `OVER_MS` after the last bubble. Of the 226 throws in 18 kept runs
   * after which both came back, the button came first after 205, by a median 1.06s: Close Combat's rating went 0.1s
   * after its last bubble, on the frame the button began to fade in, and our bar came back 1.54s later. Our bar came
   * first after 21, by two frames at most bar one by 0.18s. Read up only once its disc was white, the button left a
   * median 0.165s of its fade to be swiped, after 47 throws. Not a bar centred on its Pokémon: one showed through
   * Crunch's bubbles, read once as the opponent's.
   */
  back?: boolean;
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
 * at under its `used` banner or just before it. Found sooner, it is swiped until what the minigame hides is back, as
 * `back` says.
 */
const OVER_MS = 500;

/**
 * How long the bubbles have to have been found, unbroken by `OVER_MS`, for that or `back` to end them, in
 * milliseconds. A throw can be taken to be playing before its minigame begins, as when the opponent's faint hides our
 * buttons, and whatever the fight shows meanwhile is found as bubbles: 0.8s and 1.3s of it in kept runs, and the `Get
 * Ready!` after, with none found, would have ended a minigame not yet begun, as the fight's button and bar would, and
 * the button through `Get Ready!` itself. Every stretch the move came after ran 2.5s at the least.
 */
const BUBBLES_MS = 2_000;

/**
 * How much of the most saturated share found over a minigame's bubbles, unbroken by `OVER_MS`, a blob has to hold to be
 * swiped. Paler, it is no bubble still to pop, though with nothing more saturated beside it on its frame `bubbleSwipes`
 * puts it first: at night, Palkia's wing held 0.33 to 0.46 of Dragon's and Water's share and a bubble popped paled to
 * 0.4 before it went, where the bubbles of each minigame reached 1.05 to 1.08. A frame of only such blobs is waited
 * through, the bubbles still found as `OVER_MS` counts them. Over five kept minigames, 70 of 590 frames with a find
 * were, each the wing or Palkia's body, a bubble popped, Avalanche's ice chunks or the move playing out. No tighter: a
 * sunny Pixel 4 XL's Ice bubbles still to pop held as little as 0.73 against Avalanche's 1.05, and the finder tells no
 * share above 1.15, so whatever is found beside the bubbles cannot put the bar above 0.58.
 */
const GONE = 0.5;

/**
 * The least share a blob has to hold to be swiped, however little has been found for `GONE` to judge it by. Before a
 * minigame's first bubble nothing has: at night, Palkia's wing, at 0.33 to 0.46 of Dragon's and Water's share, was all
 * that was found for a quarter of a second before the first bubble of Spacial Rend and of Aqua Tail. The palest bubble
 * still to pop held 0.54, one of Mewtwo's by day found only in part. Over the minigames of 212 throws in 12 kept runs,
 * this alone kept a blob from being swiped on 31 frames, and the 27 looked at were the move playing out, its smoke, ice
 * or the bar it struck, a bubble popped, the trail a swipe leaves or Kyogre's belly, bar two that may have been a bubble
 * half hidden behind a trail or a chunk of ice.
 */
const PALEST = 0.5;

/**
 * How long a bubble swiped goes on being found where it was, in milliseconds, as it swells and pales before it goes,
 * and how far from the swipe, in widths: an Aqua Tail bubble paled from 0.95 to 0.4 over the 0.3s after the touch
 * reached it, `LANDS_MS` and some of the swipe's 80ms after the frame it was aimed off, by when it held less than half
 * the bubbles' share for `GONE` to wait through, and swelled to 2,060 pixels at the finder's 180 wide, 0.14 widths in
 * radius.
 */
const POP_MS = 400;
const SWELL = 0.15;

/**
 * How much of the share of a bubble swiped within `POP_MS` and `SWELL` of a blob the blob has to hold to be swiped as
 * another bubble, rather than waited through as that one popping. Alone on its frame, a bubble popped is all
 * `bubbleSwipes` finds, though still over half as saturated as the bubbles: on the frame of 110.165s of a night Close
 * Combat, two so popped held 0.6 of Fighting's share against the minigame's 1.08, and a Spacial Rend and an Aqua Tail
 * bubble held 0.71 and 0.72 of their own 0.34s after the swipes aimed at them. A bubble come since holds about as much
 * as the one swiped: one of Dragon's, found as one blob with those popping beside it, held 0.85. Over the minigames of
 * 212 throws, 210 frames that would have been swiped were waited through so, and the 16 looked at, at random, were each
 * a bubble popped. By day, a Close Combat bubble come up on Zamazenta's red body within one popping held 0.62 of the one
 * swiped there, and was waited through.
 */
const POPPED = 0.8;

/** How long one swipe takes, in milliseconds: short, so a fast move fires about six times a second. */
const SWIPE_MS = 80;

/**
 * How long a swipe aimed off a frame takes to land, in milliseconds, from when the frame was drawn: in a kept Training
 * battle against Candela, the first Aqua Tail bubble swiped was aimed at off the frame of 213.129s, and the game drew
 * the swipe's trail from 213.251s.
 */
const LANDS_MS = 120;

/**
 * How fast a bubble can move, in widths a second, and how slowly it can and still be taken to be standing: the fastest
 * of that battle's three minigames crossed 1.6 widths a second, Aqua Tail's from the right edge to the bottom left, and
 * Close Combat's grew in place, its middle drifting 0.16 widths a second.
 */
const FASTEST = 2;
const MOVING = 0.4;

/** How far apart two frames can be, in milliseconds, for a bubble's move between them to say how it moves now. */
const STALE_MS = 250;

/**
 * How long a swipe can be, in widths, and be through one bubble rather than a chain of them, which is swiped along its
 * length as found: a Water bubble's ran 0.27 to 0.33, its 0.21 to 0.27 and `OVERRUN` either side.
 */
const LONE = 0.4;

/**
 * How much longer one swipe can be than the other for both to be through one bubble a frame apart. A bubble moving
 * keeps its size, where one popped swells where it was and Dragon's grow as they come in, and either, taken for one
 * moving, was swiped away from where it stood: Spacial Rend's swipes so led crossed a bubble 27 times in 41 rather than
 * the 30 they did as found.
 */
const SAME = 1.33;

/** The swipes through the bubbles found on a frame, and when the frame was first looked at, in milliseconds. */
export interface Look {
  at: number;
  bubbles: readonly (readonly [Point, Point])[];
}

/**
 * `swipe`, through a bubble the frame `look` found, run on to where the bubble will be by the time the swipe ends where
 * the frame `before` shows it moving alone, rather than in a chain: from where it was seen, the way it moves, to
 * `LANDS_MS` and the swipe's `ms` on from `at`, and half the swipe beyond. As found where it is not seen moving. Either
 * way it is brought onto what a swipe may reach only once aimed: the bubble's size and middle are told from the swipes
 * as found, since clamped to `REACH` one at an edge is shorter than on the frame before, failing `SAME`, and its middle
 * moves less than it does.
 *
 * A move's bubbles fly across the screen: Water's in from the right edge and out at the bottom left, at up to 1.6
 * widths a second, and Dragon's in from the left at 0.3 to 1.5. Over the 0.12s a swipe takes to land a Water bubble
 * moves 0.15 widths, past the 0.11 of its radius, so a swipe through where it was passes behind it: of the 40 bubbles
 * tracked through two Aqua Tails, 12 left at an edge unpopped, and those two minigames reached only `GREAT!`. Begun
 * where the bubble was seen, a swipe still catches one slower than its move between frames made it look.
 */
export function ahead(
  swipe: readonly [Point, Point],
  look: Look,
  before: Look | undefined,
  at: number,
  ms: number,
  { width, height }: Size,
): readonly [Point, Point] {
  const seconds = before ? (look.at - before.at) / 1000 : 0;
  const found = [reachable(swipe[0]), reachable(swipe[1])] as const;

  if (!before || seconds <= 0 || seconds * 1000 > STALE_MS) {
    return found;
  }

  // In widths across and down, which a bubble moves the same distance in either way.
  const tall = height / width;
  const middle = ([from, to]: readonly [Point, Point]) =>
    [(from[0] + to[0]) / 2, ((from[1] + to[1]) / 2) * tall] as const;
  const length = ([from, to]: readonly [Point, Point]) => Math.hypot(to[0] - from[0], (to[1] - from[1]) * tall);
  const [x, y] = middle(swipe);
  const [was] = before.bubbles
    .filter((other) => Math.abs(Math.log(length(other) / length(swipe))) <= Math.log(SAME))
    .map((other) => middle(other))
    .map(([bx, by]) => ({ dx: x - bx, dy: y - by, apart: Math.hypot(x - bx, y - by) }))
    .filter(({ apart }) => apart <= FASTEST * seconds)
    .sort((a, b) => a.apart - b.apart);
  const speed = was ? was.apart / seconds : 0;

  if (!was || speed < MOVING || length(swipe) > LONE) {
    return found;
  }

  const on = (speed * (at - look.at + LANDS_MS + ms)) / 1000 + length(swipe) / 2;

  return [reachable([x, y / tall]), reachable([x + (was.dx / was.apart) * on, (y + (was.dy / was.apart) * on) / tall])];
}

/** How far the middle of a blob, as `found` runs through it, lies from `swipe`, in widths. */
function away(found: readonly [Point, Point], swipe: readonly [Point, Point], { width, height }: Size): number {
  // In widths across and down, as in `ahead`.
  const tall = height / width;
  const [x, y] = [(found[0][0] + found[1][0]) / 2, ((found[0][1] + found[1][1]) / 2) * tall];
  const [ax, ay] = [swipe[0][0], swipe[0][1] * tall];
  const [dx, dy] = [swipe[1][0] - ax, swipe[1][1] * tall - ay];
  const along = Math.min(Math.max(((x - ax) * dx + (y - ay) * dy) / (dx ** 2 + dy ** 2 || 1), 0), 1);

  return Math.hypot(x - ax - dx * along, y - ay - dy * along);
}

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

/**
 * How long the fight's own frames must run unbroken to end a minigame, in milliseconds. A move can play out with the HUD
 * up throughout: live, after Close Combat the fight came back with nothing hiding it, and the minigame, still waited on,
 * left 2.6s of it unplayed. Over 20 kept runs, a frame of a charged move under way read as the fight for 4 frames at a
 * time at most, the white of Kyogre's jaw through its own minigame among them, and a button tapped dims for 3.
 */
const FIGHT_MS = 300;

export class Player {
  readonly #taps: { shield: Point; switch: Point };
  readonly #screen: Size;
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
   * out, read as `playing` until a frame of it that hides the HUD or the fight is back, with nothing to pop and no fast
   * move to fire: in a
   * kept run, `bubbleSwipes` found Avalanche's bubbles from 114.14s to 119.35s, never losing them for more than 0.3s,
   * and rows were swept on from there through `Kyogre used Avalanche!` until 121.7s. Found before then, they may be no
   * minigame's: live, after an Outrage tapped went unthrown, Kyurem having fainted to our fast move, the shards of its
   * faint were found as Outrage's bubbles. With it, the most saturated share found over it, for `GONE` to judge by.
   */
  #found: { from: number; to: number; vivid: number } | undefined;

  /**
   * The swipes made through bubbles over the last `POP_MS`, as aimed, each with the share of the bubble it went through
   * and when, for a blob found where one went to be told from that bubble popping, as `POPPED` says.
   */
  #swiped: { swipe: readonly [Point, Point]; share: number; at: number }[] = [];

  /**
   * Whether the bubbles found for `BUBBLES_MS` are over, gone `OVER_MS` or what the minigame hides back after them,
   * after which none are swiped.
   */
  #over = false;

  /** The last frame's bubbles and the one's before, which how each bubble is moving is told from, as `ahead` says. */
  #look: Look | undefined;
  #before: Look | undefined;

  /** Since when the frames have read as the fight, unbroken, which `FIGHT_MS` of ends a minigame. */
  #fighting: number | undefined;

  /** When each lit charged-move button lit, by its x, for as long as it stays lit. */
  readonly #lit = new Map<number, number>();

  /** `screen` is the frames' size, which the prompts' taps are placed on. */
  constructor(screen: Size) {
    this.#taps = { shield: place(TAPS.shield, BOTTOM, screen), switch: place(TAPS.switch, BOTTOM, screen) };
    this.#screen = screen;
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
    {
      ready = [],
      best,
      shield = true,
      minigame = false,
      card = this.#taps.switch,
      bench,
      bubbles,
      clear = () => true,
      back = false,
    }: Choices = {},
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
    // throw itself plays and hides the HUD or the fight is back; as is a frame the caller says is a minigame, though no
    // tap here began it. The HUD hidden within `LEAD_IN_MS` of the tap is the throw beginning: live, Avalanche's wave of
    // ice hid it for two frames a second after the tap, and its minigame, ended there, went unswiped for 2.5s. A prompt
    // ends it whenever, the opponent's throw having come first.
    const begun = this.#tapped?.state === 'charged' && now - this.#tapped.at < LEAD_IN_MS;
    this.#fighting = state === 'battle' || state === 'charged' ? (this.#fighting ?? now) : undefined;
    const resumed = this.#fighting !== undefined && now - this.#fighting >= FIGHT_MS;

    if (state === 'shield' || state === 'switch' || (state === 'other' && !begun) || resumed) {
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

      // Judged whatever is found on the frame: the move playing out can be found as bubbles with no gap of `OVER_MS`.
      this.#over ||= back && this.#found !== undefined && this.#found.to - this.#found.from >= BUBBLES_MS;

      // A frame read again, the loop having come round before the next, is the same look rather than a second one. Told
      // by what is found on it rather than by the list, which the caller can make afresh for each turn.
      const seen = bubbles?.map((bubble) => bubble.swipe);

      if (seen && JSON.stringify(seen) !== JSON.stringify(this.#look?.bubbles)) {
        this.#before = this.#look;
        this.#look = { at: now, bubbles: seen };
      }

      const look = this.#look;
      const found = this.#minigame && !this.#over ? (bubbles ?? []) : [];
      const stretch = this.#found && now - this.#found.to < OVER_MS ? this.#found : undefined;
      const vivid = Math.max(stretch?.vivid ?? 0, ...found.map(({ share }) => share));
      this.#swiped = this.#swiped.filter(({ at }) => now - at < POP_MS);
      const popping = (bubble: Bubble) =>
        this.#swiped.some(
          (swiped) => bubble.share < POPPED * swiped.share && away(bubble.swipe, swiped.swipe, this.#screen) <= SWELL,
        );
      const aimed = look
        ? found
            .filter((bubble) => bubble.share >= Math.max(GONE * vivid, PALEST) && !popping(bubble))
            .map((bubble) => ({
              swipe: ahead(bubble.swipe, look, this.#before, now, SWIPE_MS, this.#screen),
              share: bubble.share,
            }))
        : [];
      const through = aimed.find((bubble) => clear(bubble.swipe));

      // A frame of blobs all too pale or popping still has the bubbles found, so that waiting through it does not end
      // them. Before any, it is a frame with none found, those of a move whose bubbles the finder misses swept in rows.
      if (this.#playing && (through || (found.length > 0 && aimed.length === 0 && stretch))) {
        this.#found = { from: stretch?.from ?? now, to: now, vivid };
      }

      if (through) {
        this.#swiped.push({ ...through, at: now });

        return { kind: 'swipe', from: through.swipe[0], to: through.swipe[1], ms: SWIPE_MS };
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
    this.#fighting = undefined;

    return { kind: 'tap', at: first, what: state };
  }
}
