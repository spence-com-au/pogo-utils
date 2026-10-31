/**
 * The arithmetic and the fuzzy matching, against the vended game master rather than the live one, a test of a reader
 * not being allowed to reach the network. `loadGameData` is therefore untested here; everything downstream of it is,
 * which is where the pipeline's claims live — CP and HP are pure functions of a form, three IVs and a level's
 * multiplier, and identifying a Pokémon is running them backwards.
 *
 * **Every expectation is derived from the formula and checked against a number the game printed** rather than recorded
 * from a run of the code, which would pass whatever the code did.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  closest,
  cpOf,
  distance,
  fitsHeight,
  hpOf,
  levelsOf,
  multiplierOf,
  type Form,
  type GameData,
} from './game-master.mts';

const DATA = JSON.parse(readFileSync(new URL('fixtures/game-master.json', import.meta.url), 'utf8')) as GameData;

const form = (species: string, name: string | null = null) => {
  const found = DATA.forms.find((f) => f.species === species && f.form === name && !f.costume);

  if (!found) {
    throw new Error(`${species} ${name} is not in the vended game master`);
  }

  return found;
};

const iv = (attack: number, defense: number, stamina: number) => ({ attack, defense, stamina });

/**
 * The fixture's own shape, pinned because every assertion below is read out of it and a truncated or swapped file
 * would otherwise surface as arithmetic that has stopped agreeing with the game. `JSON.parse` answers `any`, so the
 * cast above is unchecked and this is the only thing standing behind it.
 *
 * Expect these to move when upstream releases a species, and read that as the vend being reviewed rather than as the
 * suite breaking: `pnpm vend:game-master` prints exactly these five figures as it writes the file.
 */
test('the vended game master is the shape the readers are asserted against', () => {
  expect({
    forms: DATA.forms.length,
    species: DATA.species.length,
    moves: DATA.moves.length,
    types: DATA.types.length,
    cpm: DATA.cpm.length,
  }).toStrictEqual({ forms: 1473, species: 1024, moves: 328, types: 18, cpm: 101 });
});

/**
 * The type chart's order, which `loadGameData` writes down because the game master does not say it. One matchup per
 * row of the game's own chart, each one a pair the alphabetical order the templates come in would get wrong, so
 * reading the scalars in that order instead fails here.
 */
test('the type chart reads in the order the game deals damage', () => {
  const chart = DATA.effectiveness;

  expect([
    chart['Fire']?.['Grass'],
    chart['Water']?.['Fire'],
    chart['Grass']?.['Water'],
    chart['Electric']?.['Ground'],
    chart['Normal']?.['Ghost'],
    chart['Fighting']?.['Ghost'],
    chart['Dragon']?.['Fairy'],
    chart['Poison']?.['Steel'],
    chart['Ice']?.['Dragon'],
    chart['Psychic']?.['Dark'],
    chart['Ground']?.['Flying'],
    chart['Dark']?.['Psychic'],
  ]).toStrictEqual([1.6, 1.6, 1.6, 0.390625, 0.390625, 0.390625, 0.390625, 0.390625, 1.6, 0.390625, 0.390625, 1.6]);
  expect(Object.keys(chart).sort()).toStrictEqual([...DATA.types].sort());
});

/**
 * The trainer-battle numbers rather than the raid ones, and the ordinary move where a name is several: the game's
 * battle screen prints only Hydro Pump, which is 130 for everyone but the Blastoise that has its own 90.
 */
test('a move is read with its trainer-battle power, energy and turns', () => {
  expect(DATA.combat['Hydro Pump']).toStrictEqual({ type: 'Water', power: 130, energy: -75, turns: 1 });
  expect(DATA.combat['Avalanche']).toStrictEqual({ type: 'Ice', power: 90, energy: -45, turns: 1 });
  expect(DATA.combat['Shadow Sneak']).toStrictEqual({ type: 'Ghost', power: 75, energy: -50, turns: 1 });
  expect(DATA.combat['Mud Shot'], 'a fast move gains energy').toStrictEqual({
    type: 'Ground',
    power: 3,
    energy: 9,
    turns: 2,
  });
  expect(DATA.combat['Lock-On']?.turns, 'one turn, its `durationTurns` left out').toBe(1);
  expect(DATA.combat['Confusion']?.turns).toBe(4);
});

