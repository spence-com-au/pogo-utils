/** Switching ours in and out: when it switches to a counter or a resister, and when it stays in. */

import { type GameData } from '../../core/game-master.mts';
import { type Image } from '../../core/png.mts';
import { BENCH, BENCH_ANCHOR } from './play.mts';
import { place } from './layout.mts';
import { type Meta } from './meta.mts';
import {
  battleAndBack,
  DATA,
  FIRST_BALL,
  fixture,
  flyingIn,
  HELD,
  ICONS,
  minigameNoneFainted,
  painted,
  pasted,
  play,
  recorder,
  type Scene,
  scripted,
  sneaking,
  THEIR_BALLS,
  ULTRA,
} from './node/test-run.mts';
import { expect, test } from 'vitest';

/** The same Golem read by its type icons, Rock and Electric: an Alolan one, nothing of which threatens Gengar. */
test('stays in when the type icons show a form that does not threaten ours', async () => {
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      party: { frame: fixture('menu-party-full'), tap: { at: [0.5, 0.87], to: 'loading' } },
      loading: { frame: fixture('other-vs-fade'), lasts: { ms: 4000, to: 'glaceon' } },
      glaceon: { frame: fixture('battle-latias'), swipes: { count: 10, to: 'golem' } },
      golem: { frame: fixture('battle-gengar-label-short'), lasts: { ms: 6000, to: 'won' } },
    },
    'party',
  );

  await play(phone, { mode: ULTRA, count: 1 }, clock);

  expect(taps.filter((scene) => scene === 'golem')).toEqual([]);
});

/** Glaceon gives way to Sneasel, which no card of ours counters, a Hisuian one's Close Combat beating Mamoswine. */
test('stays in when nothing benched counters the opponent switched in', async () => {
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      loading: { frame: fixture('other-vs-fade'), lasts: { ms: 4000, to: 'glaceon' } },
      glaceon: { frame: fixture('battle-latias'), swipes: { count: 10, to: 'sneasel' } },
      sneasel: { frame: fixture('battle-deoxys'), lasts: { ms: 6000, to: 'won' } },
    },
    'party',
  );

  await play(phone, { mode: ULTRA, count: 1 }, clock);

  expect(taps.filter((scene) => scene === 'sneasel')).toEqual([]);
});

const STAYED = 'own: staying in against Mamoswine: Shadow Sneak drawn into a shield before Giratina faints';

/**
 * The opponent switches Glaceon out for Mamoswine while our Giratina has Shadow Sneak lit. Mamoswine's Avalanche
 * threatens Giratina, and nothing benched counters Mamoswine, but Umbreon is safe from all of its moves: Giratina
 * switches to it rather than throw, keeping the energy on the bench. There being no committed party of these, the party
 * screen is read with Zeraora's icon standing for Umbreon and Gyarados' for Giratina, so the party is Umbreon, Latias
 * and Giratina, and Umbreon the bench's top card. Mamoswine's frame is of a later battle, its Poké Balls painted red so
 * that it, like Glaceon's, shows all three of each side's left, and the change reads as a switch rather than a faint.
 * The switch shows only as `other` before Mamoswine's first frame, which so reads the HUD at once, its last read being
 * `READ_MS` ago.
 *
 * Giratina's own shields are spent on the frame as recorded, and Mamoswine's moves would faint it: doomed, it stays in
 * and throws Shadow Sneak into Mamoswine's shield. Painted held, it has a shield to take, and banks. Painted held only
 * for the first second, as though spent while Mamoswine flies in, the switch decided on is given up as Giratina comes
 * to be doomed, before its tap, and it stays in and throws.
 */
