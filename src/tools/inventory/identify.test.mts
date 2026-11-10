/**
 * What `identify` makes of a reading built here rather than read off a capture, for the cases a capture cannot state:
 * the same screen with one field taken away, misread or changed, each the one difference on an otherwise fixed reading.
 * `screens.test.mts` holds the other half — that each field is read off the screen at all.
 *
 * Three readings. `pumpkaboo-large.png`'s is a level 1 Pumpkaboo at 2/0/6, where a Large and a Super both show 14 HP
 * and CP 14 and only the height tells them apart. `sinistea-phony.png`'s is one every form of Sinistea fits equally:
 * Phony and Antique share a dex, a type and all three base stats, and the `EVOLVE` row's candy is the only thing on the
 * screen that parts them. And an ordinary Lugia's, which only the stardust its `POWER UP` row asks parts from its Apex
 * form.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { type Detail } from './detail.mts';
import { type Form, type GameData } from '../../core/game-master.mts';
import { identify, label, shadowOf } from './identify.mts';
import { type Overlay } from './overlay.mts';

/** The game master the readers are asserted against, vended beside the captures. */
const DATA = JSON.parse(readFileSync(new URL('../../../data/game-master.json', import.meta.url), 'utf8')) as GameData;

const PUMPKABOO: Overlay = { iv: { attack: 2, defense: 0, stamina: 6 }, levels: [1], checked: true, form: null };

const pumpkaboo = (height: number | null, size: Detail['size']): Detail => ({
  cp: 14,
  cps: [],
  name: 'Pumpkaboo',
  hp: 14,
  weight: 11.07,
  height,
  types: ['Ghost', 'Grass'],
  gender: 'male',
  favourite: false,
  lucky: false,
  size,
  tags: [],
  evolveCandy: null,
  powerUp: null,
  max: null,
});

const answer = (detail: Detail) => {
  const identity = identify(DATA, detail, PUMPKABOO);

  return { form: identity.form && label(identity.form), alternatives: identity.alternatives.map(label) };
};

test('a height under its badge settles the forms the numbers leave together', () => {
  expect(answer(pumpkaboo(0.57, 'XL'))).toStrictEqual({ form: 'Pumpkaboo (Large)', alternatives: [] });
  expect(answer(pumpkaboo(0.7, 'XXL'))).toStrictEqual({ form: 'Pumpkaboo (Super)', alternatives: [] });
});

/**
 * 0.6m is the edge between a Large and a Super, and is both: the top of a Large's XL band and every band of a Super's
 * but XXL. A centimetre either side is one or the other, which is what the half centimetre allowed for rounding leaves.
 */
test('a centimetre either side of the edge between two forms is one of them', () => {
  expect(answer(pumpkaboo(0.59, 'XL'))).toStrictEqual({ form: 'Pumpkaboo (Large)', alternatives: [] });
  expect(answer(pumpkaboo(0.61, 'XXL'))).toStrictEqual({ form: 'Pumpkaboo (Super)', alternatives: [] });
});

test('with no height read, the forms the numbers leave are all still answered', () => {
  expect(answer(pumpkaboo(null, 'XL'))).toStrictEqual({
    form: 'Pumpkaboo (Large)',
    alternatives: ['Pumpkaboo (Super)'],
  });
});

/**
 * A height no form fits is a misread rather than a Pumpkaboo of no size, so it narrows nothing: 0.57m with no badge is
 * in no Pumpkaboo's middle band, a Large's being 0.5m exactly, and the forms the numbers left are answered as before.
 */
test('a height no form fits leaves the forms the numbers left', () => {
  expect(answer(pumpkaboo(0.57, null))).toStrictEqual({
    form: 'Pumpkaboo (Large)',
    alternatives: ['Pumpkaboo (Super)'],
  });
  expect(answer(pumpkaboo(5.7, 'XL'))).toStrictEqual({
    form: 'Pumpkaboo (Large)',
    alternatives: ['Pumpkaboo (Super)'],
  });
});

const SINISTEA: Detail = {
  cp: 461,
  cps: [],
  name: 'Sinistea',
  hp: 68,
  weight: 0.23,
  height: 0.11,
  types: ['Ghost'],
  gender: 'genderunknown',
  favourite: false,
  lucky: false,
  size: null,
  tags: [],
  evolveCandy: 50,
  powerUp: null,
  max: null,
};

const OVERLAY: Overlay = { levels: [15], iv: { attack: 11, defense: 11, stamina: 12 }, checked: true, form: null };

/** The answer, the forms beside it and the notes, which are the three things the candy can move. */
const answered = (detail: Detail, overlay: Overlay = OVERLAY) => {
  const identity = identify(DATA, detail, overlay);

  return {
    form: identity.form && label(identity.form),
    unseparated: identity.unseparated.map(label),
    notes: identity.notes,
  };
};

