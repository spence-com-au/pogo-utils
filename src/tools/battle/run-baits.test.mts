/** Which charged move the run throws while the opponent has shields, mirrors among them. */

import { type GameData } from '../../core/game-master.mts';
import { type Image } from '../../core/png.mts';
import { type Meta } from './meta.mts';
import {
  battleAndBack,
  DATA,
  FIRST_BALL,
  fixture,
  ICONS,
  masterParty,
  minigameNoneFainted,
  painted,
  pasted,
  play,
  recorder,
  RED,
  type Scene,
  scripted,
  sneaking,
  ULTRA,
} from './node/test-run.mts';
import { expect, test } from 'vitest';

// The menus between the battles are no stretch off a battle's field, nor is the first battle's end, never come back from.
test('carries on into the next battle until the count is reached', async () => {
  const { phone, clock, taps } = scripted(battleAndBack(), 'training');
  const report = recorder();

  expect(await play(phone, { mode: ULTRA, count: 2 }, clock, report)).toEqual({ battles: 2, won: 2, lost: 0 });
  expect(taps.filter((scene) => scene === 'result')).toHaveLength(2);
  expect(report.events.filter((line) => line.includes('off the battle'))).toEqual([]);
});

/**
 * Kyogre against Entei, with Avalanche lit and Hydro Pump not, and both of Entei's shields up: Avalanche costs 45 to
 * Hydro Pump's 75, so it goes now to draw a shield, where with the shields gone the fight would carry on until Hydro
 * Pump lit — `strategy.test.mts` holds that half.
 */
test('baits with the cheaper move while the opponent has shields', async () => {
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      fight: {
        frame: fixture('charged-two-right'),
        tap: { at: [0.69, 0.889], to: 'minigame' },
        swipes: { count: 10, to: 'training' },
      },
      minigame: minigameNoneFainted(),
    },
    'fight',
  );

  expect(await play(phone, { mode: ULTRA, count: 1 }, clock)).toEqual({ battles: 1, won: 1, lost: 0 });
  expect(taps).toEqual(['fight', 'result']);
});

/**
 * Giratina, CP 2392, with Shadow Sneak lit against a CP 2472 Mamoswine at 4%. With Mamoswine's shield hexagons painted
 * a spent one's purple, its throw is told as the finish it would be; with them up, a shield could stop it, and it is
 * thrown as the move held for. Our grey Poké Ball is painted red, on the minigame too, as if Giratina, the party's third
 * card, had led: read as a faint, it would be counted against Giratina, the one whose moves fit, leaving none of ours
 * known to be out, and the throw lost to it.
 */
test.each([
  ['spent', [[0.7, 0.195, 0.78, 0.222]], 'own: threw Shadow Sneak: would finish Mamoswine at 4%'],
  ['up', [], 'own: threw Shadow Sneak'],
])('with the opponent’s shields %s, a throw that would finish it says so', async (_, spent, said) => {
  const frame = painted(fixture('charged-shadow-sneak'), [200, 60, 60], FIRST_BALL);
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: painted(frame, [111, 81, 118], ...spent), tap: { at: [0.499, 0.889], to: 'minigame' } },
      minigame: minigameNoneFainted(),
    },
    'party',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  expect(taps).toContain('fight');
  expect(report.events.filter((line) => line.startsWith('own: threw'))).toEqual([said]);
});

/**
 * The same Giratina against Mamoswine with its shields spent, our fast moves seen taking it from 16%, once the battle's
 * first read has named it, to 10% and to the 4% the frame shows, steps 200ms apart, with Shadow Sneak's button painted
 * unlit until it lights at 4%; and one Powder Snow taking our 58% to 55%. One hit more finishes it, before that Powder
 * Snow's 8 energy and the 24 of three more, two landing in our longest fast move's three turns and one for the count,
 * reach Icicle Spear's 40. With Mamoswine's middle Poké Ball painted red, another is to come, and Shadow Sneak is held
 * for it; with Mamoswine its last, the finish is thrown. The fight's time, 1.6s, affords no more than the count; but
 * with the hold kept 3s, no fast move of ours landing here, by 2s it affords 16, and the finish goes after all.
 */
const HELD_FOR_NEXT = 'own: holding Shadow Sneak for the next: fast moves finish Mamoswine at 4%';
const FINISHED = 'own: threw Shadow Sneak: would finish Mamoswine at 4%';
const ANOTHER = [[0.879, 0.19, 0.905, 0.215]];

