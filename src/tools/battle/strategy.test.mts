/**
 * The choice of move against the vended game master, on the pairings the committed footage holds: Kyogre's Hydro Pump
 * and Avalanche, against the Entei and the Salamence it met.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { type GameData } from '../inventory/game-master.mts';
import { type Meta } from './meta.mts';
import {
  activeOf,
  beforeFainting,
  bestButton,
  bestLit,
  chargedOf,
  counterOf,
  damage,
  nextOut,
  refugeOf,
  shouldShield,
  type Shown,
  stripperOf,
  typesOf,
  worth,
} from './strategy.mts';

const DATA = JSON.parse(
  readFileSync(new URL('../inventory/fixtures/game-master.json', import.meta.url), 'utf8'),
) as GameData;

/** A meta in which `species` is run with `chargedMoves` alone. */
const metaOf = (species: string, chargedMoves: string[]): Meta => ({
  cup: 'all',
  cap: 2500,
  movesets: new Map([[species, { fast: '', fastMoves: [], chargedMoves }]]),
});

const KYOGRE = new Map([
  [0.31, 'Hydro Pump'],
  [0.69, 'Avalanche'],
]);

/** Two moves of a type and a power, Ice Beam costing 55 and Avalanche 45. */
const GLACEON = new Map([
  [0.31, 'Ice Beam'],
  [0.69, 'Avalanche'],
]);

test('a species has every typing its forms have', () => {
  expect(typesOf(DATA, { species: 'Kyogre' })).toEqual([['Water']]);
  expect(typesOf(DATA, { species: 'Salamence' })).toEqual([['Dragon', 'Flying']]);
  expect(typesOf(DATA, { species: 'Marowak' }), 'an Alolan Marowak is Fire and Ghost').toEqual([
    ['Fire', 'Ghost'],
    ['Ground'],
  ]);
  expect(typesOf(DATA, { species: null })).toEqual([]);
});

test('the types its icons show narrow a species to its forms that have them', () => {
  expect(typesOf(DATA, { species: 'Marowak', types: ['Ghost', 'Fire'] }), 'in either order').toEqual([
    ['Fire', 'Ghost'],
  ]);
  expect(typesOf(DATA, { species: 'Marowak', types: ['Ground'] })).toEqual([['Ground']]);
  expect(typesOf(DATA, { species: 'Marowak', types: ['Fire'] }), 'one of two read, which no form is').toEqual([
    ['Fire', 'Ghost'],
    ['Ground'],
  ]);
});

test('damage is power, times STAB, times what each of the defender’s types makes of it', () => {
  expect(damage(DATA, 'Hydro Pump', [['Water']], [['Fire']])).toBeCloseTo(130 * 1.2 * 1.6);
  expect(damage(DATA, 'Avalanche', [['Water']], [['Dragon', 'Flying']])).toBeCloseTo(90 * 1.6 * 1.6);
  expect(damage(DATA, 'Avalanche', [], []), 'unknowns are neutral').toBe(90);
  expect(damage(DATA, 'Not A Move', [], [])).toBe(0);
  expect(
    damage(DATA, 'Stone Edge', typesOf(DATA, { species: 'Tyranitar' }), typesOf(DATA, { species: 'Moltres' })),
    'Rock into a Galarian Moltres, Dark and Flying, rather than 2.56× into a Kantonian one',
  ).toBeCloseTo(100 * 1.2 * 1.6);
});

test('the best button is the move worth the most per energy against this opponent', () => {
  const kyogre = typesOf(DATA, { species: 'Kyogre' });

  expect(bestButton(DATA, KYOGRE, kyogre, typesOf(DATA, { species: 'Entei' }))?.x, 'Hydro Pump into Entei').toBe(0.31);
  expect(bestButton(DATA, KYOGRE, kyogre, typesOf(DATA, { species: 'Salamence' }))?.x, 'Avalanche into Salamence').toBe(
    0.69,
  );
  expect(bestButton(DATA, KYOGRE, [], [])?.x, 'Avalanche on power alone, 2 per energy to Hydro Pump’s 1.73').toBe(0.69);
});

