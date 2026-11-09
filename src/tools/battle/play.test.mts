import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { BOTTOM, place, type Point } from './layout.mts';
import { BENCH, BENCH_ANCHOR, Player, TAPS, type Action } from './play.mts';
import { BUTTON_XS, readyButtons, recognise, type State } from './recognise.mts';
import { streamSize } from './record-command.mts';
import { decodeFrames } from './node/stream.mts';

/** The size of the committed frames, a Pixel 4 XL's stream. */
const SIZE = streamSize({ width: 1440, height: 3040 });

/** Where the charged-move buttons sit: one move's centred, two moves' either side, as `readyButtons` reports them. */
const button = (x: number): Point => place([x, -0.2343], BOTTOM, SIZE);
const LEFT = button(BUTTON_XS[0]);
const CENTRE = button(BUTTON_XS[1]);
const RIGHT = button(BUTTON_XS[2]);

/**
 * The actions for a run of states, a frame every 33ms — 30 a second, as the stream sends them — with the one button of
 * a Pokémon with one charged move lit on every `charged` frame.
 */
function play(states: readonly State[], player = new Player(SIZE), from = 0): Action[] {
  return states.map((state, i) => player.next(state, from + i * 33, { ready: state === 'charged' ? [CENTRE] : [] }));
}

const taps = (actions: readonly Action[]) => actions.filter((action) => action.kind === 'tap');

const swipes = (actions: readonly Action[]) => actions.flatMap((action) => (action.kind === 'swipe' ? [action] : []));

/** Whether a point lies on the bench's switch buttons, or on any of the charged-move buttons. */
const onBench = ([x, y]: Point) => x > 0.8 && y > 0.53 && y < 0.7;
const onButton = ([x, y]: Point) =>
  [LEFT, CENTRE, RIGHT].some(([bx, by]) => Math.hypot(x - bx, (y - by) * (760 / 360)) < 0.12);

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
  expect(player.next('playing', 1033, { bubbles: [chain] })).toEqual({
    kind: 'swipe',
    from: chain[0],
    to: chain[1],
    ms: 80,
  });

  // Found again once the throw is taken to be playing, then the move playing out once its bubbles are over, until a
  // frame hides the HUD.
  player.next('playing', 2000, { minigame: true, bubbles: [chain] });
  const over = Array.from({ length: 60 }, (_, i) => player.next('playing', 3000 + i * 33, { bubbles: [] }));

  expect(over.every((action) => action.kind === 'wait')).toBe(true);
});

/**
 * `count` frames from `from` milliseconds, 33ms apart, each read as `playing` with `bubbles` found on it, and our bar
 * where `bar` says.
 */
const frames = (
  player: Player,
  from: number,
  count: number,
  bubbles: readonly (readonly [Point, Point])[],
  bar = false,
) => Array.from({ length: count }, (_, i) => player.next('playing', from + i * 33, { bubbles, bar }));

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
  player.next('playing', 3000, { minigame: true, bubbles: [chain] });
  frames(player, 3033, 60, [chain]);

  // A moment lost among them is not their end.
  expect(waits(frames(player, 5000, 9, []))).toBe(true);
  expect(frames(player, 5300, 20, [chain]).every((action) => action.kind === 'swipe')).toBe(true);

  frames(player, 5960, 42, []);

  expect(waits(frames(player, 7346, 19, [chunk]))).toBe(true);
});

// In a kept run, Close Combat's colour was found on Zamazenta's red body on and off for 1.8s after its bubbles, never
// more than 0.29s apart, as the move played out with our bar back under its `used` banner.
test('leaves alone what is found once our bar shows again, however closely it follows the bubbles', () => {
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
  player.next('playing', 3000, { minigame: true, bubbles: [chain] });
  frames(player, 3033, 60, [chain]);
  frames(player, 5013, 9, []);

  expect(frames(player, 5310, 6, [body]).every((action) => action.kind === 'swipe')).toBe(true);

  frames(player, 5508, 9, []);

  expect(waits(frames(player, 5805, 6, [body], true))).toBe(true);
  expect(waits(frames(player, 6003, 30, [body]))).toBe(true);
});

