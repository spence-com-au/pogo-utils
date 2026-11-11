import { expect, test } from 'vitest';
import { type Form } from '../../core/game-master.mts';
import { answer, isDetail, printable, refusals, type Reading } from './report.mts';

const APPLIN: Form = {
  dex: 840,
  species: 'Applin',
  form: null,
  costume: false,
  types: ['Grass', 'Dragon'],
  attack: 71,
  defense: 116,
  stamina: 120,
  heights: null,
  icon: null,
  shiny: null,
  moves: [],
  evolveCandy: [200],
  shadowOnly: false,
};

/** `applin.png` as the readers make it: `CP` unlabelled, so the 286 the screen shows is only in `cps`. */
const READING: Reading = {
  lines: [],
  whole: [],
  costume: null,
  detail: {
    cp: null,
    cps: [286],
    name: 'Applin',
    hp: 69,
    weight: 0.95,
    height: 0.28,
    types: ['Grass', 'Dragon'],
    gender: 'female',
    favourite: false,
    lucky: false,
    size: 'XL',
    tags: [],
    evolveCandy: null,
    powerUp: null,
    max: null,
  },
  moves: { fast: 'Astonish', charged: ['Struggle'] },
  box: null,
  overlay: {
    levels: [1, 15, 5, 51, 18, 8, 4],
    iv: { attack: 10, defense: 14, stamina: 14 },
    checked: true,
    form: null,
  },
  identity: {
    form: APPLIN,
    cp: 286,
    height: 0.28,
    alternatives: [],
    unseparated: [],
    levels: [15],
    nickname: null,
    notes: [],
  },
};

/**
 * Each field once, and labelled by where it came from: the issue was a `cp: null` beside a `cp: 286` and a level
 * shortlist of seven beside the one level, with nothing to say which was read and which worked out.
 */
test('the answer states each field once, saying which were read and which worked out', () => {
  expect(answer(READING)).toStrictEqual({
    facts: [
      { label: 'species', value: 'Applin', source: 'worked out' },
      { label: 'cp', value: '286', source: 'worked out' },
      { label: 'hp', value: '69', source: 'read' },
      { label: 'level', value: '15', source: 'worked out' },
      { label: 'ivs', value: '10/14/14', source: 'read' },
      { label: 'fast move', value: 'Astonish', source: 'read' },
      { label: 'charged', value: 'Struggle', source: 'read' },
    ],
    notes: [],
  });
});

/** Where the level is ambiguous no CP can be worked out, so the one read is shown, and said to be read. */
test('a CP that could not be worked out falls back to the one read, and a form and nickname are shown', () => {
  const { facts } = answer({
    ...READING,
    detail: { ...READING.detail, cp: 290 },
    identity: {
      ...READING.identity,
      form: { ...APPLIN, form: 'Galarian' },
      cp: null,
      levels: [15, 15.5],
      nickname: 'Apple',
      notes: ['level ambiguous: 15 or 15.5'],
    },
  });

  expect(facts).toEqual(
    expect.arrayContaining([
      { label: 'form', value: 'Galarian', source: 'worked out' },
      { label: 'nickname', value: 'Apple', source: 'read' },
      { label: 'cp', value: '290', source: 'read' },
      { label: 'level', value: '15 or 15.5', source: 'worked out' },
    ]),
  );
});

/**
 * Forms the screen cannot separate leave the form unknown rather than naming the one `identify` sorted first — every
 * unsure Minior was written `Red` — and the same where that one is the species' plain form, as Gimmighoul's is.
 */
test('a form nothing on the screen settles is unknown, not the first of its candidates', () => {
  const unsettled = (form: string | null, other: string) =>
    answer({
      ...READING,
      identity: { ...READING.identity, form: { ...APPLIN, form }, unseparated: [{ ...APPLIN, form: other }] },
    }).facts.find((f) => f.label === 'form');

  expect(unsettled('Red', 'Green')).toStrictEqual({ label: 'form', value: 'unknown', source: null });
  expect(unsettled(null, 'Roaming')).toStrictEqual({ label: 'form', value: 'unknown', source: null });
});

/** `costumeOf` lists none as `''` beside a single costume it cannot tell from it, which reads as none, not as blank. */
test('a costume that could be none says so', () =>
  expect(answer({ ...READING, costume: ['', 'Holiday 2016'] }).facts).toContainEqual({
    label: 'costume',
    value: 'none | Holiday 2016',
    source: 'worked out',
  }));

/** Nothing identified and no overlay: every field is unknown and claims no source. */
test('a screen that read nothing answers unknown, from nowhere', () => {
  const { facts } = answer({
    ...READING,
    detail: { ...READING.detail, cp: null, hp: null },
    moves: { fast: null, charged: [] },
    overlay: null,
    identity: { ...READING.identity, form: null, cp: null, levels: [] },
  });

  expect(facts).not.toHaveLength(0);
  expect(facts.every((f) => f.value === 'unknown' && f.source === null)).toBe(true);
});

const BOX = { x: 0, y: 0, width: 10, height: 10 };

test('a screen is a detail screen when its HP read', () => {
  expect(isDetail(READING.detail)).toBe(true);
  expect(isDetail({ ...READING.detail, hp: null })).toBe(false);
});

/** A configured box is taken on trust, so the box can be known while nothing reads inside it. */
test('a capture is refused for each of the three reasons, and for none where all three hold', () => {
  const found = { ...READING, box: BOX };

  expect(refusals(found)).toStrictEqual([]);
  expect(refusals({ ...found, detail: { ...READING.detail, hp: null } })).toStrictEqual([
    'its HP did not read, so a scan could not have used this screen',
  ]);
  expect(refusals(READING)).toStrictEqual(["PGSharp's overlay was not found on it"]);
  expect(refusals({ ...found, overlay: null })).toStrictEqual([
    "PGSharp's overlay was found but nothing read inside it",
  ]);
});

test('an identity prints its forms with their moves as names', () => {
  const move = { name: 'Vine Whip' } as Form['moves'][number];
  const withMoves = { ...APPLIN, moves: [move, { ...move, name: 'Dragon Breath' }] };
  const printed = printable({
    ...READING.identity,
    form: withMoves,
    alternatives: [withMoves],
    unseparated: [withMoves],
  });

  expect(printed.form?.moves).toBe('Vine Whip, Dragon Breath');
  expect(printed.alternatives[0]?.moves).toBe('Vine Whip, Dragon Breath');
  expect(printed.unseparated[0]?.moves).toBe('Vine Whip, Dragon Breath');
  expect(printable({ ...READING.identity, form: null }).form).toBeNull();
});
