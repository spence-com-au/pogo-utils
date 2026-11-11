/**
 * The row a scan writes, put together from readings made up here rather than read off a phone: an Elgyem as the
 * phone test's recordings show it, with whatever a test changes, its flag passes and the look down its screen made up
 * alongside. The artwork is a blank image, which `artworkIn` finds no Pokémon in, so `identify` decides alone.
 */

import { type Detail } from './detail.mts';
import { type Form, type GameData } from '../../core/game-master.mts';
import { identify, type Identity } from './identify.mts';
import { type Looked } from './look.mts';
import { type Overlay } from './overlay.mts';
import { rowOf, type Writing } from './row.mts';
import { Marks, type Flag } from './scan.mts';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const DATA = JSON.parse(readFileSync(new URL('../../../data/game-master.json', import.meta.url), 'utf8')) as GameData;

const BLANK = { width: 40, height: 80, data: new Uint8Array(40 * 80 * 4) };

const OVERLAY: Overlay = { levels: [8], iv: { attack: 11, defense: 13, stamina: 8 }, checked: true, form: null };

/** The Elgyem `moves/elgyem-detail.png` shows, with its CP unread, and whatever else a test says. */
function elgyem(fields: Partial<Detail> = {}, overlay: Overlay | null = OVERLAY) {
  const detail: Detail = {
    cp: null,
    cps: [],
    name: 'Elgyem',
    hp: 57,
    weight: 7.6,
    height: 0.46,
    types: ['Psychic'],
    gender: null,
    favourite: false,
    lucky: false,
    size: null,
    tags: [],
    evolveCandy: null,
    powerUp: null,
    max: null,
    ...fields,
  };

  return { detail, overlay, id: identify(DATA, detail, overlay), image: BLANK };
}

/** Marks for each flag named, each holding the readings given: a pass that ran and found them. */
function passes(found: Partial<Record<Flag, readonly ReturnType<typeof elgyem>[]>>): Map<Flag, Marks> {
  return new Map(
    Object.entries(found).map(([flag, readings]) => {
      const marks = new Marks();

      for (const { detail, overlay } of readings ?? []) {
        marks.add(detail, overlay);
      }

      return [flag as Flag, marks];
    }),
  );
}

/** The rest of what a row is written with: no passes, no tags, no overlay box and no look, unless a test says. */
const writing = (fields: Partial<Writing> = {}): Writing => ({
  data: DATA,
  icons: new Map(),
  marked: new Map(),
  tags: [],
  boxes: { box: null },
  wardrobe: () => expect.unreachable('the wardrobe was opened for a Pokémon that is not a Pikachu'),
  look: null,
  ...fields,
});

test("a row holds the reading's fields, with the CP worked out where the screen did not read it", async () => {
  expect(await rowOf(elgyem(), 0, writing())).toStrictEqual({
    index: 1,
    species: 'Elgyem',
    nickname: null,
    dex: 605,
    form: null,
    gender: null,
    favourite: false,
    tags: [],
    costume: null,
    shiny: null,
    lucky: null,
    size: null,
    shadow: null,
    purified: null,
    max: null,
    cp: 295,
    hp: 57,
    levels: [8],
    iv: { attack: 11, defense: 13, stamina: 8 },
    moves: { fast: null, charged: [] },
    weight: 7.6,
    height: 0.46,
    types: ['Psychic'],
    notes: [],
  });
});

test('a height no Elgyem can be is written blank, with the note that says why', async () => {
  const row = await rowOf(elgyem({ height: 46 }), 0, writing());

  expect({ height: row.height, notes: row.notes }).toStrictEqual({
    height: null,
    notes: ['the screen reads a height of 46m, which no Elgyem can be'],
  });
});

test('a flag is taken from its pass once, so of two rows alike the pass found once only the first is', async () => {
  const reading = elgyem();
  const marked = passes({ shiny: [reading] });

  expect((await rowOf(reading, 0, writing({ marked }))).shiny).toBe(true);
  expect((await rowOf(reading, 1, writing({ marked }))).shiny).toBe(false);
});

test.for([
  [true, null, true],
  [true, false, true],
  [false, true, true],
  [false, false, false],
  [false, null, null],
] as const)('a lucky caption of %j with a pass of %j is lucky %j', async ([caption, pass, lucky]) => {
  const reading = elgyem({ lucky: caption });
  const marked = pass === null ? new Map() : passes({ lucky: pass ? [reading] : [] });

  expect((await rowOf(reading, 0, writing({ marked }))).lucky).toBe(lucky);
});

