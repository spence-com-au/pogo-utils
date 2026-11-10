import { createReadStream, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { decodePng } from '../../core/png.mts';
import { BOTTOM, place, type Point } from './layout.mts';
import { bubbleSwipes, typeColour, type Bubble } from './minigame.mts';
import { swipeAround, type Panel } from './overlay.mts';
import { ahead, BENCH, BENCH_ANCHOR, Player, TAPS, type Action } from './play.mts';
import { LAYOUTS, readyButtons, recognise, type State } from './recognise.mts';
import { streamSize } from './record-command.mts';
import { decodeFrames } from './node/stream.mts';

/** The size of the committed frames, a Pixel 4 XL's stream. */
const SIZE = streamSize({ width: 1440, height: 3040 });

/** Where the charged-move buttons sit: one move's centred, two moves' either side, as `readyButtons` reports them. */
const button = (x: number): Point => place([x, -0.2343], BOTTOM, SIZE);
const [[centreX], [leftX, rightX]] = LAYOUTS;
const LEFT = button(leftX);
const CENTRE = button(centreX);
const RIGHT = button(rightX);

/**
 * The actions for a run of states, a frame every 33ms — 30 a second, as the stream sends them — with the one button of
 * a Pokémon with one charged move lit on every `charged` frame.
 */
function play(states: readonly State[], player = new Player(SIZE), from = 0): Action[] {
  return states.map((state, i) => player.next(state, from + i * 33, { ready: state === 'charged' ? [CENTRE] : [] }));
}

const taps = (actions: readonly Action[]) => actions.filter((action) => action.kind === 'tap');

/** Bubbles found along `chains`, each as saturated as the rest. */
const live = (...chains: (readonly [Point, Point])[]): Bubble[] => chains.map((swipe) => ({ swipe, share: 1 }));

const swipes = (actions: readonly Action[]) => actions.flatMap((action) => (action.kind === 'swipe' ? [action] : []));

/** Whether a point lies on the bench's switch buttons, or on any of the charged-move buttons. */
const onBench = ([x, y]: Point) => x > 0.8 && y > 0.53 && y < 0.7;
const onButton = ([x, y]: Point) =>
  [LEFT, CENTRE, RIGHT].some(([bx, by]) => Math.hypot(x - bx, (y - by) * (760 / 360)) < 0.12);

const png = (path: string) => decodePng(readFileSync(new URL(`fixtures/${path}.png`, import.meta.url)));

/** Whether a swipe passes through a box, sampled along its length. */
const crosses = ([from, to]: readonly [Point, Point], [left, top, right, bottom]: readonly number[]) =>
  Array.from({ length: 21 }, (_, i) => i / 20).some((t) => {
    const [x, y] = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];

    return x >= (left ?? 0) && x <= (right ?? 1) && y >= (top ?? 0) && y <= (bottom ?? 1);
  });

test('swipes through the fight, clear of the bench and the charged-move buttons', () => {
  const actions = swipes(play(Array(10).fill('battle')));

  expect(actions).toHaveLength(10);

  for (const { from, to } of actions) {
    expect([from, to].some(onBench)).toBe(false);
    expect([from, to].some(onButton)).toBe(false);
  }
});

test('touches nothing through a charged move under way that is not ours, and fights once the buttons are back', () => {
  const actions = play(['battle', ...Array<State>(30).fill('playing'), 'battle']);

  expect(actions.slice(1, -1).every((action) => action.kind === 'wait')).toBe(true);
  expect(actions.at(-1)).toMatchObject({ kind: 'swipe', from: [0.7, 0.5] });
});

test('throws a charged move once it has held for two frames, and once only', () => {
  const actions = play(Array(20).fill('charged'));

  expect(actions[0]).toEqual({ kind: 'wait' });
  expect(taps(actions)).toEqual([{ kind: 'tap', at: CENTRE, what: 'charged' }]);
});

/**
 * A throw waits for the fast move under way, up to five 500ms turns, with its button lit, and a tap dropped looks the
 * same: lit a second on, the button is tapped again, rather than left to the end of the longest fast move with the
 * Pokémon perhaps fainting first.
 */
test('throws again each second the button stays lit', () => {
  expect(taps(play(Array(30).fill('charged')))).toHaveLength(1);
  expect(taps(play(Array(40).fill('charged')))).toHaveLength(2);
  expect(taps(play(Array(100).fill('charged')))).toHaveLength(4);
});

test('throws the next charged move at once after the last one’s throw has played', () => {
  const player = new Player(SIZE);
  const thrown = play(['charged', 'charged'], player);
  const next = play(['other', 'battle', 'charged', 'charged'], player, 1500);

  expect(taps([...thrown, ...next])).toHaveLength(2);
});

