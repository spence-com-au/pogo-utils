/** Countdowns, the league a run plays, the frames it keeps and what it says, and where it stops. */

import { type Image } from '../../core/png.mts';
import { type Meta } from './meta.mts';
import { BLACK_MS, Lost, LOST_MS } from './run.mts';
import {
  battleAndBack,
  charizardHit,
  fixture,
  GBL,
  league,
  painted,
  play,
  recorder,
  type Scene,
  sceneShowing,
  scripted,
  ULTRA,
} from './node/test-run.mts';
import { expect, test } from 'vitest';

/**
 * With none of our shields left, the opponent's throws one after another — each its countdown and its animation, the
 * fight never showing between — run longer than `LOST_MS`, as Sealeo's did against Blanche on a Pixel 4 XL (#580). The
 * countdown is the battle going on, so the run plays on to its end rather than stopping lost.
 */
test('waits out countdowns in a row for longer than the run takes to give up as lost', async () => {
  const throwing = (n: number, to: string): Record<string, Scene> => ({
    [`countdown${n}`]: { frame: fixture('other-pixel8-countdown'), lasts: { ms: 5000, to: `animation${n}` } },
    [`animation${n}`]: { frame: fixture('other-white'), lasts: { ms: 8000, to } },
  });
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('battle-pixel8-greninja'), swipes: { count: 10, to: 'countdown0' } },
      ...throwing(0, 'countdown1'),
      ...throwing(1, 'won'),
    },
    'fight',
  );

  expect(await play(phone, { mode: ULTRA, count: 1 }, clock)).toEqual({ battles: 1, won: 1, lost: 0 });
  expect(clock.now()).toBeGreaterThan(LOST_MS);
});

/**
 * The switch prompt carries a countdown too, as after Moltres fainted to a Garganacl, recorded off a Pixel 8 Pro. With
 * its grey Poké Ball painted red, no faint of ours accounts for the prompt, and the run takes it for `other`, as it does
 * a dark field that matches the prompt's slate. With none of our shields left, its countdown is still no throw.
 */
test('counts no throw off the countdown on a switch prompt taken for `other`', async () => {
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('battle-pixel8-greninja'), swipes: { count: 10, to: 'prompt' } },
      prompt: {
        frame: painted(fixture('switch-pixel8-countdown'), [200, 60, 60], [0.045, 0.19, 0.071, 0.215]),
        lasts: { ms: 3000, to: 'won' },
      },
    },
    'fight',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  expect(
    taps.filter((scene) => scene === 'prompt'),
    'the prompt was answered, so not taken for `other`',
  ).toEqual([]);
  expect(report.events.filter((line) => line.includes('threw a charged move'))).toEqual([]);
});

// Started mid-battle in GO Battle League, the party screen that states the league's cap never seen: every shield taken,
// even the one Charizard keeps in Training.
test('takes every shield in GO Battle League until the party screen has given the cap', async () => {
  const { phone, clock, taps } = scripted(
    {
      ...league(),
      ...charizardHit(fixture('shield-charizard-high'), true),
      result: { frame: fixture('menu-gbl-result-last'), tap: { at: [0.5, 0.935], to: 'collect' } },
      collect: { frame: fixture('menu-gbl-collect') },
    },
    'fight',
  );

  await play(phone, { mode: GBL, count: 1 }, clock);

  expect(taps.filter((scene) => scene === 'prompt')).toEqual(['prompt']);
});

// The same, but with the league's meta loaded: `--league ultra` gives the cap the party screen would have, so Charizard
// at 86% with one shield eats the hit as it does in Training.
test('takes the cap from the league named until the party screen gives it', async () => {
  const { phone, clock, taps } = scripted(
    {
      ...league(),
      ...charizardHit(fixture('shield-charizard-high'), true),
      result: { frame: fixture('menu-gbl-result-last'), tap: { at: [0.5, 0.935], to: 'collect' } },
      collect: { frame: fixture('menu-gbl-collect') },
    },
    'fight',
  );
  const report = recorder();
  const meta = { cup: 'all', cap: 2500, movesets: new Map() };

  await play(phone, { mode: GBL, meta, count: 1 }, clock, report);

  expect(taps.filter((scene) => scene === 'prompt')).toEqual([]);
  expect(report.events.filter((line) => line.includes(' shield'))).toEqual([
    'own: kept shield: Fire Blast would take ~48%, with 86% left; leaves ~38%, more than the ~20% of 10 fast moves ' +
      'before their next charged move',
  ]);
});

/** A meta in which Magmar is run with Karate Chop and `charged` alone. */
const magmarRun = (cup: string, charged: string): Meta => ({
  cup,
  cap: null,
  movesets: new Map([['Magmar', { fast: 'Karate Chop', fastMoves: ['Karate Chop'], chargedMoves: [charged] }]]),
});