test.each([
  ['spent', [], undefined, [STAYED], []],
  [
    'held',
    HELD,
    undefined,
    [],
    [
      "own: switching to Umbreon against Mamoswine, banking Shadow Sneak: Giratina is hit super effectively and banks its energy; Umbreon is safe from Mamoswine's moves",
    ],
  ],
  ['spent as it flies in', HELD, 1000, [STAYED], []],
])(
  'with our shields %s, a lit move against an opponent switched in is thrown or banked',
  async (_, held, spentAfter, stayed, switched) => {
    const stand = { Zeraora: 'Umbreon', Gyarados: 'Giratina' } as Record<string, string>;
    const icons = ICONS.map((icon) => ({ ...icon, species: stand[icon.species] ?? icon.species }));
    const balls = [0.058, 0.111, 0.161, 0.842, 0.892, 0.944].map((x) => [x - 0.01, 0.192, x + 0.01, 0.213]);
    const red = painted(fixture('charged-shadow-sneak'), [220, 40, 40], ...balls);
    const mamoswine = painted(red, [224, 161, 238], ...held);
    const bench = place(BENCH[0] ?? [0, 0], BENCH_ANCHOR, mamoswine);
    const { phone, clock, taps } = scripted(
      {
        ...battleAndBack(),
        party: { frame: fixture('menu-party-full'), tap: { at: [0.5, 0.87], to: 'loading' } },
        loading: { frame: fixture('other-vs-fade'), lasts: { ms: 4000, to: 'glaceon' } },
        glaceon: { frame: fixture('battle-latias'), swipes: { count: 10, to: 'coming' } },
        coming: { frame: fixture('other-vs-fade'), lasts: { ms: 3200, to: 'mamoswine' } },
        mamoswine: {
          frame: mamoswine,
          tap: { at: bench, to: 'won' },
          lasts: spentAfter === undefined ? { ms: 6000, to: 'won' } : { ms: spentAfter, to: 'spent' },
        },
        spent: { frame: red, tap: { at: bench, to: 'won' }, lasts: { ms: 6000, to: 'won' } },
      },
      'party',
    );
    const report = recorder();

    await play(phone, { mode: ULTRA, icons, count: 1 }, clock, report);

    expect(taps).toContain(spentAfter === undefined ? 'mamoswine' : 'spent');
    expect(report.events.filter((line) => line.startsWith('own: staying'))).toEqual(stayed);
    expect(report.events.filter((line) => line.startsWith('own: switching'))).toEqual(switched);
  },
);

/**
 * Giratina switches to Umbreon to bank Shadow Sneak, as above with our shields held, and the tap is dropped: from the
 * tap on, the HUD shows Giratina at its CP still with Shadow Sneak's label painted out, as live the labels went unread
 * after two taps to Kyogre were dropped, and its button painted unlit until the drop is read. Lit again, the switch is
 * tapped again and dropped again, after which none is tried for `REFUSED_MS`. Lit a third time, Shadow Sneak is thrown
 * by the moves read before the first tap, which each refusal gives back, and its minigame's Ghost bubbles are swiped
 * through rather than swept across in rows. With the moves left unread, nothing lit is known to bank, and Shadow Sneak
 * is thrown unnamed the first time it lights instead, as Close Combat was live.
 */
test('aims the swipes of a throw after our switch was dropped at its bubbles', async () => {
  const stand = { Zeraora: 'Umbreon', Gyarados: 'Giratina' } as Record<string, string>;
  const icons = ICONS.map((icon) => ({ ...icon, species: stand[icon.species] ?? icon.species }));
  const balls = [0.058, 0.111, 0.161, 0.842, 0.892, 0.944].map((x) => [x - 0.01, 0.192, x + 0.01, 0.213]);
  const red = painted(fixture('charged-shadow-sneak'), [220, 40, 40], ...balls);
  const mamoswine = painted(red, [224, 161, 238], ...HELD);
  const unlabelled = painted(mamoswine, [80, 130, 60], [0.3, 1.985, 0.7, 2.06]);
  const unlit = painted(unlabelled, [107, 105, 112], [140 / 360, 635 / 360, 220 / 360, 676 / 360]);
  const bench = place(BENCH[0] ?? [0, 0], BENCH_ANCHOR, mamoswine);
  const { phone, clock, strokes } = scripted(
    {
      ...battleAndBack(),
      party: { frame: fixture('menu-party-full'), tap: { at: [0.5, 0.87], to: 'loading' } },
      loading: { frame: fixture('other-vs-fade'), lasts: { ms: 4000, to: 'glaceon' } },
      glaceon: { frame: fixture('battle-latias'), swipes: { count: 10, to: 'coming' } },
      coming: { frame: fixture('other-vs-fade'), lasts: { ms: 3200, to: 'mamoswine' } },
      mamoswine: { frame: mamoswine, tap: { at: bench, to: 'dropped' }, lasts: { ms: 6000, to: 'won' } },
      dropped: { frame: unlit, lasts: { ms: 4000, to: 'relit' } },
      relit: {
        frame: unlabelled,
        tap: [
          { at: bench, to: 'redropped' },
          { at: [0.499, 0.889], to: 'minigame' },
        ],
        lasts: { ms: 6000, to: 'won' },
      },
      redropped: { frame: unlit, lasts: { ms: 4000, to: 'lit' } },
      lit: { frame: unlabelled, tap: { at: [0.499, 0.889], to: 'minigame' }, lasts: { ms: 6000, to: 'won' } },
      minigame: minigameNoneFainted(),
    },
    'party',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, icons, count: 1 }, clock, report);

  const minigame = strokes.filter(({ scene }) => scene === 'minigame');

  expect(report.events.filter((line) => /^own: (Umbreon not sent in|threw)/.test(line))).toEqual([
    'own: Umbreon not sent in: taken as dropped, no switch of ours in the last 45s',
    'own: Umbreon not sent in: taken as dropped, no switch of ours in the last 45s',
    'own: threw Shadow Sneak',
  ]);
  expect(minigame.length).toBeGreaterThan(0);

  for (const { from, to } of minigame) {
    expect([from[1], to[1]].every((y) => y > 0.78 && y < 0.86)).toBe(true);
    expect(Math.min(from[0], to[0])).toBeLessThan(0.45);
    expect(Math.max(from[0], to[0])).toBeGreaterThan(0.45);
  }
});