// Live, an Outrage was taken to be playing before its minigame began, the opponent's faint having hidden our buttons,
// and the fight, our bar in it, was found as its bubbles for 0.8s before `Get Ready!`.
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

  play(['charged', 'charged'], player);
  player.next('playing', 3000, { minigame: true, bubbles: [fight], bar: true });
  frames(player, 3033, 24, [fight], true);

  expect(waits(frames(player, 3825, 66, []))).toBe(true);
  expect(frames(player, 6003, 30, [chain]).every((action) => action.kind === 'swipe' && action.from === chain[0])).toBe(
    true,
  );
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

  expect(hidden.next('playing', 2000, { bubbles: [chain] })).toMatchObject({ from: chain[0] });

  const prompted = new Player(SIZE);

  play(['charged', 'charged', 'playing', 'shield', 'other', 'playing'], prompted);

  expect(prompted.next('playing', 2000, { bubbles: [chain] })).toEqual({ kind: 'wait' });
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
  player.next('playing', 1000, { minigame: true, bubbles: [chain] });
  player.next('battle', 1033, { bubbles: [] });
  player.next('battle', 1066, { bubbles: [] });

  expect(player.next('playing', 1100, { bubbles: [chain] })).toMatchObject({ from: chain[0] });

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

  expect(player.next('playing', 12_066, { bubbles: [chain] })).toMatchObject({ from: chain[0] });
});

// Live, an Outrage tapped went unthrown, Kyurem fainting to our fast move, and the shards of its faint read as bubbles.
test('sweeps rows where bubbles were found only before the throw was taken to be playing', () => {
  const player = new Player(SIZE);

  play(['charged', 'charged'], player);
  player.next('playing', 1500, {
    bubbles: [
      [
        [0.17, 0.59],
        [0.59, 0.51],
      ],
    ],
  });

  const late = player.next('playing', 3000, { bubbles: [] });

  expect(late.kind === 'swipe' && Math.abs(late.to[0] - late.from[0])).toBeGreaterThan(0.8);
});

test('sweeps rows through a minigame whose bubbles are never found, though the last one’s were', () => {
  const player = new Player(SIZE);
  const chain: [Point, Point] = [
    [0.17, 0.59],
    [0.59, 0.51],
  ];

  play(['charged', 'charged'], player);
  player.next('playing', 1000, { minigame: true, bubbles: [chain] });
  play(['other', 'battle', 'charged', 'charged'], player, 2000);

  // Bubbles not found once the lead-in is over, it sweeps the rows rather than not swipe at all.
  const late = player.next('playing', 5000, { bubbles: [] });

  expect(late.kind === 'swipe' && Math.abs(late.to[0] - late.from[0])).toBeGreaterThan(0.8);
});

test('fights once told to forget a minigame that is not coming, whatever was found as its bubbles', () => {
  const player = new Player(SIZE);
  const chain: [Point, Point] = [
    [0.4, 0.5],
    [0.89, 0.55],
  ];

  play(['charged', 'charged'], player);
  player.next('playing', 3000, { minigame: true, bubbles: [chain] });
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

  expect(player.next('playing', 12_000, { bubbles: [chain] })).toEqual({ kind: 'wait' });
  expect(player.next('playing', 12_033, { minigame: true, bubbles: [chain] })).toMatchObject({ from: chain[0] });
  expect(player.next('playing', 12_066, { bubbles: [chain] })).toMatchObject({ from: chain[0] });
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
] as const)('answers the %s prompt once it has held for %i frames', (state, frames) => {
  const actions = play(Array(20).fill(state));

  expect(actions.slice(0, frames - 1).every((action) => action.kind === 'wait')).toBe(true);
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
