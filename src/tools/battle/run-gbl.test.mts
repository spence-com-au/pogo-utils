/** GO Battle League sets, PGSharp's toolbar over what the run reads, and how soon the run plays on. */

import { readFileSync } from 'node:fs';
import { Lost } from './run.mts';
import {
  battleAndBack,
  fixture,
  flyingIn,
  GBL,
  league,
  play,
  recorder,
  type Scene,
  sceneShowing,
  scripted,
  ULTRA,
} from './node/test-run.mts';
import { expect, test } from 'vitest';

// The party's first card is tapped for its moves only the first time round: the same cards the second time are not read
// again.
test('plays GO Battle League battles from the map, waiting out matchmaking', async () => {
  const { phone, clock, taps } = scripted(league(), 'map');

  expect(await play(phone, { mode: GBL, count: 2 }, clock)).toEqual({
    battles: 2,
    won: 0,
    lost: 2,
  });
  expect(taps).toEqual([
    ...['map', 'main', 'tab', 'welcome', 'league', 'party', 'party', 'charged', 'result'],
    ...['league', 'party', 'charged', 'result'],
  ]);
});

// The reward encounter's Poké Ball is left alone: GO Battle League does not come back to the map of itself.
test('taps no Poké Ball once a GO Battle League battle has been played', async () => {
  const { phone, clock, taps } = scripted(
    { ...league(), result: { frame: fixture('menu-gbl-result'), tap: { at: [0.5, 0.854], to: 'map' } } },
    'tab',
  );

  await expect(play(phone, { mode: GBL, count: 2 }, clock)).rejects.toBeInstanceOf(Lost);
  expect(taps.filter((scene) => scene === 'map')).toEqual([]);
});

/** PGSharp's toolbar open over a Pixel 4 XL, as `uiautomator dump` wrote it. */
const TOOLBAR = readFileSync(new URL('fixtures/views-pixel4xl-toolbar.xml', import.meta.url), 'utf8');

/** GO Battle League's scenes with PGSharp's toolbar open over those `named`. */
const toolbarOver = (...named: string[]): Record<string, Scene> =>
  Object.fromEntries(
    Object.entries(league()).map(([name, scene]) => [
      name,
      named.includes(name) ? { ...scene, views: TOOLBAR } : scene,
    ]),
  );

test('refuses to start with PGSharp’s toolbar open over what it reads, tapping nothing', async () => {
  const { phone, clock, taps } = scripted(toolbarOver('party'), 'party');

  await expect(play(phone, { mode: GBL, count: 1 }, clock)).rejects.toThrow(
    /^PGSharp's toolbar covers .*: collapse it to its star or hide the overlay\./,
  );
  expect(taps).toEqual([]);
});

