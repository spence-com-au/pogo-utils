/** Switch prompts and faints: telling one of ours fainting, and the one sent in after it. */

import { type Image } from '../../core/png.mts';
import {
  battleAndBack,
  FIRST_BALL,
  fixture,
  flyingIn,
  ICONS,
  painted,
  play,
  recorder,
  type Scene,
  scripted,
  shieldsSpent,
  ULTRA,
} from './node/test-run.mts';
import { expect, test } from 'vitest';

/**
 * Latias faints to Glaceon, and the switch prompt reads as the fight for the odd frame as it slides in and out, as
 * Palkia's did replayed off a live run's video: a frame of it, 110ms of the fight, the prompt until it is tapped, and
 * as it goes, 90ms of the fight and a last frame of it. Ended by the first frame of the fight, the prompt was owed
 * nothing after it, and went untapped: live until the game's timer picked, here until the run ends `Lost`.
 */
test('answers a switch prompt that reads as the fight for a frame as it slides in and out', async () => {
  const latias = fixture('battle-latias');
  const prompt = fixture('switch-glaceon');
  const scenes: Record<string, Scene> = {
    ...battleAndBack(),
    fight: { frame: latias, swipes: { count: 10, to: 'sliding' } },
    sliding: { frame: prompt, lasts: { ms: 20, to: 'flicker' } },
    flicker: { frame: latias, lasts: { ms: 110, to: 'fainted' } },
    fainted: { frame: prompt, tap: { at: [0.33, 0.87], to: 'leaving' }, lasts: { ms: 3000, to: 'stuck' } },
    leaving: { frame: prompt, lasts: { ms: 500, to: 'fading' } },
    fading: { frame: latias, lasts: { ms: 90, to: 'gone' } },
    gone: { frame: prompt, lasts: { ms: 20, to: 'next' } },
    stuck: { frame: fixture('other-loss') },
    next: flyingIn(),
  };
  const { phone, clock, taps, strokes } = scripted(scenes, 'party');
  const report = recorder();

  expect(await play(phone, { mode: ULTRA, count: 1 }, clock, report)).toEqual({ battles: 1, won: 1, lost: 0 });

  const named = new Set(report.fights.map(({ own, opponent }) => `${own.species} against ${opponent.species}`));

  expect(taps).toEqual(['party', 'party', 'fainted', 'result']);
  expect(strokes.map(({ scene }) => scene)).toEqual(expect.arrayContaining(['flicker', 'fading']));
  expect(report.events.filter((line) => line.startsWith('own: ') && line.includes('fainted'))).toEqual([
    "own: Latias fainted; sending in Mamoswine: none safe from Glaceon's moves; hits hardest (Stone Edge)",
  ]);
  expect([...named].at(-1)).toBe('Mamoswine against Glaceon');
});

/**
 * What matches the switch prompt with all three of our Poké Balls red follows no faint, and is not answered as one: live,
 * a charged move's burst over a night field was, and Mewtwo was told as fainted for a battle it fought on in. Here the
 * prompt itself, its grey ball painted red, stands in for it, `recognise` no longer reading that burst as the prompt.
 */
test('answers no switch prompt while all three of our Poké Balls are red', async () => {
  const prompt = fixture('switch-glaceon');
  const ball = { x: Math.round(0.058 * prompt.width), y: Math.round(0.2026 * prompt.width) };
  const allRed = { ...prompt, data: prompt.data.slice() };

  for (let y = ball.y - 4; y <= ball.y + 4; y++) {
    for (let x = ball.x - 4; x <= ball.x + 4; x++) {
      allRed.data.set([220, 40, 40, 255], (y * allRed.width + x) * 4);
    }
  }

  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('battle-latias'), swipes: { count: 10, to: 'slate' } },
      slate: { frame: allRed, tap: { at: [0.33, 0.87], to: 'stuck' }, lasts: { ms: 3000, to: 'won' } },
      stuck: { frame: fixture('other-loss') },
    },
    'party',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  expect(taps).not.toContain('slate');
  expect(report.events.filter((line) => line.includes('fainted'))).toEqual([]);
});

/**
 * Latias leads and faints with no switch prompt to answer, as where the game's timer picks or the prompt goes
 * unrecognised: the battle comes back with one of our Poké Balls grey. Counted only off our taps, Latias stayed out to
 * the end of a live run, the next faint told against it.
 */
test('counts a faint off our Poké Balls where no switch prompt is answered for it', async () => {
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('battle-latias'), swipes: { count: 10, to: 'next' } },
      next: flyingIn(),
    },
    'party',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  const named = new Set(report.fights.map(({ own, opponent }) => `${own.species} against ${opponent.species}`));

  expect(report.events.filter((line) => line.startsWith('own: ') && line.includes('fainted'))).toEqual([
    'own: Latias fainted: one fewer of our Poké Balls',
  ]);
  expect([...named]).toEqual(['Latias against null', 'Latias against Glaceon', 'Mamoswine against Glaceon']);
});

/**
 * Kyogre leads, Hydro Pump and Avalanche read under its buttons, and faints with no switch prompt to answer, as where
 * the game sends the last one in, its timer picks or the prompt goes unrecognised: Mamoswine comes in with one of our
 * Poké Balls grey. Kept, Kyogre's moves would stand for Mamoswine's, and fitting none still standing, name neither.
 * Latias's icon stands for Kyogre's, there being no committed party with it.
 */