test('of two charged moves, throws the one that lit first', () => {
  const player = new Player(SIZE);

  player.next('charged', 0, { ready: [RIGHT] });
  const action = player.next('charged', 33, { ready: [LEFT, RIGHT] });

  expect(action).toEqual({ kind: 'tap', at: RIGHT, what: 'charged' });
});

test('of two charged moves lit together, throws the left', () => {
  const player = new Player(SIZE);

  player.next('charged', 0, { ready: [LEFT, RIGHT] });
  const action = player.next('charged', 33, { ready: [LEFT, RIGHT] });

  expect(action).toEqual({ kind: 'tap', at: LEFT, what: 'charged' });
});

test('fights on while only a weaker move is lit, and throws the best once it lights', () => {
  const player = new Player(SIZE);

  player.next('charged', 0, { ready: [RIGHT], best: LEFT[0] });
  const held = player.next('charged', 33, { ready: [RIGHT], best: LEFT[0] });

  expect(held.kind).toBe('swipe');
  expect(player.next('charged', 66, { ready: [LEFT, RIGHT], best: LEFT[0] })).toEqual({
    kind: 'tap',
    at: LEFT,
    what: 'charged',
  });
});

test('forgets when a button lit once it goes out', () => {
  const player = new Player(SIZE);

  // The right lights, then goes out as it is thrown; later the left lights, then the right again beside it.
  player.next('charged', 0, { ready: [RIGHT] });
  player.next('battle', 33, { ready: [] });
  player.next('charged', 2000, { ready: [LEFT] });

  expect(player.next('charged', 2033, { ready: [LEFT, RIGHT] })).toEqual({ kind: 'tap', at: LEFT, what: 'charged' });
});

test('swipes the lower field after a charged move, until the throw plays', () => {
  const player = new Player(SIZE);
  const fight = swipes(play(Array(4).fill('battle'), player));
  const minigame = swipes(play(['charged', 'charged', ...Array<State>(40).fill('playing')], player, 1000));
  const after = swipes(play(['other', ...Array<State>(4).fill('battle')], player, 7000));

  const lowest = (actions: readonly { from: Point; to: Point }[]) =>
    Math.max(...actions.flatMap(({ from, to }) => [from[1], to[1]]));

  expect(lowest(fight)).toBeLessThan(0.55);
  expect(lowest(minigame)).toBeGreaterThan(0.85);
  expect(lowest(after)).toBeLessThan(0.55);
});

test('swipes through the bubbles found in the minigame, waiting through its lead-in and once they are gone', () => {
  const player = new Player(SIZE);
  const chain: [Point, Point] = [
    [0.17, 0.59],
    [0.59, 0.51],
  ];

  play(['charged', 'charged'], player);

  // Past the hold after the tap, still in the minigame.
  expect(player.next('playing', 1000, { bubbles: [] })).toEqual({ kind: 'wait' });
  expect(player.next('playing', 1033, { bubbles: live(chain) })).toEqual({
    kind: 'swipe',
    from: chain[0],
    to: chain[1],
    ms: 80,
  });

  // Found again once the throw is taken to be playing, then the move playing out once its bubbles are over, until a
  // frame hides the HUD.
  player.next('playing', 2000, { minigame: true, bubbles: live(chain) });
  const over = Array.from({ length: 60 }, (_, i) => player.next('playing', 3000 + i * 33, { bubbles: [] }));

  expect(over.every((action) => action.kind === 'wait')).toBe(true);
});

/**
 * A throw begins as its button goes dark, having waited with it lit for the fast move under way, and its minigame's first
 * bubble can come more than 3s after: Palkia's Aqua Tail at night on a Pixel 8 Pro 2.64s after, its button dark 0.3s
 * after it lit, and Kyogre's Avalanche by day on a Pixel 4 XL 3.4s after. A row swept before the bubble holds up the
 * first swipe at it. Lit past `FIGHT_MS` after its tap, the button reads as the fight back, ending the minigame until
 * the run reads the throw's `Get Ready!`.
 */
test.each([
  ['at once', 300],
  ['after waiting for the fast move under way', 1900],
])('waits for the first bubble of a throw begun %s', (_, lit) => {
  const player = new Player(SIZE);
  const chain: [Point, Point] = [
    [0.17, 0.59],
    [0.59, 0.51],
  ];
  const held = Math.round(lit / 33);
  const dark = held * 33;

  play(Array<State>(held).fill('charged'), player);

  const before = Array.from({ length: 90 }, (_, i) =>
    player.next('playing', dark + i * 33, { minigame: i === 45, bubbles: [] }),
  );

  expect(before.every((action) => action.kind === 'wait')).toBe(true);
  expect(player.next('playing', dark + 3000, { bubbles: live(chain) })).toMatchObject({ from: chain[0] });
});