/** The move `bestButton` holds for, by name, with `left` and `right` under the pair of buttons. */
const heldFor = (own: Shown, opponent: Shown, [left, right]: readonly [string, string], { lastHit = false } = {}) => {
  const moves = new Map([
    [0.31, left],
    [0.69, right],
  ]);
  const pick = bestButton(DATA, moves, typesOf(DATA, own), typesOf(DATA, opponent), { lastHit });

  return pick && moves.get(pick.x);
};

/**
 * The user's Ultra League team. Its Snorlax and Melmetal threw Body Slam and Dynamic Punch at unshielded opponents as
 * they lit, rather than hold for Earthquake and Hyper Beam.
 */
test('with no shield to bait, the move held for is the one worth the most per energy', () => {
  const snorlax = ['Earthquake', 'Body Slam'] as const;
  const melmetal = ['Hyper Beam', 'Dynamic Punch'] as const;

  expect(heldFor({ species: 'Snorlax' }, { species: 'Garchomp' }, snorlax), '1.95 per energy to 1.85').toBe(
    'Body Slam',
  );
  expect(heldFor({ species: 'Snorlax' }, { species: null }, snorlax), 'against an opponent not read').toBe('Body Slam');
  expect(heldFor({ species: 'Snorlax' }, { species: 'Ampharos' }, snorlax), 'super effective, 2.95 to 1.95').toBe(
    'Earthquake',
  );
  expect(heldFor({ species: 'Snorlax' }, { species: 'Giratina' }, snorlax), 'Body Slam doubly resisted, 0.76').toBe(
    'Earthquake',
  );
  expect(heldFor({ species: 'Melmetal' }, { species: 'Garchomp' }, melmetal), '2 per energy to 1.88').toBe(
    'Dynamic Punch',
  );
  expect(heldFor({ species: 'Melmetal' }, { species: 'Sylveon' }, melmetal), 'Fighting resisted, 1.25 to 1.88').toBe(
    'Hyper Beam',
  );
});

test('a move that lowers our defense gives way to one within 10 energy and worth more than 0.7 of it per energy', () => {
  const moltres = { species: 'Moltres', types: ['Dark', 'Flying'] };
  const fly = new Map([
    [0.31, 'Fly'],
    [0.69, 'Brave Bird'],
  ]);
  const machamp = typesOf(DATA, { species: 'Machamp' });
  const combat = new Map([
    [0.31, 'Close Combat'],
    [0.69, 'Rock Slide'],
  ]);

  expect(
    bestButton(DATA, fly, typesOf(DATA, moltres), []),
    'Fly, 2.13 per energy, 0.75 of Brave Bird’s 2.84 and 10 cheaper',
  ).toEqual({ x: 0.31, bait: false, why: 'Brave Bird lowers our defense; Fly is worth 75% of it per energy' });
  expect(bestButton(DATA, fly, typesOf(DATA, moltres), [], { lastHit: true })?.x, 'on our last hit').toBe(0.69);
  expect(bestButton(DATA, combat, machamp, [])?.x, 'Close Combat, 2.67 to Rock Slide’s 1.67, 0.63 of it').toBe(0.31);
  expect(
    bestButton(
      DATA,
      new Map([
        [0.31, 'Wild Charge'],
        [0.69, 'Thunderbolt'],
      ]),
      typesOf(DATA, { species: 'Raikou' }),
      [],
      { bait: true },
    ),
    'Raikou’s Thunderbolt, 0.74 of Wild Charge per energy, and Wild Charge saving only 10 as the bait',
  ).toEqual({
    x: 0.69,
    bait: false,
    why: 'Wild Charge lowers our defense; Thunderbolt is worth 74% of it per energy; not baiting: Wild Charge costs only 10 less than Thunderbolt',
  });
});

/** Battle 2 of a Master League set on a Pixel 8 Pro, 2026-10-29, in which Xerneas threw Moonblast at Regigigas twice. */
test('Xerneas throws Close Combat at a Regigigas, 3.56 per energy to Moonblast’s 2.20', () => {
  const xerneas = new Map([
    [0.31, 'Moonblast'],
    [0.69, 'Close Combat'],
  ]);
  const own = typesOf(DATA, { species: 'Xerneas' });
  const regigigas = typesOf(DATA, { species: 'Regigigas' });

  expect(bestButton(DATA, xerneas, own, regigigas, { bait: true }), 'the cheaper, and the bait').toEqual({
    x: 0.69,
    bait: true,
  });
  expect(bestButton(DATA, xerneas, own, regigigas), 'with no shield to bait').toEqual({ x: 0.69, bait: false });
});