// `--league 'Master League'` taps Master League: Mega Edition while it is on, which PvPoke ranks apart from the open
// league: Magmar run with Fire Punch in the one `--league` names, which would leave the shield kept, and Fire Blast in
// the one tapped. Its meta is loaded before the card is tapped, as the meta the shield at 86% with both left is judged
// by.
test('judges a shield by the meta of the league card tapped rather than of `--league`', async () => {
  const { phone, clock, taps } = scripted(
    {
      ...league(),
      ...charizardHit(fixture('shield-charizard-high')),
      league: { frame: fixture('menu-gbl-league'), tap: { at: [0.64, 0.57], to: 'party' } },
      result: { frame: fixture('menu-gbl-result-last'), tap: { at: [0.5, 0.935], to: 'collect' } },
      collect: { frame: fixture('menu-gbl-collect') },
    },
    'league',
  );
  const report = recorder();
  const asked: { league: string; taps: string[] }[] = [];

  const metaOf = (title: string) => {
    asked.push({ league: title, taps: [...taps] });

    return Promise.resolve(magmarRun('mega', 'Fire Blast'));
  };

  const mode = { mode: 'gbl', league: 'Master League' } as const;
  await play(phone, { mode, meta: magmarRun('all', 'Fire Punch'), metaOf, count: 1 }, clock, report);

  expect(asked).toEqual([{ league: 'master league mega edition', taps: [] }]);
  expect(taps.filter((scene) => scene === 'prompt')).toEqual(['prompt']);
  expect(report.events.filter((line) => line.includes(' shield'))).toEqual([
    expect.stringMatching(/^own: took shield: Fire Blast would take ~48%/),
  ]);
});

// The chooser comes round again with each set, and the same card is the meta already loaded.
test('loads the meta of a league card once, however many sets tap it', async () => {
  const { phone, clock, taps } = scripted(league(), 'map');
  const asked: string[] = [];

  const metaOf = (title: string) => {
    asked.push(title);

    return Promise.resolve(null);
  };

  await play(phone, { mode: GBL, metaOf, count: 2 }, clock);

  expect(taps.filter((scene) => scene === 'league')).toHaveLength(2);
  expect(asked).toEqual(['ultra league']);
});

/**
 * A second either side of the shield prompt is handed to `keep`, each frame once, with when it was first seen: the
 * fight before it and the prompt and the frame after it, but not the lead's three seconds earlier nor a frame first
 * shown past the second, each scene standing still on one.
 */
test('keeps the frames a second either side of a shield prompt', async () => {
  const scenes: Record<string, Scene> = {
    ...battleAndBack(),
    lead: { frame: fixture('battle-latias'), lasts: { ms: 3000, to: 'fight' }, still: true },
    fight: { frame: fixture('battle-charizard-magmar'), lasts: { ms: 500, to: 'prompt' }, still: true },
    prompt: { frame: fixture('shield-charizard-high'), lasts: { ms: 400, to: 'after' }, still: true },
    after: { frame: fixture('battle-charizard-magmar'), lasts: { ms: 800, to: 'later' }, still: true },
    later: { frame: fixture('battle-charizard-magmar'), lasts: { ms: 2000, to: 'won' }, still: true },
  };
  const { phone, clock } = scripted(scenes, 'lead');
  const kept: [string | undefined, number, string][] = [];

  await play(
    phone,
    { mode: ULTRA, count: 1, keep: (frame, at, event) => kept.push([sceneShowing(scenes, frame), at, event]) },
    clock,
  );

  // The last is `after`, which shows `fight`'s battle.
  expect(kept).toEqual([
    ['fight', 3080, 'shield'],
    ['prompt', 3630, 'shield'],
    ['fight', 4040, 'shield'],
  ]);
});

/**
 * What is read of each side through a battle: its CP off the HUD, its HP off its bar, how many shields we have, and the
 * opponent's energy counted off ours.
 */
test('says each side’s CP and HP, and how many shields we have left', async () => {
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('battle-one-shield'), swipes: { count: 10, to: 'prompt' } },
      prompt: { frame: fixture('shield-low'), lasts: { ms: 3000, to: 'won' } },
    },
    'fight',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  const percent = (hp: number | null) => (hp === null ? null : Math.round(hp * 100));
  const read = report.fights.map(({ own, opponent }) => [
    own.cp,
    percent(own.hp),
    opponent.cp,
    percent(opponent.hp),
    own.shields,
  ]);

  expect(read).toContainEqual([2495, 74, 2497, 51, 1]);
  expect(read.at(-1)).toEqual([2495, 9, 2497, 6, 1]);

  // The shield prompt is the opponent's charged move, told once however long it shows.
  expect(report.events.filter((line) => line.endsWith('threw a charged move'))).toEqual([
    `opponent: ${report.fights.at(-1)?.opponent.species ?? 'the opponent'} threw a charged move`,
  ]);

  // One frame of the fight shown throughout lands no hit, and the drop to 9% comes across the prompt, which pauses it.
  // Nothing is counted until the battle's first read is back to name the opponent.
  expect(new Set(report.fights.map(({ energy }) => energy && `${energy.energy} by ${energy.fast}`))).toEqual(
    new Set([undefined, '0 by Wing Attack']),
  );
});