test.each([
  ['with another to come', ANOTHER, 1000, [HELD_FOR_NEXT]],
  ['on its last', [], 1000, [FINISHED]],
  ['with another to come, held as long as its energy could fill', ANOTHER, 3000, [HELD_FOR_NEXT, FINISHED]],
])('fast moves finishing the opponent %s hold the energy lit only for the next', async (_, next, ms, said) => {
  const balls = painted(fixture('charged-shadow-sneak'), [200, 60, 60], FIRST_BALL, ...next);
  const hud = painted(balls, [111, 81, 118], [0.7, 0.195, 0.78, 0.222]);
  const hit = painted(hud, [105, 91, 41], [79 / 360, 220 / 360, 82 / 360, 225 / 360]);

  // Their fill run on to `px` of the bar's 100 at 360 wide, and Shadow Sneak's button with the top of its rim painted
  // over, the half `readyButtons` needs white gone.
  const theirs = (image: Image, px: number) =>
    painted(image, [229, 105, 103], [216 / 360, 265 / 360, (216 + px) / 360, 271 / 360]);
  const unlit = (image: Image) => painted(image, [107, 105, 112], [140 / 360, 635 / 360, 220 / 360, 676 / 360]);
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: unlit(theirs(hud, 16)), lasts: { ms: 400, to: 'closer' } },
      closer: { frame: unlit(theirs(hit, 10)), lasts: { ms: 200, to: 'charged' } },
      charged: { frame: hit, tap: { at: [0.499, 0.889], to: 'minigame' }, lasts: { ms, to: 'won' } },
      minigame: minigameNoneFainted(),
    },
    'party',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  expect(report.events.filter((line) => /^own: (threw|holding)/.test(line))).toEqual(said);
});

/**
 * The game master with Shadow Sneak lowering our defense by 2 as Close Combat does: no committed frame has a move that
 * does lit with our shields spent and both sides' CPs read, but Giratina's against Mamoswine does with this one.
 */
const SNEAK_LOWERS: GameData = {
  ...DATA,
  combat: {
    ...DATA.combat,
    'Shadow Sneak': { ...DATA.combat['Shadow Sneak'], buffs: { chance: 1, ownDefense: -2 } },
  } as GameData['combat'],
};

/** A meta in which Mamoswine is run with Powder Snow, Ancient Power and Bulldoze. */
const MAMOSWINE_RUN: Meta = {
  cup: 'all',
  cap: 2500,
  movesets: new Map([
    ['Mamoswine', { fast: 'Powder Snow', fastMoves: ['Powder Snow'], chargedMoves: ['Ancient Power', 'Bulldoze'] }],
  ]),
};

/** What is told of a hold and its throw, and of the opponent's throw meanwhile. */
const holdsOf = (events: readonly string[]) =>
  events.filter((line) => /^own: (threw|holding|no longer holding)|threw a charged move/.test(line));

const HOLDING =
  'own: holding Shadow Sneak: Mamoswine can afford Ancient Power; Ancient Power would take ~27%, with 76% left, the hardest 48 energy affords';

/**
 * Held, Shadow Sneak goes once Mamoswine's Ancient Power has landed, its countdown showing with no prompt and lowering
 * the count to 8, one hit's allowance, which affords nothing, our bar at 30% after it. Or once held as long as
 * Giratina's energy takes to fill from 50 at 8 a second, as any of its fast moves gains: 6.25s of the fight, the 3s off
 * the field between `lit` and `relit` not counting, so after the 6s the two last and before `late`, 0.5s after them,
 * ends. Or as a finish, Mamoswine's shields painted spent, takes its place, which ends the hold. Or as our bar, at 4%,
 * comes within one of Mamoswine's fast moves, `fastFaints`'s fear named with the charged move the count affords before
 * the drop has come to rest and been counted. Never on `lit` or `relit`, which take no tap.
 */
