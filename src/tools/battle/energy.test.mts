/**
 * The opponent's energy counted off our bar, on a Great League Medicham against our Registeel: Psycho Cut takes 2 of
 * Registeel's 132 HP a hit and gains 9, Counter takes 6 and gains 6, so the size of the steps says which it has.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { type GameData } from '../inventory/game-master.mts';
import { type Verdict } from './damage.mts';
import { Energy, Hits, spare, untilTheirsLands, type Matchup, type Standing } from './energy.mts';
import { type Meta } from './meta.mts';

const DATA = JSON.parse(
  readFileSync(new URL('../inventory/fixtures/game-master.json', import.meta.url), 'utf8'),
) as GameData;

const MATCHUP: Matchup = {
  own: { species: 'Registeel', cp: 1497 },
  opponent: { species: 'Medicham', cp: 1497 },
  cap: 1500,
};

const PSYCHO_CUT = 2 / 132;
const COUNTER = 6 / 132;

/** A bar read every `every` ms through `hits` seconds, a hit taking `step` off it each second, from `from`. */
function fight(
  energy: Pick<Energy, 'read'>,
  { from = 1, step, hits, start = 0, every = 100 }: Fight,
  matchup = MATCHUP,
): number {
  let hp = from;
  let at = start;

  for (let hit = 0; hit < hits; hit++) {
    for (let t = 0; t < 1000; t += every) {
      energy.read(at + t, hp, matchup);
    }

    hp -= step;
    at += 1000;
  }

  energy.read(at, hp, matchup);

  return hp;
}

interface Fight {
  from?: number;
  step: number;
  hits: number;
  start?: number;
  every?: number;
}

test('nothing has landed yet: no energy, counted by the fast move gaining it fastest', () => {
  const energy = new Energy(DATA);

  energy.read(0, 1, MATCHUP);

  expect(energy.estimate(MATCHUP)).toStrictEqual({ energy: 0, fast: 'Psycho Cut', gain: 9 });
});

test('or by the one PvPoke recommends, where it ranks the species', () => {
  const meta: Meta = {
    cup: 'all',
    cap: 1500,
    movesets: new Map([['Medicham', { fast: 'Counter', fastMoves: ['Psycho Cut', 'Counter'], chargedMoves: [] }]]),
  };
  const energy = new Energy(DATA, meta);

  energy.read(0, 1, MATCHUP);

  expect(energy.estimate(MATCHUP)?.fast).toBe('Counter');
});

test.each([
  ['Psycho Cut', PSYCHO_CUT, 9, 63],
  ['Counter', COUNTER, 6, 42],
])('seven hits of %s are told by their size and gain %s each', (fast, step, gain, total) => {
  const energy = new Energy(DATA);

  fight(energy, { step, hits: 7 });

  expect(energy.estimate(MATCHUP)).toStrictEqual({ energy: total, fast, gain });
});

test('hits run together between readings are counted by the step measured before them', () => {
  const energy = new Energy(DATA);
  const hp = fight(energy, { step: COUNTER, hits: 3 });

  // Four more, two between each reading: no clean step among them, but the HP they took is four of the three's.
  energy.read(5000, hp - 2 * COUNTER, MATCHUP);
  energy.read(7000, hp - 4 * COUNTER, MATCHUP);

  expect(energy.estimate(MATCHUP)?.energy).toBe(42);
});

test('no more than a full bar of energy, however many hits land', () => {
  const energy = new Energy(DATA);

  fight(energy, { step: PSYCHO_CUT, hits: 15 });

  expect(energy.estimate(MATCHUP)?.energy).toBe(100);
});

test('what is lost across a pause is no fast move’s', () => {
  const energy = new Energy(DATA);
  const hp = fight(energy, { step: COUNTER, hits: 2 });

  energy.pause();
  energy.read(5000, hp - 0.4, MATCHUP);
  energy.read(5100, hp - 0.4, MATCHUP);

  expect(energy.estimate(MATCHUP)?.energy).toBe(12);
});