test('stops, keeping its last frames, where nothing is recognised', async () => {
  const { phone, clock, taps } = scripted({ stuck: { frame: fixture('other-loss') } }, 'stuck');

  const lost = await play(phone, { mode: ULTRA }, clock).catch((error: unknown) => error);

  expect(lost).toBeInstanceOf(Lost);
  expect((lost as Lost).message).toBe(
    'nothing recognised for 20s; stopped rather than tap at a screen it does not know',
  );
  expect((lost as Lost).frames.length).toBeGreaterThan(0);
  expect(clock.now()).toBeGreaterThan(LOST_MS);
  expect(taps).toEqual([]);
});

/**
 * `image` drawn at `shade` of itself below Android's status bar, which ends 25 rows of a Pixel 8 Pro's 802 down: the
 * whole game as that phone has drawn it until the game was restarted, 224 for 255 (#974).
 */
function darker(image: Image, shade: number): Image {
  const data = image.data.slice();

  for (let i = Math.round((25 / 360) * image.width) * image.width * 4; i < data.length; i++) {
    data[i] = i % 4 === 3 ? (data[i] ?? 0) : Math.round((data[i] ?? 0) * shade);
  }

  return { ...image, data };
}

// The map so drawn has its Poké Ball too dark to be known by, and no word OCR knows: a run started there stops, and says
// why, where it said only that it did not know the screen.
test('stops on the map drawn darker, saying the game is', async () => {
  const { phone, clock, taps } = scripted({ map: { frame: darker(fixture('menu-pixel8-map'), 224 / 255) } }, 'map');

  const lost = await play(phone, { mode: ULTRA }, clock).catch((error: unknown) => error);

  expect(lost).toBeInstanceOf(Lost);
  expect((lost as Lost).message).toBe(
    "nothing recognised for 20s: the game is drawn 12% darker than Android's status bar over it, which its colours " +
      'are not read through; restart the game, or failing that the phone',
  );
  expect(taps).toEqual([]);
});

/**
 * The black a Pixel 8 Pro drew for 18.6s and more between a battle won against Candela and its result (#975), standing
 * still as the phone sends no frame of it, for `after` it and then on to `to`.
 */
const blackAfterWin = (to: string, after?: number): Record<string, Scene> => ({
  won: { frame: fixture('other-win'), screenshot: fixture('menu-unknown-medal'), lasts: { ms: 8000, to: 'black' } },
  black: {
    frame: fixture('other-pixel8-black'),
    still: true,
    ...(after !== undefined && { lasts: { ms: after, to } }),
  },
});

test('waits out the black between a battle won and its result for longer than it takes to give up as lost', async () => {
  const { phone, clock, taps } = scripted({ ...battleAndBack(), ...blackAfterWin('result', LOST_MS * 2) }, 'training');

  expect(await play(phone, { mode: ULTRA, count: 1 }, clock)).toEqual({ battles: 1, won: 1, lost: 0 });
  expect(taps.at(-1)).toBe('result');
});

test('stops where the black after a battle never ends, once it has held off giving up for as long as it may', async () => {
  const { phone, clock, visits } = scripted({ ...battleAndBack(), ...blackAfterWin('result') }, 'training');

  await expect(play(phone, { mode: ULTRA, count: 1 }, clock)).rejects.toBeInstanceOf(Lost);

  const lostAfter = clock.now() - (visits.find(({ scene }) => scene === 'black')?.at ?? NaN);

  expect(lostAfter).toBeGreaterThanOrEqual(BLACK_MS + LOST_MS);
  expect(lostAfter).toBeLessThan(BLACK_MS + LOST_MS + 1000);
});

// Black with no battle before it is no battle's end, and as lost as any screen not known.
test('stops where it starts on black as where nothing is recognised', async () => {
  const { phone, clock } = scripted({ black: { frame: fixture('other-pixel8-black'), still: true } }, 'black');

  await expect(play(phone, { mode: ULTRA }, clock)).rejects.toBeInstanceOf(Lost);
  expect(clock.now()).toBeLessThan(BLACK_MS);
});