test.each([
  [
    'lands',
    { lasts: { ms: 2000, to: 'countdown' } },
    'back',
    [
      HOLDING,
      'opponent: Mamoswine threw a charged move: none of our shields left to prompt for',
      "own: no longer holding Shadow Sneak: 8 energy affords none of Mamoswine's charged moves",
      'own: threw Shadow Sneak',
    ],
  ],
  [
    'runs out of time',
    { lasts: { ms: 4000, to: 'gap' } },
    'late',
    [
      HOLDING,
      expect.stringMatching(
        /^own: no longer holding Shadow Sneak: 6\.(2[5-9]|30)s of the fight since the hold began, Giratina's energy filling from 50 in 6\.25s at the soonest$/,
      ),
      'own: threw Shadow Sneak',
    ],
  ],
  [
    'gives way to a finish',
    { lasts: { ms: 2000, to: 'finishing' } },
    'finishing',
    [
      HOLDING,
      'own: no longer holding Shadow Sneak: would finish Mamoswine at 4%',
      'own: threw Shadow Sneak: would finish Mamoswine at 4%',
    ],
  ],
  [
    'gives way to a fast move fainting us',
    { lasts: { ms: 2000, to: 'low' } },
    'low',
    [
      HOLDING,
      'own: no longer holding Shadow Sneak: their next fast move would faint us, one taking ~4% with 4% left; Ancient Power would faint us, 48 energy affords it',
      'own: threw Shadow Sneak',
    ],
  ],
])(
  'with no shield of ours left, a move lowering our defense is held until the hit it waits for %s',
  async (_, lit, tapped, said) => {
    const { scenes, ours } = sneaking([96, 92, 88, 84, 80, 76], lit);
    const { phone, clock, taps } = scripted(
      {
        ...scenes,
        countdown: { frame: fixture('other-pixel8-countdown'), lasts: { ms: 3000, to: 'playing' } },
        playing: { frame: fixture('other-vs-fade'), lasts: { ms: 1000, to: 'back' } },
        back: { frame: ours(30), tap: { at: [0.499, 0.889], to: 'minigame' } },
        gap: { frame: fixture('other-vs-fade'), lasts: { ms: 3000, to: 'relit' } },
        relit: { frame: ours(76), lasts: { ms: 2000, to: 'late' } },
        late: { frame: ours(76), tap: { at: [0.499, 0.889], to: 'minigame' }, lasts: { ms: 500, to: 'won' } },
        low: { frame: ours(4), tap: { at: [0.499, 0.889], to: 'minigame' } },
        finishing: {
          frame: painted(ours(76), [111, 81, 118], [0.7, 0.195, 0.78, 0.222]),
          tap: { at: [0.499, 0.889], to: 'minigame' },
        },
      },
      'party',
    );
    const report = recorder();

    await play(phone, { mode: ULTRA, data: SNEAK_LOWERS, meta: MAMOSWINE_RUN, count: 1 }, clock, report);

    expect(taps.filter((scene) => scene === 'lit' || scene === 'relit' || scene === tapped)).toEqual([tapped]);
    expect(holdsOf(report.events)).toEqual(said);
  },
);

/**
 * Thrown at once, as above, where there is no hit to wait for: with our two shields painted held, one left to take
 * Ancient Power; with Mamoswine's painted spent, Shadow Sneak finishing it at 4%; and from 54%, Bulldoze taking 1/1.4
 * of what is left, as PvPoke would not have us wait for.
 */
test.each([
  [
    'a shield of ours left',
    [96, 92, 88, 84, 80, 76],
    (image: Image) => painted(image, [224, 161, 238], [0.23, 0.2027, 0.242, 0.2153], [0.275, 0.2027, 0.287, 0.2153]),
    'own: threw Shadow Sneak',
  ],
  [
    'a finish',
    [96, 92, 88, 84, 80, 76],
    (image: Image) => painted(image, [111, 81, 118], [0.7, 0.195, 0.78, 0.222]),
    'own: threw Shadow Sneak: would finish Mamoswine at 4%',
  ],
  ['a hit taking 1/1.4 of what is left', [74, 70, 66, 62, 58, 54], (image: Image) => image, 'own: threw Shadow Sneak'],
])('a move lowering our defense goes at once with %s', async (_, bars, paint, said) => {
  const { scenes } = sneaking(bars, { tap: { at: [0.499, 0.889], to: 'minigame' } }, paint);
  const { phone, clock, taps } = scripted(scenes, 'party');
  const report = recorder();

  await play(phone, { mode: ULTRA, data: SNEAK_LOWERS, meta: MAMOSWINE_RUN, count: 1 }, clock, report);

  expect(taps).toContain('lit');
  expect(holdsOf(report.events)).toEqual([said]);
});

/**
 * Kyogre against Entei in Master League with Avalanche lit, and with Entei's shield hexagons painted a spent one's
 * purple, Hydro Pump held for: worth more per energy, as `strategy.test.mts` has it. Our bar, its fill painted over
 * past the HP wanted, is seen to lose 12 points to one of Entei's fast moves once the battle's first read has named it.
 * Left within one more, Avalanche goes now rather than faint with its energy; left more, Hydro Pump is held for.
 */
