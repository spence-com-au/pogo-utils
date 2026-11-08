import { readFileSync } from 'node:fs';
import { afterAll, expect, test, vi } from 'vitest';
import { costumeOf, measure, wardrobeFor, type Wardrobe } from './costume.mts';
import { REFERENCES } from './costume-references.mts';
import { type GameData } from './game-master.mts';
import { type Identity } from './identify.mts';
import { findOverlay } from './overlay.mts';
import { decodePng, screenIn } from './png.mts';
import { artworkFrom, costumeIn } from './report.mts';
import { useTestEngine } from './test-engine.mts';

afterAll(useTestEngine());

const DATA = JSON.parse(readFileSync(new URL('fixtures/game-master.json', import.meta.url), 'utf8')) as GameData;

/** Pikachu with two of its costumes, which is all a wardrobe's loading needs and keeps the registration quick. */
const CAP = DATA.costumes.find((c) => c.name === 'Gofest 2026 Cap Red');
const HAT = DATA.costumes.find((c) => c.name === 'Holiday 2016');
const TWO = { ...DATA, costumes: [CAP, HAT].filter((c) => c !== undefined) };
const PLAIN = 'pm25.icon.png';

const fixture = async (file: string) => decodePng(readFileSync(new URL(`fixtures/icons/${file}`, import.meta.url)));

test('the two costumes are the ones asked for', () =>
  expect(TWO.costumes.map((c) => c.name).sort()).toStrictEqual(['Gofest 2026 Cap Red', 'Holiday 2016']));

// One icon a download cannot have is a costume left out, not a read failed: a 404 among some 200 icons would otherwise
// cost the Inventory page its whole reading of a Pikachu, and a scan its run at the first one.
test('a costume whose icon cannot be had is left out of the wardrobe', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  const wardrobe = await wardrobeFor(TWO, (file) =>
    file === HAT?.icon ? Promise.reject(new Error(`${file}: 404 Not Found`)) : fixture(file),
  );

  expect(new Set(wardrobe?.drawn.map((d) => d.costume))).toStrictEqual(new Set(['', 'Gofest 2026 Cap Red']));
});

// Everything is registered onto the plain icon, so without it there is nothing to read a costume against.
test('a wardrobe without the plain icon is none at all', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  await expect(
    wardrobeFor(TWO, (file) => (file === PLAIN ? Promise.reject(new Error(`${file}: offline`)) : fixture(file))),
  ).resolves.toBeNull();
});

let whole: Promise<Wardrobe | null> | null = null;

/** Every costume's icons, which a pick is vetoed among. Drawn once, for the first cap read. */
const wardrobe = () => (whole ??= wardrobeFor(DATA, fixture));

// The three caps differ by the logo on their front alone, which the body's blocks average away. Each is read against
// every other labelled capture: its own is among `REFERENCES`, and would answer at no distance at all.
test.each(['Red', 'Yellow', 'Blue'])('a Pikachu in the %s GO Fest 2026 cap is read as wearing it', async (colour) => {
  const file = `fixtures/costume/pikachu-gofest-2026-cap-${colour.toLowerCase()}.png`;
  const image = decodePng(readFileSync(new URL(file, import.meta.url)));
  const from = artworkFrom((await findOverlay(image))?.box ?? null);
  const drawn = await wardrobe();
  const measured = drawn && measure(image, from, drawn);

  if (!drawn || !measured) {
    throw new Error(`${file}: no Pikachu found to read`);
  }

  const own = Buffer.from(measured.blocks).toString('base64');
  const others = REFERENCES.captures.filter((c) => c.blocks !== own);

  expect(others).toHaveLength(REFERENCES.captures.length - 1);
  expect(costumeOf(image, from, drawn, null, { ...REFERENCES, captures: others })).toStrictEqual([
    `Gofest 2026 Cap ${colour}`,
  ]);
});

// The plain Pikachu is a costume among the others to compare against, so one the search found in a costume is read as
// the nearest of the rest instead, where it would otherwise come out as wearing none. Cropped to its screen, as the
// scan reads it: the file is a stitch, whose rows below the screen the readers are not anchored for.
test('a Pikachu the search found in a costume is not read as the plain one', async () => {
  const file = 'fixtures/pikachu.png';
  const image = screenIn(decodePng(readFileSync(new URL(file, import.meta.url))));
  const from = artworkFrom((await findOverlay(image))?.box ?? null);
  const drawn = await wardrobe();

  if (!drawn) {
    throw new Error(`${file}: no wardrobe to read it against`);
  }

  expect(costumeOf(image, from, drawn, null), 'unasked').toStrictEqual([]);
  expect(costumeOf(image, from, drawn, true), 'asked').not.toStrictEqual([]);
});

const pikachu = { form: DATA.forms.find((f) => f.dex === 25 && f.form === null) } as Identity;
const image = { width: 1, height: 1, data: new Uint8Array(4) };

test('a Pikachu with no wardrobe is unread, and says why', async () =>
  expect(await costumeIn(image, null, pikachu, () => Promise.resolve(null), null)).toStrictEqual({
    costume: null,
    note: "Pikachu's own icon could not be had, so its costume was not read",
  }));

test('a Pikachu the search did not find wears none, without a wardrobe being fetched', async () => {
  const wardrobe = vi.fn(() => Promise.resolve(null));

  expect(await costumeIn(image, null, pikachu, wardrobe, false)).toStrictEqual({ costume: [], note: null });
  expect(wardrobe).not.toHaveBeenCalled();
});