/**
 * Giratina switches to Umbreon to bank Shadow Sneak, as above with our shields held, and the tap goes nowhere: the frame
 * stays as it was, Shadow Sneak lit and labelled. The tap forgot our moves, so the button is not thrown on the next
 * frame, unnamed, but waits for the read that judges the switch, which gives them back. Thrown once the switch has been
 * dropped twice, its minigame's Ghost bubbles are swiped through rather than swept across in rows.
 */
test('throws nothing lit while a switch of ours is still to be judged', async () => {
  const stand = { Zeraora: 'Umbreon', Gyarados: 'Giratina' } as Record<string, string>;
  const icons = ICONS.map((icon) => ({ ...icon, species: stand[icon.species] ?? icon.species }));
  const balls = [0.058, 0.111, 0.161, 0.842, 0.892, 0.944].map((x) => [x - 0.01, 0.192, x + 0.01, 0.213]);
  const red = painted(fixture('charged-shadow-sneak'), [220, 40, 40], ...balls);
  const mamoswine = painted(red, [224, 161, 238], ...HELD);
  const { phone, clock, strokes } = scripted(
    {
      ...battleAndBack(),
      party: { frame: fixture('menu-party-full'), tap: { at: [0.5, 0.87], to: 'loading' } },
      loading: { frame: fixture('other-vs-fade'), lasts: { ms: 4000, to: 'glaceon' } },
      glaceon: { frame: fixture('battle-latias'), swipes: { count: 10, to: 'coming' } },
      coming: { frame: fixture('other-vs-fade'), lasts: { ms: 3200, to: 'mamoswine' } },
      mamoswine: { frame: mamoswine, tap: { at: [0.499, 0.889], to: 'minigame' }, lasts: { ms: 12_000, to: 'won' } },
      minigame: minigameNoneFainted(),
    },
    'party',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, icons, count: 1 }, clock, report);

  const minigame = strokes.filter(({ scene }) => scene === 'minigame');
  const switched =
    "own: switching to Umbreon against Mamoswine, banking Shadow Sneak: Giratina is hit super effectively and banks its energy; Umbreon is safe from Mamoswine's moves";
  const dropped = 'own: Umbreon not sent in: taken as dropped, no switch of ours in the last 45s';

  expect(report.events.filter((line) => /^own: (switching|Umbreon not sent in|threw)/.test(line))).toEqual([
    switched,
    dropped,
    switched,
    dropped,
    'own: threw Shadow Sneak',
  ]);
  expect(minigame.length).toBeGreaterThan(0);

  for (const { from, to } of minigame) {
    expect([from[1], to[1]].every((y) => y > 0.78 && y < 0.86)).toBe(true);
  }
});

/** A meta in which Mamoswine is run with Powder Snow, Avalanche and Bulldoze: its Avalanche hits Giratina 1.6×. */
const MAMOSWINE_AVALANCHE: Meta = {
  cup: 'all',
  cap: 2500,
  movesets: new Map([
    ['Mamoswine', { fast: 'Powder Snow', fastMoves: ['Powder Snow'], chargedMoves: ['Avalanche', 'Bulldoze'] }],
  ]),
};

const GLACEON =
  "own: switching to Glaceon against Mamoswine: Avalanche affordable after one more Powder Snow; Glaceon resists it, and nothing of Mamoswine's is super effective";

/** What is told of our throws and switches. */
const moved = (events: readonly string[]) => events.filter((line) => /^own: (threw|switching)/.test(line));

/**
 * Giratina leads against Mamoswine, whose Avalanche, as `MAMOSWINE_AVALANCHE` has it run, hits it super effectively,
 * through the hits of `sneaking`: four Powder Snow, 32 energy and one more for the count, leave Avalanche's 45 out of
 * reach, and the fifth brings it within one more. Glaceon resists Avalanche, and Bulldoze is neutral on it: switched to
 * on `hit5`, and not on `hit4`. Mamoswine's icon stands for Glaceon on the party screen, so that it is Latias, Glaceon
 * and Giratina, Glaceon the bench's second card.
 *
 * On `hit5`, our two shields painted held, it switches all the same. With Shadow Sneak lit on it and Mamoswine's
 * shields painted spent, the finish is thrown instead, and nothing switched, the battle won. With Shadow Sneak lit and
 * the shields up, Shadow Sneak goes first, and the switch once the fight is `back`, the count unchanged across the
 * throw.
 */
