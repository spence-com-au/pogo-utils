import { expect, test } from 'vitest';
import { type Form } from './game-master.mts';
import { answer, type Reading } from './report.mts';

const APPLIN: Form = {
  dex: 840,
  species: 'Applin',
  form: null,
  costume: false,
  types: ['Grass', 'Dragon'],
  attack: 71,
  defense: 116,
  stamina: 120,
  icon: null,
  moves: [],
  evolveCandy: [200],
};

/** `applin.png` as the readers make it: `CP` unlabelled, so the 286 the screen shows is only in `cps`. */
const READING: Reading = {
  lines: [],
  whole: [],
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
    size: 'XL',
    tags: [],
  },
  moves: { fast: 'Astonish', charged: ['Struggle'] },
  box: null,
  overlay: { levels: [1, 15, 5, 51, 18, 8, 4], iv: { attack: 10, defense: 14, stamina: 14 }, form: null },
  identity: { form: APPLIN, cp: 286, alternatives: [], unseparated: [], levels: [15], nickname: null, notes: [] },
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

/** Nothing identified and no overlay: every field is unknown and claims no source. */
test('a screen that read nothing answers unknown, from nowhere', () => {
  const { facts } = answer({
    ...READING,
    detail: { ...READING.detail, cp: null, hp: null },
    moves: { fast: null, charged: [] },
    overlay: null,
    identity: { ...READING.identity, form: null, cp: null, levels: [] },
  });

  expect(facts.every((f) => f.value === 'unknown' && f.source === null)).toBe(true);
});
