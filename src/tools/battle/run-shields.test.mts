/** The hits counted off our bar, and when the run takes a shield or keeps it. */

import { type Phone } from './phone.mts';
import {
  battleAndBack,
  charizard,
  CHARIZARD_BUBBLE,
  CHARIZARD_HARD_HIT,
  charizardHit,
  fixture,
  OUR_SECOND_SHIELD,
  painted,
  play,
  recorder,
  scripted,
  sneaking,
  ULTRA,
} from './node/test-run.mts';
import { expect, test } from 'vitest';

/**
 * Charizard's bar full, then with the "Go, Magmar!" bubble over its end as `battle-charizard-magmar` shows it, which
 * read the bar 93%, and full again: a 5-point drop that the count took for a fast move of Magmar's. Under the bubble
 * the bar is not read, and nothing is counted off it.
 */
test('counts no hit off our bar while the "Go, X!" bubble dims its end', async () => {
  const bubbled = fixture('battle-charizard-magmar');
  const full = painted(bubbled, [119, 250, 189], CHARIZARD_BUBBLE);
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: full, lasts: { ms: 1000, to: 'bubble' } },
      bubble: { frame: bubbled, lasts: { ms: 1000, to: 'after' } },
      after: { frame: full, lasts: { ms: 1000, to: 'won' } },
    },
    'fight',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  expect(new Set(report.fights.flatMap(({ energy }) => (energy ? [energy.energy] : [])))).toEqual(new Set([0]));
});

/** A ring drawn where a touch landed, as the thin near-white line it draws across a bar, over Charizard's at 37%. */
const CHARIZARD_RING = [60 / 360, 242 / 360, 62 / 360, 250 / 360];

/**
 * Charizard's bar full, then with a touch's ring drawn across it, which read the bar 37% to where the ring crosses it,
 * and full again: a drop the count took for Magmar's fast moves. With the fill showing again past the ring, the bar is
 * not read, and nothing is counted off it.
 */
test('counts no hit off our bar while a touch’s ring crosses it', async () => {
  const full = painted(fixture('battle-charizard-magmar'), [119, 250, 189], CHARIZARD_BUBBLE);
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: full, lasts: { ms: 1000, to: 'ring' } },
      ring: { frame: painted(full, [240, 248, 245], CHARIZARD_RING), lasts: { ms: 1000, to: 'after' } },
      after: { frame: full, lasts: { ms: 1000, to: 'won' } },
    },
    'fight',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  expect(new Set(report.fights.flatMap(({ energy }) => (energy ? [energy.energy] : [])))).toEqual(new Set([0]));
});

/**
 * Giratina against Mamoswine as `sneaking` paints them, three of Mamoswine's Powder Snow taking 4 points of our bar
 * each from 96%, and each read for a frame 5 points short of where it leaves the bar, as our Kyogre's read 35% for a
 * frame where Snorlax's Lick left it at 40%. Each counts to where the bar rests, 8 energy a Powder Snow; counted to the
 * short frame, the first left the low there, below where the second left the bar.
 */