test.each([
  ['unlit', (scenes: Record<string, Scene>) => scenes.hit5?.frame, ['hit5'], [GLACEON]],
  [
    'unlit, our shields held',
    (scenes: Record<string, Scene>) => painted(scenes.hit5?.frame ?? fixture('other-white'), [224, 161, 238], ...HELD),
    ['hit5'],
    [GLACEON],
  ],
  [
    'lit to finish',
    (scenes: Record<string, Scene>) =>
      painted(scenes.lit?.frame ?? fixture('other-white'), [111, 81, 118], [0.7, 0.195, 0.78, 0.222]),
    ['hit5'],
    ['own: threw Shadow Sneak: would finish Mamoswine at 4%'],
  ],
  ['lit', (scenes: Record<string, Scene>) => scenes.lit?.frame, ['hit5', 'back'], ['own: threw Shadow Sneak', GLACEON]],
])(
  'switches the lead to a resister one fast move before the opponent affords a super-effective move: %s',
  async (_, frameOf, tapped, said) => {
    const { scenes } = sneaking([96, 92, 88, 84, 80, 76], { lasts: { ms: 6000, to: 'won' } });
    const icons = ICONS.map((icon) => ({ ...icon, species: icon.species === 'Mamoswine' ? 'Glaceon' : icon.species }));
    const frame = frameOf(scenes) ?? fixture('other-white');
    const bench = place(BENCH[1] ?? [0, 0], BENCH_ANCHOR, frame);
    const { phone, clock, taps } = scripted(
      {
        ...scenes,
        hit5: {
          frame,
          tap: [
            { at: bench, to: 'won' },
            { at: [0.499, 0.889], to: 'minigame' },
          ],
          lasts: { ms: 6000, to: 'won' },
        },
        minigame: { ...minigameNoneFainted(), swipes: { count: 40, to: tapped.includes('back') ? 'playing' : 'won' } },
        playing: { frame: fixture('other-vs-fade'), lasts: { ms: 1000, to: 'back' } },
        back: { frame: scenes.hit5?.frame ?? frame, tap: { at: bench, to: 'won' }, lasts: { ms: 6000, to: 'won' } },
      },
      'party',
    );
    const report = recorder();

    await play(phone, { mode: ULTRA, meta: MAMOSWINE_AVALANCHE, icons, count: 1 }, clock, report);

    expect(taps.filter((scene) => /^(fight|hit|back)/.test(scene))).toEqual(tapped);
    expect(moved(report.events)).toEqual(said);
  },
);

/** The game master with Entei able to hold Leaf Blade, 35 energy, which hits Kyogre 1.6×. */
const ENTEI_LEAF_BLADE: GameData = {
  ...DATA,
  forms: DATA.forms.map((form) =>
    form.species === 'Entei' ? { ...form, moves: [...form.moves, { name: 'Leaf Blade', fast: false }] } : form,
  ),
};

/**
 * Kyogre leads against Entei, its shields painted spent, with Avalanche lit and Hydro Pump held for, as `bestButton`
 * holds for it with no shield to bait. Entei is run with Fire Spin, Overheat and Leaf Blade, which hits Kyogre super
 * effectively. Our bar, its fill painted over past the HP wanted, loses 2 points to each of three Fire Spin, two
 * leaving Leaf Blade's 35 out of reach of one more and the third bringing it within it: Latias, which resists Leaf
 * Blade and Overheat, is switched to on `hit3`, banking Avalanche. Giratina's icon stands for Kyogre on the party
 * screen, so that it is Latias, Mamoswine and Kyogre, Latias the bench's top card; Mamoswine takes Leaf Blade super
 * effectively.
 */
test('switches the lead to a resister, banking a lit move held for another', async () => {
  const spent = painted(fixture('charged-two-right'), [111, 81, 118], [0.7, 0.195, 0.78, 0.222]);
  const ours = (px: number) => painted(spent, [105, 91, 41], [(24 + px) / 360, 330 / 360, 91 / 360, 336 / 360]);
  const icons = ICONS.map((icon) => ({ ...icon, species: icon.species === 'Giratina' ? 'Kyogre' : icon.species }));
  const bench = place(BENCH[0] ?? [0, 0], BENCH_ANCHOR, spent);
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: ours(67), lasts: { ms: 400, to: 'hit1' } },
      hit1: { frame: ours(65), lasts: { ms: 200, to: 'hit2' } },
      hit2: { frame: ours(63), lasts: { ms: 200, to: 'hit3' } },
      hit3: { frame: ours(61), tap: { at: bench, to: 'won' }, lasts: { ms: 6000, to: 'won' } },
    },
    'party',
  );
  const report = recorder();

  await play(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'master' },
      data: ENTEI_LEAF_BLADE,
      meta: {
        cup: 'all',
        cap: null,
        movesets: new Map([
          ['Entei', { fast: 'Fire Spin', fastMoves: ['Fire Spin'], chargedMoves: ['Overheat', 'Leaf Blade'] }],
        ]),
      },
      icons,
      count: 1,
    },
    clock,
    report,
  );

  expect(taps.filter((scene) => /^(fight|hit)/.test(scene))).toEqual(['hit3']);
  expect(moved(report.events)).toEqual([
    "own: switching to Latias against Entei, banking Avalanche: Leaf Blade affordable after one more Fire Spin; Latias resists it, and nothing of Entei's is super effective",
  ]);
});