/**
 * Palkia's Aqua Tail against Candela, at night on a Pixel 8 Pro: the bubble found on the frame of 213.228s, alone, flew
 * on from 0.49 across on the frame of 213.129s towards the bottom left, and the frame of 213.397s, as the swipe aimed off
 * it lands, has it centred at 0.22 across and 0.80 down, 37 pixels wide at the finder's 180. Swiped where it was seen,
 * the swipe passes behind it.
 */
test('runs a swipe on ahead of a bubble seen moving, to where it is as the swipe lands', () => {
  const screen = { width: 360, height: 802 };
  const player = new Player(screen);
  const water = typeColour(png('types/POKEMON_TYPE_WATER'));
  const [before, seen] = ['playing-minigame-palkia-before', 'playing-minigame-palkia'].map((name) =>
    bubbleSwipes(png(name), water),
  );
  const lands: [number, number, number, number] = [0.22 - 0.1, 0.8 - 0.046, 0.22 + 0.1, 0.8 + 0.046];

  play(['charged', 'charged'], player);
  player.next('playing', 1000, { minigame: true, bubbles: before });
  const action = player.next('playing', 1099, { bubbles: seen });

  expect(action.kind === 'swipe' && crosses([action.from, action.to], lands)).toBe(true);
  expect(seen?.[0] && crosses(seen[0].swipe, lands)).toBe(false);

  // The same frame read again, the loop come round before the next, its swipes listed afresh: still one look.
  const again = player.next('playing', 1119, {
    bubbles: seen?.map(({ swipe: [from, to], share }) => ({ swipe: [from, to], share })),
  });

  expect(again.kind === 'swipe' && crosses([again.from, again.to], lands)).toBe(true);
});

/**
 * Palkia's Aqua Tail at night: on the frame of 216.271s its wing, which passes for Water's colour washed, is all that
 * is found, between bubbles found on the frames either side, the two at the right edge going unfound on it. The wing
 * holds less than half the share of the bubbles still to pop on the frame of 213.486s, of the same minigame.
 */
test('waits through Palkia’s wing found alone among the bubbles', () => {
  const player = new Player({ width: 360, height: 802 });
  const water = typeColour(png('types/POKEMON_TYPE_WATER'));
  const [bubbles, wing] = ['playing-minigame-palkia-popped', 'playing-minigame-palkia-wing'].map((name) =>
    bubbleSwipes(png(name), water),
  );

  play(['charged', 'charged'], player);

  expect(player.next('playing', 1000, { minigame: true, bubbles }).kind).toBe('swipe');
  expect(wing).not.toEqual([]);
  expect(player.next('playing', 1062, { bubbles: wing })).toEqual({ kind: 'wait' });
});

test.each([
  [
    'standing',
    [
      [0.4, 0.6],
      [0.5, 0.6],
    ],
    [
      [0.4, 0.6],
      [0.5, 0.6],
    ],
    100,
  ],
  [
    'one of a chain',
    [
      [0.1, 0.6],
      [0.6, 0.6],
    ],
    [
      [0.2, 0.6],
      [0.7, 0.6],
    ],
    100,
  ],
  [
    'swelling where one was, popped',
    [
      [0.4, 0.6],
      [0.5, 0.6],
    ],
    [
      [0.35, 0.6],
      [0.6, 0.6],
    ],
    100,
  ],
  [
    'seen moving only too long before',
    [
      [0.4, 0.6],
      [0.5, 0.6],
    ],
    [
      [0.5, 0.6],
      [0.6, 0.6],
    ],
    400,
  ],
] as const)('swipes a bubble %s where it was found', (_, was, swipe, apart) => {
  const screen = { width: 360, height: 760 };
  const look = { at: 1000 + apart, bubbles: [swipe] };

  expect(ahead(swipe, look, { at: 1000, bubbles: [was] }, look.at, 80, screen)).toEqual(swipe);
});

/**
 * A Water bubble flying in at 1.6 widths a second, first seen with its middle at 0.92 across, its swipe as found running
 * past `REACH`. Clamped before it was matched, it was shorter on the first frame than on the second, by more than
 * `SAME`, and was swiped where it was found.
 */
test('runs a swipe on ahead of a bubble flying in from the edge', () => {
  const screen = { width: 360, height: 760 };
  const was: [Point, Point] = [
    [0.79, 0.5],
    [1.05, 0.5],
  ];
  const swipe: [Point, Point] = [
    [0.63, 0.5],
    [0.89, 0.5],
  ];
  const [from, to] = ahead(swipe, { at: 1100, bubbles: [swipe] }, { at: 1000, bubbles: [was] }, 1100, 80, screen);

  expect(from[0]).toBeCloseTo(0.76);
  expect(to[0]).toBeCloseTo(0.76 - (1.6 * (120 + 80)) / 1000 - 0.26 / 2);
});

