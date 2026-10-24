/**
 * The damage model against the vended game master, on the pairing that asked for it: a CP 2495 Charizard of ours
 * against a CP 1826 Magmar in Ultra League.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { cpOf, multiplierOf, type Form, type GameData } from '../inventory/game-master.mts';
import { afterThrow, buildsOf, hit, NO_STAGES, rankOne, wouldFaint, type Side, type Stages } from './damage.mts';
import { type Meta } from './meta.mts';

const DATA = JSON.parse(
  readFileSync(new URL('../inventory/fixtures/game-master.json', import.meta.url), 'utf8'),
) as GameData;

const ULTRA = 2500;
const CHARIZARD = { species: 'Charizard', cp: 2495 };
const MAGMAR = { species: 'Magmar', cp: 1826 };

function formOf(species: string): Form {
  const form = DATA.forms.find((f) => f.species === species && !f.costume);

  if (!form) {
    throw new Error(`no ${species}`);
  }

  return form;
}

test('a Great League Azumarill at its rank-1 CP is the published rank-1 build', () => {
  // DittoBase's Azumarill PvP page (dittobase.com/pokemon-go/pokedex/azumarill/pvp) gives Great League rank 1 as
  // 0/15/15 at level 45.5, CP 1499: attack 91.59, defense 136.57, HP 196, stat product 2,451,821.
  const build = rankOne(DATA, formOf('Azumarill'), 1499);

  expect(build).toMatchObject({ iv: { attack: 0, defense: 15, stamina: 15 }, level: 45.5, hp: 196 });
  expect(build?.attack).toBeCloseTo(91.59, 2);
  expect(build?.defense).toBeCloseTo(136.57, 2);
  expect(Math.round((build?.attack ?? 0) * (build?.defense ?? 0) * (build?.hp ?? 0))).toBe(2451821);
});

test('a CP read is matched exactly where some spread shows it, rank 1 among those', () => {
  const azumarill = formOf('Azumarill');
  const build = rankOne(DATA, azumarill, 1500);

  expect(build?.iv, 'rank 1 shows 1499, so a 1500 is something weaker').not.toEqual({
    attack: 0,
    defense: 15,
    stamina: 15,
  });
  expect(build && cpOf(azumarill, build.iv, multiplierOf(DATA, build.level) ?? 0)).toBe(1500);
  expect(rankOne(DATA, azumarill, 9), 'below the floor of 10').toBe(null);
});

test('every form of a species is built, none where the read cannot be one', () => {
  expect(buildsOf(DATA, CHARIZARD, ULTRA).map(({ form }) => form.form)).toEqual(['Copy 2019', null]);
  expect(buildsOf(DATA, { species: 'Charizard', cp: 2501 }, ULTRA), 'over the cap is a misread').toEqual([]);
  expect(buildsOf(DATA, { species: 'Charizard', cp: 2501 }, null), 'Master League has none').toHaveLength(2);
  expect(buildsOf(DATA, { species: 'Charizard', cp: null }, ULTRA)).toEqual([]);
  expect(buildsOf(DATA, { species: null, cp: 2495 }, ULTRA)).toEqual([]);
});

test('Magmar’s Fire Blast takes 71 of a CP 2495 Charizard’s 149 HP', () => {
  const [charizard] = buildsOf(DATA, CHARIZARD, ULTRA);
  const [magmar] = buildsOf(DATA, MAGMAR, ULTRA);
  const fireBlast = DATA.combat['Fire Blast'];

  // Magmar 1/15/15 at level 28.5 has attack 147.626; Charizard 0/15/9 at 35.5 defense 143.723 and 149 HP. Fire Blast
  // is 140 power with STAB, and Fire into Fire and Flying is 0.625 × 1:
  // floor(0.5 × 140 × 147.626 / 143.723 × 1.2 × 0.625 × 1.3) + 1 = floor(70.10) + 1 = 71.
  expect(magmar?.build).toMatchObject({ iv: { attack: 1, defense: 15, stamina: 15 }, level: 28.5 });
  expect(charizard?.build).toMatchObject({ iv: { attack: 0, defense: 15, stamina: 9 }, level: 35.5, hp: 149 });
  expect(magmar && charizard && fireBlast && hit(DATA, fireBlast, magmar, charizard)).toBe(71);
});

test.each<[number, boolean, string]>([
  [0.3, true, 'Fire Blast’s 71 is more than the 45 left'],
  [0.5, true, '71 is past nine tenths of the 74 left'],
  [0.6, false, 'nor 71 of 89'],
  [0.9, false, 'still less of 134'],
])('a CP 2495 Charizard at %s HP would faint to a CP 1826 Magmar: %s, %s', (hp, faints) => {
  expect(wouldFaint(DATA, CHARIZARD, MAGMAR, hp, ULTRA).faints).toBe(faints);
});

test('Frustration and Return are left out, which only a shadow or a purified Magmar has', () => {
  // Return, 130 power and neutral on Charizard without STAB, would take floor(0.5 × 130 × 147.626 / 143.723 × 1.3) + 1
  // = 87, past nine tenths of the 89 HP left at 0.6.
  expect(wouldFaint(DATA, CHARIZARD, MAGMAR, 0.6, ULTRA).faints).toBe(false);
});

/** A meta in which `species` is run with `chargedMoves` alone. */
const metaOf = (species: string, chargedMoves: string[]): Meta => ({
  cup: 'all',
  cap: 2500,
  movesets: new Map([[species, { fast: '', fastMoves: [], chargedMoves }]]),
});