test('nor is what the bar goes on losing after it, until it holds', () => {
  const energy = new Energy(DATA);
  const hp = fight(energy, { step: COUNTER, hits: 2 });

  // A charged hit draining the bar 3% a frame for 2s after the fight is back, then two more Counters once it has held.
  energy.threw(MATCHUP);
  energy.pause();

  for (let frame = 0; frame <= 20; frame++) {
    energy.read(5000 + frame * 100, hp - 0.03 * frame, MATCHUP);
  }

  fight(energy, { from: hp - 0.6, step: COUNTER, hits: 2, start: 7100 });

  expect(energy.estimate(MATCHUP)?.energy).toBe(12);
  expect(energy.step).toBeCloseTo(COUNTER);
});

test('a throw spends the cheapest charged move it is allowed for, from what it had', () => {
  const energy = new Energy(DATA);
  const hp = fight(energy, { step: PSYCHO_CUT, hits: 10 });

  // 90, less Power-Up Punch's 35, the cheapest of Ice Punch, Psychic, Dynamic Punch and Power-Up Punch.
  energy.threw(MATCHUP);
  expect(energy.estimate(MATCHUP)?.energy).toBe(55);

  fight(energy, { from: hp, step: PSYCHO_CUT, hits: 2, start: 20_000 });
  expect(energy.estimate(MATCHUP)?.energy).toBe(73);
});

test('its energy is kept while it is out, and a drop across our switch is not a hit', () => {
  const energy = new Energy(DATA);
  const azumarill: Matchup = { ...MATCHUP, own: { species: 'Azumarill', cp: 1499 } };

  fight(energy, { step: COUNTER, hits: 3 });
  energy.read(4000, 0.8, azumarill);
  energy.read(4100, 0.8, azumarill);

  expect(energy.estimate(azumarill)?.energy).toBe(18);
  expect(energy.estimate({ ...MATCHUP, opponent: { species: 'Registeel', cp: 1497 } })?.energy, 'a newcomer').toBe(0);
});

test('nothing is counted for an opponent not named, nor HP lost that nothing says how many hits held', () => {
  const energy = new Energy(DATA);
  const unnamed: Matchup = { ...MATCHUP, opponent: { species: null, cp: 1497 } };
  const uncapped: Matchup = { ...MATCHUP, opponent: { species: 'Medicham', cp: null }, cap: null };

  energy.read(0, 1, unnamed);
  expect(energy.estimate(unnamed)).toBe(null);

  // Read 2.5s apart, so no clean step, and with Medicham's CP unread and no cap to take it as, no build to say what a
  // hit takes.
  energy.read(0, 1, uncapped);
  energy.read(2500, 0.9, uncapped);
  expect(energy.estimate(uncapped)).toBe(null);
});

test('the banner settles what a throw cost: the move named rather than the cheapest', () => {
  const energy = new Energy(DATA);
  const hp = fight(energy, { step: PSYCHO_CUT, hits: 10 });

  energy.threw(MATCHUP);
  fight(energy, { from: hp, step: PSYCHO_CUT, hits: 2, start: 20_000 });

  // 90 less Dynamic Punch's 45 rather than Power-Up Punch's 35, and the two hits since.
  energy.named('Medicham', 'Dynamic Punch');
  expect(energy.estimate(MATCHUP)?.energy).toBe(63);

  energy.named('Medicham', 'Psychic');
  expect(energy.estimate(MATCHUP)?.energy, 'a throw is settled once').toBe(63);
});

test('a move named that cost more than was counted leaves nothing: the count was short', () => {
  const energy = new Energy(DATA);

  fight(energy, { step: PSYCHO_CUT, hits: 4 });
  energy.threw(MATCHUP);
  energy.named('Medicham', 'Psychic');

  expect(energy.estimate(MATCHUP)?.energy).toBe(0);
});

test('once both of its moves have been seen, a throw is the cheaper of them', () => {
  const energy = new Energy(DATA);

  fight(energy, { step: PSYCHO_CUT, hits: 10 });
  energy.threw(MATCHUP, new Set(['Ice Punch', 'Psychic']));

  expect(energy.estimate(MATCHUP)?.energy, '90 less Ice Punch’s 40').toBe(50);
});