/**
 * The multiplier table, which is the one input neither formula can derive. The game master carries a value per whole
 * level and `loadGameData` fills in the half steps, each the root mean square of the two either side.
 *
 * What this can and cannot say is worth being exact about, because it is not what it looks like. It reads the **vended
 * table**, where the half steps are already computed, so it asserts that the file is self-consistent and not that the
 * code which built it is right — measured by replacing that root mean square with an arithmetic one and watching
 * every assertion here pass. Only `pnpm vend:game-master` runs the interpolation, so only a re-vend can move it, and
 * the diff of that re-vend is where it would be seen.
 */
test('the multiplier table runs from 1 to 51 in half steps', () => {
  expect(DATA.cpm[0]?.[0], 'the table no longer starts at level 1').toBe(1);
  expect(DATA.cpm.at(-1)?.[0], 'the table no longer stops at level 51').toBe(51);
  expect(multiplierOf(DATA, 1)).toBeCloseTo(0.094, 6);
  expect(multiplierOf(DATA, 40)).toBeCloseTo(0.7903, 4);

  // Half levels exist and whole ones above the top do not, which is what a reader offering `51.5` has to be told.
  expect(multiplierOf(DATA, 20.5)).not.toBe(null);
  expect(multiplierOf(DATA, 51.5), 'the half steps no longer stop at 51').toBe(null);
  expect(multiplierOf(DATA, 0), 'there is no level 0').toBe(null);

  const whole = multiplierOf(DATA, 20) ?? 0;
  const next = multiplierOf(DATA, 21) ?? 0;
  expect(multiplierOf(DATA, 20.5), 'a half level is no longer the root mean square of its neighbours').toBeCloseTo(
    Math.sqrt((whole * whole + next * next) / 2),
    12,
  );
});

/**
 * CP against three numbers the game itself printed on a committed capture, which is the only way to check this that is
 * not a restatement of the formula. Each is a species, a level and a triple read off the screen, and each derives the
 * CP that screen shows.
 */
test('a CP derives to the number the game printed', () => {
  for (const [species, name, level, ivs, cp] of [
    ['Ho-Oh', null, 25, iv(13, 15, 15), 2738],
    ['Nidoran♂', null, 20, iv(15, 15, 15), 491],
    ['Thundurus', 'Incarnate', 20, iv(7, 7, 10), 1792],
  ] as [string, string | null, number, ReturnType<typeof iv>, number][]) {
    const multiplier = multiplierOf(DATA, level);
    expect(multiplier, `there is no multiplier for level ${level}`).not.toBe(null);
    expect(cpOf(form(species, name), ivs, multiplier ?? 0), `${species} at level ${level}`).toBe(cp);
  }
});

/**
 * That a form differing only in attack and defense derives a different CP, which is the whole reason to reach for the
 * printed one: HP is a function of stamina alone, so every other test on the screen is blind to the pair.
 */
test('two forms sharing a stamina derive the same HP and different CPs', () => {
  const multiplier = multiplierOf(DATA, 20) ?? 0;
  const incarnate = form('Thundurus', 'Incarnate');
  const therian = form('Thundurus', 'Therian');
  const ivs = iv(7, 7, 10);

  expect(incarnate.stamina, 'the pair no longer shares a stamina, so this says nothing').toBe(therian.stamina);
  expect(hpOf(incarnate, ivs, multiplier)).toBe(hpOf(therian, ivs, multiplier));
  expect([cpOf(incarnate, ivs, multiplier), cpOf(therian, ivs, multiplier)]).toStrictEqual([1792, 1965]);
});