test('of two worth as much per energy, the cheaper is held for, whatever the last bit of the arithmetic says', () => {
  const dewgong = new Map([
    [0.31, 'Water Pulse'],
    [0.69, 'Icy Wind'],
  ]);
  const own = typesOf(DATA, { species: 'Dewgong' });

  expect(worth(DATA, 'Icy Wind', own, []) / 45, 'the floats split the tie for Water Pulse').toBeLessThan(
    worth(DATA, 'Water Pulse', own, []) / 50,
  );
  expect(bestButton(DATA, dewgong, own, [])?.x, 'Icy Wind, 86.4 for 45, over Water Pulse, 96 for 50: 1.92 each').toBe(
    0.69,
  );
});

test('a move whose energy is not known is worth nothing per energy', () => {
  const unknown = new Map([
    [0.31, 'Not A Move'],
    [0.69, 'Body Slam'],
  ]);

  expect(bestButton(DATA, unknown, [], [])?.x).toBe(0.69);
});

test('a move is worth its damage, moved by the stat stages it may change as if each touched one more hit', () => {
  expect(worth(DATA, 'Rock Slide', [], []), 'no stages').toBe(75);
  expect(
    worth(DATA, 'Ancient Power', [], []),
    'a tenth of a chance at +1 attack, its +1 defense uncounted',
  ).toBeCloseTo(60 * 1.025);
  expect(worth(DATA, 'Rock Tomb', [], []), 'their attack −1 every time').toBeCloseTo(75 * 1.2);
  expect(worth(DATA, 'Overheat', [], []), 'our attack −2 every time').toBeCloseTo((130 * 2) / 3);
  expect(worth(DATA, 'Close Combat', [], []), 'our defense −2 left to `bestButton`').toBe(100);
  expect(worth(DATA, 'Superpower', [], []), 'its attack −1 counted, its defense −1 not').toBeCloseTo(85 * 0.8);
  expect(worth(DATA, 'Not A Move', [], [])).toBe(0);
});

test('the best button counts what a move does to either side’s stats as well as the damage', () => {
  const tomb = new Map([
    [0.31, 'Rock Tomb'],
    [0.69, 'Power Gem'],
  ]);
  const fire = new Map([
    [0.31, 'Overheat'],
    [0.69, 'Flamethrower'],
  ]);

  expect(bestButton(DATA, tomb, [], [])?.x, 'Rock Tomb, 75 and their attack −1, over Power Gem’s 85').toBe(0.31);
  expect(bestButton(DATA, fire, [], [])?.x, 'Flamethrower, 90, over an Overheat that leaves ours −2 to attack').toBe(
    0.69,
  );
});

test('on our last hit, a move’s stages on our side count for nothing, and those on theirs still count', () => {
  const lastHit = { lastHit: true };
  const fire = new Map([
    [0.31, 'Overheat'],
    [0.69, 'Flamethrower'],
  ]);

  expect(worth(DATA, 'Overheat', [], [], lastHit), 'no next throw for our attack −2 to cost').toBe(130);
  expect(worth(DATA, 'Ancient Power', [], [], lastHit), 'nor for our attack +1 to help').toBe(60);
  expect(worth(DATA, 'Rock Tomb', [], [], lastHit), 'their attack −1 lasts on them').toBeCloseTo(75 * 1.2);
  expect(bestButton(DATA, fire, [], [], lastHit)?.x, 'Overheat, 130 to 90').toBe(0.31);
});