/**
 * PGSharp's star at the left edge, by a bubble listed before one standing clear of it. A swipe with both ends on the star
 * is not made, and the bubble it was aimed at would be chosen again on every frame, so each is judged as `ahead` aims it:
 * one flying left onto the star is clear of it as found, to 0.19 across, but aimed ahead runs from 0.06 to 0.05, both on
 * it; one flying right off it is on it at both ends as found, but aimed ahead runs clear to 0.39.
 */
test.each([
  [
    'standing on the star',
    [
      [0.05, 0.7],
      [0.06, 0.74],
    ],
    [
      [0.05, 0.7],
      [0.06, 0.74],
    ],
    0.4,
  ],
  [
    'flying onto the star',
    [
      [0.07, 0.72],
      [0.33, 0.72],
    ],
    [
      [-0.07, 0.72],
      [0.19, 0.72],
    ],
    0.4,
  ],
  [
    'flying off the star',
    [
      [-0.13, 0.72],
      [-0.03, 0.72],
    ],
    [
      [0.01, 0.72],
      [0.11, 0.72],
    ],
    0.06,
  ],
] as const)('judges a bubble %s by PGSharp’s overlay on its swipe as aimed', (_, was, found, from) => {
  const screen = { width: 360, height: 760 };
  const player = new Player(screen);
  const star: Panel = { name: 'star', box: [0, 0.7, 0.0875, 0.74] };
  const clear = (swipe: readonly [Point, Point]) => swipeAround(swipe, [star], screen) !== undefined;
  const standing: [Point, Point] = [
    [0.4, 0.5],
    [0.6, 0.5],
  ];

  play(['charged', 'charged'], player);
  player.next('playing', 1000, { minigame: true, bubbles: live(was, standing), clear });
  const action = player.next('playing', 1100, { bubbles: live(found, standing), clear });

  expect(action.kind === 'swipe' ? action.from[0] : NaN).toBeCloseTo(from);
});

/** Mewtwo's bubbles low on the screen run past where a swipe may reach as found, and are swiped only within it. */
test('no minigame swipe starts or ends on an edge Android takes for its own gestures', () => {
  const found = bubbleSwipes(png('playing-minigame-mewtwo'), typeColour(png('types/POKEMON_TYPE_PSYCHIC')));
  const made = found.map((bubble) => {
    const player = new Player(SIZE);

    play(['charged', 'charged'], player);

    return player.next('playing', 1000, { minigame: true, bubbles: [bubble] });
  });

  expect(found.flatMap(({ swipe }) => swipe).some(([x, y]) => x < 0.05 || x > 0.95 || y > 0.92)).toBe(true);
  expect(
    swipes(made)
      .flatMap(({ from, to }) => [from, to])
      .every(([x, y]) => x >= 0.05 && x <= 0.95 && y <= 0.92),
  ).toBe(true);
  expect(swipes(made)).toHaveLength(found.length);
});

/**
 * `count` frames from `from` milliseconds, 33ms apart, each read as `playing` with `bubbles` found on it, and what the
 * minigame hides back where `back` says.
 */
const frames = (player: Player, from: number, count: number, bubbles: readonly Bubble[], back = false) =>
  Array.from({ length: count }, (_, i) => player.next('playing', from + i * 33, { bubbles, back }));

const waits = (actions: readonly Action[]) => actions.every((action) => action.kind === 'wait');

// In a kept run, Avalanche's ice chunks were found as its bubbles on 19 frames as they struck the opponent, 1.4s after
// the last bubble.
test('leaves alone what is found once the bubbles have been gone a while, the move playing out', () => {
  const player = new Player(SIZE);
  const chain: [Point, Point] = [
    [0.17, 0.59],
    [0.59, 0.51],
  ];
  const chunk: [Point, Point] = [
    [0.6, 0.39],
    [0.68, 0.41],
  ];

  play(['charged', 'charged'], player);
  player.next('playing', 3000, { minigame: true, bubbles: live(chain) });
  frames(player, 3033, 60, live(chain));

  // A moment lost among them is not their end.
  expect(waits(frames(player, 5000, 9, []))).toBe(true);
  expect(frames(player, 5300, 20, live(chain)).every((action) => action.kind === 'swipe')).toBe(true);

  frames(player, 5960, 42, []);

  expect(waits(frames(player, 7346, 19, live(chunk)))).toBe(true);
});