test('in a league PvPoke ranks, only the charged moves the opponent’s players run are allowed for', () => {
  expect(
    wouldFaint(DATA, CHARIZARD, MAGMAR, 0.5, ULTRA, metaOf('Magmar', ['Fire Punch'])).faints,
    'not Fire Blast',
  ).toBe(false);
  expect(wouldFaint(DATA, CHARIZARD, MAGMAR, 0.2, ULTRA, metaOf('Magmar', ['Fire Punch'])).faints, 'Fire Punch').toBe(
    true,
  );
  expect(wouldFaint(DATA, CHARIZARD, MAGMAR, 0.6, ULTRA, metaOf('Magmar', ['Return'])).faints, 'Return, run').toBe(
    true,
  );
  expect(wouldFaint(DATA, CHARIZARD, MAGMAR, 0.5, ULTRA, metaOf('Charizard', [])).faints, 'Magmar unranked').toBe(true);
});

test('only the charged moves the opponent can afford are allowed for, where its energy is counted', () => {
  // At 50%, Fire Blast's 71 of the 74 left faints; Flamethrower, Scorching Sands and Fire Punch do not.
  expect(wouldFaint(DATA, CHARIZARD, MAGMAR, 0.5, ULTRA, null, undefined, 60).faints, 'short of Fire Blast’s 80').toBe(
    false,
  );
  expect(wouldFaint(DATA, CHARIZARD, MAGMAR, 0.5, ULTRA, null, undefined, 80).faints).toBe(true);
  expect(
    wouldFaint(DATA, CHARIZARD, MAGMAR, 0.5, ULTRA, null, undefined, 10).faints,
    'too little for anything: the count is short',
  ).toBe(true);

  // Both of its moves seen, Fire Blast among them, and 60 energy: only Fire Punch is left to fear.
  const both = new Set(['Fire Blast', 'Fire Punch']);

  expect(
    wouldFaint(DATA, CHARIZARD, MAGMAR, 0.5, ULTRA, null, both, 60).faints,
    'the moves seen, then what it can afford',
  ).toBe(false);
  expect(wouldFaint(DATA, CHARIZARD, MAGMAR, 0.5, ULTRA, null, both, 80).faints).toBe(true);
  expect(
    wouldFaint(DATA, CHARIZARD, MAGMAR, 0.5, ULTRA, null, undefined, 60).why,
    'says the energy narrowed it',
  ).toMatch(/^Flamethrower would take ~\d+%, with 50% left, the hardest 60 energy affords$/);
});