/**
 * The game master with Shadow Sneak lowering our attack by 2 as Psycho Boost does, and Avalanche by 1: no committed
 * frame has a move that does lit.
 */
const SNEAK_DROPS: GameData = {
  ...DATA,
  combat: {
    ...DATA.combat,
    'Shadow Sneak': { ...DATA.combat['Shadow Sneak'], buffs: { chance: 1, ownAttack: -2 } },
    'Avalanche': { ...DATA.combat.Avalanche, buffs: { chance: 1, ownAttack: -1 } },
  } as GameData['combat'],
};

const CLEARING =
  "own: switching to Mamoswine against Mamoswine, banking Shadow Sneak: clearing −2 attack; Mamoswine is safe from Mamoswine's moves";

/**
 * Giratina against Mamoswine as above, none of either side's fainted and our two shields painted held, throws Shadow
 * Sneak, lowering its attack by 2 as `SNEAK_DROPS` has it; once its minigame has played, the fight is `back` with
 * Shadow Sneak lit again. Mamoswine, run with Avalanche and Bulldoze as `MAMOSWINE_AVALANCHE` has it, hits our own
 * Mamoswine, the bench's second card, neutrally with both: it is switched to, banking Shadow Sneak. With Mamoswine's
 * shields painted spent on `back`, Shadow Sneak would finish it, and is thrown instead; with our shields left spent, as
 * recorded, Giratina's next hit is its last, and it stays in.
 */
test.each([
  ['with a refuge', (frame: Image) => frame, [CLEARING]],
  ['with a lit finisher', (frame: Image) => painted(frame, [111, 81, 118], [0.7, 0.195, 0.78, 0.222]), []],
  ['on its last hit', (frame: Image) => painted(frame, [107, 105, 112], ...HELD), []],
])('clears a drop of its own throw by switching %s', async (_, paint, said) => {
  const balls = painted(fixture('charged-shadow-sneak'), [200, 60, 60], FIRST_BALL, ...THEIR_BALLS);
  const lit = painted(balls, [224, 161, 238], ...HELD);
  const back = paint(lit);
  const bench = place(BENCH[1] ?? [0, 0], BENCH_ANCHOR, back);
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: lit, tap: { at: [0.499, 0.889], to: 'minigame' } },
      minigame: { ...minigameNoneFainted(), swipes: { count: 40, to: 'playing' } },
      playing: { frame: fixture('other-vs-fade'), lasts: { ms: 1000, to: 'back' } },
      back: {
        frame: back,
        tap: [
          { at: bench, to: 'won' },
          { at: [0.499, 0.889], to: 'won' },
        ],
        lasts: { ms: 6000, to: 'won' },
      },
    },
    'party',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, data: SNEAK_DROPS, meta: MAMOSWINE_AVALANCHE, count: 1 }, clock, report);

  expect(taps).toContain('back');
  expect(report.events.filter((line) => line.startsWith('own: threw'))[0]).toBe('own: threw Shadow Sneak');
  expect(report.events.filter((line) => line.startsWith('own: switching'))).toEqual(said);
});

/**
 * The same switch to Mamoswine, which the next read finds out by its CP, 2336 rather than Giratina's 2392, against
 * Empoleon, sent in after Mamoswine fainted, its Poké Balls two to Mamoswine's three. Empoleon, run with Hydro Cannon
 * and Drill Peck, hits neither Latias nor Giratina super effectively. Mamoswine's Avalanche, lowering its attack as
 * `SNEAK_DROPS` has it, is painted unlit for `unlit` and then lit, and thrown; once played, inside `TIMER_MS` of the
 * switch, Mamoswine stays in, and after it, switches to Latias, whose Thunder hits Empoleon hardest.
 */
