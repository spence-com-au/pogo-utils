/** The charged move's minigame: the swipes the run aims at its bubbles, and throws that never play out. */

import { bubbleSwipes, typeColour } from './minigame.mts';
import { type Point } from './layout.mts';
import {
  battleAndBack,
  fixture,
  FRAME_MS,
  painted,
  pasted,
  PILL,
  play,
  recorder,
  type Scene,
  scripted,
  shieldsSpent,
  ULTRA,
} from './node/test-run.mts';
import { expect, test } from 'vitest';

/**
 * Shadow Sneak thrown, its minigame's Ghost bubbles are swiped through rather than swept across in rows: every swipe in
 * it crosses the bubble low in the middle of `playing-minigame-giratina`.
 */
test('aims the minigame’s swipes at its bubbles', async () => {
  // Straight to Shadow Sneak's frame: the usual fight is Deoxys's, whose Zap Cannon would be read as the move thrown.
  const { phone, clock, strokes } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('charged-shadow-sneak'), tap: { at: [0.499, 0.889], to: 'minigame' } },
    },
    'fight',
  );

  expect(await play(phone, { mode: ULTRA, count: 1 }, clock)).toEqual({ battles: 1, won: 1, lost: 0 });

  const minigame = strokes.filter(({ scene }) => scene === 'minigame');

  expect(minigame.length).toBeGreaterThan(0);

  for (const { from, to } of minigame) {
    expect([from[1], to[1]].every((y) => y > 0.78 && y < 0.86)).toBe(true);
    expect(Math.min(from[0], to[0])).toBeLessThan(0.45);
    expect(Math.max(from[0], to[0])).toBeGreaterThan(0.45);
  }
});

/**
 * Avalanche played out in kept runs, too soon after the last of its bubbles for their gap to end them: under `98% used
 * Avalanche!`, our bar back, the white lines of the field found as its bubbles 0.3s on, with the button to flee, fading
 * in there, painted out with the night sky beside it; in another, the button back and our bar not yet, the white of
 * Kyogre's body found as them; and in that run again, the button fading in, its disc not yet white. And in a third,
 * `98% used Avalanche!` up before either, its bubbles left drawn as the move played out.
 */
test.each([
  ['our bar', () => painted(fixture('playing-banner-avalanche'), [3, 39, 122], [0.01, 0.26, 0.15, 0.41])],
  ['the button to flee', () => fixture('playing-flee-avalanche')],
  ['the button to flee fading in', () => fixture('playing-flee-fading-avalanche')],
  ['the banner', () => fixture('playing-banner-avalanche-bubbles')],
])('touches nothing once %s is back after the minigame, whatever is found as its bubbles', async (_, played) => {
  const { phone, clock, strokes } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('charged-avalanche'), tap: { at: [0.499, 0.889], to: 'minigame' } },
      minigame: { frame: fixture('playing-minigame-mamoswine'), lasts: { ms: 6000, to: 'played' } },
      played: { frame: played(), lasts: { ms: 1500, to: 'won' } },
    },
    'fight',
  );

  await play(phone, { mode: ULTRA, count: 1 }, clock);

  expect(strokes.some(({ scene }) => scene === 'minigame')).toBe(true);
  expect(strokes.filter(({ scene }) => scene === 'played')).toEqual([]);
});

/**
 * A throw waits for the fast move under way with its button lit, and a live run tapped it again a second on and told
 * the one throw twice. Whether the tap took or not, it is tried again each second the button stays lit, and told once.
 */
test.each([
  ['retaps a throw still waiting', { at: [0.499, 0.889] as Point, to: 'queued' }, ['fight', 'queued', 'result']],
  ['retries a tap that did not take', undefined, ['fight', 'fight', 'fight', 'fight', 'result']],
])('%s with the button still lit, telling the throw once', async (_, tap, tapped) => {
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('charged-shadow-sneak'), ...(tap && { tap }), lasts: { ms: 4000, to: 'minigame' } },
      queued: { frame: fixture('charged-shadow-sneak'), lasts: { ms: 1500, to: 'minigame' } },
    },
    'fight',
  );
  const report = recorder();

  expect(await play(phone, { mode: ULTRA, count: 1 }, clock, report)).toEqual({ battles: 1, won: 1, lost: 0 });
  expect(taps).toEqual(tapped);
  expect(report.events.filter((line) => line.startsWith('own: threw'))).toEqual(['own: threw Shadow Sneak']);
});

/**
 * Moltres against Charizard in GO Battle League, as the user recorded it on a Pixel 8 Pro: Fly's tap moves on to
 * `tapped`, its minigame or the prompt for Charizard's Air Cutter on the same turn, which plays and puts up its banner
 * before `after`. Fly's `Get Ready!` is `ready`, none of the recordings kept: Palkia's, off a run on the same phone,
 * pasted over the banner.
 */
function moltresFly(tapped: string, after: string): Record<string, Scene> {
  const fly = (to: string): Scene => ({ frame: fixture('charged-pixel8-fly'), tap: { at: [0.69, 0.895], to } });

  return {
    ...battleAndBack(),
    fight: fly(tapped),
    prompt: { frame: fixture('shield-pixel8-charizard'), lasts: { ms: 2000, to: 'away' } },
    away: { frame: fixture('other-vs-fade'), lasts: { ms: 5000, to: 'banner' } },
    banner: { frame: fixture('playing-banner-pixel8-charizard'), lasts: { ms: 2000, to: 'gap' } },
    gap: { frame: fixture('other-vs-fade'), lasts: { ms: 700, to: after } },
    ready: {
      frame: pasted(fixture('playing-banner-pixel8-charizard'), fixture('playing-ready-pixel8-palkia'), PILL),
      lasts: { ms: 800, to: 'minigame' },
    },
    relit: fly('minigame'),
    minigame: { frame: fixture('playing-minigame-pixel8-fly'), lasts: { ms: 6000, to: 'won' } },
  };
}