test('the hardest move is named as afforded only where the counted energy affords it', () => {
  expect(wouldFaint(DATA, CHARIZARD, MAGMAR, 0.5, ULTRA, null, undefined, 80)).toMatchObject({
    faints: true,
    afforded: 'Fire Blast',
  });
  expect(
    wouldFaint(DATA, CHARIZARD, MAGMAR, 0.5, ULTRA, null, undefined, 60),
    'Flamethrower, short of faint',
  ).toMatchObject({ faints: false, afforded: 'Flamethrower' });
  expect(wouldFaint(DATA, CHARIZARD, MAGMAR, 0.5, ULTRA).afforded, 'no energy counted').toBe(undefined);
  expect(
    wouldFaint(DATA, CHARIZARD, MAGMAR, 0.5, ULTRA, null, undefined, 10).afforded,
    'too little for anything, every move feared',
  ).toBe(undefined);
  expect(wouldFaint(DATA, CHARIZARD, MAGMAR, null, ULTRA, null, undefined, 80).afforded, 'our HP unread').toBe(
    undefined,
  );
});

test('anything unknown counts as fainting', () => {
  expect(wouldFaint(DATA, { species: null, cp: 2495 }, MAGMAR, 0.9, ULTRA).faints, 'our species').toBe(true);
  expect(wouldFaint(DATA, CHARIZARD, { species: null, cp: 1826 }, 0.9, ULTRA).faints, 'theirs').toBe(true);
  expect(wouldFaint(DATA, { species: 'Charizard', cp: null }, MAGMAR, 0.9, ULTRA).faints, 'our CP').toBe(true);
  expect(wouldFaint(DATA, CHARIZARD, { species: 'Magmar', cp: null }, 0.9, null).faints, 'theirs, no cap').toBe(true);
  expect(wouldFaint(DATA, CHARIZARD, { species: 'Magmar', cp: 2826 }, 0.9, ULTRA).faints, 'over the cap').toBe(true);
  expect(wouldFaint(DATA, CHARIZARD, MAGMAR, null, ULTRA).faints, 'the HP left').toBe(true);
  expect(wouldFaint(DATA, CHARIZARD, { species: 'Not A Pokémon', cp: 1826 }, 0.9, ULTRA).faints).toBe(true);
});

test('their CP unread is taken as the cap, and says so', () => {
  const unread = { species: 'Magmar', cp: null };
  const atCap = wouldFaint(DATA, CHARIZARD, { species: 'Magmar', cp: ULTRA }, 0.9, ULTRA);

  expect(wouldFaint(DATA, CHARIZARD, unread, 0.9, ULTRA)).toEqual({
    faints: atCap.faints,
    why: `${atCap.why} (their CP unread, taken as the 2500 cap)`,
  });
  expect(atCap.faints, 'a hit it survives keeps the shield').toBe(false);
  expect(wouldFaint(DATA, { species: 'Charizard', cp: null }, MAGMAR, 0.9, ULTRA).why, 'ours is not').toBe(
    'our CP unread',
  );
});

test('says which hit it judged by, and how much of us it takes against what is left', () => {
  expect(wouldFaint(DATA, CHARIZARD, MAGMAR, 0.5, ULTRA)).toEqual({
    faints: true,
    why: 'Fire Blast would take ~48%, with 50% left',
  });
  expect(wouldFaint(DATA, CHARIZARD, MAGMAR, 0.6, ULTRA).why).toBe('Fire Blast would take ~48%, with 60% left');
});

test('names what it did not know, where that is why it shields', () => {
  const why = (own: Side, opponent: Side, hp: number | null = 0.9) => wouldFaint(DATA, own, opponent, hp, ULTRA).why;

  expect(why({ species: null, cp: 2495 }, MAGMAR)).toBe('our species unread');
  expect(wouldFaint(DATA, CHARIZARD, { species: 'Magmar', cp: null }, 0.9, null).why).toBe('their CP unread');
  expect(why(CHARIZARD, { species: 'Magmar', cp: 2826 })).toBe('their CP 2826 is over the 2500 cap, so misread');
  expect(why(CHARIZARD, MAGMAR, null)).toBe('our HP unread');
  expect(why(CHARIZARD, { species: 'Not A Pokémon', cp: 1826 })).toBe('no Not A Pokémon at CP 1826');

  // Two seen are all it has, which the game data must know to weigh.
  expect(wouldFaint(DATA, CHARIZARD, MAGMAR, 0.5, ULTRA, null, new Set(['Not A Move', 'Nor This'])).why).toBe(
    'no charged move known for Magmar',
  );
});

/**
 * Dialga, CP 2289, at 58% against Tyranitar, CP 2256, as in a live GO Battle League battle: Tyranitar's Fire Blast takes
 * about 80% of Dialga, Crunch about 48% and Stone Edge 43%. One move seen leaves Fire Blast possible as the other; both
 * seen, it is not.
 */