test('an opponent CP unread is counted as the cap', () => {
  const unread: Matchup = { ...MATCHUP, opponent: { species: 'Medicham', cp: null } };
  const atCap: Matchup = { ...MATCHUP, opponent: { species: 'Medicham', cp: 1500 } };

  const estimate = (matchup: Matchup) => {
    const energy = new Energy(DATA);

    // Read 2.5s apart, so no clean step: what a hit takes is the model's, built at the cap.
    energy.read(0, 1, matchup);
    energy.read(2500, 0.9, matchup);

    return energy.estimate(matchup);
  };

  expect(estimate(unread)).not.toBe(null);
  expect(estimate(unread)).toStrictEqual(estimate(atCap));
});

test('steps measured before a CP was read do not stop later ones from telling the fast move', () => {
  const energy = new Energy(DATA);
  const unread: Matchup = { ...MATCHUP, opponent: { species: 'Medicham', cp: null }, cap: null };

  // Counter's steps with Medicham's CP not yet read and no cap to take it as, which no build can check, and then with
  // it read.
  const hp = fight(energy, { step: COUNTER, hits: 3 }, unread);
  fight(energy, { from: hp, step: COUNTER, hits: 3, start: 5000 });

  expect(energy.estimate(MATCHUP)?.fast).toBe('Counter');
});

test('what one hit takes is the median clean step, for this matchup only', () => {
  const energy = new Energy(DATA);
  const hits = new Hits();

  expect([energy.step, hits.step], 'before any step').toEqual([undefined, undefined]);

  fight(energy, { step: COUNTER, hits: 3 });
  fight(hits, { step: PSYCHO_CUT, hits: 3 });

  expect(energy.step).toBeCloseTo(COUNTER);
  expect(hits.step).toBeCloseTo(PSYCHO_CUT);

  const azumarill: Matchup = { ...MATCHUP, own: { species: 'Azumarill', cp: 1499 } };

  energy.read(4000, 0.8, azumarill);
  hits.read(4000, 0.8, azumarill);
  expect([energy.step, hits.step], 'a newcomer of ours').toEqual([undefined, undefined]);

  hits.read(4100, 0.7, { ...MATCHUP, opponent: { species: null, cp: null } });
  expect(hits.step, 'an opponent not named').toBe(undefined);
});

/**
 * Counter measured taking 4.5% of Registeel a hit: within one of it, with the bar's 2 points, the next would faint us,
 * and short of that it would not.
 */
test.each([
  [0.06, 'their next fast move would faint us, one taking ~5% with 6% left'],
  [0.07, undefined],
])('with a hit measured and %f left, the next fast move would faint us: %s', (hp, said) => {
  const energy = new Energy(DATA);

  fight(energy, { step: COUNTER, hits: 3 });

  expect(energy.fastFaints(MATCHUP, hp)).toBe(said);
});

/**
 * A shadow Medicham's Counter, a fifth harder than the model has any Counter, with our defense at −2: 8.2% of Registeel
 * a hit to the model's 6.8%. Where the stages have moved the hit, the larger of the two counts, and that is the step.
 */
test('a hit measured larger than the model outweighs it', () => {
  const meta: Meta = {
    cup: 'all',
    cap: 1500,
    movesets: new Map([['Medicham', { fast: 'Counter', fastMoves: ['Psycho Cut', 'Counter'], chargedMoves: [] }]]),
  };
  const energy = new Energy(DATA, meta);
  const lowered = { own: { attack: 0, defense: -2 }, their: { attack: 0, defense: 0 } };

  fight(energy, { step: (9 / 132) * 1.2, hits: 3 });

  expect(energy.fastFaints(MATCHUP, 0.1, lowered)).toBe(
    'their next fast move would faint us, one taking ~8% with 10% left',
  );
});

/**
 * With no hit measured, the model's for the fast move it is counted by, the one PvPoke recommends: Counter takes 4.5%,
 * and Psycho Cut 1.5%.
 */
test.each([
  ['Counter', 0.06, 'their next fast move would faint us, Counter modelled at ~5% with 6% left'],
  ['Counter', 0.07, undefined],
  ['Psycho Cut', 0.06, undefined],
  ['Psycho Cut', 0.03, 'their next fast move would faint us, Psycho Cut modelled at ~2% with 3% left'],
])('with no hit measured, %s is modelled against %f left: %s', (fast, hp, said) => {
  const meta: Meta = {
    cup: 'all',
    cap: 1500,
    movesets: new Map([['Medicham', { fast, fastMoves: ['Psycho Cut', 'Counter'], chargedMoves: [] }]]),
  };
  const energy = new Energy(DATA, meta);

  energy.read(0, hp, MATCHUP);

  expect(energy.fastFaints(MATCHUP, hp)).toBe(said);
});

