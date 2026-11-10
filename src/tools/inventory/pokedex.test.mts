/**
 * What the Pokédex's screens read as: first which species an entry shows, over lines built here, and then each reader
 * over the captures under `fixtures/pokedex/`, read by the real Tesseract.
 *
 * The title's cases are lines rather than captures because `dexOn` takes lines and no image, so a capture buys it
 * nothing a line cannot state; that Tesseract reads the title at all is what the captures below say, and that no detail
 * screen reads as one is `screens.test.mts`'s to say.
 *
 * The captures are a Pixel 4 XL's, 1440x3040, taken as `pokedex-walk.mts` takes them: an entry from its top, then a
 * slow drag at a time down its CAUGHT tab. What each one is expected to read is what the phone showed when it was
 * taken, checked by eye: a silhouette is a category not registered.
 */

import { beforeAll, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { tesseractCli } from '../../core/node/ocr-cli.mts';
import { useEngine, type Line } from '../../core/ocr.mts';
import { decodePng, type Image } from '../../core/png.mts';
import {
  alertOf,
  caughtFrame,
  caughtOn,
  CostumeReader,
  costumesOn,
  countsOn,
  dexOn,
  formBand,
  formLabelled,
  formsOn,
  framed,
  gendersOn,
  iconIn,
  labelsOf,
  listLines,
  ownBeside,
  pokedexLines,
  regionsButtonOf,
  silhouettesNamed,
  type Candidate,
  type Category,
  type Look,
} from './pokedex.mts';
import { type GameData } from '../../core/game-master.mts';

/** The game master the readers are asserted against, vended beside the captures. */
const DATA = JSON.parse(readFileSync(new URL('../../../data/game-master.json', import.meta.url), 'utf8')) as GameData;

beforeAll(() => useEngine(tesseractCli));

const capture = (name: string): Image =>
  decodePng(readFileSync(new URL(`fixtures/pokedex/${name}.png`, import.meta.url)));
const icon = (file: string): Image => decodePng(readFileSync(new URL(`fixtures/icons/${file}`, import.meta.url)));

/** A capture and every line `pokedexLines` reads off it, read once however many tests ask. */
const read = (() => {
  const held = new Map<string, Promise<{ image: Image; lines: Line[] }>>();

  return (name: string) => {
    let shot = held.get(name);

    if (!shot) {
      const image = capture(name);
      shot = pokedexLines(image).then((found) => ({ image, lines: found }));
      held.set(name, shot);
    }

    return shot;
  };
})();

/** A species' forms as candidates for a tile's icon, by the files `pogo_assets` names them under. */
const formsOf = (dex: number): Candidate[] =>
  DATA.forms
    .filter((f) => f.dex === dex && !f.costume && f.icon !== null)
    .map((f) => ({ name: f.form, icon: icon(f.icon as string) }));

const lines = (...texts: readonly string[]) =>
  texts.map((text, at) => ({ text, left: 0, top: at * 40, width: 400, height: 32 }));

/**
 * The title line of an entry, which is a four-digit number and the species beside it. `©` stands in for the circular
 * arrows the game draws ahead of the number, which folds away to nothing on a real capture.
 */
test('an entry names its species by the number and the name together', () => {
  expect(dexOn(lines('© 0585 DEERLING', 'SEEN 2763', 'CAUGHT 1499'), DATA)).toBe(585);
});

/**
 * The counters are the reason the name is cross-checked rather than the number taken alone: an entry carries other
 * four-digit numbers, and `2763` is no species while `1499` would be one with no name beside it.
 */
test('a four-digit counter with no species beside it is not a dex number', () => {
  expect(dexOn(lines('SEEN 2763', 'CAUGHT 1499'), DATA)).toBe(null);
  expect(dexOn(lines('0585 SEEN'), DATA), 'a number whose species does not match the word beside it').toBe(null);
});

/**
 * The pair the reader exists for. Both fold to `nidoran`, so the name cannot tell them apart and the number is the only
 * thing that does — which is the same loss the detail screen suffers, the game drawing a `♀` or `♂` that OCR drops.
 */
test('both Nidoran are told apart by the number, which is the only thing that can', () => {
  expect(dexOn(lines('0029 NIDORAN'), DATA)).toBe(29);
  expect(dexOn(lines('0032 NIDORAN'), DATA)).toBe(32);
  expect(DATA.forms.find((f) => f.dex === 29)?.species, 'the vended game master has moved').toBe('Nidoran♀');
  expect(DATA.forms.find((f) => f.dex === 32)?.species, 'the vended game master has moved').toBe('Nidoran♂');
});

/**
 * Residue either side of the title, which is what the glyphs read as when they do not fold away. A letter after the
 * name still leads with the species; a digit ahead of the number makes a five-digit run, which is no dex.
 */
test('residue after the name is tolerated and a digit before the number is not', () => {
  expect(dexOn(lines('0032 NIDORAN d'), DATA), 'residue after the name').toBe(32);
  expect(dexOn(lines('90032 NIDORAN'), DATA), 'a digit ahead of the number').toBe(null);
});

/**
 * Two entries at once, which the game really does draw mid-swipe between them. Either would be a guess at which half
 * the walk is standing on, so the answer is neither.
 */
test('a screen mid-swipe between two entries answers neither of them', () => {
  expect(dexOn(lines('0029 NIDORAN', '0032 NIDORAN'), DATA)).toBe(null);
  expect(dexOn(lines('0029 NIDORAN', '0029 NIDORAN'), DATA), 'one entry read twice is still that entry').toBe(29);
});

/**
 * That Tesseract reads an entry's title off the phone, which the lines above take for granted: each of these is an
 * entry at its top, and the menu, a grid and a region list carry four-digit numbers that are no title.
 */
test('every entry captured names its species, and nothing else does', async () => {
  const named = async (name: string) => dexOn((await read(name)).lines, DATA);

  expect(await named('bulbasaur-0')).toBe(1);
  expect(await named('nidoran-female-0')).toBe(29);
  expect(await named('meowth-0')).toBe(52);
  expect(await named('tauros-0')).toBe(128);
  expect(await named('unown-0')).toBe(201);
  expect(await named('menu')).toBe(null);
  expect(await named('kanto')).toBe(null);
  expect(await named('tab-pokemon-0')).toBe(null);
});

/** The CAUGHT tab's tiles over every screenshot of one form, the first whole reading of each kept, as the walk keeps it. */
async function tilesOf(...names: string[]): Promise<Partial<Record<Category | 'own', Look>>> {
  const looks: Partial<Record<Category | 'own', Look>> = {};

  for (const name of names) {
    const { image, lines: found } = await read(name);

    for (const { category, look } of caughtOn(image, found)) {
      looks[category ?? 'own'] ??= look;
    }
  }

  return looks;
}

/**
 * Bulbasaur's tab down to its foot, which is every category but G-MAX and MEGA; and the two it does not have, which a
 * species with them draws among the rest — Venusaur one MEGA, Charizard an X and a Y. Beedrill's own icon is as flat as
 * a silhouette, its translucent wings the backdrop seen through grey, and is an icon by its yellow and black.
 */
test("a form's tiles read as the icon where registered and the silhouette where not", async () => {
  expect(await tilesOf('bulbasaur-0', 'bulbasaur-1', 'bulbasaur-2')).toStrictEqual({
    own: 'icon',
    shiny: 'icon',
    perfect: 'silhouette',
    lucky: 'icon',
    xxl: 'silhouette',
    xxs: 'icon',
    shadow: 'icon',
    purified: 'icon',
  });

  expect(await tilesOf('venusaur-0', 'venusaur-1', 'venusaur-2')).toMatchObject({
    own: 'icon',
    lucky: 'icon',
    mega: 'silhouette',
    gmax: 'silhouette',
  });

  expect(await tilesOf('charizard-2')).toMatchObject({ own: 'icon', megaX: 'silhouette', megaY: 'silhouette' });

  expect(await tilesOf('beedrill-1')).toStrictEqual({
    own: 'icon',
    shiny: 'silhouette',
    perfect: 'silhouette',
    lucky: 'silhouette',
    xxl: 'silhouette',
    xxs: 'silhouette',
    mega: 'silhouette',
    shadow: 'silhouette',
    purified: 'silhouette',
  });
});

/**
 * Which of the CAUGHT tab's tiles is showing, by the white frame round it: the form's own as Ekans's entry opens, and
 * SHINY once tapped, which the game selects though it draws the tile as a silhouette (#1047). The form's own is found
 * beside SHINY, which is how the walk puts the entry back.
 */
test('the CAUGHT tile showing wears the frame, a silhouetted SHINY the game selects among them', async () => {
  const showing = async (name: string) => {
    const { image, lines: found } = await read(name);
    const caught = caughtOn(image, found);
    const shiny = caught.find((c) => c.category === 'shiny') ?? expect.unreachable(`${name} draws a SHINY tile`);

    return {
      shiny: shiny.look,
      framed: caught.filter(({ box }) => framed(image, box)).map((c) => c.category),
      own: framed(image, ownBeside(image, shiny.box)),
    };
  };

  expect(await showing('ekans-0')).toStrictEqual({ shiny: 'silhouette', framed: [null], own: true });
  expect(await showing('ekans-shiny-0')).toStrictEqual({ shiny: 'silhouette', framed: ['shiny'], own: false });
});

/**
 * A band of the backdrop's light across part of a tile, which the game sweeps down the Pokédex and the tiles are
 * translucent over. On `unown-band-1`, Unown's own tile and SHINY are registered letters, black with a white eye, under
 * a light band along their tops. `unown-band-0` is its entry at the top, the four forms with a white eye registered and
 * the rest silhouettes, the five from the sixteenth on crossed by bands through their middles.
 *
 * The form row's second row is not there to read: PGSharp's star button over the screen's left margin, which `formsOn`
 * takes the backdrop's colour from, hides it (#1059).
 */
test('a band of light across a tile leaves what it holds as it is', async () => {
  expect(await tilesOf('unown-band-1')).toStrictEqual({
    own: 'icon',
    shiny: 'icon',
    perfect: 'silhouette',
    lucky: 'silhouette',
  });

  const forms = (await formRow('unown-band-0')).tiles.map((t) => t.look);

  expect(forms.flatMap((look, i) => (look === 'icon' ? [i + 1] : []))).toStrictEqual([8, 9, 11, 14]);
  expect(forms).toHaveLength(23);
});

/**
 * Each way the game draws genders: both registered, one of two not — Ivysaur's ♀ dashed — both seen and neither caught,
 * one gender alone either way round, and Unown's ring, which is no gender at all.
 */
test('the genders an entry draws, solid where registered and dashed where not', async () => {
  const genders = async (name: string) => {
    const { image, lines: found } = await read(name);

    return gendersOn(image, found);
  };

  expect(await genders('bulbasaur-0')).toStrictEqual({ male: true, female: true });
  expect(await genders('ivysaur-0')).toStrictEqual({ male: true, female: false });
  expect(await genders('golem-0')).toStrictEqual({ male: false, female: false });
  expect(await genders('tauros-0')).toStrictEqual({ male: true });
  expect(await genders('nidoran-female-0')).toStrictEqual({ female: true });
  expect(await genders('unown-3')).toStrictEqual({});
});

/** The form row's tiles between the title and the row of icons, as the walk bounds it, with the `ALERT` label unread. */
async function formRow(name: string, { alert = true } = {}) {
  const { image, lines: found } = await read(name);
  const band = formBand(image, alert ? found : found.filter((l) => l !== alertOf(found)));
  const tiles = formsOn(image, band.from, band.to);

  return { tiles, ended: band.ended, labels: await labelsOf(image, tiles) };
}

/**
 * Meowth's three forms, all registered, the plain one showing; and Tauros's four, the Paldean breeds silhouettes and
 * labelled small enough that only the full-size read of each label gets them. Each label names its form among the game
 * master's, which spells them otherwise: `Combat Breed` is `Paldea Combat`.
 */
test("the form row's tiles, which is showing, and what each label names", async () => {
  const meowth = await formRow('meowth-0');

  expect(meowth.tiles.map((t) => [t.look, t.selected])).toStrictEqual([
    ['icon', true],
    ['icon', false],
    ['icon', false],
  ]);
  expect(meowth.labels).toStrictEqual([null, 'ALOLAN', 'GALARIAN']);

  const tauros = await formRow('tauros-0');
  const forms = DATA.forms.filter((f) => f.dex === 128 && !f.costume);

  expect(tauros.tiles.map((t) => t.look)).toStrictEqual(['icon', 'silhouette', 'silhouette', 'silhouette']);
  expect(tauros.labels.map((l) => l && formLabelled(l, forms)?.form)).toStrictEqual([
    null,
    'Paldea Combat',
    'Paldea Blaze',
    'Paldea Aqua',
  ]);
});

/**
 * Unown's rows of five, the first four of which its entry opens on, the fifth running off the foot. Its letters are
 * dark across the whole of the first row, which leaves that row little pale at its middle; it is one row for all that,
 * and a row lost there names every letter after it wrongly.
 */
test("every whole row of Unown's forms is found on the entry as it opens", async () => {
  const { tiles } = await formRow('unown-0');

  expect(tiles).toHaveLength(20);
  expect(new Set(tiles.map((t) => Math.round(t.box.top))).size, 'rows of five').toBe(4);
});

/** An entry with one form draws no form row, its band being the backdrop and nothing pale across it. */
test('an entry with one form has no form row', async () => {
  expect((await formRow('bulbasaur-0')).tiles).toStrictEqual([]);
});

/**
 * The `SEEN` counter ends the form row where the `ALERT` label is not read, as the label would have. Past the row of
 * icons are the counters and the CAUGHT tab, pale tiles all: Bulbasaur's band run on to the foot of the screen found
 * five of them, and Meowth's a fourth form.
 */
test('an entry whose ALERT is not read ends its form row at the same place', async () => {
  const bulbasaur = await formRow('bulbasaur-0', { alert: false });
  const meowth = await formRow('meowth-0', { alert: false });

  expect(bulbasaur.tiles).toStrictEqual([]);
  expect(bulbasaur.ended, 'a row that ends is not looked for past the foot of the screen').toBe(true);
  expect(meowth.tiles.map((t) => t.box)).toStrictEqual((await formRow('meowth-0')).tiles.map((t) => t.box));
});

/** The form a CAUGHT tab is showing, off its own tile, named among the species' forms. */
async function ownForm(name: string, dex: number) {
  const { image, lines: found } = await read(name);
  const own = caughtOn(image, found).find((c) => c.category === null);

  return own && iconIn(image, own.box, caughtFrame(image, own.box), own.look, formsOf(dex));
}

/** The game draws its own icons, so the right one is near-exact: Meowth's two regional forms and an Unown's letter. */
test("a form is named by its own tile's icon", async () => {
  expect(await ownForm('meowth-alola-1', 52)).toBe('Alola');
  expect(await ownForm('meowth-galar-1', 52)).toBe('Galarian');
  expect(await ownForm('unown-3', 201)).toBe('G');
});

/**
 * The silhouettes of a form row, named as the walk names them, `named` being the forms already registered, unless
 * `unread` drops their labels or `shapes` the icons to match them against.
 */
async function silhouettes(
  name: string,
  dex: number,
  named: readonly (string | null)[],
  { unread = false, shapes = formsOf(dex) }: { unread?: boolean; shapes?: readonly Candidate[] } = {},
) {
  const { image } = await read(name);
  const { tiles, labels } = await formRow(name);
  const forms = DATA.forms.filter((f) => f.dex === dex && !f.costume);
  const found = tiles.flatMap(({ box, look }, index) =>
    look === 'silhouette' ? [{ index, image, box, label: unread ? null : (labels[index] ?? null) }] : [],
  );

  return silhouettesNamed(found, forms, shapes, named);
}

/**
 * Unown's 14 letters not registered on the entry as it opens, each named by its own silhouette, as the phone drew them:
 * the letters run A to T in rows of five, and G, H, M, N, P and S, whose eyes are drawn white, are the ones registered.
 * The last column's tiles are cut short by the panel docked at the screen's edge, which E, J and O are named past.
 */
test("each of Unown's silhouetted letters is named by its own shape", async () => {
  const { forms, notes } = await silhouettes('unown-0', 201, ['G', 'H', 'M', 'N', 'P', 'S']);

  expect(forms.map((f) => f.form)).toStrictEqual([...'ABCDEFIJKLOQRT']);
  expect(notes).toStrictEqual([]);
});

/**
 * Paldean Tauros's three breeds, their labels unread, are named by shape alone: each is drawn in its own pose, and came
 * out under a twentieth as far from its own icon as from the next. With none of their icons to be had either, which
 * the walk says and goes on without, they are named only by elimination, in the game master's order — Aqua, Blaze,
 * Combat — where the game draws Combat, Blaze, Aqua. A form named that way is noted as such, so a line whose order was
 * not read says so.
 */
test('a silhouette its shape cannot settle is named by elimination, and noted', async () => {
  const byShape = await silhouettes('tauros-0', 128, [null], { unread: true });

  expect(byShape.forms.map((f) => f.form)).toStrictEqual(['Paldea Combat', 'Paldea Blaze', 'Paldea Aqua']);
  expect(byShape.notes).toStrictEqual([]);

  const { forms, notes } = await silhouettes('tauros-0', 128, [null], { unread: true, shapes: [] });

  expect(forms.map((f) => f.form)).toStrictEqual(['Paldea Aqua', 'Paldea Blaze', 'Paldea Combat']);
  expect(notes).toStrictEqual([
    'form 2 is a silhouette that neither its label nor its shape names, named Paldea Aqua by elimination',
    'form 3 is a silhouette that neither its label nor its shape names, named Paldea Blaze by elimination',
    'form 4 is a silhouette that neither its label nor its shape names, named Paldea Combat by elimination',
  ]);
});

/**
 * A species' last unregistered form, every other one named: Tauros as if Combat and Blaze were registered, with Aqua's
 * label unread. Held against Aqua's icon alone, which is all that is left, `namedFrom` would name nothing and it would
 * fall to elimination; held against every breed's, it is named by its shape.
 */
test("a species' last unregistered form is named by its shape", async () => {
  const { image } = await read('tauros-0');
  const { tiles } = await formRow('tauros-0');
  const { box } = tiles[3] ?? expect.unreachable("Tauros's form row has four tiles");
  const forms = DATA.forms.filter((f) => f.dex === 128 && !f.costume);

  expect(
    silhouettesNamed([{ index: 3, image, box, label: null }], forms, formsOf(128), [
      null,
      'Paldea Combat',
      'Paldea Blaze',
    ]),
  ).toStrictEqual({ forms: [{ index: 3, form: 'Paldea Aqua' }], notes: [] });
});

/** The costumes on one screenshot, named among `candidates`, undefined where none is plainly nearest. */
async function costumes(name: string, candidates: readonly Candidate[]) {
  const { image, lines: found } = await read(name);

  return costumesOn(image, found, false).map((box) => iconIn(image, box, caughtFrame(image, box), 'icon', candidates));
}

const BULBASAUR: readonly Candidate[] = [
  { name: 'Jan 2020', icon: icon('pm1.cJAN_2020_NOEVOLVE.icon.png') },
  { name: 'Spring 2020', icon: icon('pm1.cSPRING_2020_NOEVOLVE.icon.png') },
  { name: 'Fall 2019', icon: icon('pm1.fFALL_2019.icon.png') },
];

/**
 * Bulbasaur's three costumes, each named by its icon; and the never-guessing half. Without the Fall 2019 icon, its tile
 * is as far from both the others, and is no one's; with one icon alone, nothing is plainly nearer than anything, so
 * that icon names none of the three, its own included; and Charizard's one costume sits between `Goggles 2026` and the
 * clone's `Copy 2019`, 16.2 against 17.1, which is too near to call.
 */
test('a costume is named by its icon, and only where one is plainly nearest', async () => {
  expect(await costumes('bulbasaur-2', BULBASAUR)).toStrictEqual(['Spring 2020', 'Jan 2020', 'Fall 2019']);
  expect(await costumes('bulbasaur-2', BULBASAUR.slice(0, 2))).toStrictEqual(['Spring 2020', 'Jan 2020', undefined]);
  expect(await costumes('bulbasaur-2', BULBASAUR.slice(0, 1))).toStrictEqual([undefined, undefined, undefined]);

  const charizard = ['pm6.cJAN_2020_NOEVOLVE', 'pm6.cSPRING_2020_NOEVOLVE', 'pm6.fCOPY_2019', 'pm6.fGOGGLES_2026'].map(
    (file) => ({ name: file, icon: icon(`${file}.icon.png`) }),
  );

  expect(await costumes('charizard-2', charizard)).toStrictEqual([undefined]);
});

/**
 * The nearest and next nearest of Pikachu's hundred-odd costumes to each tile on `pikachu-3`, which is all a name turns
 * on: among these the tiles are named as among every one a walk gathers, at a fifth of the cost.
 */
const PIKACHU: readonly Candidate[] = (
  [
    ['Anniversary', 'pm25.cANNIVERSARY'],
    ['November 2018', 'pm25.cNOVEMBER_2018'],
    ['May 2019', 'pm25.cMAY_2019_NOEVOLVE'],
    ['Kanto 2020', 'pm25.cKANTO_2020_NOEVOLVE'],
    ['Halloween 2017', 'pm25.cHALLOWEEN_2017'],
    ['Fall 2018', 'pm25.cFALL_2018'],
    ['Summer 2018', 'pm25.cSUMMER_2018'],
    ['Winter 2018', 'pm25.cWINTER_2018'],
    ['Gotour 2024 B', 'pm25.fGOTOUR_2024_B'],
    ['Jan 2020', 'pm25.cJAN_2020_NOEVOLVE'],
    ['Gofest 2022', 'pm25.cGOFEST_2022_NOEVOLVE'],
    ['Gofest 2022', 'pm25.fGOFEST_2022'],
    ['Halloween 2021', 'pm25.cHALLOWEEN_2021_NOEVOLVE'],
    ['Gofest 2021', 'pm25.cGOFEST_2021_NOEVOLVE'],
    ['Fall 2019', 'pm25.fFALL_2019'],
    ['Gofest 2026 Cap Red', 'pm25.fGOFEST_2026_CAP_RED'],
    ['Gofest 2026 Cap Yellow', 'pm25.fGOFEST_2026_CAP_YELLOW'],
    ['Gofest 2026 Cap Blue', 'pm25.fGOFEST_2026_CAP_BLUE'],
    ['Anniversary 2026', 'pm25.fANNIVERSARY_2026'],
  ] as const
).map(([name, file]) => ({ name, icon: icon(`${file}.icon.png`) }));

/**
 * Pikachu's costumes, named where one icon is plainly nearest; the three GO Fest 2026 caps, alike but for their colour,
 * and two party hats are left unnamed. Three rows of the five read: the first is under PGSharp's star button (#1005),
 * and the fifth runs under the close button.
 */
test("Pikachu's costumes are named among its own", async () => {
  expect(await costumes('pikachu-3', PIKACHU)).toStrictEqual([
    undefined,
    'May 2019',
    'Halloween 2017',
    'Summer 2018',
    'Winter 2018',
    undefined,
    'Halloween 2021',
    'Fall 2019',
    undefined,
    undefined,
    'Anniversary 2026',
    undefined,
  ]);
});

/**
 * The slots a `CostumeReader` places costumes in off `names`, read in turn as a drag at a time down an entry, and
 * whether any went unplaced. With no icons to name them by, since naming is what costs the time and is `ranked`'s,
 * whose own tests are above.
 */
async function placed(...names: readonly string[]) {
  const reader = new CostumeReader([]);

  for (const name of names) {
    const { image, lines: found } = await read(name);

    reader.read(image, found, caughtOn(image, found));
  }

  return { slots: reader.costumes.map(({ slot }) => slot), unplaced: reader.unplaced };
}

/** The slots from `from` up to but not including `to`. */
const slots = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

/**
 * Pikachu's 31 costumes, eight rows of four but the last, read off the five screenshots a walk takes of them: each once
 * however many show it, in the game's order. The first row is read off `pikachu-2`, being under PGSharp's star button
 * on `pikachu-3` (#1005); the last is shown twice, `pikachu-6` a short drag on from `pikachu-5` that the end of the
 * entry stopped; and the pill that crosses the empty slot after it on both is no costume.
 */
test("each of an entry's costumes is read once, by its place among them", async () => {
  expect(await placed('pikachu-2', 'pikachu-3', 'pikachu-4', 'pikachu-5', 'pikachu-6')).toStrictEqual({
    slots: slots(0, 31),
    unplaced: false,
  });
});

/**
 * A drag the phone dropped, which shows the same costumes again where they were, and one that went too far to line up,
 * which leaves what it shows unread and says so rather than counting any of it twice.
 */
test('a dropped drag reads nothing twice, and one too far to line up reads nothing', async () => {
  expect(await placed('pikachu-3', 'pikachu-4', 'pikachu-4')).toStrictEqual({ slots: slots(4, 24), unplaced: false });
  expect(await placed('pikachu-2', 'pikachu-5')).toStrictEqual({ slots: slots(0, 8), unplaced: true });
});

/**
 * The grid by its button back to the list, whichever tab it is of: on ★ 100%'s the tiles' numbers are pink on pink and
 * not one of them reads, where the button's label is dark on white on every tab. Nothing else carries the label.
 */
test('the grid is known by its REGIONS button on any tab, and nothing else is', async () => {
  for (const grid of ['kanto', 'paldea-perfect']) {
    expect(regionsButtonOf((await read(grid)).lines), grid).toBeDefined();
  }

  for (const other of ['map', 'menu', 'tab-pokemon-0', 'bulbasaur-0', 'bulbasaur-2']) {
    expect(regionsButtonOf((await read(other)).lines), other).toBeUndefined();
  }
});

/**
 * The counts a tab's region list prints. The POKÉMON tab's over the three screenshots its list takes to scroll, each
 * count taken only where the number after it is the region's own size; SHINY's off its first, with `Caught:`.
 */
test("each tab's region list counts its regions", async () => {
  const counted = async (...names: string[]) => {
    const all = new Map<string, number>();

    for (const name of names) {
      for (const { region, count } of countsOn(await listLines(capture(name)))) {
        all.set(region, count);
      }
    }

    return Object.fromEntries(all);
  };

  expect(await counted('tab-pokemon-0', 'tab-pokemon-1', 'tab-pokemon-2')).toMatchObject({
    Kanto: 148,
    Johto: 98,
    Hoenn: 134,
    Sinnoh: 97,
    Unova: 114,
    Alola: 55,
    Hisui: 3,
    Paldea: 44,
    Unidentified: 2,
  });

  expect(await counted('tab-shiny-0')).toMatchObject({ Kanto: 80, Johto: 51, Hoenn: 78, Sinnoh: 33, Unova: 51 });
});