test.each<[string[], boolean]>([
  [[], true],
  [['Crunch'], true],
  [['Crunch', 'Stone Edge'], false],
  [['Crunch', 'Fire Blast'], true],
])('with %j seen, Tyranitar would faint Dialga at 58%: %s', (seen, faints) => {
  const own = { species: 'Dialga', cp: 2289 };
  const opponent = { species: 'Tyranitar', cp: 2256 };

  expect(wouldFaint(DATA, own, opponent, 0.58, 2500, null, new Set(seen)).faints).toBe(faints);
});

test('a stage up on the attacker’s attack or down on the defender’s defense moves the hit by `stage`', () => {
  const [charizard] = buildsOf(DATA, CHARIZARD, ULTRA);
  const [magmar] = buildsOf(DATA, MAGMAR, ULTRA);
  const fireBlast = DATA.combat['Fire Blast'];
  const fire = (attack?: number, defense?: number) =>
    magmar && charizard && fireBlast && hit(DATA, fireBlast, magmar, charizard, attack, defense);

  // The 70.10 under the 71 above, ×1.25 for +1 attack, ×1.5 for −2 defense and ×0.8 for −1 attack.
  expect(fire(1)).toBe(88);
  expect(fire(0, -2)).toBe(106);
  expect(fire(-1)).toBe(57);
  expect(fire(4, -4), 'twice over on each side').toBe(281);
});

/** Both sides' stages, theirs and ours, as `wouldFaint` takes them. */
const staged = (their: Partial<Stages>, own: Partial<Stages> = {}) => ({
  own: { ...NO_STAGES, ...own },
  their: { ...NO_STAGES, ...their },
});

test.each<[string, number, ReturnType<typeof staged>, boolean, string]>([
  [
    'Magmar a stage up on attack',
    0.6,
    staged({ attack: 1 }),
    true,
    'Fire Blast would take ~59%, with 60% left (their attack +1)',
  ],
  [
    'our defense down two after our Close Combat',
    0.75,
    staged({}, { defense: -2 }),
    true,
    'Fire Blast would take ~71%, with 75% left (our defense -2)',
  ],
  [
    'Magmar a stage down on attack after our Icy Wind',
    0.5,
    staged({ attack: -1 }),
    false,
    'Fire Blast would take ~38%, with 50% left (their attack -1)',
  ],
  [
    'our attack and their defense, which do not move its hit',
    0.6,
    staged({ defense: -2 }, { attack: 2 }),
    false,
    'Fire Blast would take ~48%, with 60% left',
  ],
])('with %s, at %s HP a CP 2495 Charizard would faint: %s', (_, hp, stages, faints, why) => {
  expect(wouldFaint(DATA, CHARIZARD, MAGMAR, hp, ULTRA, null, new Set(), undefined, stages)).toEqual({ faints, why });
});

test('only a stat change that always happens moves a stage, and no further than ±4', () => {
  const after = (name: string, user: Stages = NO_STAGES) => afterThrow(DATA.combat[name], user, NO_STAGES);

  expect(after('Close Combat')).toEqual([{ attack: 0, defense: -2 }, NO_STAGES]);
  expect(after('Superpower')).toEqual([{ attack: -1, defense: -1 }, NO_STAGES]);
  expect(after('Icy Wind')).toEqual([NO_STAGES, { attack: -1, defense: 0 }]);
  expect(after('Power-Up Punch', { attack: 1, defense: -3 })).toEqual([{ attack: 2, defense: -3 }, NO_STAGES]);
  expect(after('Ancient Power'), 'a tenth of a chance').toEqual([NO_STAGES, NO_STAGES]);
  expect(after('Fire Blast'), 'none at all').toEqual([NO_STAGES, NO_STAGES]);
  expect(afterThrow(undefined, NO_STAGES, NO_STAGES), 'a move not known').toEqual([NO_STAGES, NO_STAGES]);
  expect(after('Close Combat', { attack: 0, defense: -3 })).toEqual([{ attack: 0, defense: -4 }, NO_STAGES]);
  expect(after('Power-Up Punch', { attack: 4, defense: 0 })).toEqual([{ attack: 4, defense: 0 }, NO_STAGES]);
});