test.each([
  ['inside', 10_000, [CLEARING]],
  [
    'after',
    50_000,
    [
      CLEARING,
      "own: switching to Latias against Empoleon, banking Avalanche: clearing −1 attack; Latias is safe from Empoleon's moves",
    ],
  ],
])('clears a drop %s our switch timer of the switch before', async (_, unlit, said) => {
  const balls = painted(fixture('charged-shadow-sneak'), [200, 60, 60], FIRST_BALL, ...THEIR_BALLS);
  const lit = painted(balls, [224, 161, 238], ...HELD);
  const avalanche = painted(fixture('charged-avalanche'), [200, 60, 60], FIRST_BALL);
  const dark = painted(avalanche, [107, 105, 112], [140 / 360, 635 / 360, 220 / 360, 676 / 360]);
  const charged: Scene['tap'] = { at: [0.499, 0.889], to: 'minigame' };
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: lit, tap: charged },
      minigame: { ...minigameNoneFainted(), swipes: { count: 40, to: 'playing' } },
      playing: { frame: fixture('other-vs-fade'), lasts: { ms: 1000, to: 'back' } },
      back: { frame: lit, tap: { at: place(BENCH[1] ?? [0, 0], BENCH_ANCHOR, lit), to: 'mamoswine' } },
      mamoswine: { frame: dark, lasts: { ms: unlit, to: 'avalanche' } },
      avalanche: { frame: avalanche, tap: { at: [0.499, 0.889], to: 'thrown' } },
      thrown: {
        frame: painted(fixture('playing-minigame-mamoswine'), [200, 60, 60], FIRST_BALL),
        swipes: { count: 40, to: 'played' },
      },
      played: { frame: fixture('other-vs-fade'), lasts: { ms: 1000, to: 'again' } },
      again: {
        frame: avalanche,
        tap: { at: place(BENCH[0] ?? [0, 0], BENCH_ANCHOR, avalanche), to: 'won' },
        lasts: { ms: 6000, to: 'won' },
      },
    },
    'party',
  );
  const report = recorder();

  await play(
    phone,
    {
      mode: ULTRA,
      data: SNEAK_DROPS,
      meta: {
        ...MAMOSWINE_AVALANCHE,
        movesets: new Map([
          ...MAMOSWINE_AVALANCHE.movesets,
          ['Empoleon', { fast: 'Waterfall', fastMoves: ['Waterfall'], chargedMoves: ['Hydro Cannon', 'Drill Peck'] }],
        ]),
      },
      count: 1,
    },
    clock,
    report,
  );

  expect(report.events.filter((line) => line.startsWith('own: switching'))).toEqual(said);
});

/**
 * The same switch to Mamoswine, against Empoleon, sent in after Mamoswine fainted and so not anchored. Empoleon, run
 * with Waterfall, Hydro Cannon and Drill Peck, puts up a shield prompt `wait` ms of the fight after the switch and,
 * with `banner`, the banner naming Drill Peck, which settles its count at nothing left. Fifty seconds of Waterfall, 10
 * energy a 1.5s, fill it whatever our bar shows, so Drill Peck leaves it 60 by the most it can hold, and Hydro Cannon's
 * 40, super effective on Mamoswine, is affordable at once. Latias resists it, and Drill Peck is neutral on it: it is
 * switched to on `steady`, only after the banner, and only outside `TIMER_MS` of the switch to Mamoswine. The count
 * alone would wait for the three Waterfall after it, 4 points each off our bar, painted over Mamoswine's on
 * `charged-avalanche` with Avalanche unlit, the third bringing Hydro Cannon within one more.
 */
