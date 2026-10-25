import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { BOTTOM, place } from './layout.mts';
import { BENCH, BENCH_ANCHOR, Player, TAPS, type Action, type Point } from './play.mts';
import { BUTTON_XS, readyButtons, recognise, type State } from './recognise.mts';
import { decodeFrames, streamSize } from './stream.mts';

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

test('throws a charged move once it has held for two frames, and once only', () => {
  const actions = play(Array(20).fill('charged'));

  expect(actions[0]).toEqual({ kind: 'wait' });
  expect(taps(actions)).toEqual([{ kind: 'tap', at: CENTRE, what: 'charged' }]);
});

/**
 * A throw waits for the fast move under way, up to five 500ms turns, with its button lit: a tap a second later was the
 * same throw counted twice. Lit past the longest fast move, the first tap did not take.
 */
test('throws again only if the button is still lit past the longest fast move', () => {
  expect(taps(play(Array(80).fill('charged')))).toHaveLength(1);
  expect(taps(play(Array(100).fill('charged')))).toHaveLength(2);
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
  const minigame = swipes(play(['charged', 'charged', ...Array<State>(40).fill('battle')], player, 1000));
  const after = swipes(play(['other', ...Array<State>(4).fill('battle')], player, 3000));

  const lowest = (actions: readonly { from: Point; to: Point }[]) =>
    Math.max(...actions.flatMap(({ from, to }) => [from[1], to[1]]));

  expect(lowest(fight)).toBeLessThan(0.55);
  expect(lowest(minigame)).toBeGreaterThan(0.85);
  expect(lowest(after)).toBeLessThan(0.55);
});

test('swipes through the bubbles found in the minigame, and waits for them through its lead-in', () => {
  const player = new Player(SIZE);
  const chain: [Point, Point] = [
    [0.17, 0.59],
    [0.59, 0.51],
  ];

  play(['charged', 'charged'], player);

  // Past the hold after the tap, still in the minigame.
  expect(player.next('battle', 1000, { bubbles: [] })).toEqual({ kind: 'wait' });
  expect(player.next('battle', 1033, { bubbles: [chain] })).toEqual({
    kind: 'swipe',
    from: chain[0],
    to: chain[1],
    ms: 80,
  });

  // Bubbles not found once the lead-in is over, it sweeps the rows rather than not swipe at all.
  const late = player.next('battle', 3000, { bubbles: [] });

  expect(late.kind).toBe('swipe');
  expect(late).not.toMatchObject({ from: chain[0] });
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

test('taps the bench card it is told to in place of a swipe, but not through the minigame', () => {
  const player = new Player(SIZE);
  const bench = place(BENCH[0], BENCH_ANCHOR, SIZE);

  expect(player.next('battle', 0, { bench })).toEqual({ kind: 'tap', at: bench, what: 'bench' });
  player.next('charged', 33, { ready: [CENTRE], bench });
  expect(player.next('charged', 66, { ready: [CENTRE], bench })).toMatchObject({ what: 'charged' });
  expect(player.next('battle', 99, { bench }), 'the hold after a throw').toEqual({ kind: 'wait' });
  expect(player.next('battle', 1000, { bench }), 'the minigame').toMatchObject({ kind: 'swipe' });
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
 * The button in `charge.h264` stays lit for 38 frames, until the person playing threw it, and then goes dark before the
 * throw plays: tapped on its second lit frame, it is tapped once, as a throw waiting on a fast move would be.
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

  expect(tapped.map(({ action }) => action)).toEqual([{ kind: 'tap', at: CENTRE, what: 'charged' }]);
  expect(tapped[0]?.at).toBe(lit[1]?.at);
});