test.each([
  [
    '13%',
    25,
    13,
    [
      'own: threw Avalanche: their next fast move would faint us, one taking ~12% with 13% left; not holding for Hydro Pump',
    ],
  ],
  ['28%', 40, 28, []],
])('with %s left, a lit move goes only once the next fast move would faint us', async (_, before, after, said) => {
  const spent = painted(fixture('charged-two-right'), [111, 81, 118], [0.7, 0.195, 0.78, 0.222]);
  const ours = (px: number) => painted(spent, [105, 91, 41], [(24 + px) / 360, 330 / 360, 91 / 360, 336 / 360]);
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      minigame: minigameNoneFainted(),
      fight: { frame: ours(before), lasts: { ms: 400, to: 'hit' } },
      hit: { frame: ours(after), tap: { at: [0.69, 0.889], to: 'minigame' }, lasts: { ms: 3000, to: 'won' } },
    },
    'fight',
  );
  const report = recorder();

  await play(phone, { mode: { mode: 'training', leader: 'blanche', league: 'master' }, count: 1 }, clock, report);

  expect(report.events.filter((line) => line.startsWith('own: threw'))).toEqual(said);
});

/** The game master with Entei able to hold Kyogre's Hydro Pump and Avalanche. */
const ENTEI_HYDRO_PUMP: GameData = {
  ...DATA,
  forms: DATA.forms.map((form) =>
    form.species === 'Entei'
      ? { ...form, moves: [...form.moves, { name: 'Hydro Pump', fast: false }, { name: 'Avalanche', fast: false }] }
      : form,
  ),
};

/**
 * Kyogre against Entei in Ultra League, played as an Entei mirror: Giratina's icon stands for Entei on the party
 * screen, which is then Latias, Mamoswine and Entei, and Entei can hold Hydro Pump and Avalanche in `ENTEI_HYDRO_PUMP`,
 * so that the card the moves under the buttons fit, the HUD naming ours by a nickname, is an Entei. Avalanche, 45
 * energy, is the bait for Hydro Pump, 75 and 2.77 per energy into Entei to Avalanche's 1.25. What the run taps and
 * tells, through `scenes` after the party screen, for `count` battles.
 */
async function mirror(scenes: Record<string, Scene>, count = 1): Promise<{ taps: string[]; said: string[] }> {
  const icons = ICONS.map((icon) => ({ ...icon, species: icon.species === 'Giratina' ? 'Entei' : icon.species }));
  const { phone, clock, taps } = scripted({ ...battleAndBack(), minigame: minigameNoneFainted(), ...scenes }, 'party');
  const report = recorder();

  await play(phone, { mode: ULTRA, data: ENTEI_HYDRO_PUMP, icons, count }, clock, report);

  return { taps: taps.filter((scene) => scene in scenes), said: holdsOf(report.events) };
}

/**
 * With Entei's shields up, Avalanche lit alone for 3s is held, nothing tapped, and goes once Hydro Pump lights beside
 * it, twice over, the second hold told afresh; `baits with the cheaper move while the opponent has shields` throws it at
 * once out of a mirror.
 */
test('in a mirror, holds a bait lit alone until the move it stands in for lights beside it', async () => {
  const { taps, said } = await mirror({
    'fight': { frame: fixture('charged-two-right'), lasts: { ms: 3000, to: 'both' } },
    'both': { frame: fixture('charged-two-both'), tap: { at: [0.69, 0.889], to: 'minigame' } },
    'minigame': { ...minigameNoneFainted(), swipes: { count: 40, to: 'again' } },
    'again': { frame: fixture('charged-two-right'), lasts: { ms: 3000, to: 'both again' } },
    'both again': { frame: fixture('charged-two-both'), tap: { at: [0.69, 0.889], to: 'last' } },
    'last': minigameNoneFainted(),
  });
  const round = [
    'own: holding Avalanche for Hydro Pump to light: an Entei mirror counts our energy',
    'own: threw Avalanche: bait, Hydro Pump lit beside it',
  ];

  expect(taps).toEqual(['both', 'both again']);
  expect(said).toEqual([...round, ...round]);
});

/** A hold under way as a battle ends is told afresh in the next. */
test('in a mirror, tells a bait held again in the next battle', async () => {
  const { said } = await mirror({ fight: { frame: fixture('charged-two-right'), lasts: { ms: 3000, to: 'won' } } }, 2);
  const held = 'own: holding Avalanche for Hydro Pump to light: an Entei mirror counts our energy';

  expect(said).toEqual([held, held]);
});