test('forgets the moves of one of ours fainting with no switch prompt', async () => {
  const icons = ICONS.map((icon) => ({ ...icon, species: icon.species === 'Latias' ? 'Kyogre' : icon.species }));
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('battle-two-unlit'), swipes: { count: 10, to: 'next' } },
      next: flyingIn(),
    },
    'party',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, icons, count: 1 }, clock, report);

  const fights = new Set(report.fights.map(({ own, moves }) => `${own.species}: ${moves.join(', ') || '?'}`));

  expect([...fights]).toEqual(['Kyogre: ?', 'Kyogre: Hydro Pump, Avalanche', 'Mamoswine: ?']);
});

/**
 * Latias leads with Hydro Pump read under its buttons, which none of our party can hold, as a label misread: live, our
 * name unread, `TIVE` beneath Xerneas's Moonblast read as Dive. It faints with no switch prompt, and Mamoswine comes in
 * with one of our Poké Balls grey. Counted only where the moves read fit one of ours, the faint went untold, and the
 * misread moves stood for Mamoswine's.
 */
test('counts a faint off our Poké Balls where the moves read fit none of ours', async () => {
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('battle-two-unlit'), swipes: { count: 10, to: 'next' } },
      next: flyingIn(),
    },
    'party',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  const fights = new Set(report.fights.map(({ own, moves }) => `${own.species}: ${moves.join(', ') || '?'}`));

  expect(report.events.filter((line) => line.startsWith('own: ') && line.includes('fainted'))).toEqual([
    'own: Latias fainted: one fewer of our Poké Balls',
  ]);
  expect([...fights]).toEqual(['Latias: ?', 'null: Hydro Pump, Avalanche', 'Mamoswine: ?']);
});

/**
 * Gengar leads, named in the HUD, and faints with no switch prompt to answer: one of our Poké Balls goes grey with the
 * HUD naming Gengar on for a second, as live it named Palkia through the switch prompt after Palkia fainted. Then one
 * nicknamed `##` comes in, a name matching no species, as Xerneas's `Xemeas` matched none. Merged as read, Gengar's
 * name stood for the one sent in for as long as it fought. Latias's icon stands for Gengar's, there being no committed
 * party with it.
 */
test('takes no read naming one of ours that has fainted for the one sent in', async () => {
  const icons = ICONS.map((icon) => ({ ...icon, species: icon.species === 'Latias' ? 'Gengar' : icon.species }));
  const gengar = fixture('battle-gengar-label-short');
  const grey = (image: Image) => painted(image, [105, 65, 68], FIRST_BALL);
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: gengar, swipes: { count: 10, to: 'fainting' } },
      fainting: { frame: grey(gengar), lasts: { ms: 1000, to: 'next' } },
      next: { frame: grey(fixture('battle-latias')), swipes: { count: 10, to: 'won' } },
    },
    'party',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, icons, count: 1 }, clock, report);

  const named = new Set(report.fights.map(({ own }) => `${own.species} at CP ${own.cp}`));

  expect(report.events.filter((line) => line.startsWith('own: ') && line.includes('fainted'))).toEqual([
    'own: Gengar fainted: one fewer of our Poké Balls',
  ]);
  expect([...named]).toEqual([
    'Gengar at CP null',
    'Gengar at CP 2392',
    'Mamoswine at CP null',
    'Mamoswine at CP 2458',
  ]);
});

/**
 * Gengar leads and faints as before, but the one sent in is a second Gengar, Mamoswine's icon standing for it, so the
 * HUD naming the fainted one's species is also naming the one out. Once the stale HUD's while has gone by, its reads
 * stand: dropped for naming a fainted species, the second Gengar's CP would never have been read.
 */
test('takes a read naming a fainted species once the HUD has had time to change', async () => {
  const icons = ICONS.map((icon) => ({
    ...icon,
    species: icon.species === 'Latias' || icon.species === 'Mamoswine' ? 'Gengar' : icon.species,
  }));
  const gengar = fixture('battle-gengar-label-short');
  const greyed = painted(gengar, [105, 65, 68], FIRST_BALL);
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: gengar, swipes: { count: 10, to: 'fainting' } },
      fainting: { frame: greyed, lasts: { ms: 1000, to: 'next' } },
      next: { frame: greyed, swipes: { count: 40, to: 'won' } },
    },
    'party',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, icons, count: 1 }, clock, report);

  const told = report.events.includes('own: Gengar fainted: one fewer of our Poké Balls');
  const after = report.fights.slice(-1).map(({ own }) => `${own.species} at CP ${own.cp}`);

  expect(told).toBe(true);
  expect(after).toEqual(['Gengar at CP 2392']);
});

/**
 * A shield prompt is tapped while we have a shield left, and left to run out once both are spent: tapped, it would be
 * a tap at a prompt with nothing behind it. Latias leads with both shields up, and again with both painted spent.
 */
test.each([
  ['both up', () => fixture('battle-latias'), ['prompt']],
  ['both spent', shieldsSpent, []],
])('with our shields %s, the shield prompt is tapped in %j', async (_, fight, tapped) => {
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fight(), swipes: { count: 10, to: 'prompt' } },
      prompt: { frame: fixture('shield-glaceon'), tap: { at: [0.5, 0.82], to: 'won' }, lasts: { ms: 3000, to: 'won' } },
    },
    'fight',
  );

  await play(phone, { mode: ULTRA, count: 1 }, clock);

  expect(taps.filter((scene) => scene === 'prompt')).toEqual(tapped);
});