// In a kept run, Close Combat's colour was found on Zamazenta's red body on and off for 1.8s after its bubbles, never
// more than 0.29s apart, as the move played out: the button to flee was back 0.19s after the last bubble, and our bar
// 1.56s after.
test('leaves alone what is found once what the minigame hides is back, however closely it follows the bubbles', () => {
  const player = new Player(SIZE);
  const chain: [Point, Point] = [
    [0.17, 0.59],
    [0.59, 0.51],
  ];
  const body: [Point, Point] = [
    [0.3, 0.62],
    [0.45, 0.7],
  ];

  play(['charged', 'charged'], player);
  player.next('playing', 3000, { minigame: true, bubbles: live(chain) });
  frames(player, 3033, 60, live(chain));
  frames(player, 5013, 9, []);

  expect(frames(player, 5310, 6, live(body)).every((action) => action.kind === 'swipe')).toBe(true);

  frames(player, 5508, 9, []);

  expect(waits(frames(player, 5805, 6, live(body), true))).toBe(true);
  expect(waits(frames(player, 6003, 30, live(body)))).toBe(true);
});

// Live, an Outrage was taken to be playing before its minigame began, the opponent's faint having hidden our buttons,
// and the fight, its button to flee and our bar in it, was found as its bubbles for 0.8s before `Get Ready!`.
test('swipes the bubbles of a minigame taken to be playing before it began', () => {
  const player = new Player(SIZE);
  const fight: [Point, Point] = [
    [0.3, 0.45],
    [0.4, 0.47],
  ];
  const chain: [Point, Point] = [
    [0.17, 0.59],
    [0.59, 0.51],
  ];

  const found = [{ swipe: fight, share: 1.15 }];

  play(['charged', 'charged'], player);
  player.next('playing', 3000, { minigame: true, bubbles: found, back: true });
  frames(player, 3033, 24, found, true);

  expect(waits(frames(player, 3825, 66, []))).toBe(true);

  // Paler than half what was found before `Get Ready!`, the bubbles are judged by their own share.
  expect(
    frames(player, 6003, 30, [{ swipe: chain, share: 0.55 }]).map((action) => action.kind === 'swipe' && action.from),
  ).toEqual(Array.from({ length: 30 }, () => chain[0]));
});

// Palkia's wing passes for Water's colour washed, and a bubble popped pales before it goes: either can be all that is
// found on a frame among the bubbles. Waited through, it still has them found, as it did swiped, which `OVER_MS` was
// measured with.
test('waits through what is paler than half the bubbles found, though it keeps them found', () => {
  const player = new Player(SIZE);
  const chain: [Point, Point] = [
    [0.17, 0.59],
    [0.59, 0.51],
  ];
  const wing: Bubble = {
    swipe: [
      [0.28, 0.32],
      [0.33, 0.4],
    ],
    share: 0.4,
  };

  play(['charged', 'charged'], player);
  player.next('playing', 3000, { minigame: true, bubbles: live(chain) });
  frames(player, 3033, 60, live(chain));

  expect(waits(frames(player, 5013, 20, [wing]))).toBe(true);
  expect(frames(player, 5673, 5, live(chain)).every((action) => action.kind === 'swipe')).toBe(true);
});

/**
 * Palkia's wing at night, alone on the frame, as it was for a quarter of a second before the first bubble of Spacial
 * Rend and of Aqua Tail, with nothing yet found to judge it by; then Aqua Tail's bubbles.
 */
test('waits through Palkia’s wing found before the first bubble', () => {
  const player = new Player({ width: 360, height: 802 });
  const water = typeColour(png('types/POKEMON_TYPE_WATER'));
  const [wing, bubbles] = ['playing-minigame-palkia-wing', 'playing-minigame-palkia-before'].map((name) =>
    bubbleSwipes(png(name), water),
  );

  play(['charged', 'charged'], player);

  expect(wing).not.toEqual([]);
  expect(player.next('playing', 1000, { minigame: true, bubbles: wing })).toEqual({ kind: 'wait' });
  expect(player.next('playing', 1100, { bubbles })).toMatchObject({ kind: 'swipe' });
});

// A bubble swiped swells and pales where it was before it goes: on a frame of Close Combat, two so popped were all that
// was found, at 0.6 of Fighting's share. Another found there as saturated as the one swiped is a bubble come since, and
// one paler elsewhere is no bubble swiped.
test('waits through a bubble it popped found alone, but not through another found where it was', () => {
  const player = new Player(SIZE);
  const bubble: [Point, Point] = [
    [0.4, 0.6],
    [0.6, 0.6],
  ];
  const popped: Bubble = {
    swipe: [
      [0.38, 0.61],
      [0.66, 0.62],
    ],
    share: 0.6,
  };
  const elsewhere: Bubble = {
    swipe: [
      [0.2, 0.85],
      [0.3, 0.85],
    ],
    share: 0.6,
  };

  play(['charged', 'charged'], player);

  expect(player.next('playing', 3000, { minigame: true, bubbles: live(bubble) })).toMatchObject({ kind: 'swipe' });
  expect(player.next('playing', 3150, { bubbles: [popped] })).toEqual({ kind: 'wait' });
  expect(player.next('playing', 3250, { bubbles: live(bubble) })).toMatchObject({ kind: 'swipe' });
  expect(player.next('playing', 3350, { bubbles: [popped, elsewhere] })).toMatchObject({ from: elsewhere.swipe[0] });

  // The last bubble swiped there gone, what is found there is no longer it.
  expect(player.next('playing', 3700, { bubbles: [popped] })).toMatchObject({ kind: 'swipe' });
});

