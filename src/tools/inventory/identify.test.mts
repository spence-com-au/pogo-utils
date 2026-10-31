/**
 * What the `EVOLVE` row's candy does to `identify`'s answer, over readings built here rather than read off a capture:
 * the narrowing takes a `Detail` and the game master and no image, so each case is the one field changed on an
 * otherwise fixed reading. `screens.test.mts` holds the other half — that the figure is read off the screen at all.
 *
 * The readings are `sinistea-phony.png`'s, which every form of Sinistea fits equally: Phony and Antique share a dex, a
 * type and all three base stats, and the candy is the only thing on the screen that parts them.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { type Detail } from './detail.mts';
import { type Form, type GameData } from './game-master.mts';
import { identify, label } from './identify.mts';
import { type Overlay } from './overlay.mts';

/** The game master the readers are asserted against, vended beside the captures. */
const DATA = JSON.parse(readFileSync(new URL('fixtures/game-master.json', import.meta.url), 'utf8')) as GameData;

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
  size: null,
  tags: [],
  evolveCandy: 50,
};

const OVERLAY: Overlay = { levels: [15], iv: { attack: 11, defense: 11, stamina: 12 }, form: null };

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

  for (const f of DATA.forms.filter((f) => !f.costume && f.evolveCandy.length > 0)) {
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
  const overlay = { levels: [3], iv: { attack: 15, defense: 13, stamina: 15 }, form: null };

  expect(answered(pikachu, overlay).unseparated).toStrictEqual(['Pikachu (Copy 2019)']);
});