test('the slot out is the first not fainted whose species can hold the moves read', () => {
  const party = ['Latias', 'Mamoswine', 'Giratina'];
  const none = new Set<number>();

  expect(activeOf(DATA, party, none, []), 'the lead, before anything is read').toBe(0);
  expect(activeOf(DATA, party, new Set([0]), []), 'the first of the rest after a faint').toBe(1);
  expect(activeOf(DATA, party, none, ['Avalanche']), 'Latias cannot hold Avalanche; Mamoswine can').toBe(1);
  expect(activeOf(DATA, party, none, ['Shadow Sneak'])).toBe(2);
  expect(activeOf(DATA, [null, 'Mamoswine'], none, ['Shadow Sneak']), 'an unread card cannot be ruled out').toBe(0);
  expect(activeOf(DATA, party, none, ['Hydro Pump']), 'none of them').toBe(undefined);
  expect(activeOf(DATA, party, new Set([0, 1, 2]), [])).toBe(undefined);
  expect(activeOf(DATA, [], none, []), 'a run started mid-battle, past the party screen').toBe(undefined);
});

test('a shield is taken unless none of the opponent’s charged moves is super effective', () => {
  expect(shouldShield(DATA, { species: 'Latias' }, { species: 'Glaceon' }), 'Avalanche into Dragon').toBe(true);
  expect(shouldShield(DATA, { species: 'Giratina' }, { species: 'Sneasel' }), 'Foul Play into Ghost').toBe(true);
  expect(shouldShield(DATA, { species: 'Kyogre' }, { species: 'Entei' }), 'nothing of Entei’s beats Water').toBe(false);
  expect(shouldShield(DATA, { species: 'Latias' }, { species: 'Entei' })).toBe(false);
  expect(shouldShield(DATA, { species: null }, { species: 'Entei' }), 'our species unknown').toBe(true);
  expect(shouldShield(DATA, { species: 'Kyogre' }, { species: null }), 'theirs unknown').toBe(true);
  expect(shouldShield(DATA, { species: 'Marowak' }, { species: 'Entei' }), 'Solar Beam into a Kantonian Marowak').toBe(
    true,
  );
});

test.each<[string, string[] | null, boolean, string]>([
  ['Moltres', null, true, 'a Galarian one’s Payback into Psychic'],
  ['Moltres', ['Dark', 'Flying'], true, 'a Galarian one’s Payback into Psychic'],
  ['Moltres', ['Fire', 'Flying'], false, 'nothing of a Kantonian one’s beats Psychic'],
  ['Marowak', ['Fire', 'Ghost'], true, 'an Alolan one’s Shadow Ball into Psychic'],
  ['Marowak', ['Ground'], false, 'nothing of a Kantonian one’s beats Psychic'],
  ['Moltres', ['Fire'], true, 'a typing no form has, which narrows nothing'],
])('Mewtwo against %s shown as %j shields: %s, %s', (opponent, types, shield) => {
  expect(shouldShield(DATA, { species: 'Mewtwo', types: ['Psychic'] }, { species: opponent, types })).toBe(shield);
});

test('while baiting, the cheapest move is best whatever it hits for', () => {
  const kyogre = typesOf(DATA, { species: 'Kyogre' });
  const entei = typesOf(DATA, { species: 'Entei' });

  expect(bestButton(DATA, KYOGRE, kyogre, entei)?.x, 'Hydro Pump into Entei once its shields are gone').toBe(0.31);
  expect(
    bestButton(DATA, KYOGRE, kyogre, entei, { bait: true })?.x,
    'Avalanche, 45 to Hydro Pump’s 75, while they are up',
  ).toBe(0.69);
  expect(
    bestButton(DATA, new Map([[0.499, 'Hydro Pump']]), kyogre, entei, { bait: true })?.x,
    'one move baits too',
  ).toBe(0.499);
  expect(bestButton(DATA, KYOGRE, kyogre, entei, { bait: true }), 'Avalanche saves 30').toEqual({
    x: 0.69,
    bait: true,
  });
});