// The swipe's trail often hides the bubble it popped on the look after, which is then found again paler, its share
// risen from nothing: Close Combat's, on the frame of 275.655s of a kept run, held 0.67 against the 1.08 swiped there,
// the look before having found only a bubble elsewhere. Found again, it is still that bubble popping.
test('waits through a bubble it popped found again after a look that lost it', () => {
  const player = new Player(SIZE);
  const swiped: Bubble = {
    swipe: [
      [0.44, 0.71],
      [0.58, 0.71],
    ],
    share: 1.08,
  };
  const elsewhere: Bubble = {
    swipe: [
      [0.2, 0.4],
      [0.36, 0.4],
    ],
    share: 1.01,
  };
  const popped: Bubble = {
    swipe: [
      [0.4, 0.68],
      [0.53, 0.68],
    ],
    share: 0.67,
  };

  play(['charged', 'charged'], player);

  expect(player.next('playing', 3000, { minigame: true, bubbles: [swiped] })).toMatchObject({ kind: 'swipe' });
  expect(player.next('playing', 3170, { bubbles: [elsewhere] })).toMatchObject({ kind: 'swipe' });
  expect(player.next('playing', 3335, { bubbles: [popped] })).toEqual({ kind: 'wait' });
});

// A blob kept only for the emblem followed past its box is a bubble the finder found in part, or one popped swelling
// where a swipe just went with the trail's head for an emblem, as saturated as a bubble. Near the swipe it is waited
// through; elsewhere, or once the swipe is too old to be popping, it is swiped.
test('waits through a blob found by its cut emblem near a swipe it just made, but not elsewhere', () => {
  const player = new Player(SIZE);
  const swiped: Bubble = {
    swipe: [
      [0.4, 0.6],
      [0.6, 0.6],
    ],
    share: 1,
  };
  const near: Bubble = {
    swipe: [
      [0.62, 0.72],
      [0.78, 0.72],
    ],
    share: 0.98,
    cut: true,
  };
  const far: Bubble = {
    swipe: [
      [0.2, 0.9],
      [0.3, 0.9],
    ],
    share: 0.98,
    cut: true,
  };

  play(['charged', 'charged'], player);

  expect(player.next('playing', 3000, { minigame: true, bubbles: [swiped] })).toMatchObject({ kind: 'swipe' });
  expect(player.next('playing', 3150, { bubbles: [near] })).toEqual({ kind: 'wait' });
  expect(player.next('playing', 3250, { bubbles: [near, far] })).toMatchObject({ from: far.swipe[0] });

  // Uncut, the same blob is a bubble come since.
  const whole = { swipe: near.swipe, share: near.share };
  const again = new Player(SIZE);
  play(['charged', 'charged'], again);
  again.next('playing', 3000, { minigame: true, bubbles: [swiped] });

  expect(again.next('playing', 3150, { bubbles: [whole] })).toMatchObject({ kind: 'swipe' });
});

// Live, Avalanche's wave of ice hid the HUD for two frames a second after the tap, and the minigame ended there went
// unswiped until the run took the throw to be playing, 2.5s of its bubbles lost; a prompt still ends it.
test('keeps the minigame a tap began through the HUD hidden as it begins, but not through a prompt', () => {
  const chain: [Point, Point] = [
    [0.17, 0.59],
    [0.59, 0.51],
  ];
  const hidden = new Player(SIZE);

  play(['charged', 'charged', 'playing', 'other', 'other', 'playing'], hidden);

  expect(hidden.next('playing', 2000, { bubbles: live(chain) })).toMatchObject({ from: chain[0] });

  const prompted = new Player(SIZE);

  play(['charged', 'charged', 'playing', 'shield', 'other', 'playing'], prompted);

  expect(prompted.next('playing', 2000, { bubbles: live(chain) })).toEqual({ kind: 'wait' });
});