test('an HP derives to the number under the name, and is a function of stamina alone', () => {
  const thundurus = form('Thundurus', 'Incarnate');
  const multiplier = multiplierOf(DATA, 20) ?? 0;

  expect(hpOf(thundurus, iv(7, 7, 10), multiplier)).toBe(118);
  expect(
    hpOf(thundurus, iv(15, 0, 10), multiplier),
    'the attack and defense IVs reached the HP, which they must not',
  ).toBe(118);
});

/**
 * The size bands, each one `heights[i]` to `heights[i + 1]` metres. Pikachu's are 0.49, 0.5, 0.75, 1.25, 1.5 and 1.75
 * times its 0.4m, so a 0.55m Pikachu wears an XL badge and a 0.4m one wears none.
 */
test('a height fits the band its badge names and no other', () => {
  const pikachu = form('Pikachu');

  expect(pikachu.heights).toStrictEqual([0.196, 0.2, 0.3, 0.5, 0.6, 0.7]);
  expect([fitsHeight(pikachu, 0.55, 'XL'), fitsHeight(pikachu, 0.55, null)]).toStrictEqual([true, false]);
  expect([fitsHeight(pikachu, 0.4, null), fitsHeight(pikachu, 0.4, 'XL')]).toStrictEqual([true, false]);
  expect([fitsHeight(pikachu, 0.25, 'XS'), fitsHeight(pikachu, 0.65, 'XXL')]).toStrictEqual([true, true]);
  expect([fitsHeight(pikachu, 0.25, 'XXS'), fitsHeight(pikachu, 0.65, 'XL')]).toStrictEqual([false, false]);
});

/**
 * The height the game prints is rounded to the centimetre, so a band reaches half a centimetre past either edge the
 * game master gives it: `smoliv.png` prints 0.15m under an XXS badge, which Smoliv's 0.147 to 0.15 holds only once the
 * rounding is allowed for, where 0.16m is a centimetre past it.
 */
test('a printed height is allowed the half centimetre it was rounded by', () => {
  const smoliv = form('Smoliv');

  expect(smoliv.heights?.slice(0, 2)).toStrictEqual([0.147, 0.15]);
  expect(fitsHeight(smoliv, 0.15, 'XXS')).toBe(true);
  expect(fitsHeight(smoliv, 0.16, 'XXS')).toBe(false);
});

/** A form the game master gives no bands, as it gives Minior's Meteor forms none, is one no height rules out. */
test('a form with no bands fits every height', () => {
  const meteor = form('Minior', 'Meteor');

  expect(meteor.heights).toBe(null);
  expect(fitsHeight(meteor, 100, 'XXS')).toBe(true);
});

/**
 * Running `hpOf` backwards, which is how a level is settled. It can answer more than one level, because `hpOf` floors
 * and two neighbouring multipliers land on the same integer — which is what the overlay's stated level picks among,
 * and what a reader expecting exactly one would be wrong about.
 *
 * How often is measured here rather than claimed: over all 101 levels of one form, 63 HPs belong to a single level and
 * 38 are shared by exactly two. Never three, and the two are always adjacent half steps, so the shortlist the overlay
 * states only ever has to break a tie between neighbours.
 */
test('an HP admits one level or two adjacent ones, never more', () => {
  const thundurus = form('Thundurus', 'Incarnate');
  const ivs = iv(7, 7, 10);
  const sizes = new Map<number, number>();

  for (const [, multiplier] of DATA.cpm) {
    const levels = levelsOf(DATA, thundurus, ivs, hpOf(thundurus, ivs, multiplier));
    sizes.set(levels.length, (sizes.get(levels.length) ?? 0) + 1);

    for (const level of levels) {
      expect(hpOf(thundurus, ivs, multiplierOf(DATA, level) ?? 0), `level ${level} does not show that HP`).toBe(
        hpOf(thundurus, ivs, multiplier),
      );
    }

    // Adjacent, which is what makes the overlay a tie-break rather than a search.
    if (levels.length === 2) {
      expect(Math.abs((levels[1] ?? 0) - (levels[0] ?? 0)), `${levels.join(' and ')} are not neighbours`).toBe(0.5);
    }
  }

  expect(Object.fromEntries(sizes), 'how many levels share an HP has changed').toStrictEqual({ 1: 63, 2: 38 });

  // The capture that states 118 is settled outright, so its overlay has nothing to arbitrate.
  expect(levelsOf(DATA, thundurus, ivs, 118)).toStrictEqual([20]);
  expect(levelsOf(DATA, thundurus, ivs, 9_999), 'an HP no level reaches admits one').toStrictEqual([]);
});