// The toolbar opened during the first battle, over every screen after it, found as it ends: the run stops before it
// taps anything there, even with the dump taking the 4s it takes on a phone, as long as the taps to the next battle.
test('stops between battles once PGSharp’s toolbar comes to cover what it reads', async () => {
  const { phone, clock, taps } = scripted(toolbarOver('result', 'league'), 'party', undefined, 4000);

  await expect(play(phone, { mode: GBL, count: 2 }, clock)).rejects.toThrow(/^PGSharp's toolbar covers /);
  expect(taps).toEqual(['party', 'party', 'charged']);
});

// After the last battle wanted nothing more is read, so the toolbar opened over the result costs the run nothing.
test('finishes a run whose PGSharp toolbar opens during its last battle', async () => {
  const { phone, clock, taps } = scripted(toolbarOver('result', 'league'), 'party', undefined, 4000);

  expect(await play(phone, { mode: GBL, count: 1 }, clock)).toEqual({
    battles: 1,
    won: 0,
    lost: 1,
  });
  expect(taps).toEqual(['party', 'party', 'charged', 'result']);
});

test('stops at the end of a GO Battle League set, leaving its reward to be collected', async () => {
  const { phone, clock, taps } = scripted(
    {
      ...league(),
      result: { frame: fixture('menu-gbl-result-last'), tap: { at: [0.5, 0.935], to: 'collect' } },
      collect: { frame: fixture('menu-gbl-collect') },
    },
    'party',
  );

  expect(await play(phone, { mode: GBL, count: 3 }, clock)).toEqual({
    battles: 1,
    won: 1,
    lost: 0,
  });
  expect(taps).toEqual(['party', 'party', 'charged', 'result']);
});

/**
 * A faint, then black, then GO Battle League's card with no result between, as #563's second battle ended live: each is
 * counted, its result unread, and the card after the last is left alone rather than its BATTLE tapped for another.
 */
test('counts a GO Battle League battle the game ends without a result', async () => {
  const { phone, clock, taps } = scripted(
    { ...league(), won: { frame: fixture('other-vs-fade'), lasts: { ms: 3000, to: 'tab' } } },
    'party',
  );
  const report = recorder();

  expect(await play(phone, { mode: GBL, count: 2 }, clock, report)).toEqual({ battles: 2, won: 0, lost: 0 });
  expect(taps).toEqual(['party', 'party', 'charged', 'tab', 'welcome', 'league', 'party', 'charged']);
  expect(report.events.filter((line) => /^run: battle \d (?!started)/.test(line))).toEqual([
    'run: battle 1 finished, with no result',
    'run: battle 2 finished, with no result',
  ]);
});

// The set's last battle ending without a result, on a card with no battle left: counted before the run stops there.
test('counts a set’s last battle the game ends without a result', async () => {
  const { phone, clock } = scripted(
    {
      ...league(),
      won: { frame: fixture('other-vs-fade'), lasts: { ms: 3000, to: 'collect' } },
      collect: { frame: fixture('menu-gbl-collect') },
    },
    'party',
  );

  expect(await play(phone, { mode: GBL, count: 3 }, clock)).toEqual({
    battles: 1,
    won: 0,
    lost: 0,
  });
});

// The Battle tab sliding in, its BATTLE caught not yet green by the first read: the second finds it lit, and plays.
test('plays on where GO Battle League shows BATTLE greyed for one read only', async () => {
  const { phone, clock, taps } = scripted(
    { ...league(), opening: { frame: fixture('menu-gbl-collect'), lasts: { ms: 3000, to: 'tab' } } },
    'opening',
  );

  expect(await play(phone, { mode: GBL, count: 1 }, clock)).toEqual({
    battles: 1,
    won: 0,
    lost: 1,
  });
  expect(taps[0]).toBe('tab');
});

/**
 * Zeraora leads and faints to Glaceon. Of Latias and Gyarados, Glaceon hits Latias super effectively and not Gyarados,
 * so Gyarados goes in, off the prompt's second card. The first tap does not land, and the retap a second later goes to
 * the same card: decided again, with Gyarados already taken to be out, it went to Latias's. A retap that misses runs on
 * into a screen nothing recognises, so a regression ends `Lost` rather than tapping at the prompt for ever.
 *
 * The faint is caught once, on the prompt's first frame, by the prompt and by the Poké Balls it leaves in view, so the
 * frames kept are the prompt's two, each scene standing still on one: the fight's was first seen more than a second
 * before it, and Mamoswine's more than a second after. Each is kept at its time on the run's clock, 6.52s of it the
 * first card's tap for the selection screen, which these scenes never open: looked for twice, then the party screen
 * read afresh.
 */
test('retaps the card it chose when the first tap on the switch prompt does not land', async () => {
  const scenes: Record<string, Scene> = {
    ...battleAndBack(),
    party: { frame: fixture('menu-party-full'), tap: { at: [0.5, 0.87], to: 'loading' } },
    fight: { frame: fixture('battle-latias'), swipes: { count: 10, to: 'fainted' }, still: true },
    fainted: { frame: fixture('switch-glaceon'), lasts: { ms: 600, to: 'again' }, still: true },
    again: {
      frame: fixture('switch-glaceon'),
      tap: { at: [0.67, 0.87], to: 'next' },
      lasts: { ms: 3000, to: 'stuck' },
      still: true,
    },
    stuck: { frame: fixture('other-loss') },
    next: { ...flyingIn(), still: true },
  };
  const { phone, clock, taps } = scripted(scenes, 'party');
  const report = recorder();
  const kept: [string | undefined, number, string][] = [];

  expect(
    await play(
      phone,
      { mode: ULTRA, count: 1, keep: (frame, at, event) => kept.push([sceneShowing(scenes, frame), at, event]) },
      clock,
      report,
    ),
  ).toEqual({ battles: 1, won: 1, lost: 0 });

  // The second is `again`, 600ms on, which shows `fainted`'s prompt.
  expect(kept).toEqual([
    ['fainted', 13850, 'faint-own'],
    ['fainted', 14460, 'faint-own'],
  ]);
  expect(taps.filter((scene) => scene === 'fainted' || scene === 'again')).toEqual(['fainted', 'again']);
  expect(report.events.filter((line) => line.includes('sending in'))).toEqual([
    "own: Zeraora fainted; sending in Gyarados: the only one safe from Glaceon's moves",
  ]);
  expect(report.events.filter((line) => line.startsWith('run: battle 1'))).toEqual([
    'run: battle 1 started',
    'run: battle 1 won',
  ]);
});

/**
 * An opponent's charged move takes the battle off the screen for 2.2s: long enough for a menu read to start, its
 * screenshot due a second later at 3.5s. The battle is back at 3.2s, and is played from then, not from when the read
 * is done — which, awaited, held the fast moves up after every charged move.
 */
test('plays on as soon as the battle is back, without waiting for a menu read', async () => {
  const { phone, clock, strokes } = scripted(
    {
      fight: { frame: fixture('battle-deoxys'), lasts: { ms: 1000, to: 'pause' } },
      pause: { frame: fixture('other-vs-fade'), lasts: { ms: 2200, to: 'back' } },
      back: { frame: fixture('battle-deoxys'), lasts: { ms: 1000, to: 'gone' } },
      gone: { frame: fixture('other-white') },
    },
    'fight',
  );

  await expect(play(phone, { mode: ULTRA }, clock)).rejects.toBeInstanceOf(Lost);

  const resumed = strokes.find(({ scene }) => scene === 'back');

  expect(resumed?.at).toBeGreaterThanOrEqual(3200);
  expect(resumed?.at).toBeLessThan(3400);
});

/**
 * The battle's names and labels take 2s to read here, a second a band, from its first frame. The fight is swiped
 * throughout, one swipe straight after another from that frame on, and Sneasel is named only once the read is back.
 */
test('plays on while the battle’s names are read, rather than wait for them', async () => {
  const { phone, clock, strokes } = scripted(
    {
      fight: { frame: fixture('battle-deoxys'), lasts: { ms: 4000, to: 'gone' } },
      gone: { frame: fixture('other-white') },
    },
    'fight',
    () => 1000,
  );
  let named: { at: number; strokes: number } | undefined;

  await expect(
    play(phone, { mode: ULTRA }, clock, {
      event: () => {},
      status: ({ fight }) => {
        if (fight?.opponent.species === 'Sneasel') {
          named ??= { at: clock.now(), strokes: strokes.length };
        }
      },
    }),
  ).rejects.toBeInstanceOf(Lost);

  const before = strokes.slice(0, named?.strokes).map(({ at }) => at);
  const gaps = before.slice(1).map((at, i) => at - (before[i] ?? 0));

  expect(named?.at).toBeGreaterThanOrEqual(2000);
  expect(before[0]).toBe(0);
  expect(before.length).toBeGreaterThan(1);
  expect(new Set(gaps).size, 'swiped evenly, none held up').toBe(1);
});

test('stops on a Battle tab whose Training card never shows, rather than scroll it for ever', async () => {
  const { phone, clock, taps } = scripted(
    {
      main: { frame: fixture('menu-main'), tap: { at: [0.777, 0.5975], to: 'tab' } },
      tab: { frame: fixture('menu-battle-league') },
    },
    'main',
  );

  const lost = await play(phone, { mode: ULTRA }, clock).catch((error: unknown) => error);

  expect(lost).toBeInstanceOf(Lost);
  expect(taps).toEqual(['main']);
});