/**
 * The same with our bar, its fill painted over past the HP wanted, seen to lose 12 points to one of Entei's fast moves
 * once the battle's first read has named it, from 25% to 13%, within one more, and Avalanche's button painted unlit
 * for 200ms after: lit then, it goes at once, never told as held.
 */
test('in a mirror, a bait lit alone goes at once on a faint feared', async () => {
  const ours = (px: number) =>
    painted(fixture('charged-two-right'), [105, 91, 41], [(24 + px) / 360, 330 / 360, 91 / 360, 336 / 360]);
  const unlit = (image: Image) => painted(image, [107, 105, 112], [208 / 360, 635 / 360, 292 / 360, 676 / 360]);
  const { taps, said } = await mirror({
    fight: { frame: unlit(ours(25)), lasts: { ms: 400, to: 'hit' } },
    hit: { frame: unlit(ours(13)), lasts: { ms: 200, to: 'lit' } },
    lit: { frame: ours(13), tap: { at: [0.69, 0.889], to: 'minigame' } },
  });

  expect(taps).toEqual(['lit']);
  expect(said).toEqual([
    'own: threw Avalanche: their next fast move would faint us, one taking ~12% with 13% left; not holding for Hydro Pump',
  ]);
});

/** The game master with Geomancy gaining 4 energy rather than 13, which leaves Moonblast two of them past Close Combat. */
const SLOW_GEOMANCY: GameData = {
  ...DATA,
  combat: { ...DATA.combat, Geomancy: { ...DATA.combat.Geomancy, energy: 4 } } as GameData['combat'],
};

/**
 * Xerneas, its card read as Geomancy, against Garchomp with its shields spent, Moonblast held for as worth more per
 * energy into a Dragon. Close Combat's button and Moonblast's label are copied from a frame where the one is lit and the
 * other reads, and Close Combat lit makes our energy at least its 45, as the report shows; Moonblast's 50 is then two
 * of `SLOW_GEOMANCY`'s Geomancy off, 6 turns. Our bar, its fill painted over past the HP wanted, is seen to lose 2
 * points to one of Garchomp's fast moves, counted as Mud Shot's 2 turns, once the battle's first read has named it,
 * and our grey Poké Ball is painted red, as if none of ours had fainted. Left at 5%, two more faint us in 4 turns,
 * before Moonblast fills, and Close Combat goes now; left at 15%, seven more, and Moonblast is held for.
 */
test.each([
  [
    '5%',
    7,
    [
      "own: threw Close Combat: Moonblast fills in 6 turns, 5 energy short; 2 of Garchomp's fast moves faint us in 4, one taking ~2% with 5% left; not holding for Moonblast",
    ],
  ],
  ['15%', 17, []],
])('with %s left, a lit move goes once our energy fills the move held for too late', async (_, from, said) => {
  const widths = (...px: number[]) => px.map((x) => x / 360);
  const balls = painted(fixture('battle-pixel8-xerneas-super-effective'), [200, 60, 60], widths(15, 69, 30, 82));
  const donor = fixture('charged-pixel8-xerneas-not-very-effective');
  const lit = pasted(pasted(balls, donor, widths(205, 670, 292, 755)), donor, widths(40, 755, 180, 779));
  const ours = (px: number) =>
    painted(painted(lit, RED, widths(22, 242, 122, 248)), [22, 31, 36], widths(22 + px, 242, 122, 248));
  const { phone, clock } = scripted(
    {
      ...masterParty(),
      minigame: minigameNoneFainted(),
      fight: { frame: ours(from), lasts: { ms: 400, to: 'hit' } },
      hit: { frame: ours(from - 2), tap: { at: [0.69, 0.895], to: 'minigame' }, lasts: { ms: 3000, to: 'won' } },
    },
    'party',
  );
  const report = recorder();

  await play(
    phone,
    { mode: { mode: 'training', leader: 'blanche', league: 'master' }, data: SLOW_GEOMANCY, count: 1 },
    clock,
    report,
  );

  expect(report.events.filter((line) => line.startsWith('own: threw'))).toEqual(said);
  expect(report.fights.find((fight) => fight.ourEnergy?.fast === 'Geomancy')?.ourEnergy).toEqual({
    energy: 45,
    fast: 'Geomancy',
  });
});