test('the candy each form costs is the one its evolution branches state', () => {
  const costs = (species: string) =>
    DATA.forms.filter((f) => f.species === species && !f.costume).map((f) => [label(f), f.evolveCandy]);

  expect(costs('Sinistea')).toStrictEqual([
    ['Sinistea (Antique)', [400]],
    ['Sinistea (Phony)', [50]],
  ]);
  expect(costs('Poltchageist')).toStrictEqual([
    ['Poltchageist (Artisan)', [400]],
    ['Poltchageist (Counterfeit)', [50]],
  ]);
});

/**
 * Every set of forms sharing a dex, types and base stats whose members cost different candy to evolve, which is where
 * the candy separates what no other number on the screen can. Costumes are left out, `identify` folding them into the
 * form they dress, and so is a form with no branch, which the candy never rules out: Pikachu's clone and Psyduck's
 * swimming one have none, and differ from their ordinary form in nothing else.
 */
test('the forms only the candy separates are Sinistea’s and Poltchageist’s', () => {
  const groups = new Map<string, Form[]>();

  for (const f of DATA.forms.filter((form) => !form.costume && form.evolveCandy.length > 0)) {
    const key = JSON.stringify([f.dex, f.types, f.attack, f.defense, f.stamina]);
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }

  expect(
    [...groups.values()]
      .filter((forms) => new Set(forms.map((f) => JSON.stringify(f.evolveCandy))).size > 1)
      .map((forms) => forms.map(label)),
  ).toStrictEqual([
    ['Sinistea (Antique)', 'Sinistea (Phony)'],
    ['Poltchageist (Artisan)', 'Poltchageist (Counterfeit)'],
  ]);
});

test('a Sinistea asking 50 candy is Phony, and one asking 400 Antique', () => {
  expect(answered(SINISTEA)).toStrictEqual({ form: 'Sinistea (Phony)', unseparated: [], notes: [] });
  expect(answered({ ...SINISTEA, evolveCandy: 400 })).toStrictEqual({
    form: 'Sinistea (Antique)',
    unseparated: [],
    notes: [],
  });
});

/**
 * Both ways the row can say nothing: not read at all, and read as a figure neither form costs. The second is a trade
 * that made the evolution free or an event that cut it, and is answered exactly as the first rather than as no form.
 */
test('a candy unread, or one no form costs, leaves both forms standing', () => {
  const unread = {
    form: 'Sinistea (Phony)',
    unseparated: ['Sinistea (Antique)'],
    notes: ['nothing on the screen separates it from Sinistea (Antique)'],
  };

  expect(answered({ ...SINISTEA, evolveCandy: null })).toStrictEqual(unread);
  expect(answered({ ...SINISTEA, evolveCandy: 25 })).toStrictEqual(unread);
  expect(answered({ ...SINISTEA, evolveCandy: 0 })).toStrictEqual(unread);
});

test('a Poltchageist is told apart by its candy as a Sinistea is', () => {
  const poltchageist = { ...SINISTEA, name: 'Poltchageist', types: ['Grass', 'Ghost'] };

  expect(answered({ ...poltchageist, evolveCandy: 400 }).form).toBe('Poltchageist (Artisan)');
  expect(answered({ ...poltchageist, evolveCandy: 50 })).toStrictEqual({
    form: 'Poltchageist (Counterfeit)',
    unseparated: [],
    notes: [],
  });
});

/**
 * A form the game master gives no branch is kept whatever the row asks, because the row is then something the game
 * master does not state: costumed Pikachu have no branch of their own, and `pikachu-ash-hat.png` asks 50 all the same.
 * So `pikachu.png`'s 50 cannot rule out the branchless clone, which is still the one form it cannot be told from.
 */
test('a form with no evolution branch is not ruled out by the candy', () => {
  const pikachu: Detail = {
    ...SINISTEA,
    cp: 69,
    name: 'Pikachu',
    hp: 27,
    weight: 5.11,
    height: 0.36,
    types: ['Electric'],
    gender: 'male',
  };
  const overlay = { levels: [3], iv: { attack: 15, defense: 13, stamina: 15 }, checked: true, form: null };

  expect(answered(pikachu, overlay).unseparated).toStrictEqual(['Pikachu (Copy 2019)']);
});

/**
 * The two narrowings together, each on the field it reads: a Pumpkaboo asking 50 candy, which every Pumpkaboo costs,
 * is still settled by its height, and one asking a figure no Pumpkaboo costs is answered as if the row were unread.
 * And a Sinistea asking 400 is Antique whatever its height, every Sinistea sharing one set of size bands.
 */
test('the candy and the height narrow together, neither acting on a figure no form fits', () => {
  expect(answer({ ...pumpkaboo(0.57, 'XL'), evolveCandy: 50 })).toStrictEqual({
    form: 'Pumpkaboo (Large)',
    alternatives: [],
  });
  expect(answer({ ...pumpkaboo(0.57, 'XL'), evolveCandy: 25 })).toStrictEqual({
    form: 'Pumpkaboo (Large)',
    alternatives: [],
  });
  expect(answer({ ...pumpkaboo(null, null), evolveCandy: 25 })).toStrictEqual({
    form: 'Pumpkaboo (Large)',
    alternatives: ['Pumpkaboo (Super)'],
  });
  expect(answered({ ...SINISTEA, evolveCandy: 400 }).form).toBe('Sinistea (Antique)');
  expect(answered({ ...SINISTEA, height: 5, evolveCandy: 400 }).form).toBe('Sinistea (Antique)');
});