test.each([
  ['after a banner', true, 50_000, ['steady']],
  ['before any banner', false, 50_000, []],
  ['inside our switch timer', true, 10_000, []],
])('switches to a resister mid-battle %s', async (_, banner, wait, tapped) => {
  const balls = painted(fixture('charged-shadow-sneak'), [200, 60, 60], FIRST_BALL, ...THEIR_BALLS);
  const lit = painted(balls, [224, 161, 238], ...HELD);
  const avalanche = painted(fixture('charged-avalanche'), [200, 60, 60], FIRST_BALL);
  const dark = painted(avalanche, [107, 105, 112], [140 / 360, 635 / 360, 220 / 360, 676 / 360]);

  // Our fill run on to `px` of the bar's 100 at 360 wide, and dark beyond it.
  const ours = (px: number) =>
    painted(
      painted(dark, [105, 91, 41], [29 / 360, 380 / 360, 129 / 360, 385 / 360]),
      [26, 255, 187],
      [29 / 360, 380 / 360, (29 + px) / 360, 385 / 360],
    );
  const bench = [0, 1].map((card) => ({ at: place(BENCH[card] ?? [0, 0], BENCH_ANCHOR, dark), to: 'won' }));
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: lit, tap: { at: [0.499, 0.889], to: 'minigame' } },
      minigame: { ...minigameNoneFainted(), swipes: { count: 40, to: 'playing' } },
      playing: { frame: fixture('other-vs-fade'), lasts: { ms: 1000, to: 'back' } },
      back: { frame: lit, tap: { at: place(BENCH[1] ?? [0, 0], BENCH_ANCHOR, lit), to: 'mamoswine' } },
      mamoswine: { frame: ours(74), lasts: { ms: wait, to: 'prompt' } },
      prompt: { frame: fixture('shield-glaceon'), lasts: { ms: 3000, to: 'banner' } },
      banner: {
        frame: banner ? painted(fixture('playing-banner'), [200, 60, 60], FIRST_BALL) : ours(74),
        lasts: { ms: 2000, to: 'steady' },
      },
      steady: { frame: ours(74), tap: bench, lasts: { ms: 1000, to: 'hit1' } },
      hit1: { frame: ours(70), tap: bench, lasts: { ms: 200, to: 'hit2' } },
      hit2: { frame: ours(66), tap: bench, lasts: { ms: 200, to: 'hit3' } },
      hit3: { frame: ours(62), tap: bench, lasts: { ms: 6000, to: 'won' } },
    },
    'party',
  );
  const report = recorder();

  await play(
    phone,
    {
      mode: ULTRA,
      data: SNEAK_DROPS,
      meta: {
        ...MAMOSWINE_AVALANCHE,
        movesets: new Map([
          ...MAMOSWINE_AVALANCHE.movesets,
          ['Empoleon', { fast: 'Waterfall', fastMoves: ['Waterfall'], chargedMoves: ['Hydro Cannon', 'Drill Peck'] }],
        ]),
      },
      count: 1,
    },
    clock,
    report,
  );

  expect(taps.filter((scene) => /^(steady|hit)/.test(scene))).toEqual(tapped);
  expect(report.events.filter((line) => line.startsWith('own: switching'))).toEqual([
    CLEARING,
    ...(tapped.length > 0
      ? [
          "own: switching to Latias against Empoleon: Hydro Cannon affordable after one more Waterfall; Latias resists it, and nothing of Empoleon's is super effective",
        ]
      : []),
  ]);
});

/** Where the opponent's panel is on the Pixel 4 XL's frames, its name, CP, shields and Poké Balls, as a box. */
const THEIR_PANEL = [0.58, 0.13, 1, 0.225];

/**
 * The same five hits, with either side's lead gone before them: the opponent's, by Mamoswine's panel pasted over with
 * Glaceon's from `battle-latias` for its first 2s, all three of its Poké Balls red, so that Mamoswine, two of them grey,
 * is read as sent in after Glaceon fainted, its count not anchored, and nothing switched; or ours, by our grey Poké
 * Ball left grey, the faint counted off it, and the party Giratina, Glaceon and Giratina, the second of whom is out.
 * Their lead never gone and a faint starting no switch timer, the second Giratina switches to Glaceon as the first
 * would. The hits wait 2.5s, so that Mamoswine has flown in by the last, `FLY_IN_MS` after it is named, a switch decided
 * on before then being given up for Giratina doomed. Shadow Sneak, lit once the hits are over, is tapped and goes
 * nowhere, the scene having no minigame to go to.
 */
test.each([
  [
    'their',
    { Mamoswine: 'Glaceon' },
    (image: Image) => image,
    true,
    'opponent: Glaceon fainted; sent in Mamoswine',
    [],
    [],
  ],
  [
    'our',
    { Mamoswine: 'Glaceon', Latias: 'Giratina' },
    (image: Image) => pasted(image, fixture('charged-shadow-sneak'), FIRST_BALL),
    false,
    'own: Giratina fainted: one fewer of our Poké Balls',
    ['hit5'],
    [GLACEON],
  ],
])(
  'after %s lead faints, switches to a resister only if theirs is out',
  async (_, stand, paint, before, said, tapped, switched) => {
    const { scenes } = sneaking([96, 92, 88, 84, 80, 76], { lasts: { ms: 6000, to: 'won' } }, paint);
    const standing: Record<string, string> = stand;
    const icons = ICONS.map((icon) => ({ ...icon, species: standing[icon.species] ?? icon.species }));
    const fight = scenes.fight?.frame ?? fixture('other-white');
    const { phone, clock, taps } = scripted(
      {
        ...scenes,
        fight: { frame: fight, lasts: { ms: 2500, to: 'hit1' } },
        loading: { frame: fixture('other-vs-fade'), lasts: { ms: 4000, to: before ? 'glaceon' : 'fight' } },
        glaceon: { frame: pasted(fight, fixture('battle-latias'), THEIR_PANEL), lasts: { ms: 2000, to: 'coming' } },
        coming: { frame: fixture('other-vs-fade'), lasts: { ms: 1500, to: 'fight' } },
      },
      'party',
    );
    const report = recorder();

    await play(phone, { mode: ULTRA, meta: MAMOSWINE_AVALANCHE, icons, count: 1 }, clock, report);

    expect(report.events).toContain(said);
    expect(taps.filter((scene) => /^(fight|hit)/.test(scene))).toEqual(tapped);
    expect(report.events.filter((line) => line.startsWith('own: switching'))).toEqual(switched);
  },
);