/** What is told of a throw: ours tapped again, thrown or not, and the opponent's. */
const throws = (events: readonly string[]) =>
  events.filter((line) => /^own: (threw|tap Fly|Fly)|threw a charged move$/.test(line));

/**
 * Where Air Cutter comes first, the tap can be dropped, Fly's button lit again once the field is back and the retap
 * thrown, or held back, its minigame following Air Cutter's banner with no tap of its own. Either way the one throw is
 * told once it plays, as one played at once is, and its minigame is swiped through its bubbles. Told at the tap, a
 * dropped tap would be two throws, and a held-back minigame would be swiped at as the fight.
 */
test.each([
  ['played', 'minigame', 'minigame', []],
  [
    'dropped',
    'prompt',
    'relit',
    ['opponent: Charizard threw a charged move', 'own: tap Fly again: its button still lit'],
  ],
  ['held back', 'prompt', 'minigame', ['opponent: Charizard threw a charged move']],
])('tells a throw %s once it plays, and swipes its minigame', async (_, tapped, after, before) => {
  const { phone, clock, strokes } = scripted(moltresFly(tapped, after), 'fight');
  const report = recorder();
  const chain = bubbleSwipes(
    fixture('playing-minigame-pixel8-fly'),
    typeColour(fixture('types/POKEMON_TYPE_FLYING')),
  )[0]?.swipe;

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  const last = strokes.filter(({ scene }) => scene === 'minigame').at(-1);

  expect(throws(report.events)).toEqual([...before, 'own: threw Fly']);
  expect(last && [last.from, last.to]).toEqual(chain);
});

/**
 * Held back, Fly's minigame is taken to have begun once its `Get Ready!` is read, and its bubbles are swiped from the
 * first frame they show on. Waiting out `PLAYING_MS` from the pill's first frame instead, it went 2.7s unswiped.
 */
test('swipes a held-back minigame from its Get Ready!', async () => {
  const { phone, clock, strokes, visits } = scripted(moltresFly('prompt', 'ready'), 'fight');
  const report = recorder();
  const chain = bubbleSwipes(
    fixture('playing-minigame-pixel8-fly'),
    typeColour(fixture('types/POKEMON_TYPE_FLYING')),
  )[0]?.swipe;

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  const begun = visits.find(({ scene }) => scene === 'minigame')?.at ?? NaN;
  const first = strokes.find(({ scene }) => scene === 'minigame');

  expect(throws(report.events)).toEqual(['opponent: Charizard threw a charged move', 'own: threw Fly']);
  expect(first && [first.from, first.to]).toEqual(chain);
  expect((first?.at ?? Infinity) - begun).toBeLessThan(FRAME_MS);
});

// Moltres faints to Air Cutter before Fly plays: lost, and not told as thrown by the next of ours as it fights on.
test('loses a throw where ours faints before it plays', async () => {
  const { phone, clock } = scripted(
    {
      ...moltresFly('prompt', 'minigame'),
      away: { frame: fixture('other-vs-fade'), lasts: { ms: 5000, to: 'fainted' } },
      fainted: { frame: fixture('switch-pixel8'), lasts: { ms: 2000, to: 'next' } },
      next: { frame: fixture('battle-pixel8-moltres-body'), lasts: { ms: 5000, to: 'won' } },
    },
    'fight',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  expect(throws(report.events)).toEqual([
    'opponent: Charizard threw a charged move',
    'own: Fly not thrown: Moltres fainted first',
  ]);
});

/**
 * Each stretch off the field told once the battle is back, with what showed: our Shadow Sneak's minigame and the move
 * playing after it, and, with our shields spent, a move of theirs that puts up no prompt. Shorter stretches and the
 * result's, which the battle never comes back from, are not told.
 */
test.each([
  [
    'charged-shadow-sneak',
    () => fixture('charged-shadow-sneak'),
    'run: off the battle for 10.1s: the minigame for our Shadow Sneak (5.1s), then the charged move playing (5.0s)',
  ],
  [
    'our shields spent',
    shieldsSpent,
    "run: off the battle for 5.0s: likely Glaceon's charged move, none of our shields left to prompt for",
  ],
])('tells how long the battle was off its field from %s', async (_, fight, said) => {
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: {
        frame: fight(),
        tap: { at: [0.499, 0.889], to: 'minigame' },
        swipes: { count: 10, to: 'away' },
      },
      minigame: { frame: fixture('playing-minigame-giratina'), swipes: { count: 40, to: 'away' } },
      away: { frame: fixture('other-vs-fade'), lasts: { ms: 5000, to: 'back' } },
      back: { frame: fixture('battle-deoxys'), swipes: { count: 10, to: 'blip' } },
      blip: { frame: fixture('other-vs-fade'), lasts: { ms: 1000, to: 'last' } },
      last: { frame: fixture('battle-deoxys'), swipes: { count: 10, to: 'won' } },
    },
    'fight',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  expect(report.events.filter((line) => line.includes('off the battle'))).toEqual([said]);
});