test('counts each hit off our bar to where it rests, past a frame reading it short as the hit lands', async () => {
  const { scenes, ours } = sneaking([96], {});
  const unlit = (px: number) => painted(ours(px), [107, 105, 112], [140 / 360, 635 / 360, 220 / 360, 676 / 360]);
  const { phone, clock } = scripted(
    {
      ...scenes,
      fight: { frame: unlit(96), lasts: { ms: 1000, to: 'short1' } },
      short1: { frame: unlit(87), lasts: { ms: 100, to: 'hit1' } },
      hit1: { frame: unlit(92), lasts: { ms: 1000, to: 'short2' } },
      short2: { frame: unlit(83), lasts: { ms: 100, to: 'hit2' } },
      hit2: { frame: unlit(88), lasts: { ms: 1000, to: 'short3' } },
      short3: { frame: unlit(79), lasts: { ms: 100, to: 'hit3' } },
      hit3: { frame: unlit(84), lasts: { ms: 1000, to: 'won' } },
    },
    'party',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  expect(report.fights.at(-1)?.energy).toEqual({ energy: 24, fast: 'Powder Snow' });
});

/**
 * Charizard, CP 2495, against Magmar, CP 1826, in the Ultra League, as played live: Magmar's hardest charged move, Fire
 * Blast, takes about half of Charizard, and its fast moves 2 points. Fire Blast's 80 energy is nine of them at 9 apiece
 * and one more for margin, 20% of Charizard. At 86% with both shields, the 38% Fire Blast would leave is less than
 * twice that, and the shield is taken; with one, it is more, and the shield kept. At 9% it is taken against a hit that
 * would faint Charizard, where live it was not and Charizard fainted to it. Each says why.
 */
test.each([
  [
    'shield-charizard-high',
    false,
    ['prompt'],
    'own: took shield: Fire Blast would take ~48%, with 86% left; leaves ~38%, no more than 2 × the ~20% of 10 ' +
      'fast moves before their next charged move',
  ],
  [
    'shield-charizard-high',
    true,
    [],
    'own: kept shield: Fire Blast would take ~48%, with 86% left; leaves ~38%, more than the ~20% of 10 fast moves ' +
      'before their next charged move',
  ],
  ['shield-low', false, ['prompt'], 'own: took shield: Fire Blast would take ~48%, with 9% left; that would faint us'],
])('at %s with one shield spent %s, the shield is tapped in %j', async (prompt, spent, tapped, said) => {
  const { phone, clock, taps } = scripted({ ...battleAndBack(), ...charizardHit(fixture(prompt), spent) }, 'fight');
  const report = recorder();

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  expect(taps.filter((scene) => scene === 'prompt')).toEqual(tapped);
  expect(report.events.filter((line) => line.includes(' shield'))).toEqual([said]);
});

/**
 * The prompt at 86% with one shield spent as above, but straight after the fight starts, before any of Magmar's fast
 * moves has been measured on Charizard: the model's stands in, and the shield is kept as against one measured.
 */
test('keeps the shield on a fast move modelled where none has been measured', async () => {
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      ...charizardHit(fixture('shield-charizard-high'), true),
      fight: {
        frame: painted(charizard(), [111, 81, 118], OUR_SECOND_SHIELD),
        swipes: { count: 10, to: 'prompt' },
      },
    },
    'fight',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  expect(taps.filter((scene) => scene === 'prompt')).toEqual([]);
  expect(report.events.filter((line) => line.includes(' shield'))).toEqual([
    'own: kept shield: Fire Blast would take ~48%, with 86% left; leaves ~38%, more than the ~20% of 10 fast moves ' +
      'before their next charged move, Ember modelled at ~2% a hit',
  ]);
});

/**
 * The prompt at 86% with both shields, after 11s of the fight in which only four of Magmar's fast moves are seen on
 * Charizard's bar, 2 points each: counted, 36 energy and one more for margin afford Fire Punch's 40 alone. The fight's
 * time affords 11 of them at 1s each, 99, so the hit is priced as the hardest of every move, Fire Blast, and the shield
 * taken, as the prompt above has it, where the count alone priced Fire Punch and kept it.
 */
test('prices the hit by every move the fight’s time affords, where the count off our bar affords fewer', async () => {
  const fight = charizard();
  const short = (points: number) =>
    painted(fight, [52, 86, 97], [(116 - points) / 360, 243 / 360, 117 / 360, 248 / 360]);
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fight, lasts: { ms: 1500, to: 'hit1' } },
      hit1: { frame: short(2), lasts: { ms: 2500, to: 'hit2' } },
      hit2: { frame: short(4), lasts: { ms: 2500, to: 'hit3' } },
      hit3: { frame: short(6), lasts: { ms: 2500, to: 'hit4' } },
      hit4: { frame: short(8), lasts: { ms: 2000, to: 'prompt' } },
      prompt: {
        frame: fixture('shield-charizard-high'),
        tap: { at: [0.5, 0.82], to: 'won' },
        lasts: { ms: 3000, to: 'won' },
      },
    },
    'fight',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  expect(taps.filter((scene) => scene === 'prompt')).toEqual(['prompt']);
  expect(report.events.filter((line) => line.includes(' shield'))).toEqual([
    'own: took shield: Fire Blast would take ~48%, with 86% left; leaves ~38%, no more than 2 × the ~20% of 10 ' +
      'fast moves before their next charged move',
  ]);
});

/**
 * The prompt at 9% as above, but with Magmar's fast move measured taking 8 points of Charizard rather than 2: the next
 * faints Charizard whether or not it shields Fire Blast, so the shield is kept for the next Pokémon, as a low Galarian
 * Corsola's was not in the Baltimore 2027 Regional grand final, which shielded Discharge and fainted to the Volt Switch
 * after it.
 */