/**
 * Our defense at −2, as Close Combat leaves it, takes Counter's hit from 4.5% to 6.8%: modelled so where no hit has
 * been measured, and over a step measured before the drop, which the stretch does not start again for.
 */
test.each([
  ['no hit measured', 0],
  ['a hit measured before our defense fell', 3],
])('with %s, a fast move is weighed at the stages that move it', (_, hits) => {
  const meta: Meta = {
    cup: 'all',
    cap: 1500,
    movesets: new Map([['Medicham', { fast: 'Counter', fastMoves: ['Psycho Cut', 'Counter'], chargedMoves: [] }]]),
  };
  const energy = new Energy(DATA, meta);
  const lowered = { own: { attack: 0, defense: -2 }, their: { attack: 0, defense: 0 } };

  fight(energy, { step: COUNTER, hits });

  expect(energy.fastFaints(MATCHUP, 0.08), 'at no stages').toBe(undefined);
  expect(energy.fastFaints(MATCHUP, 0.08, lowered)).toBe(
    'their next fast move would faint us, Counter modelled at ~7% with 8% left',
  );
});

test('nothing is told of a fast move where our HP or a build to model it on is unknown', () => {
  const energy = new Energy(DATA);
  const uncapped: Matchup = { ...MATCHUP, opponent: { species: 'Medicham', cp: null }, cap: null };

  expect(energy.fastFaints(MATCHUP, null), 'our HP unread').toBe(undefined);
  expect(energy.fastFaints(uncapped, 0.01), 'their CP unread, with no cap to take it as').toBe(undefined);
  expect(energy.fastFaints({ ...MATCHUP, opponent: { species: null, cp: 1497 } }, 0.01), 'unnamed').toBe(undefined);
});

/**
 * The Ultra League footage that asked for the hold: Galarian Moltres with Brave Bird and Fly lit, against a Giratina at
 * 15% with no shields left and Mewtwo to come. Sucker Punch takes 4.3% of a rank-1 Altered Giratina, so four of them
 * finish it, two turns each; Dragon Breath takes 1.3% of Moltres, gaining 4 in one turn. So eight of Giratina's land
 * meanwhile and one for the count, 36 energy, short of the 45 that Ancient Power, its cheapest, costs.
 */
const FOOTAGE: Standing = {
  matchup: {
    own: { species: 'Moltres', cp: 2500, types: ['Dark', 'Flying'] },
    opponent: { species: 'Giratina', cp: 2500 },
    cap: 2500,
  },
  hp: { own: 0.6, opponent: 0.15 },
  shields: 0,
  left: 2,
  steps: { ours: 0.043, theirs: 0.013 },
  estimate: { energy: 0, fast: 'Dragon Breath', gain: 4 },
};

test('holds the charged moves where fast moves finish the opponent before it can throw', () => {
  expect(spare(DATA, FOOTAGE)).toBe('fast moves finish Giratina at 15%');
});

test.each<[string, Partial<Standing>]>([
  ['its shield left', { shields: 1 }],
  ['its last Pokémon', { left: 1 }],
  ['its Poké Balls unread', { left: null }],
  ['no hit of ours measured', { steps: { ours: undefined, theirs: 0.013 } }],
  ['no hit of theirs measured', { steps: { ours: 0.043, theirs: undefined } }],
  ['its energy uncounted', { estimate: null }],
  ['its HP unread', { hp: { own: 0.6, opponent: null } }],
  ['six hits to go', { hp: { own: 0.6, opponent: 0.2 } }],
  ['45 energy by the time they land', { estimate: { energy: 9, fast: 'Dragon Breath', gain: 4 } }],
  ['fast moves that would faint us first', { hp: { own: 0.12, opponent: 0.15 } }],
  ['our species unread', { matchup: { ...FOOTAGE.matchup, own: { species: null, cp: 2500 } } }],
])('throws with %s', (_, change) => {
  expect(spare(DATA, { ...FOOTAGE, ...change })).toBe(undefined);
});