/**
 * A CP worked out that none of the screen's candidates is, where no CP read for certain and the overlay's percentage
 * did not vouch for the IVs it came from. A Skarmory showing CP 862 had its `11/10/11` read as `1/1/1`, worked out to
 * 872, and was written without a note. Where one of the candidates is the CP worked out there is nothing to say, and
 * where the IVs were checked a missing candidate is a misread one: `castform-snowy.png` offers 747 for its 746.
 */
test('a worked-out CP none of the screen’s candidates is gets a note, where the IVs went unchecked', () => {
  const unsure = (cps: number[], checked = false) =>
    identify(DATA, { ...pumpkaboo(0.57, 'XL'), cp: null, cps }, { ...PUMPKABOO, checked }).notes.filter((n) =>
      n.includes('CP'),
    );

  expect(unsure([140, 99, 140])).toStrictEqual(['the screen reads CP 140 or 99, where this form at this level is 14']);
  expect(unsure([140, 14])).toStrictEqual([]);
  expect(unsure([])).toStrictEqual([]);
  expect(unsure([140, 99], true)).toStrictEqual([]);
});

/** `00015-detail.png` from a Pixel 4 XL scan: an ordinary Lugia, which shares every number with its Apex form. */
const LUGIA: Detail = {
  cp: 1571,
  cps: [],
  name: 'Lugia',
  hp: 129,
  weight: 204.75,
  height: 5.26,
  types: ['Psychic', 'Flying'],
  gender: 'genderunknown',
  favourite: false,
  lucky: false,
  size: null,
  tags: [],
  evolveCandy: null,
  powerUp: 1900,
  max: null,
};

const LUGIA_OVERLAY: Overlay = {
  levels: [15],
  iv: { attack: 13, defense: 15, stamina: 15 },
  checked: true,
  form: null,
};

/** The answer, the forms beside it and the notes for that Lugia, as `shadowed` leaves it. */
const lugia = (shadowed: boolean | null) => {
  const identity = identify(DATA, LUGIA, LUGIA_OVERLAY, undefined, shadowed);

  return {
    form: identity.form && label(identity.form),
    unseparated: identity.unseparated.map(label),
    notes: identity.notes,
  };
};

test('the forms the game hands out only as shadows are the two Apex ones', () => {
  expect(DATA.forms.filter((f) => f.shadowOnly).map(label)).toStrictEqual(['Lugia (S)', 'Ho-Oh (S)']);
});

/**
 * The Apex form is ruled out only where the Pokémon is known to be neither shadow nor purified. A shadow Lugia, a
 * purified one or one nothing has said about can still be it.
 */
test('a Lugia neither shadow nor purified is not its Apex form', () => {
  expect(lugia(false)).toStrictEqual({ form: 'Lugia', unseparated: [], notes: [] });

  const either = {
    form: 'Lugia',
    unseparated: ['Lugia (S)'],
    notes: ['nothing on the screen separates it from Lugia (S)'],
  };

  expect(lugia(true)).toStrictEqual(either);
  expect(lugia(null)).toStrictEqual(either);
});

/**
 * The stardust a power-up asks at the Lugia's level 15, where the game master's figure is 1,900: as it is for neither,
 * 1.2 times it rounded up for a shadow, 0.9 times it for a purified Pokémon and half for a lucky one. Pancham's level 8
 * is the figure that settles the rounding, its shadow asking 961 for 800 × 1.2.
 */
test('the stardust to power up says whether the Pokémon is shadow or purified', () => {
  const shade = (powerUp: number | null, levels = [15]) => shadowOf(DATA, { ...LUGIA, powerUp }, levels);

  expect(shade(1900)).toBe('neither');
  expect(shade(950)).toBe('neither');
  expect(shade(2280)).toBe('shadow');
  expect(shade(1710)).toBe('purified');
  expect(shade(961, [8])).toBe('shadow');
  expect(shade(960, [8]), 'a shadow’s cost is rounded up in single precision').toBeNull();
  expect(shade(1900, [15, 15.5])).toBe('neither');
});

/** Where the figure is unread, matches none of the costs, or the levels left would cost different amounts. */
test('the stardust says nothing where it cannot say which', () => {
  const shade = (powerUp: number | null, levels = [15]) => shadowOf(DATA, { ...LUGIA, powerUp }, levels);

  expect(shade(null)).toBeNull();
  expect(shade(1900, [])).toBeNull();
  expect(shade(1000)).toBeNull();
  expect(shade(855), 'a lucky purified Pokémon, which no capture shows').toBeNull();
  expect(shade(1900, [14, 15])).toBeNull();
  expect(shade(1900, [51])).toBeNull();
});