test('a bait saving no more than `BAIT_SAVES` is not thrown, the move worth the most per energy going instead', () => {
  const togekiss = new Map([
    [0.31, 'Ancient Power'],
    [0.69, 'Flamethrower'],
  ]);

  expect(
    bestButton(DATA, togekiss, typesOf(DATA, { species: 'Togekiss' }), typesOf(DATA, { species: 'Scizor' }), {
      bait: true,
    }),
    'Ancient Power, 45, saves only 10 on Flamethrower, 55 and 2.56× into Scizor',
  ).toEqual({ x: 0.69, bait: false, why: 'not baiting: Ancient Power costs only 10 less than Flamethrower' });
  expect(
    bestButton(
      DATA,
      new Map([
        [0.31, 'Night Slash'],
        [0.69, 'Trailblaze'],
      ]),
      [],
      [],
      { bait: true },
    ),
    'Night Slash, 35, saves 10 on Trailblaze, 45, too',
  ).toMatchObject({ x: 0.69, bait: false });
  expect(
    bestButton(DATA, togekiss, typesOf(DATA, { species: 'Togekiss' }), typesOf(DATA, { species: 'Charizard' }), {
      bait: true,
    }),
    'Ancient Power, 2.56× into Charizard, is the bait and the move worth the most',
  ).toEqual({ x: 0.31, bait: true });
  expect(
    bestButton(
      DATA,
      new Map([
        [0.31, 'Moonblast'],
        [0.69, 'Meteor Mash'],
      ]),
      typesOf(DATA, { species: 'Clefable' }),
      [],
      { bait: true },
    ),
    'Meteor Mash, 2.22 to Moonblast’s 2.20, is the bait and the move worth the most per energy, though it saves 5',
  ).toEqual({ x: 0.69, bait: true });
});

test.each<[(string | null)[], number[], string, number | undefined, string]>([
  [['Latias', 'Mamoswine', 'Giratina'], [0], 'Glaceon', 1, 'none safe from Glaceon; Mamoswine hits hardest'],
  [['Tyranitar', 'Giratina', 'Kyogre'], [0], 'Salamence', 2, 'Kyogre the one Salamence cannot hit hard'],
  [['Tyranitar', 'Giratina', 'Kyogre'], [0], 'Entei', 2, 'both safe from Entei; Kyogre hits hardest'],
  [['Kyogre', null, 'Giratina'], [0], 'Entei', 2, 'a named safe card ahead of an unread one'],
  [['Tyranitar', 'Kyogre', 'Tyranitar'], [0], 'Moltres', 2, 'Stone Edge into either Moltres beats Hydro Pump'],
  [
    ['Swampert', 'Charizard', 'Mamoswine'],
    [0],
    'Quaquaval',
    2,
    'High Horsepower beats Fire Blast; a purified one’s Return, 130 for either, decides nothing',
  ],
  [['Kyogre', 'Tyranitar', 'Giratina'], [0, 1, 2], 'Entei', undefined, 'nobody left'],
])('after a faint, %o less %o against %s sends in slot %s: %s', (party, fainted, opponent, slot) => {
  expect(nextOut(DATA, party, new Set(fainted), { species: opponent })?.slot).toBe(slot);
});

test.each<[(string | null)[], number[], string, string]>([
  [['Kyogre', 'Tyranitar', 'Giratina'], [0, 1], 'Entei', 'the last left'],
  [['Tyranitar', 'Giratina', 'Kyogre'], [0], 'Salamence', "the only one safe from Salamence's moves"],
  [['Tyranitar', 'Giratina', 'Kyogre'], [0], 'Entei', "safe from Entei's moves, and hits hardest (Hydro Pump)"],
  [['Latias', 'Mamoswine', 'Giratina'], [0], 'Glaceon', "none safe from Glaceon's moves; hits hardest (Stone Edge)"],
  [['Tyranitar', 'Kyogre', 'Tyranitar'], [1], 'Moltres', 'first card, nothing to choose between them'],
])('after a faint, %o less %o against %s says why it sends in whom it does: %s', (party, fainted, opponent, why) => {
  expect(nextOut(DATA, party, new Set(fainted), { species: opponent })?.why).toBe(why);
});