test('an edit distance is over folded text, so case and accents cost nothing', () => {
  expect(distance('Pikachu', 'pikachu')).toBe(0);
  expect(distance('Nidoran♀', 'nidoran')).toBe(0);
  expect(distance('Flabébé', 'flabebe')).toBe(0);
  expect(distance('Pikachv', 'Pikachu')).toBe(1);
  expect(distance('Mr. Mime', 'mrmime')).toBe(0);
});

test('an edit distance within a phrase is to its nearest stretch', () => {
  expect(distance('TIVE', 'Super Effective', true)).toBe(0);
  expect(distance('EFFEt', 'Not Very Effective', true)).toBe(1);
  expect(distance('Dive', 'Super Effective', true)).toBe(1);
  expect(distance('TIVE', 'Super Effective'), 'without it, the whole phrase').toBe(10);
});

/**
 * The slack is a quarter of what was read, which is what separates a misreading from a different word. Both sides
 * matter: too tight and `Pikachv` is a nickname, too loose and every nickname becomes whichever species it is nearest.
 */
test('a misread name reaches its species and a nickname does not', () => {
  const species = DATA.species;
  const name = (s: string) => s;

  expect(closest('Pikachv', species, name)).toBe('Pikachu');
  expect(closest('Charizrd', species, name)).toBe('Charizard');
  expect(closest('Nickname', species, name), 'a nickname was answered as a species').toBe(null);

  // Two characters is refused outright rather than by the slack, and `Mw` is what tells the two apart: it is one edit
  // from `Mew` and so would match on distance alone, where `96%` is three from everything and would be refused either
  // way. Measured — with the length guard removed, `96%` still answers null and only this line fails.
  expect(closest('Mw', species, name), 'a two-character reading is matching on edit distance alone').toBe(null);
  expect(closest('96%', species, name), 'a nickname of digits was answered as a species').toBe(null);
  expect(closest('Mew', species, name), 'three characters is long enough to match').toBe('Mew');

  // Both Nidoran fold to `nidoran`, which is why the name cannot tell them apart and the Pokédex entry's number is
  // what has to. Asserted here so that a change to `fold` which happened to separate them is reported rather than
  // quietly making a reader elsewhere look better than it is.
  expect(distance('Nidoran♀', 'Nidoran♂'), 'the two Nidoran no longer fold to one string').toBe(0);
});

test('a form is found by the species and form name the CSV prints', () => {
  const autumn = form('Deerling', 'Autumn');

  expect([autumn.dex, autumn.types, autumn.attack, autumn.defense, autumn.stamina]).toStrictEqual([
    585,
    ['Normal', 'Grass'],
    115,
    100,
    155,
  ]);

  // The ordinary form of a species carries no form name rather than `Normal`, which is what lets a label be written as
  // the species alone — and null rather than empty, which is how the overlay and the fixture table spell no form.
  expect(form('Pikachu').form).toBe(null);
});

/**
 * Every form carries the file its artwork lives in, or null where the game draws none — which is a statement about the
 * game rather than a gap in the data, and so says whether consulting the artwork could narrow a form at all.
 */
test('a form names the icon the game draws it with, or says it has none', () => {
  expect(form('Deerling', 'Autumn').icon).toBe('pm585.fAUTUMN.icon.png');
  expect(form('Pikachu').icon, 'the ordinary form takes the bare name').toBe('pm25.icon.png');

  const drawn = DATA.forms.filter((f: Form) => f.icon !== null);
  expect(drawn.length, 'no form has an icon, so the resolution has stopped working').toBeGreaterThan(0);
  expect(drawn.length, 'every form has an icon, so nothing exercises a form the game draws none for').toBeLessThan(
    DATA.forms.length,
  );
});