test('stardust off the moves screen settles the shade where the detail screen showed none', async () => {
  const forms: (Form | null)[] = [];

  const look = async (form: Form | null): Promise<Looked> => {
    forms.push(form);

    // A level 8 shadow's, 1.2 times 800.
    return { moves: { fast: 'Astonish', charged: ['Dark Pulse'] }, powerUp: 961, notes: ['the look said this'] };
  };

  const row = await rowOf(elgyem(), 0, writing({ look }));

  // The moves are read for the form settled before the look, the stardust being what it went on to find.
  expect(forms.map((form) => form?.species)).toStrictEqual(['Elgyem']);
  expect(row).toMatchObject({
    shadow: true,
    purified: false,
    moves: { fast: 'Astonish', charged: ['Dark Pulse'] },
    notes: ['the look said this'],
  });
});

test("a pass's shade is kept where the stardust says otherwise, and the row says they disagree", async () => {
  const reading = elgyem({ powerUp: 800 });
  const row = await rowOf(reading, 0, writing({ marked: passes({ shadow: [reading] }) }));

  expect(row).toMatchObject({ shadow: true, purified: false });
  expect(row.notes).toStrictEqual(['the shadow search says yes, where the stardust to power up says no']);
});

test("the screen's notes come before the look's, and an overlay unread says whether one was ever found", async () => {
  const look = async (): Promise<Looked> => ({
    moves: { fast: null, charged: [] },
    powerUp: null,
    notes: ['moves not fully read'],
  });

  const unread = elgyem({ hp: null }, null);
  const box = { x: 0.1, y: 0.2, width: 0.6, height: 0.02 };

  expect((await rowOf(unread, 0, writing({ look }))).notes).toStrictEqual([
    'detail screen not read',
    'no PGSharp overlay found; is its IV display switched on?',
    'moves not fully read',
  ]);

  expect((await rowOf(unread, 0, writing({ look, boxes: { box } }))).notes).toStrictEqual([
    'detail screen not read',
    'overlay not read',
    'moves not fully read',
  ]);
});

test('a tag chip is named for the tag it reads closest to, and kept as it read where it is close to none', async () => {
  const reading = elgyem({ tags: ['Shiny SJ', 'Qwxyz'] });

  expect((await rowOf(reading, 0, writing({ tags: ['Shiny', 'Trade'] }))).tags).toStrictEqual(['Shiny', 'Qwxyz']);
  expect((await rowOf(reading, 0, writing())).tags).toStrictEqual(['Shiny SJ', 'Qwxyz']);
});

/** A Bulbasaur as `identify` would place one, which the game master names three costumes for. */
function bulbasaur() {
  const form = DATA.forms.find((f) => f.dex === 1 && f.form === null) ?? expect.unreachable('no Bulbasaur');
  const id: Identity = {
    form,
    levels: [20],
    nickname: null,
    notes: [],
    cp: 637,
    height: 0.46,
    alternatives: [],
    unseparated: [],
  };

  return { ...elgyem({ name: 'Bulbasaur', hp: 90, types: ['Grass', 'Poison'] }), id };
}

test.for([
  ['found it', true, ['Jan 2020', 'Spring 2020', 'Fall 2019']],
  ['did not find it', false, []],
  ['never ran', null, null],
] as const)('a Pokémon other than Pikachu whose costume search %s wears %j', async ([, found, costume]) => {
  const reading = bulbasaur();
  const marked = found === null ? new Map() : passes({ costume: found ? [reading] : [] });

  expect((await rowOf(reading, 0, writing({ marked }))).costume).toStrictEqual(costume);
});

test('a costume the game master lists twice, as it does Pikachu’s `Gotour 2023 Hat`, is named once', async () => {
  const reading = bulbasaur();
  const twice = DATA.costumes.filter((c) => c.dex === 1).map((c) => ({ ...c, icon: `again-${c.icon}` }));
  const data = { ...DATA, costumes: [...DATA.costumes, ...twice] };
  const row = await rowOf(reading, 0, writing({ data, marked: passes({ costume: [reading] }) }));

  expect(row.costume).toStrictEqual(['Jan 2020', 'Spring 2020', 'Fall 2019']);
});

test('a species with no costume in the game master is unknown where its search found it, not costumed', async () => {
  const reading = elgyem();

  expect((await rowOf(reading, 0, writing({ marked: passes({ costume: [reading] }) }))).costume).toBeNull();
});