test.each<[(string | null)[], number, number[], string | null, number | undefined, string]>([
  [['Tyranitar', 'Kyogre', 'Giratina'], 0, [], 'Salamence', 1, 'Kyogre is safe, and Blizzard beats Salamence'],
  [['Tyranitar', 'Giratina', 'Kyogre'], 0, [], 'Salamence', 2, 'whichever card it is on'],
  [['Kyogre', 'Tyranitar', 'Kyogre'], 1, [], 'Salamence', 0, 'the first of two equals, the one out passed over'],
  [['Tyranitar', 'Kyogre', 'Giratina'], 0, [1], 'Salamence', undefined, 'the counter fainted'],
  [['Tyranitar', 'Giratina', null], 0, [], 'Salamence', undefined, 'Outrage beats Giratina; an unread card is none'],
  [['Kyogre', 'Tyranitar', 'Giratina'], 0, [], 'Salamence', undefined, 'Kyogre is not threatened by Salamence'],
  [['Latias', 'Kyogre'], 0, [], 'Glaceon', undefined, 'Kyogre is safe from Glaceon, but nothing of its beats it'],
  [
    ['Latias', 'Mamoswine'],
    0,
    [],
    'Sneasel',
    undefined,
    'Stone Edge beats a Sneasel, but Close Combat beats Mamoswine',
  ],
  [['Tyranitar', 'Kyogre'], 0, [], null, undefined, 'theirs not read'],
  [[null, 'Kyogre'], 0, [], 'Salamence', undefined, 'ours not read'],
])('with %o, slot %s out, less %o, against %s switches to slot %s: %s', (party, out, fainted, opponent, slot) => {
  expect(
    counterOf(DATA, party, out, { species: party[out] ?? null }, new Set(fainted), { species: opponent })?.slot,
  ).toBe(slot);
});

test('a counter says why it was switched to', () => {
  expect(
    counterOf(DATA, ['Tyranitar', 'Kyogre'], 0, { species: 'Tyranitar' }, new Set(), { species: 'Salamence' })?.why,
  ).toBe("Tyranitar is hit super effectively; Blizzard is, and nothing of Salamence's is");
});

/**
 * A Giratina whose Dragon Pulse was banked on the bench finishes Salamence as it lands, which comes before Kyogre being
 * the one safe from Salamence's moves: the opponent gone, nothing of its lands on Giratina.
 */
test('after a faint, sends in the one whose banked energy finishes the opponent, ahead of the one safe from it', () => {
  const party = ['Tyranitar', 'Giratina', 'Kyogre'];
  const banked = new Map([[1, 'Dragon Pulse']]);

  expect(nextOut(DATA, party, new Set([0]), { species: 'Salamence' }, null, banked)).toEqual({
    slot: 1,
    why: 'its banked Dragon Pulse finishes Salamence',
  });
  expect(nextOut(DATA, party, new Set([0, 1]), { species: 'Salamence' }, null, banked)?.slot, 'it fainted').toBe(2);
});

test.each<[(string | null)[], number, number[], string | null, number | undefined, string]>([
  [['Latias', 'Kyogre'], 0, [], 'Glaceon', 1, 'Kyogre is safe from Glaceon, though nothing of its beats it'],
  [['Tyranitar', 'Giratina', 'Kyogre'], 0, [], 'Salamence', 2, 'Giratina is hit by Outrage; Kyogre is not'],
  [['Tyranitar', 'Kyogre', 'Kyogre'], 0, [1], 'Salamence', 2, 'the one safe fainted, the other taken'],
  [['Latias', 'Mamoswine'], 0, [], 'Sneasel', undefined, 'Close Combat hits Mamoswine'],
  [['Kyogre', 'Tyranitar'], 0, [], 'Salamence', undefined, 'Kyogre is not threatened by Salamence'],
  [['Latias', 'Kyogre'], 0, [], null, undefined, 'theirs not read'],
  [[null, 'Kyogre'], 0, [], 'Glaceon', undefined, 'ours not read'],
  [['Latias', null], 0, [], 'Glaceon', undefined, 'an unread card is not known safe'],
])(
  'with %o, slot %s out, less %o, against %s banks by switching to slot %s: %s',
  (party, out, fainted, opponent, slot) => {
    expect(
      refugeOf(DATA, party, out, { species: party[out] ?? null }, new Set(fainted), { species: opponent })?.slot,
    ).toBe(slot);
  },
);

test('a refuge says why it was switched to', () => {
  expect(refugeOf(DATA, ['Latias', 'Kyogre'], 0, { species: 'Latias' }, new Set(), { species: 'Glaceon' })?.why).toBe(
    "Latias is hit super effectively and banks its energy; Kyogre is safe from Glaceon's moves",
  );
});