test('keeps the shield where their next fast move, measured, faints us anyway', async () => {
  const fight = charizard();
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      ...charizardHit(fixture('shield-low')),
      hit: { frame: painted(fight, [52, 86, 97], CHARIZARD_HARD_HIT), swipes: { count: 10, to: 'prompt' } },
    },
    'fight',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  expect(taps.filter((scene) => scene === 'prompt')).toEqual([]);
  expect(report.events.filter((line) => line.includes(' shield'))).toEqual([
    'own: kept shield: their next fast move faints us anyway, one taking ~8% with 9% left',
  ]);
});

/**
 * The same prompt at 86% with one shield left, every other frame of it reading as 9%, as Dialga's bar flickered
 * between 64% and 2% live: a misread snapping back is no hit, so the shield is kept, the 38% Fire Blast would leave
 * outlasting Magmar's fast moves before its next.
 */
test('keeps the shield through a prompt whose bar flickers low', async () => {
  const high = fixture('shield-charizard-high');
  const low = fixture('shield-low');
  const { phone, clock, taps } = scripted({ ...battleAndBack(), ...charizardHit(high, true) }, 'fight');
  let frames = 0;
  const flickering: Phone = {
    ...phone,
    frame: () => {
      const frame = phone.frame();

      return frame?.data === high.data && frames++ % 2 === 1 ? low : frame;
    },
  };
  const report = recorder();

  await play(flickering, { mode: ULTRA, count: 1 }, clock, report);

  expect(taps.filter((scene) => scene === 'prompt')).toEqual([]);
  expect(report.events.filter((line) => line.includes(' shield'))).toEqual([
    'own: kept shield: Fire Blast would take ~48%, with 86% left; leaves ~38%, more than the ~20% of 10 fast moves ' +
      'before their next charged move',
  ]);
});

/**
 * The same flicker, but each frame reading 9% stays the latest for two turns of the loop, as a frame does whenever the
 * next takes longer than a turn to come: read again, the misread is no second reading agreeing with it.
 */
test('keeps the shield through a prompt whose low frame is read twice', async () => {
  const high = fixture('shield-charizard-high');
  const low = fixture('shield-low');
  const { phone, clock, taps } = scripted({ ...battleAndBack(), ...charizardHit(high, true) }, 'fight');
  let frames = 0;
  const lingering: Phone = {
    ...phone,
    frame: () => {
      const frame = phone.frame();

      return frame?.data === high.data && frames++ % 4 >= 2 ? low : frame;
    },
  };
  const report = recorder();

  await play(lingering, { mode: ULTRA, count: 1 }, clock, report);

  expect(taps.filter((scene) => scene === 'prompt')).toEqual([]);
  expect(report.events.filter((line) => line.includes(' shield'))).toEqual([
    'own: kept shield: Fire Blast would take ~48%, with 86% left; leaves ~38%, more than the ~20% of 10 fast moves ' +
      'before their next charged move',
  ]);
});

// Charizard against Quaquaval: the banner after the prompt names Quaquaval's move, which is kept for the battle.
test('learns the move the banner after a shield prompt names', async () => {
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('battle-one-shield'), swipes: { count: 10, to: 'prompt' } },
      prompt: { frame: fixture('shield-low'), lasts: { ms: 3000, to: 'banner' } },
      banner: { frame: fixture('playing-banner-quaquaval'), lasts: { ms: 2000, to: 'won' } },
    },
    'fight',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  expect(report.events).toContain('opponent: Quaquaval has Aqua Jet');
});

/**
 * Moltres against Greninja in GO Battle League with none of our shields left, as recorded off a Pixel 8 Pro: Greninja's
 * Hydro Cannon puts up no prompt, only its countdown, which is counted as its throw, once for all its frames, and is
 * followed by the banner naming the move. With our shields still up, as against Typhlosion, a prompt is what a throw
 * shows, and a countdown without one is not counted.
 */
test.each([
  ['battle-pixel8-greninja', ['opponent: Greninja threw a charged move: none of our shields left to prompt for']],
  ['battle-pixel8-moltres-wing', []],
])('after %s, the countdown counts as a throw in %j', async (fight, threw) => {
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture(fight), swipes: { count: 10, to: 'countdown' } },
      countdown: { frame: fixture('other-pixel8-countdown'), lasts: { ms: 3000, to: 'banner' } },
      banner: { frame: fixture('playing-banner-pixel8-greninja'), lasts: { ms: 2000, to: 'won' } },
    },
    'fight',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  expect(report.events.filter((line) => line.includes('threw a charged move'))).toEqual(threw);
  expect(taps.filter((scene) => scene === 'countdown')).toEqual([]);

  if (threw.length > 0) {
    expect(report.events).toContain('opponent: Greninja has Hydro Cannon');
  }
});