test('counts its fast moves by the turns ours take, never fewer than ours', () => {
  // 10 energy and five Dragon Breaths, one a hit of ours and one for the count, would be 30. By the turns, nine land.
  expect(spare(DATA, { ...FOOTAGE, estimate: { energy: 10, fast: 'Dragon Breath', gain: 4 } })).toBe(undefined);

  // Dragon Tail's three turns land fewer than our four hits, which are counted instead: five of its 12, 60 energy.
  expect(spare(DATA, { ...FOOTAGE, estimate: { energy: 0, fast: 'Dragon Tail', gain: 12 } })).toBe(undefined);
});

test('weighs only its two moves once both have been seen', () => {
  const standing: Standing = { ...FOOTAGE, estimate: { energy: 10, fast: 'Dragon Breath', gain: 4 } };

  expect(spare(DATA, { ...standing, seen: new Set(['Dragon Claw', 'Shadow Sneak']) }), '46 short of 50').toBe(
    'fast moves finish Giratina at 15%',
  );
});

/**
 * Xerneas against Metagross, both read at their CPs from battle 4 of the Pixel 8 Pro's Master League set, 2026-10-29,
 * the verdicts `wouldFaint`'s for them: Meteor Mash, at 50 energy counted, would take 78% of a full bar, and at 7,
 * nothing is afforded. A hit that would faint us, charged or fast, is the caller's fear to let the throw go on.
 */
test('with no shield left, a move lowering our defense waits for a charged move we would survive to land', () => {
  const xerneas = { species: 'Xerneas', types: ['Fairy'] };
  const survived = {
    faints: false,
    why: 'Meteor Mash would take ~78%, with 100% left, the hardest 50 energy affords',
    hardest: 'Meteor Mash',
    afforded: 'Meteor Mash',
  };
  const landed = { faints: false, why: 'Flash Cannon would take ~85%, with 100% left', hardest: 'Flash Cannon' };
  const unread = { faints: true, why: 'their species unread' };
  const holds = (move: string, shields: number, verdict: Verdict, energy = 50, waited = 0) =>
    untilTheirsLands(DATA, move, xerneas, 'Metagross', shields, verdict, energy, waited);

  expect(holds('Close Combat', 0, survived)).toEqual({
    held: true,
    why: `Metagross can afford Meteor Mash, which we would survive; ${survived.why}`,
  });
  expect(holds('Close Combat', 0, landed, 7), 'the count lowered by its throw, affording nothing').toEqual({
    held: false,
    why: "7 energy affords none of Metagross's charged moves",
  });
  expect(untilTheirsLands(DATA, 'Close Combat', xerneas, 'Metagross', 0, landed, undefined, 0)).toEqual({
    held: false,
    why: "Metagross's energy not counted",
  });
  expect(holds('Close Combat', 1, survived), 'a shield left to take it').toBe(undefined);
  expect(holds('Moonblast', 0, survived), 'a move leaving our defense alone').toBe(undefined);
  expect(holds('Close Combat', 0, unread), 'a newcomer of theirs not yet named').toEqual({
    held: false,
    why: unread.why,
  });

  // Geomancy, 13 energy for 3 turns, fills 100 from Close Combat's 45 in 6346ms.
  expect(holds('Close Combat', 0, survived, 50, 6300)?.held).toBe(true);
  expect(holds('Close Combat', 0, survived, 50, 6400)).toEqual({
    held: false,
    why: "6.40s of the fight since the hold began, Xerneas's energy filling from 45 in 6.35s at the soonest",
  });

  // Galarian Moltres's Wing Attack, 8 for 2 turns, fills from Brave Bird's 55 in 5625ms.
  const moltres = { species: 'Moltres', types: ['Dark', 'Flying'] };

  expect(untilTheirsLands(DATA, 'Brave Bird', moltres, 'Metagross', 0, survived, 50, 5600)?.held).toBe(true);
  expect(untilTheirsLands(DATA, 'Brave Bird', moltres, 'Metagross', 0, survived, 50, 5700)?.why).toBe(
    "5.70s of the fight since the hold began, Moltres's energy filling from 55 in 5.63s at the soonest",
  );
  expect(
    untilTheirsLands(DATA, 'Close Combat', { species: null }, 'Metagross', 0, survived, 50, 0)?.held,
    'none of our fast moves known, so no time to hold for',
  ).toBe(false);
});