test.each<[number[], [number, string[]][], string | null, number | undefined, string]>([
  [[], [[1, ['Dragon Pulse']]], 'Salamence', 1, 'the one with energy banked'],
  [
    [],
    [
      [1, ['Dragon Pulse']],
      [2, ['Surf']],
    ],
    'Salamence',
    2,
    'Kyogre safe from Salamence, Giratina not',
  ],
  [[], [[0, ['Stone Edge']]], 'Salamence', undefined, 'only the one out has any banked'],
  [[1], [[1, ['Dragon Pulse']]], 'Salamence', undefined, 'the one with energy banked fainted'],
  [[], [[1, []]], 'Salamence', undefined, 'nothing lit as it left'],
  [[], [[1, ['Dragon Pulse']]], null, undefined, 'theirs not read'],
])('less %o, with %o banked, against %s draws the shield with slot %s: %s', (fainted, banked, opponent, slot) => {
  expect(
    stripperOf(DATA, ['Tyranitar', 'Giratina', 'Kyogre'], 0, new Set(fainted), new Map(banked), { species: opponent })
      ?.slot,
  ).toBe(slot);
});

test('a shield drawer says why it was switched to', () => {
  const banked = new Map([[1, ['Surf', 'Blizzard']]]);

  expect(stripperOf(DATA, ['Tyranitar', 'Kyogre'], 0, new Set(), banked, { species: 'Salamence' })?.why).toBe(
    "Kyogre has Surf and Blizzard banked to draw Salamence's shield",
  );
});

test('no button is best while one of a pair has no move read under it', () => {
  expect(bestButton(DATA, new Map([[0.69, 'Avalanche']]), [], [])?.x).toBe(undefined);
  expect(bestButton(DATA, new Map(), [], [])?.x).toBe(undefined);
  expect(bestButton(DATA, new Map([[0.499, 'Shadow Sneak']]), [], [])?.x).toBe(0.499);
});

test('of the lit buttons, the one worth the most is thrown now', () => {
  const kyogre = typesOf(DATA, { species: 'Kyogre' });
  const entei = typesOf(DATA, { species: 'Entei' });
  const fire = new Map([
    [0.31, 'Overheat'],
    [0.69, 'Flamethrower'],
  ]);
  const fly = new Map([
    [0.31, 'Fly'],
    [0.69, 'Brave Bird'],
  ]);

  expect(bestLit(DATA, KYOGRE, [0.69], kyogre, entei), 'Avalanche, the only one lit').toBe(0.69);
  expect(bestLit(DATA, KYOGRE, [0.31, 0.69], kyogre, entei), 'Hydro Pump, both lit').toBe(0.31);
  expect(bestLit(DATA, KYOGRE, [], kyogre, entei), 'none lit').toBe(undefined);
  expect(bestLit(DATA, new Map([[0.31, 'Hydro Pump']]), [0.69], kyogre, entei), 'no move read under it').toBe(
    undefined,
  );
  expect(bestLit(DATA, fire, [0.31, 0.69], [], []), 'Flamethrower over an Overheat that leaves ours −2').toBe(0.69);
  expect(bestLit(DATA, fire, [0.31, 0.69], [], [], { lastHit: true }), 'Overheat, on our last hit').toBe(0.31);
  expect(
    bestLit(DATA, fly, [0.31, 0.69], typesOf(DATA, { species: 'Moltres', types: ['Dark', 'Flying'] }), []),
    'Brave Bird, 156 to Fly’s 96, a throw that may be our last being worth what it hits for',
  ).toBe(0.69);
  expect(bestLit(DATA, GLACEON, [0.31, 0.69], typesOf(DATA, { species: 'Glaceon' }), []), 'Avalanche, 45 to 55').toBe(
    0.69,
  );
});

/**
 * Snorlax with Earthquake on the left and Body Slam on the right, holding for Body Slam into a Garchomp and for
 * Earthquake into an Ampharos, as `bestButton` does per energy; Glaceon holding for Avalanche over an Ice Beam as
 * strong; and Kyogre baiting Entei with Avalanche.
 */