// Live, Close Combat played out with the HUD up throughout, and the minigame, still waited on, left 2.6s of the fight
// unplayed once it was back; the fight read for a frame or two inside the minigame ends nothing.
test('ends the minigame once the fight has held for a moment, though nothing hid the HUD', () => {
  const player = new Player(SIZE);
  const chain: [Point, Point] = [
    [0.17, 0.59],
    [0.59, 0.51],
  ];

  play(['charged', 'charged'], player);
  player.next('playing', 1000, { minigame: true, bubbles: live(chain) });
  player.next('battle', 1033, { bubbles: [] });
  player.next('battle', 1066, { bubbles: [] });

  expect(player.next('playing', 1100, { bubbles: live(chain) })).toMatchObject({ from: chain[0] });

  const back = Array.from({ length: 11 }, (_, i) => player.next('battle', 5000 + i * 33, { bubbles: [] }));

  expect(back.slice(0, 9).every((action) => action.kind === 'wait')).toBe(true);
  expect(back.at(-1)).toMatchObject({ kind: 'swipe', from: [0.15, 0.42] });
  expect(player.minigame).toBe(false);
});

// The run says a throw is playing on one frame only, which can be one of the few inside a charged move that read as
// the fight: the minigame begins all the same, or the rest of it would be waited through.
test('begins a minigame that no tap here began on the frame it is told of, though it reads as the fight', () => {
  const player = new Player(SIZE);
  const chain: [Point, Point] = [
    [0.17, 0.59],
    [0.59, 0.51],
  ];

  play(['charged', 'charged', 'shield', 'other'], player);
  player.next('playing', 12_000);
  player.next('battle', 12_033, { minigame: true, bubbles: [] });

  expect(player.next('playing', 12_066, { bubbles: live(chain) })).toMatchObject({ from: chain[0] });
});

// Live, an Outrage tapped went unthrown, Kyurem fainting to our fast move, and the shards of its faint read as bubbles.
test('sweeps rows where bubbles were found only before the throw was taken to be playing', () => {
  const player = new Player(SIZE);

  play(['charged', 'charged'], player);
  player.next('playing', 1500, {
    bubbles: live([
      [0.17, 0.59],
      [0.59, 0.51],
    ]),
  });

  const late = player.next('playing', 4000, { bubbles: [] });

  expect(late.kind === 'swipe' && Math.abs(late.to[0] - late.from[0])).toBeGreaterThan(0.8);
});

test('sweeps rows through a minigame whose bubbles are never found, though the last one’s were', () => {
  const player = new Player(SIZE);
  const chain: [Point, Point] = [
    [0.17, 0.59],
    [0.59, 0.51],
  ];

  play(['charged', 'charged'], player);
  player.next('playing', 1000, { minigame: true, bubbles: live(chain) });
  play(['other', 'battle', 'charged', 'charged'], player, 2000);

  // Bubbles not found once the lead-in is over, it sweeps the rows rather than not swipe at all.
  const late = player.next('playing', 6000, { bubbles: [] });

  expect(late.kind === 'swipe' && Math.abs(late.to[0] - late.from[0])).toBeGreaterThan(0.8);
});

/**
 * Looked for in Ice's colour, Giratina's Shadow Sneak shows nothing but a blob at 0.36: no bubble, and before any has
 * been found none to wait through for, so its rows are swept once the lead-in is over.
 */
test('sweeps rows through a minigame where nothing as saturated as a bubble is ever found', () => {
  const player = new Player(SIZE);
  const pale = bubbleSwipes(png('playing-minigame-giratina'), typeColour(png('types/POKEMON_TYPE_ICE')));

  play(['charged', 'charged'], player);

  expect(pale).not.toEqual([]);
  expect(player.next('playing', 1000, { minigame: true, bubbles: pale })).toEqual({ kind: 'wait' });

  const late = player.next('playing', 4000, { bubbles: pale });

  expect(late.kind === 'swipe' && Math.abs(late.to[0] - late.from[0])).toBeGreaterThan(0.8);
});

test('fights once told to forget a minigame that is not coming, whatever was found as its bubbles', () => {
  const player = new Player(SIZE);
  const chain: [Point, Point] = [
    [0.4, 0.5],
    [0.89, 0.55],
  ];

  play(['charged', 'charged'], player);
  player.next('playing', 3000, { minigame: true, bubbles: live(chain) });
  expect(player.next('playing', 3033, { bubbles: [] })).toEqual({ kind: 'wait' });

  player.forget();

  expect(player.minigame).toBe(false);
  expect(player.next('battle', 3066)).toMatchObject({ kind: 'swipe', from: [0.15, 0.42] });
});