/**
 * Giratina taps Shadow Sneak and faints before it plays, our first Poké Ball going grey with no switch prompt, as when
 * the last of ours is sent in. The next of ours fights at once, swiped across the field from where the fight's swipes
 * begin, x 0.15 or 0.7, not left alone or swept in rows from the screen's edges for a minigame that is not coming.
 */
test('fights on where ours faints with a throw tapped and no prompt', async () => {
  const { scenes } = sneaking([96], { lasts: { ms: 1000, to: 'gone' } });
  const standing: Record<string, string> = { Mamoswine: 'Glaceon', Latias: 'Giratina' };
  const icons = ICONS.map((icon) => ({ ...icon, species: standing[icon.species] ?? icon.species }));
  const fight = scenes.fight?.frame ?? fixture('other-white');
  const { phone, clock, strokes } = scripted(
    {
      ...scenes,
      fight: { frame: fight, lasts: { ms: 2500, to: 'lit' } },
      loading: { frame: fixture('other-vs-fade'), lasts: { ms: 4000, to: 'fight' } },
      gone: { frame: pasted(fight, fixture('charged-shadow-sneak'), FIRST_BALL), lasts: { ms: 3000, to: 'won' } },
    },
    'party',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, meta: MAMOSWINE_AVALANCHE, icons, count: 1 }, clock, report);

  const after = strokes.filter(({ scene }) => scene === 'gone');

  expect(report.events).toContain('own: Shadow Sneak not thrown: Giratina fainted first');
  expect(after.length).toBeGreaterThan(10);
  expect(after.filter(({ from }) => from[0] !== 0.15 && from[0] !== 0.7)).toEqual([]);
});

/**
 * Mamoswine faints to Giratina's fast move with Shadow Sneak tapped, or still lit, its first Poké Ball going grey: the
 * game hides our buttons while the opponent picks its next, for longer than a minigame's `PLAYING_MS`, with no
 * minigame, and lights Shadow Sneak again once the newcomer is in, its energy kept. Taken to be playing 3.5s into the
 * pick, the one throw would be told twice, and the pick told as its minigame; tapped as its button fades out, the
 * throw would be taken to be playing as well.
 */
test.each([
  [
    'tapped',
    true,
    ['fight', 'relit'],
    ['own: Shadow Sneak not thrown: Mamoswine fainted first', 'own: threw Shadow Sneak'],
  ],
  ['still lit', false, ['relit'], ['own: threw Shadow Sneak']],
])('throws once, lit again, where the opponent faints with our move %s', async (_, tappedFirst, tapped, said) => {
  const balls = painted(fixture('charged-shadow-sneak'), [200, 60, 60], FIRST_BALL, ...THEIR_BALLS);
  const fainted = painted(balls, [105, 65, 68], THEIR_BALLS[0] ?? []);
  const unlit = (image: Image) => painted(image, [107, 105, 112], [140 / 360, 635 / 360, 220 / 360, 676 / 360]);
  const lead: Record<string, Scene> = tappedFirst
    ? { fight: { frame: balls, tap: { at: [0.499, 0.889], to: 'picking' } } }
    : {
        fight: { frame: unlit(balls), lasts: { ms: 1000, to: 'fainting' } },
        fainting: { frame: fainted, lasts: { ms: 300, to: 'picking' } },
      };
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      ...lead,
      picking: { frame: unlit(fainted), lasts: { ms: 6000, to: 'relit' } },
      relit: { frame: fainted, tap: { at: [0.499, 0.889], to: 'minigame' } },
      minigame: minigameNoneFainted(),
    },
    'party',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  expect(taps.filter((scene) => ['fight', 'fainting', 'picking', 'relit'].includes(scene))).toEqual(tapped);
  expect(report.events.filter((line) => /^own: (threw|Shadow Sneak|tap Shadow Sneak)/.test(line))).toEqual(said);
  expect(report.events.filter((line) => line.includes('off the battle'))).toEqual([]);
});

/**
 * Latias leads, from the party screen, and faints to Glaceon; the switch prompt's first card sends in Mamoswine, the
 * next of the party. No frame here shows a move label or our species, so the party is all that names either. Glaceon
 * is named once the battle's first read is back.
 */
test('names the lead from the party, and the next of it after a faint', async () => {
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('battle-latias'), swipes: { count: 10, to: 'fainted' } },
      fainted: { frame: fixture('switch-glaceon'), tap: { at: [0.33, 0.87], to: 'next' } },
      next: flyingIn(),
    },
    'party',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  const named = new Set(report.fights.map(({ own, opponent }) => `${own.species} against ${opponent.species}`));

  expect([...named]).toEqual(['Latias against null', 'Latias against Glaceon', 'Mamoswine against Glaceon']);
});