test('before a feared faint, the lit move worth the most goes, passing over the move chosen where it is lit', () => {
  const fear = 'Psyshock would faint us, 40 energy affords it';
  const snorlax = new Map([
    [0.31, 'Earthquake'],
    [0.69, 'Body Slam'],
  ]);
  const own = typesOf(DATA, { species: 'Snorlax' });
  const garchomp = typesOf(DATA, { species: 'Garchomp' });
  const ampharos = typesOf(DATA, { species: 'Ampharos' });
  const slam = { x: 0.69, bait: false };
  const quake = { x: 0.31, bait: false };

  expect(beforeFainting(DATA, snorlax, [0.31, 0.69], own, garchomp, slam, fear), 'Earthquake, 120 to 78').toEqual({
    x: 0.31,
    bait: false,
    why: `${fear}; worth more than Body Slam`,
  });
  expect(beforeFainting(DATA, snorlax, [0.69], own, ampharos, quake, fear), 'Body Slam, the one lit').toEqual({
    x: 0.69,
    bait: false,
    why: `${fear}; not holding for Earthquake`,
  });
  expect(beforeFainting(DATA, snorlax, [0.31, 0.69], own, ampharos, quake, fear), 'the move chosen').toBe(undefined);
  expect(beforeFainting(DATA, snorlax, [], own, garchomp, slam, fear), 'nothing lit').toBe(undefined);
  expect(
    beforeFainting(
      DATA,
      GLACEON,
      [0.31, 0.69],
      typesOf(DATA, { species: 'Glaceon' }),
      [],
      { x: 0.69, bait: false },
      fear,
    ),
    'Avalanche, as good as Ice Beam for 10 less',
  ).toBe(undefined);
  expect(
    beforeFainting(
      DATA,
      KYOGRE,
      [0.31, 0.69],
      typesOf(DATA, { species: 'Kyogre' }),
      typesOf(DATA, { species: 'Entei' }),
      { x: 0.69, bait: true },
      fear,
    )?.why,
    'Hydro Pump over the bait',
  ).toBe(`${fear}; worth more than Avalanche`);
});

test('an opponent’s form is allowed for what its players run, of what it can hold', () => {
  const [alolan, kantonian] = ['Alola', null].map((form) =>
    DATA.forms.find((f) => f.species === 'Marowak' && f.form === form && !f.costume),
  );
  const ranked = ['Bone Club', 'Rock Slide', 'Earthquake', 'Shadow Bone', 'Flame Wheel', 'Shadow Ball', 'Return'];
  const marowak = metaOf('Marowak', ranked).movesets.get('Marowak');

  expect(kantonian && chargedOf(kantonian, marowak), 'Return, which players run').toStrictEqual([
    'Bone Club',
    'Earthquake',
    'Rock Slide',
    'Return',
  ]);
  expect(alolan && chargedOf(alolan, marowak)).toStrictEqual([
    'Bone Club',
    'Shadow Ball',
    'Flame Wheel',
    'Shadow Bone',
    'Return',
  ]);
  expect(kantonian && chargedOf(kantonian), 'without a meta, every move bar Frustration and Return').toStrictEqual([
    'Bone Club',
    'Dig',
    'Earthquake',
    'Rock Slide',
  ]);
  expect(
    kantonian && chargedOf(kantonian, metaOf('Marowak', ['Hydro Pump']).movesets.get('Marowak')),
    'nothing it can hold ranked, so as if unranked',
  ).toStrictEqual(['Bone Club', 'Dig', 'Earthquake', 'Rock Slide']);
});

test('a shield and who goes in allow for only what the opponent’s players run', () => {
  const pulse = metaOf('Glaceon', ['Water Pulse']);
  const party = ['Latias', 'Mamoswine', 'Giratina'];

  expect(shouldShield(DATA, { species: 'Latias' }, { species: 'Glaceon' }, pulse), 'Water Pulse into Dragon').toBe(
    false,
  );
  expect(shouldShield(DATA, { species: 'Latias' }, { species: 'Glaceon' }, metaOf('Glaceon', ['Avalanche']))).toBe(
    true,
  );
  expect(
    shouldShield(DATA, { species: 'Latias' }, { species: 'Glaceon' }, metaOf('Entei', [])),
    'a meta without Glaceon',
  ).toBe(true);
  expect(
    nextOut(DATA, party, new Set([0]), { species: 'Glaceon' }, pulse)?.slot,
    'Giratina takes Water Pulse; Mamoswine does not',
  ).toBe(2);
});