// A throw the opponent's came ahead of plays after theirs, its minigame coming long after the tap that began the last,
// and their move and our `Get Ready!` before it touched not at all.
test('waits out the opponent’s move, then swipes a minigame that no tap here began, until the throw plays', () => {
  const player = new Player(SIZE);
  const chain: [Point, Point] = [
    [0.4, 0.5],
    [0.89, 0.55],
  ];

  play(['charged', 'charged', 'shield', 'other'], player);

  expect(player.next('playing', 12_000, { bubbles: live(chain) })).toEqual({ kind: 'wait' });
  expect(player.next('playing', 12_033, { minigame: true, bubbles: live(chain) })).toMatchObject({ from: chain[0] });
  expect(player.next('playing', 12_066, { bubbles: live(chain) })).toMatchObject({ from: chain[0] });
  expect(player.minigame).toBe(true);

  player.next('other', 20_000);
  expect(player.minigame).toBe(false);
});

test('swipes nothing for a moment after a charged move is tapped', () => {
  const player = new Player(SIZE);
  const tapped = play(['charged', 'charged'], player);
  const after = play(Array<State>(30).fill('battle'), player, 66);
  const waited = after.findIndex((action) => action.kind === 'swipe');

  expect(taps(tapped)).toHaveLength(1);
  expect(after.slice(0, waited).every((action) => action.kind === 'wait')).toBe(true);
  expect(66 + waited * 33 - 33).toBeGreaterThanOrEqual(700);
});

test.each([
  ['shield', 3],
  ['switch', 3],
] as const)('answers the %s prompt once it has held for %i frames', (state, held) => {
  const actions = play(Array(20).fill(state));

  expect(actions.slice(0, held - 1).every((action) => action.kind === 'wait')).toBe(true);
  expect(taps(actions)).toEqual([{ kind: 'tap', at: place(TAPS[state], BOTTOM, SIZE), what: state }]);
});

test('sends in the card it is told to', () => {
  const player = new Player(SIZE);
  const card: Point = [0.67, 0.87];
  const actions = Array.from({ length: 5 }, (_, i) => player.next('switch', i * 33, { card }));

  expect(taps(actions)).toEqual([{ kind: 'tap', at: card, what: 'switch' }]);
});

test('taps the bench card it is told to in place of a swipe or a lit move, but not through a charged move', () => {
  const player = new Player(SIZE);
  const bench = place(BENCH[0], BENCH_ANCHOR, SIZE);

  expect(player.next('battle', 0, { bench })).toEqual({ kind: 'tap', at: bench, what: 'bench' });
  player.next('charged', 33, { ready: [CENTRE], bench });
  expect(player.next('charged', 66, { ready: [CENTRE], bench }), 'the energy kept').toMatchObject({ what: 'bench' });
  expect(player.next('charged', 99, { ready: [CENTRE] })).toMatchObject({ what: 'charged' });
  expect(player.next('battle', 1000, { bench }), 'the minigame').toMatchObject({ kind: 'swipe' });
  player.forget();
  expect(player.next('playing', 2000, { bench }), 'a charged move under way').toEqual({ kind: 'wait' });
});

test('leaves a declined shield prompt to run out, and does not swipe at it', () => {
  const player = new Player(SIZE);
  const actions = Array.from({ length: 20 }, (_, i) => player.next('shield', i * 33, { shield: false }));

  expect(actions.every((action) => action.kind === 'wait')).toBe(true);
});

test('ignores a prompt that shows for a frame as it slides in', () => {
  expect(taps(play(['battle', 'switch', 'battle', 'battle']))).toEqual([]);
});

test('does nothing on any other screen', () => {
  expect(play(Array(10).fill('other')).every((action) => action.kind === 'wait')).toBe(true);
});

/**
 * A recording does not answer the taps made over it: the button in `charge.h264` stays lit for 38 frames, until the
 * person playing threw it, so a tap a second after the first is the retry doing its job. What the replay does show is
 * the first tap landing on the button's second lit frame, and none following sooner than a second apart.
 */
test('throws the charged move in a recorded battle as soon as it is ready', async () => {
  const player = new Player(SIZE);
  const timed: { action: Action; state: State; at: number }[] = [];
  let i = 0;

  for await (const frame of decodeFrames(
    createReadStream(fileURLToPath(new URL('fixtures/charge.h264', import.meta.url))),
    SIZE,
  )) {
    const state = recognise(frame);
    const at = i++ * 33;

    timed.push({ action: player.next(state, at, { ready: readyButtons(frame) }), state, at });
  }

  const tapped = timed.filter(({ action }) => action.kind === 'tap');
  const lit = timed.filter(({ state }) => state === 'charged');

  expect(new Set(tapped.map(({ action }) => JSON.stringify(action)))).toEqual(
    new Set([JSON.stringify({ kind: 'tap', at: CENTRE, what: 'charged' })]),
  );
  expect(tapped[0]?.at).toBe(lit[1]?.at);

  for (const [before, after] of tapped.slice(0, -1).map((tap, n) => [tap, tapped[n + 1]] as const)) {
    expect((after?.at ?? Infinity) - before.at).toBeGreaterThanOrEqual(1000);
  }
});
