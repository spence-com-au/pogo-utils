/**
 * What the detail screen's readers make of real screens, over the corpus of captures committed beside this file.
 *
 * **A row says what the Pokémon is, not what the readers answered.** A `Fixture` is the screen; a `Defects` beside it
 * is where some reader answers something else, pinned rather than softened away — fixing one is a change to the code
 * and so a pull request of its own. The `unseparated` ones are no second read of the same screen, but seven of the
 * eight are the artwork declining two icons a 12-bin hue histogram cannot tell apart, which a sharper signature could;
 * only `basculin-blue.png` is beyond every reader, its form being under PGSharp's own box. Everything after that is
 * derived from the pair, so a consequence cannot drift from its cause, and `COVERAGE` pins the counts rather than
 * leaving them to prose nothing checks.
 *
 * `NEGATIVE` holds the captures that are not detail screens, asserting the readers do not invent on a screen none of
 * them was written for. `no-pgsharp.png` and `pgsharp-no-overlay.png` are one Squirtle captured twice and so a control
 * on each other, the same screen reading `CP 330` on one and `CP 390` on the other.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, assert, beforeAll, describe, expect, test } from 'vitest';
import { closest, fitsHeight, type Form, type GameData, type IVs } from './game-master.mts';
import { ambiguous, nearest, signatureOf, type Signature } from './artwork.mts';
import { decodePng, screenIn } from './png.mts';
import { sizeOf, type Gender, type Size } from './badges.mts';
import { HEIGHT, parseDetail, readLines } from './detail.mts';
import { clearable, identify, label } from './identify.mts';
import { findOverlay } from './overlay.mts';
import { dexOn } from './pokedex.mts';
import { parseMoves, type Moves } from './moves.mts';
import { useTestEngine } from './test-engine.mts';

/**
 * The game master, vended rather than downloaded so a test of a reader reaches no network. Vended whole rather than
 * cut down to the forms these captures reach: a narrowed copy would transcribe base stats from the authority it is
 * checked against, with nothing failing when the two disagree. The cast is unchecked, which is what the test below
 * makes loud.
 */
const DATA = JSON.parse(readFileSync(new URL('fixtures/game-master.json', import.meta.url), 'utf8')) as GameData;

/**
 * The tag names under storage's own TAGS tab, which is the vocabulary a `--tags` run passes and the only thing that can
 * turn a chip's reading into a name: the game draws an emoji inside the pill and Tesseract reads it as letters, so
 * `Shiny ✦` comes back `Shiny SJ` and `Lucky ☘` comes back `Lucky Me`. `tagsOn` answers what it read on purpose and
 * `scripts/inventory.mts` matches it the same way, at the same slack, so this asserts the contract the CLI depends on
 * rather than the exact letters Tesseract happened to produce.
 */
const TAGS = [
  'Background',
  'Dynamax',
  'Favorites',
  'GBL',
  'Level 50',
  'Lucky',
  'Mega',
  'Perfect',
  'Purified',
  'Shadow',
  'Shiny',
];
const TAG_SLACK = 0.3;

/**
 * The hue signature of the game's own icon for each form the numbers cannot separate, read once out of the file that
 * form's own `icon` names — no template of the label reaches it, the blank Ho-Oh being `pm250.icon.png` against
 * `Ho-Oh (S)`'s `pm250.fS.icon.png` — and recorded here for the same reason the forms and the CP multipliers are: a
 * test of a reader must not reach the network. Four decimal places, where the margin that decides an answer is 0.3.
 *
 * Three families, two of which land: Burmy's three icons are 1.85 apart at their closest and Cherrim's two 1.62,
 * against a margin of 0.3. Ho-Oh's two are 0.25 apart, which is the third one's reason for being here — a lead can
 * never exceed the distance between the two icons it is measured against, so that family is one no capture can settle
 * and `MARGIN` is what says so. Without it the five that land are each nearest their own icon, and a margin of 0 would
 * answer every one of them correctly with nothing below noticing.
 */
const ARTWORK = new Map<string, Signature>([
  ['Burmy (Plant)', [0, 0.0527, 0.0288, 0.9173, 0.0012, 0, 0, 0, 0, 0, 0, 0]],
  ['Burmy (Sandy)', [0, 0.9677, 0.0245, 0, 0, 0, 0, 0.0078, 0, 0, 0, 0]],
  ['Burmy (Trash)', [0.6469, 0.0088, 0.0064, 0, 0, 0, 0.0064, 0, 0, 0, 0, 0.3315]],
  ['Cherrim (Overcast)', [0.0235, 0, 0, 0.0294, 0.1917, 0.0002, 0, 0, 0.2918, 0.2974, 0.0092, 0.1568]],
  ['Cherrim (Sunny)', [0.1492, 0.5625, 0.0217, 0.001, 0.0097, 0, 0, 0, 0, 0, 0, 0.2559]],
  ['Ho-Oh', [0.6891, 0.213, 0.0867, 0.0005, 0, 0, 0.0006, 0.0064, 0.0016, 0, 0.0009, 0.0011]],
  ['Ho-Oh (S)', [0.5724, 0.272, 0.1522, 0.0002, 0, 0, 0, 0.0012, 0.0017, 0, 0, 0.0003]],
]);

/** Those signatures against the forms they belong to, which is the shape `identify` takes them in. */
const ICONS: ReadonlyMap<Form, Signature> = new Map(
  DATA.forms.flatMap((f): [Form, Signature][] => {
    const signature = ARTWORK.get(label(f));

    return signature ? [[f, signature]] : [];
  }),
);

/**
 * What a reader answers where it disagrees with the row it sits in. Its presence marks a defect pinned rather than a
 * reading confirmed.
 */
interface Defects {
  tags?: string[];
  types?: string[];
  nickname?: string;
  cp?: number;
  alternatives?: string[];

  /** Null where `findOverlay` finds no box on a screen that plainly carries an overlay. */
  box?: null;

  /** True where `isFavourite` reads gold in the star corner of a Pokémon whose star is a white outline. */
  favourite?: boolean;

  /** What the height reads as where the size pill drawn over it corrupts the digits. */
  height?: number;

  /**
   * What `readOverlay` makes of the triple where it is not what PGSharp drew: `null` where it reads nothing out of a
   * box `findOverlay` did find, and the triple itself where it reads one that is wrong.
   */
  iv?: IVs | null;

  /** The name under the artwork, which is the nickname where one is set and so carries no species to fall back on. */
  name?: string;

  /** The bracketed form `readOverlay` reads, where it is not the one PGSharp drew. */
  suffix?: string | null;

  /** What `sizeOf` makes of the badge, `null` where it finds none above a height that wears one. */
  size?: Size | null;

  /** The whole label `identify` answers, where it is not this Pokémon's own. */
  label?: string;

  /** Every level `identify` still admits, where the row states the one the Pokémon is actually at. */
  levels?: number[];

  /**
   * The forms `identify` answers as sharing every number this one does, which nothing the screen prints could have
   * separated. A defect in that the row states one Pokémon and the readers reach several, and one the artwork is the
   * only reader that could take away — by telling two icons apart that it currently declines, or by reaching a form the
   * game draws none for.
   */
  unseparated?: string[];

  /**
   * Every note `identify` answers, in its order — including the two that are derived from `alternatives` and from
   * `unseparated` where this is absent, and which have to be written out where it is present.
   *
   * The whole list rather than the rest of it, because a derived note is not always last: `identify` reports the
   * unseparated forms ahead of a level shortlist no HP can be, which `charizard-gigantamax.png` did until its overlay
   * was read from a band holding the whole of its level. A row that could only append could not state that order, and
   * the order is the half that says which note came of which. No row pins one now.
   */
  notes?: string[];
}

/**
 * One Pokémon, as the game and the capture state it. Nothing here is a reader's answer: the readers are what these are
 * asserted against, and where one disagrees that goes in `defects` rather than softening a field.
 *
 * Ten of the attributes are optional and default to absent — no background, no costume, not a favourite, not lucky, not
 * purified, not shadow, not shiny, no size pill, no chips and a `name` that is the species. Absence is a claim and not
 * a gap: it says the screen shows none of those, which for the rows with no search behind them is what looking at the
 * screen can state. The alternative is every field written out on every row, which nobody reads.
 */
interface Fixture {
  defects?: Defects;
  favourite?: boolean;
  file: string;
  gender: Gender;
  height: number;
  hp: number;
  lucky?: boolean;
  purified?: boolean;
  shadow?: boolean;
  shiny?: boolean;
  size?: Size;
  types: string[];
  weight: number;

  /** The scene behind the artwork, or absent for the game's own plain sky. Described, the game showing no label. */
  background?: string;

  /** What the artwork wears, or absent for nothing. Described rather than named, the game showing no label either. */
  costume?: string;

  /** The CP above the artwork, which OCR reads on only the captures the CP test below names. */
  cp: number;

  /** Whether the game draws the Dynamax treatment behind the artwork. */
  dynamax?: boolean;

  /** Whether the game draws the Gigantamax treatment behind the artwork. */
  gigantamax?: boolean;

  /** The game master's own name for the form, `null` for a base form. */
  form: string | null;

  /** The name the screen prints under the artwork, which defaults to the species and is a nickname where it differs. */
  name?: string;

  /**
   * PGSharp's overlay as it is drawn on this screen, or null where PGSharp drew none at all. One object rather than a
   * nullable level beside a nullable triple, so "this capture has no knowable level or IVs" is structural. `suffix` is
   * the bracketed form, which PGSharp appends for Unown and Spinda and nothing else.
   */
  overlay: { iv: IVs; level: number; suffix?: string } | null;

  /** The species as the game master names it, which a nicknamed screen does not print. */
  species: string;

  /** The chips under the HP, as names once resolved against `TAGS`. */
  tags?: string[];
}

/**
 * The game's own searches that selected four of the captures, which is where those four rows' `size` and flags come
 * from. Recording them is the point rather than a note: a capture chosen because its sprite looked small to me is only
 * as good as my eye, where `xxs&female&!lucky&!shiny&!costume&!background&!shadow&!purified` is the game stating all
 * eight at once, falsifiably — re-run it and the first match is in the set the row claims. Negation is the half only a
 * search can give, since nothing on the screen says a Pokémon is **not** lucky.
 *
 * The other 40 rows have no search behind them. They arrived named for what they are, and the name is a claim the
 * rendered screen has to bear out — weaker provenance, and sufficient for what those rows are for.
 *
 * `xurkitree.png`'s search is the weak one of the four: `alola` pins its region and nothing else, so its `size` and
 * flags rest on the same eye as the 40 and it is one of those rows in everything but provenance.
 *
 * | file             | search                                                                               |
 * |------------------|--------------------------------------------------------------------------------------|
 * | `applin.png`     | `xl&female&!lucky&!shiny&!costume&!background&!shadow&!purified`                      |
 * | `ho-oh.png`      | `lucky&shiny&!male&!female&!costume&!background&!shadow&!purified&!xxl&!xxs&!xs&!xl`  |
 * | `xurkitree.png`  | `alola`                                                                              |
 * | `smoliv.png`     | `xxs&female&!lucky&!shiny&!costume&!background&!shadow&!purified`                     |
 */
const FIXTURES: readonly Fixture[] = [
  {
    cp: 286,
    file: 'applin.png',
    form: null,
    gender: 'female',
    height: 0.28,
    hp: 69,
    overlay: { iv: { attack: 10, defense: 14, stamina: 14 }, level: 15 },
    size: 'XL',
    species: 'Applin',
    types: ['Grass', 'Dragon'],
    weight: 0.95,
  },
  {
    cp: 1966,
    favourite: true,
    file: 'articuno-galar.png',
    form: 'Galarian',
    gender: 'genderunknown',
    height: 1.58,
    hp: 131,
    overlay: { iv: { attack: 12, defense: 4, stamina: 13 }, level: 20 },
    species: 'Articuno',
    types: ['Psychic', 'Flying'],
    weight: 47.79,
  },
  {
    cp: 1705,
    file: 'articuno-kanto.png',
    form: null,
    gender: 'genderunknown',
    height: 1.62,
    hp: 130,
    overlay: { iv: { attack: 13, defense: 12, stamina: 12 }, level: 20 },
    species: 'Articuno',
    types: ['Ice', 'Flying'],
    weight: 48.28,
  },
  {
    cp: 253,
    file: 'basculin-blue.png',
    form: 'Blue Striped',
    gender: 'male',
    height: 1.02,
    hp: 51,
    defects: {
      label: 'Basculin (Red Striped)',
      unseparated: ['Basculin (Blue Striped)', 'Basculin (White Striped)'],
    },
    overlay: { iv: { attack: 8, defense: 3, stamina: 5 }, level: 5 },
    species: 'Basculin',
    types: ['Water'],
    weight: 23.31,
  },
  {
    cp: 206,
    file: 'burmy-plant.png',
    form: 'Plant',
    gender: 'male',
    height: 0.23,
    hp: 69,
    overlay: { iv: { attack: 14, defense: 15, stamina: 15 }, level: 15 },
    species: 'Burmy',
    types: ['Bug'],
    weight: 4.62,
  },
  {
    cp: 196,
    file: 'burmy-sandy.png',
    form: 'Sandy',
    gender: 'female',
    height: 0.24,
    hp: 67,
    overlay: { iv: { attack: 12, defense: 14, stamina: 11 }, level: 15 },
    species: 'Burmy',
    types: ['Bug'],
    weight: 4.57,
  },
  {
    cp: 47,
    file: 'burmy-trash.png',
    form: 'Trash',
    gender: 'male',
    height: 0.18,
    hp: 36,
    overlay: { iv: { attack: 0, defense: 7, stamina: 6 }, level: 5 },
    species: 'Burmy',
    types: ['Bug'],
    weight: 2.4,
  },
  {
    cp: 764,
    file: 'castform-normal.png',
    form: null,
    gender: 'male',
    height: 0.24,
    hp: 102,
    overlay: { iv: { attack: 10, defense: 14, stamina: 15 }, level: 17 },
    species: 'Castform',
    types: ['Normal'],
    weight: 0.49,
  },
  {
    cp: 832,
    file: 'castform-rainy.png',
    form: 'Rainy',
    gender: 'male',
    height: 0.29,
    hp: 104,
    lucky: true,
    name: 'Rainy 93%',
    overlay: { iv: { attack: 15, defense: 15, stamina: 12 }, level: 18 },
    species: 'Castform',
    types: ['Water'],
    weight: 0.8,
  },
  {
    cp: 746,
    file: 'castform-snowy.png',
    form: 'Snowy',
    gender: 'female',
    height: 0.36,
    hp: 102,
    overlay: { iv: { attack: 5, defense: 5, stamina: 9 }, level: 18 },
    species: 'Castform',
    types: ['Ice'],
    weight: 1.01,
  },
  {
    cp: 979,
    file: 'castform-sunny.png',
    form: 'Sunny',
    gender: 'female',
    height: 0.36,
    hp: 114,
    overlay: { iv: { attack: 15, defense: 15, stamina: 15 }, level: 21 },
    species: 'Castform',
    types: ['Fire'],
    weight: 1.26,
  },
  {
    cp: 693,
    dynamax: true,
    file: 'chansey-dynamax.png',
    form: null,
    gender: 'female',
    height: 1.36,
    hp: 298,
    overlay: { iv: { attack: 13, defense: 14, stamina: 12 }, level: 20 },
    species: 'Chansey',
    types: ['Normal'],
    weight: 57.97,
  },
  {
    cp: 1605,
    defects: { unseparated: ['Charizard (Copy 2019)', 'Charizard (Goggles 2026)'] },
    file: 'charizard-gigantamax.png',
    form: null,
    gender: 'male',
    gigantamax: true,
    height: 1.77,
    hp: 118,
    overlay: { iv: { attack: 12, defense: 12, stamina: 12 }, level: 20 },
    species: 'Charizard',
    types: ['Fire', 'Flying'],
    weight: 106.37,
  },
  {
    cp: 1025,
    file: 'cherrim-overcast.png',
    form: 'Overcast',
    gender: 'male',
    height: 0.4,
    hp: 102,
    overlay: { iv: { attack: 13, defense: 15, stamina: 9 }, level: 18 },
    species: 'Cherrim',
    types: ['Grass'],
    weight: 3.87,
  },
  {
    cp: 1658,
    file: 'cherrim-sunny.png',
    form: 'Sunny',
    gender: 'male',
    height: 0.61,
    hp: 132,
    overlay: { iv: { attack: 10, defense: 7, stamina: 7 }, level: 31 },
    shiny: true,
    species: 'Cherrim',
    types: ['Grass'],
    weight: 12.82,
  },
  {
    cp: 1441,
    file: 'deoxys-attack.png',
    form: 'Attack',
    gender: 'genderunknown',
    height: 1.95,
    hp: 90,
    overlay: { iv: { attack: 14, defense: 13, stamina: 14 }, level: 20 },
    species: 'Deoxys',
    types: ['Psychic'],
    weight: 81.38,
  },
  {
    cp: 1569,
    file: 'deoxys-defense.png',
    form: 'Defense',
    gender: 'genderunknown',
    height: 1.56,
    hp: 100,
    overlay: { iv: { attack: 11, defense: 11, stamina: 14 }, level: 25 },
    species: 'Deoxys',
    types: ['Psychic'],
    weight: 44.29,
  },
  {
    cp: 1772,
    file: 'deoxys-normal.png',
    form: null,
    gender: 'genderunknown',
    height: 1.94,
    hp: 90,
    overlay: { iv: { attack: 11, defense: 13, stamina: 15 }, level: 20 },
    species: 'Deoxys',
    types: ['Psychic'],
    weight: 77.83,
  },
  {
    cp: 2009,
    file: 'deoxys-speed.png',
    form: 'Speed',
    gender: 'genderunknown',
    height: 1.73,
    hp: 101,
    overlay: { iv: { attack: 12, defense: 10, stamina: 15 }, level: 25 },
    species: 'Deoxys',
    types: ['Psychic'],
    weight: 63.93,
  },
  {
    cp: 2848,
    file: 'dialga-altered.png',
    form: null,
    gender: 'genderunknown',
    height: 6.82,
    hp: 146,
    overlay: { iv: { attack: 12, defense: 15, stamina: 14 }, level: 25 },
    size: 'XL',
    species: 'Dialga',
    types: ['Steel', 'Dragon'],
    weight: 1077.24,
  },
  {
    cp: 2845,
    file: 'dialga-origin.png',
    form: 'Origin',
    gender: 'genderunknown',
    height: 6.6,
    hp: 145,
    overlay: { iv: { attack: 10, defense: 13, stamina: 13 }, level: 25 },
    species: 'Dialga',
    types: ['Steel', 'Dragon'],
    weight: 809.96,
  },
  {
    background: 'a city skyline across a river',
    costume: 'a pale cap',
    cp: 451,
    file: 'eevee-background.png',
    form: null,
    gender: 'male',
    height: 0.24,
    hp: 83,
    overlay: { iv: { attack: 13, defense: 15, stamina: 15 }, level: 15 },
    species: 'Eevee',
    types: ['Normal'],
    weight: 4.24,
  },
  {
    cp: 738,
    file: 'growlithe-nickname.png',
    form: 'Hisuian',
    gender: 'male',
    height: 0.91,
    hp: 100,
    name: 'Nickname',
    overlay: { iv: { attack: 14, defense: 12, stamina: 14 }, level: 20 },
    species: 'Growlithe',
    types: ['Fire', 'Rock'],
    weight: 25.31,
  },
  {
    cp: 2738,
    defects: { unseparated: ['Ho-Oh (S)'] },
    favourite: true,
    file: 'ho-oh.png',
    form: null,
    gender: 'genderunknown',
    height: 4.6,
    hp: 152,
    lucky: true,
    name: '96%',
    overlay: { iv: { attack: 13, defense: 15, stamina: 15 }, level: 25 },
    shiny: true,
    species: 'Ho-Oh',
    tags: ['Shiny', 'Lucky'],
    types: ['Fire', 'Flying'],
    weight: 246.49,
  },
  {
    cp: 1679,
    favourite: true,
    file: 'meloetta-aria.png',
    form: 'Aria',
    gender: 'genderunknown',
    height: 0.69,
    hp: 122,
    overlay: { iv: { attack: 13, defense: 15, stamina: 12 }, level: 15 },
    species: 'Meloetta',
    types: ['Normal', 'Psychic'],
    weight: 8.2,
  },
  {
    cp: 431,
    file: 'meowth-alola.png',
    form: 'Alola',
    gender: 'male',
    height: 0.38,
    hp: 78,
    overlay: { iv: { attack: 10, defense: 15, stamina: 12 }, level: 20 },
    species: 'Meowth',
    types: ['Dark'],
    weight: 4.34,
  },
  {
    cp: 571,
    file: 'meowth-galar.png',
    form: 'Galarian',
    gender: 'female',
    height: 0.4,
    hp: 89,
    overlay: { iv: { attack: 13, defense: 13, stamina: 12 }, level: 20 },
    species: 'Meowth',
    types: ['Steel'],
    weight: 7.45,
  },
  {
    cp: 423,
    file: 'meowth-kanto.png',
    form: null,
    gender: 'male',
    height: 0.36,
    hp: 80,
    overlay: { iv: { attack: 15, defense: 14, stamina: 14 }, level: 20 },
    species: 'Meowth',
    types: ['Normal'],
    weight: 3.88,
  },
  {
    cp: 69,
    defects: { unseparated: ['Pikachu (Copy 2019)'] },
    file: 'pikachu.png',
    form: null,
    gender: 'male',
    height: 0.36,
    hp: 27,
    overlay: { iv: { attack: 15, defense: 13, stamina: 15 }, level: 3 },
    species: 'Pikachu',
    types: ['Electric'],
    weight: 5.11,
  },
  {
    costume: "Ash's red-and-white cap",
    cp: 489,
    defects: { unseparated: ['Pikachu (Copy 2019)'] },
    file: 'pikachu-ash-hat.png',
    form: null,
    gender: 'female',
    height: 0.37,
    hp: 72,
    overlay: { iv: { attack: 9, defense: 2, stamina: 8 }, level: 21 },
    species: 'Pikachu',
    types: ['Electric'],
    weight: 4.54,
  },
  {
    costume: 'a Santa hat',
    cp: 577,
    defects: { unseparated: ['Pikachu (Copy 2019)'] },
    favourite: true,
    file: 'pikachu-santa-hat.png',
    form: null,
    gender: 'male',
    height: 0.4,
    hp: 76,
    overlay: { iv: { attack: 14, defense: 8, stamina: 9 }, level: 23 },
    species: 'Pikachu',
    types: ['Electric'],
    weight: 7.32,
  },
  {
    costume: "Willow's lab coat and goggles",
    cp: 385,
    defects: { unseparated: ['Pikachu (Copy 2019)'] },
    file: 'pikachu-willows-assistant.png',
    form: null,
    gender: 'male',
    height: 0.35,
    hp: 63,
    overlay: { iv: { attack: 13, defense: 13, stamina: 11 }, level: 15 },
    species: 'Pikachu',
    types: ['Electric'],
    weight: 3.41,
  },
  {
    costume: 'a purple witch hat',
    cp: 625,
    defects: { unseparated: ['Pikachu (Copy 2019)'] },
    file: 'pikachu-witch-hat.png',
    form: null,
    gender: 'female',
    height: 0.38,
    hp: 83,
    overlay: { iv: { attack: 2, defense: 11, stamina: 10 }, level: 27 },
    species: 'Pikachu',
    types: ['Electric'],
    weight: 5.61,
  },
  {
    cp: 14,
    file: 'pumpkaboo-large.png',
    form: 'Large',
    gender: 'male',
    height: 0.57,
    hp: 14,
    overlay: { iv: { attack: 2, defense: 0, stamina: 6 }, level: 1 },
    shiny: true,
    size: 'XL',
    species: 'Pumpkaboo',
    types: ['Ghost', 'Grass'],
    weight: 11.07,
  },
  {
    cp: 813,
    file: 'rotom-wash.png',
    form: 'Wash',
    gender: 'genderunknown',
    height: 0.31,
    hp: 63,
    overlay: { iv: { attack: 13, defense: 3, stamina: 1 }, level: 12 },
    species: 'Rotom',
    types: ['Electric', 'Water'],
    weight: 0.29,
  },
  {
    cp: 340,
    file: 'smoliv.png',
    form: null,
    gender: 'female',
    height: 0.15,
    hp: 68,
    overlay: { iv: { attack: 11, defense: 10, stamina: 12 }, level: 15 },
    size: 'XXS',
    species: 'Smoliv',
    types: ['Grass', 'Normal'],
    weight: 0.97,
  },
  {
    cp: 2304,
    favourite: true,
    file: 'snorlax-purified.png',
    form: null,
    gender: 'female',
    height: 2.05,
    hp: 230,
    overlay: { iv: { attack: 15, defense: 15, stamina: 15 }, level: 25 },
    purified: true,
    species: 'Snorlax',
    tags: ['Perfect'],
    types: ['Normal'],
    weight: 383.9,
  },
  {
    cp: 511,
    file: 'spinda-04.png',
    form: '04',
    gender: 'male',
    height: 1.16,
    hp: 87,
    overlay: { iv: { attack: 13, defense: 13, stamina: 15 }, level: 15, suffix: '04' },
    species: 'Spinda',
    types: ['Normal'],
    weight: 5.43,
  },
  {
    cp: 998,
    file: 'spoink.png',
    form: null,
    gender: 'female',
    height: 0.65,
    hp: 115,
    overlay: { iv: { attack: 14, defense: 12, stamina: 11 }, level: 27 },
    species: 'Spoink',
    types: ['Psychic'],
    weight: 24.06,
  },
  {
    cp: 487,
    file: 'unown-b.png',
    form: 'B',
    gender: 'genderunknown',
    height: 0.53,
    hp: 75,
    overlay: { iv: { attack: 7, defense: 10, stamina: 7 }, level: 16, suffix: 'B' },
    species: 'Unown',
    types: ['Psychic'],
    weight: 3.69,
  },
  {
    cp: 517,
    file: 'unown-exclamation.png',
    form: 'Exclamation Point',
    gender: 'genderunknown',
    height: 0.38,
    hp: 79,
    overlay: { iv: { attack: 10, defense: 13, stamina: 14 }, level: 16, suffix: '[' },
    species: 'Unown',
    types: ['Psychic'],
    weight: 3.86,
  },
  {
    cp: 839,
    file: 'unown-m.png',
    form: 'M',
    gender: 'genderunknown',
    height: 0.63,
    hp: 98,
    overlay: { iv: { attack: 8, defense: 7, stamina: 5 }, level: 28, suffix: 'M' },
    shiny: true,
    species: 'Unown',
    types: ['Psychic'],
    weight: 7.94,
  },
  {
    cp: 486,
    file: 'unown-question.png',
    form: 'Question Mark',
    gender: 'genderunknown',
    height: 0.45,
    hp: 76,
    overlay: { iv: { attack: 4, defense: 12, stamina: 10 }, level: 16, suffix: '\\' },
    species: 'Unown',
    types: ['Psychic'],
    weight: 3.86,
  },
  {
    cp: 2197,
    file: 'xurkitree.png',
    form: null,
    gender: 'genderunknown',
    height: 5.78,
    hp: 124,
    overlay: { iv: { attack: 11, defense: 12, stamina: 14 }, level: 20 },
    size: 'XXL',
    species: 'Xurkitree',
    types: ['Electric'],
    weight: 162.2,
  },
];

/**
 * Everything the readers answer about one capture. Each attribute is a test of its own under that capture's `describe`,
 * so a failure names the reader that broke where one `toStrictEqual` over the lot says only that the object differs.
 *
 * Memoised by file, which is what keeps that affordable: OCR is the whole cost of this suite at about four seconds a
 * capture, and six of the tests below read a capture the loop has already read. Caching the promise rather than the
 * reading is what makes that hold whatever order the runner takes them in. Nothing mutates a reading, and a screenshot
 * is the same screenshot every time it is read, so there is nothing for a shared one to carry between tests.
 */
const read = async (file: string) => {
  const image = screenIn(decodePng(readFileSync(new URL(`fixtures/${file}`, import.meta.url))));
  const lines = await readLines(image);
  const detail = await parseDetail(lines, DATA, image);
  const found = await findOverlay(image);

  // The artwork's own signature, which is the only thing that separates forms identical in every number. Floored on the
  // overlay's box where one was found, PGSharp drawing over the artwork, so no fraction of one phone's screen is
  // written down here. Memoised with the reading because the segmentation walks the pixels and the assertions are meant
  // to be free.
  const box = found?.box ?? null;
  const signature = signatureOf(image, box ? box.y + box.height : undefined);

  const overlay = found?.overlay ?? null;
  const artwork = signature ? { signature, icons: ICONS } : undefined;

  return {
    image,
    lines,
    detail,
    box,
    overlay,
    artwork,

    // The end of the pipeline, memoised with the readings it is derived from. It is pure and cheap, but each of a
    // capture's eighteen attributes is a test of its own, and caching it says outright that the eighteen are asserting
    // one answer rather than eighteen separately-derived ones.
    identity: identify(DATA, detail, overlay, artwork),
  };
};

const readings = new Map<string, ReturnType<typeof read>>();

const readingOf = (file: string) => {
  // Forgotten again if it rejects, because what rejects here is the machine rather than the capture: the kernel
  // occasionally kills one of the thousands of Tesseract processes a suite spawns. Remembering the rejection made that
  // one flake fail every later test touching the same capture.
  const reading =
    readings.get(file) ??
    read(file).catch((error: unknown) => {
      readings.delete(file);

      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    });

  readings.set(file, reading);

  return reading;
};

/**
 * The overlay a row claims, in the two stages the readers fail at — a row that conflated them could not say which went
 * wrong. A box is found unless the row carries `defects.box`; the triple is read out of it unless the row carries
 * `defects.iv` as well. Both are `in` tests rather than `??`, the defect in each case being a `null` that a `??` would
 * read as no defect at all.
 *
 * `levels` follows from the pair, so a consequence cannot drift from its cause: with no triple there is no level, and
 * with no level `identify` derives no CP. A function rather than three lines in the loop because `COVERAGE` counts the
 * same thing, and two copies of this would be free to disagree about what the corpus holds.
 */
const overlayOf = (fixture: Fixture) => {
  const defects = fixture.defects ?? {};
  const boxed = fixture.overlay !== null && !('box' in defects);
  const legible = boxed && !('iv' in defects) ? fixture.overlay : null;

  return { boxed, legible, levels: defects.levels ?? (legible ? [legible.level] : []) };
};

/**
 * The notes a row claims `identify` answers: the ones it pins, or the `could also be …` one derived from its
 * alternatives where it pins none. A function for the reason `overlayOf` is one — the test naming which captures a
 * scan would read again counts the same thing, and two copies would be free to disagree about what the corpus holds.
 */
const notesOf = (fixture: Fixture) => {
  const alternatives = fixture.defects?.alternatives ?? [];
  const unseparated = fixture.defects?.unseparated ?? [];

  return (
    fixture.defects?.notes ?? [
      ...(alternatives.length > 0 ? [`could also be ${alternatives.join(', ')}`] : []),
      ...(unseparated.length > 0 ? [`nothing on the screen separates it from ${unseparated.join(', ')}`] : []),
    ]
  );
};

for (const fixture of FIXTURES) {
  const defects = fixture.defects ?? {};

  // What the Pokémon is, and what `identify` answers about it, which are the same string wherever no `defects.label`
  // says otherwise — `COVERAGE.answeredAsThemselves` is how many that is.
  const truth = fixture.form ? `${fixture.species} (${fixture.form})` : fixture.species;
  const answered = defects.label ?? truth;

  // The name the screen prints, which defaults to the species — so a row states a nickname once and both the reader's
  // expectation and `identify`'s derive from it.
  const name = fixture.name ?? fixture.species;

  const { boxed, legible, levels } = overlayOf(fixture);
  const alternatives = defects.alternatives ?? [];
  const unseparated = defects.unseparated ?? [];
  const notes = notesOf(fixture);

  // A `describe` rather than one test with eighteen subtests inside it, because Vitest collects a file's tests
  // synchronously and so cannot be handed a test registered after an `await`. Each attribute therefore reads the
  // memoised capture for itself, which costs nothing — the first of the eighteen pays for the OCR and the rest get the
  // settled promise — and buys a failure that names the reader.
  describe(`${fixture.file} reads as the ${truth} on the screen`, () => {
    test('size', async () =>
      expect((await readingOf(fixture.file)).detail.size).toBe(
        ('size' in defects ? defects.size : fixture.size) ?? null,
      ));
    test('gender', async () => expect((await readingOf(fixture.file)).detail.gender).toBe(fixture.gender));
    test('hp', async () => expect((await readingOf(fixture.file)).detail.hp).toBe(fixture.hp));
    test('name', async () => expect((await readingOf(fixture.file)).detail.name).toBe(defects.name ?? name));
    test('weight', async () => expect((await readingOf(fixture.file)).detail.weight).toBe(fixture.weight));

    test('height', async () =>
      expect((await readingOf(fixture.file)).detail.height).toBe(defects.height ?? fixture.height));

    test('types', async () =>
      expect((await readingOf(fixture.file)).detail.types).toStrictEqual(defects.types ?? fixture.types));

    test('favourite', async () =>
      expect((await readingOf(fixture.file)).detail.favourite).toBe(defects.favourite ?? fixture.favourite ?? false));

    test('tags', async () => {
      const { detail } = await readingOf(fixture.file);

      expect(detail.tags.map((chip) => closest(chip, TAGS, (tag) => tag, TAG_SLACK))).toStrictEqual(
        defects.tags ?? fixture.tags ?? [],
      );
    });

    // Whether a box was found is asserted apart from what was read out of it, because the two are different defects
    // and a reader fixed at either stage has to fail here. The corpus reaches one side only: no row has no overlay
    // drawn on it and none needs `defects.box`, so `boxed` holds for all 44 and the false case of this test is
    // unreachable — pinned as a hole where the counts are asserted. One row carries `defects.iv`, a box found whose
    // triple was misread, which is what keeps the test below from being the same assertion twice. `findOverlay`
    // answering null is covered apart from the rows, on the two Squirtle captures PGSharp drew nothing on.
    test('overlay found', async () => expect((await readingOf(fixture.file)).box !== null).toBe(boxed));

    test('overlay ivs', async () =>
      expect((await readingOf(fixture.file)).overlay?.iv ?? null).toStrictEqual(
        ('iv' in defects ? defects.iv : legible?.iv) ?? null,
      ));

    test('overlay form', async () =>
      expect((await readingOf(fixture.file)).overlay?.form ?? null).toBe(
        ('suffix' in defects ? defects.suffix : legible?.suffix) ?? null,
      ));

    // The end of the pipeline, asserted on every capture rather than on one, which is what catches `levelsOf` admitting
    // any HP at or above the one read: against a shortlist whose largest member is already the true level, as
    // `fixtures/unown.png`'s `[1, 6, 16]` is, that break cannot move an answer.
    test('identify form', async () => {
      const { identity } = await readingOf(fixture.file);

      expect(identity.form && label(identity.form)).toBe(answered);

      // The form itself, strictly, where the answer is the row's own: the label above reads `null` and `''` alike,
      // which is how the table came to spell an ordinary form both ways.
      if (!('label' in defects)) {
        expect(identity.form?.form).toBe(fixture.form);
      }
    });

    test('identify levels', async () => expect((await readingOf(fixture.file)).identity.levels).toStrictEqual(levels));

    test('identify alternatives', async () =>
      expect((await readingOf(fixture.file)).identity.alternatives.map(label)).toStrictEqual(alternatives));

    // Apart from the alternatives, because the two are what a second read can and cannot clear: a scan reads the screen
    // again for the first and reports the second, so a reader that moved a form between them would change what a pass
    // costs without changing an answer.
    test('identify unseparated', async () =>
      expect((await readingOf(fixture.file)).identity.unseparated.map(label)).toStrictEqual(unseparated));

    test('identify notes', async () => expect((await readingOf(fixture.file)).identity.notes).toStrictEqual(notes));

    // The cross-check the whole orientation of this table exists for, and the reason a settled level is derived rather
    // than stated: `cpOf` cannot answer without one, so a capture whose overlay goes unread and a capture whose HP two
    // half-levels both fit are both a null here, and neither needs a `defects` entry to say so.
    test('identify cp', async () =>
      expect((await readingOf(fixture.file)).identity.cp).toBe(
        defects.cp ?? (levels.length === 1 ? fixture.cp : null),
      ));

    test('identify nickname', async () =>
      expect((await readingOf(fixture.file)).identity.nickname).toBe(
        defects.nickname ?? (name === fixture.species ? null : name),
      ));
  });
}

/**
 * The three captures that are not detail screens, which is why they are not rows: there is no Pokémon on them to
 * state. They are the only ones committed as a screen, having no stitch to be recovered from.
 */
const NEGATIVE = ['no-pgsharp.png', 'overworld.png', 'pgsharp-no-overlay.png'];

/**
 * How many captures to have being read at once, ahead of the tests that assert them. Without this a capture's first
 * test paid for its whole reading before the next was opened, and the suite was 49 readings end to end.
 *
 * A handful rather than all of them: a single reading is already as wide as the machine in places — `findOverlay`
 * sweeps `availableParallelism()` bands at a time — so captures past the first few buy contention rather than
 * parallelism. On 22 cores this file took 137s at one capture at a time, 106s at four, 102s at eight and 120s with all
 * 49 in flight.
 *
 * It buys total time with per-test latency at a roughly linear rate, measured on four cores:
 *
 * | captures in flight   | costliest capture's test | sum of every test's time |
 * |----------------------|--------------------------|--------------------------|
 * | none, read on demand | 8.4s                     | —                        |
 * | 1                    | 13.0s                    | 150.5s                   |
 * | 2                    | 19.4s                    | 115.5s                   |
 * | 4                    | 30.3s                    | 111.1s                   |
 *
 * That latency is the clock whatever waits gets held to, which is why `vitest.config.mjs` gives the `corpus` project
 * its own `testTimeout`. Two in flight is within 4% of four on total time, but the margin on the worst wait makes the
 * saving worthless, so four is kept. Re-run this table if the setting is ever revisited.
 */
const READ_AHEAD = 4;

/** Every capture committed beside this file, which is the two tables and nothing else. */
const CORPUS = [...FIXTURES.map((f) => f.file), ...NEGATIVE];

/**
 * The corpus read through that ceiling, in declaration order so the tests, which run in that order too, wait on the
 * readings most nearly finished. A copy because the pool below drains it destructively.
 *
 * The pool changes nothing any test asserts: `readingOf` memoises the promise rather than the reading, so this is the
 * same cache the tests read, and a test reaching a capture the pool has not started simply starts it. That is the one
 * thing that exceeds `READ_AHEAD`, and by exactly one, Vitest running a file's tests one at a time.
 *
 * The `catch` is for the clock rather than the failure: a read started here and awaited only by some later test is a
 * rejection with no handler for as long as that takes, which Node exits over — losing the failure the suite was about
 * to report. `readingOf` forgets a rejected reading, so the test that asserts it reads the capture again.
 */
const queue = [...CORPUS];

/**
 * Set at teardown so that a pool worker between captures stops rather than taking another. A read cannot be aborted
 * once started, so this is what keeps the wait below to the ones already in flight.
 */
let abandoned = false;

/** One pool worker, taking the next capture until the corpus runs out or teardown tells it to stop. */
const drain = async () => {
  while (!abandoned) {
    const file = queue.shift();

    if (file === undefined) {
      return;
    }

    await readingOf(file).catch(() => {});
  }
};

const workers: Promise<void>[] = [];

/**
 * The pool, started from a hook rather than at import so that whatever starts it is also what stops it. Module
 * initialisation has no owner: `afterAll` bounds a file's tests, and Vitest runs no hooks at all for a file whose every
 * test its `-t` filter excluded — while still *evaluating* the module, so reads started at import had nothing that
 * would ever stop them. A run matching no test now starts no read.
 *
 * Starting here costs the read-ahead nothing. `beforeAll` runs before the first test, which is the first moment any of
 * this is wanted.
 */
/**
 * The Tesseract every read below goes through, which is the CLI unless `INVENTORY_OCR=wasm` asks for the page's — see
 * `test-engine.mts`. Installed at import rather than in the hook, since a test reaching a capture the pool has not
 * started reads it itself.
 */
const stopEngine = useTestEngine();

beforeAll(() => {
  for (let worker = 0; worker < READ_AHEAD; worker++) {
    workers.push(drain());
  }
});

/**
 * The pool bounded by the tests that own it, so that Vitest does not tear the worker down over reads still in flight
 * and leave their Tesseract children orphaned on the pipes they inherited.
 *
 * Waiting is all that is on offer, nothing here being able to abort a read Tesseract already has, and `abandoned` is
 * what holds the wait to the reads in flight rather than the corpus behind them. The cost is not one read: it is up to
 * `READ_AHEAD` of them, finishing alongside each other so the wait is the slowest rather than the sum, and the run has
 * also already paid for every capture the pool got through while the tests it kept were running. A full run notices
 * none of it, the whole-corpus tests at the end having waited on everything already; a `-t` run against one cheap test
 * pays several captures for nothing.
 *
 * That wait is longer than the 10s Vitest allows a hook by default, which this failed outright. What it gets instead is
 * the `corpus` project's `hookTimeout` in `vitest.config.mjs`, that project being this file alone.
 */
afterAll(async () => {
  abandoned = true;

  await Promise.all(workers);
  await stopEngine();
});

/**
 * What the tests that read the whole corpus in one body are given, where the `corpus` project's own `testTimeout`
 * covers everything else in this file — one capture rather than 47.
 *
 * They need it because a body that waits on all 47 captures waits on the whole corpus, which `READ_AHEAD` paces at
 * about 65s however the rest of the file is filtered: `-t 'which captures the CP is read off'` on its own has the pool
 * to warm it and still takes 64.8s, there being no earlier test to have paid for any of it. What the pool did take away
 * is the other reason this was here — that on a full run the `describe` blocks above happened to have filled the memo
 * first, which passed for warm and was a coupling rather than a guarantee.
 */
const WHOLE_CORPUS_TIMEOUT = 600_000;

/**
 * Every PNG committed beside this file. One list rather than several, so a change to what counts as a capture cannot
 * leave the tests below covering different sets and each reporting that the half it can see is accounted for.
 */
const COMMITTED = readdirSync(new URL('fixtures', import.meta.url))
  .filter((file) => file.endsWith('.png'))
  .sort();

/**
 * The corpus in its two halves, by what each file *is*: a screen as the phone drew it, or a stitch of a scroll holding
 * one in its first rows. Partitioned here once so the tests below take whichever they are about rather than each
 * filtering for itself and drifting over which is which.
 *
 * Only the three negatives are screens. Every detail capture is committed as a stitch alone, the screen being
 * recoverable from it — `screenIn` says how — so there is one file per capture, under one name: a row names its own
 * file, and `read` above is handed that name whichever artifact answers to it, `screenIn` cropping a stitch to the
 * `Viewport` it carries and handing a screen, which carries none, straight back.
 *
 * Sorted by `NEGATIVE` rather than by anything the files themselves carry, which is what keeps the three claims below
 * falsifiable. A stitch both states a `Viewport` and is taller than the phone drew, so either would serve to partition
 * the directory — but then the tests asserting those two things would be asserting the property they had been sorted
 * by, and could only pass. The declaration says what a capture is, the directory says what is committed, and the test
 * below is what holds the two to each other.
 *
 * `STITCHES` takes the remainder rather than the rows, so a capture committed and declared nowhere is held to the
 * stitch claims and fails them. Partitioning both halves off a declaration would drop it out of each, unexamined.
 */
const SCREENS = COMMITTED.filter((file) => NEGATIVE.includes(file));
const STITCHES = COMMITTED.filter((file) => !NEGATIVE.includes(file));

/**
 * That every committed capture is accounted for, which is the one thing about this corpus no row can say. A PNG added
 * to `fixtures/` and left out of `FIXTURES` costs nothing and reports nothing — the suite goes on passing at whatever
 * size it was, and the capture sits in the tree looking exactly like a capture that is pinned. So the directory is the
 * authority and the table is checked against it, in both directions: a row naming a file that is gone fails here too,
 * where otherwise it would fail as an unreadable file in the middle of an unrelated reader's own test.
 */
test('every committed capture is either a row or a negative case', () => {
  expect(COMMITTED).toStrictEqual(CORPUS.toSorted());
});

/**
 * How tall a capture may be against its own width before it is a stitch rather than a screen. Bounded on both sides and
 * thin on both, so this is measured rather than placed in the middle of the gap: the tallest aspect ratio a phone ships
 * in is 21:9, or 2.333, and the first reader answers wrong at 2.380, where `pikachu-santa-hat.png`'s star stops reading
 * as filled. So not the 2.5 that splits the difference up to a stitch's 2.97 — two of the five favourites already read
 * wrong below it.
 */
const SCREEN_RATIO = 2.35;

/**
 * That every capture is one screen as the phone drew it rather than a stitch of several. The star corner, the overlay
 * sweep, the tag band, the artwork and the CP sweep are each anchored on a fraction of the image's height, so a
 * capture three times taller moves every one off what it was measured against; `parseMoves` alone survives, being
 * anchored on the `GYMS & RAIDS` line.
 *
 * It is a test because prose was not enough: a stitch was committed over all 43 detail captures anyway, reporting as
 * 76 failures of which not one said the fixtures were what was wrong. The size is the cheapest thing on a capture to
 * check and the only one that separates the two artifacts.
 *
 * Over `SCREENS` rather than the whole directory, which claim a capture is held to being `NEGATIVE`'s to say and not
 * the name's — the name stopped telling the two artifacts apart when the screens went. The failure names the size, the
 * name being what already looked right.
 */
test('every committed screen is one screen rather than a stitch', () => {
  const stitched = SCREENS.flatMap((file) => {
    // Off the PNG header, where the spec puts width and height as the 32-bit fields at 16 and 20. `decodePng` would
    // inflate each capture to 9 MB of pixels to compare two numbers — 3.4s and 606 MB across the 49.
    const bytes = readFileSync(new URL(`fixtures/${file}`, import.meta.url));
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);

    return height > width * SCREEN_RATIO ? [`${file} is ${width}x${height}`] : [];
  });

  expect(stitched).toStrictEqual([]);
});

/**
 * And the other way round: that every stitch really is taller than the phone drew, so a capture with a row to answer
 * for cannot quietly be a single frame. The ceiling is the same one, which is what makes the pair exhaustive — every
 * capture is on one side of `SCREEN_RATIO` or the other, and which side it is allowed to be on is whether `NEGATIVE`
 * names it.
 *
 * All of them are, which is worth stating because one was not. `eevee-background.png`'s scroll was refused twice over —
 * `offsetBetween` scores every shift and takes none where the best does not stand out, and a photographic backdrop
 * drifting between frames stands out nowhere — so its companion came back a copy of the single frame it had. The
 * capture taken once `scrollFrames` was handed the screen already in hand assembled three frames, so the backdrop was
 * never the whole of it. Asserted empty rather than deleted, a capture joining the list being the refusal coming back.
 */
test('every stitch is taller than the phone drew', () => {
  const copies = STITCHES.flatMap((file) => {
    const bytes = readFileSync(new URL(`fixtures/${file}`, import.meta.url));
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);

    return height > width * SCREEN_RATIO ? [] : [`${file} is ${width}x${height}`];
  });

  expect(copies, 'a stitch assembled nothing, so its scroll was refused').toStrictEqual([]);
});

/**
 * The `tEXt` chunks a capture carries, keyword against value, read off the chunk headers rather than through
 * `decodePng` — which would inflate a stitch to 25 MB of pixels to answer a question the bytes answer at a fixed
 * offset, the same economy the size check above makes. Keyword, a zero byte, then the value; a chunk with no separator
 * is malformed and is keyed as the empty string rather than skipped, so a damaged one cannot read here as a file
 * carrying nothing.
 */
const textIn = (file: string): Record<string, string> => {
  const bytes = readFileSync(new URL(`fixtures/${file}`, import.meta.url));
  const found: Record<string, string> = Object.create(null) as Record<string, string>;

  for (let at = 8; at + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);

    if (type === 'tEXt') {
      const body = bytes.subarray(at + 8, at + 8 + length);
      const split = body.indexOf(0);

      found[split > 0 ? body.toString('latin1', 0, split) : ''] =
        split > 0 ? body.toString('latin1', split + 1) : body.toString('latin1');
    }

    if (type === 'IEND') {
      break;
    }

    at += 12 + length;
  }

  return found;
};

/**
 * That every stitch carries a `Viewport` its own height could not state, which is what `screenIn` crops to and so what
 * every reader below is handed.
 *
 * **What this cannot check is that a stitch's first rows really are the screen the phone drew.** That was asserted
 * against the screen committed beside each stitch, pixel for pixel, and dropping the screens took it: a stitch
 * assembled at the wrong offset would pass everything here. The rows still catch most of it — a capture of the wrong
 * Pokémon fails a dozen fields — but not a stitch whose readable regions are right and whose tail is from the wrong
 * frame, since nothing reads there.
 *
 * Nor can a capture run check it any more: `snap` writes one file now, the stitch going over the screen under the same
 * name, so the comparison has no second side. Both images are in hand there, so it could be made before the write —
 * which would be a change to `snap` and not to this file.
 *
 * A screen carrying a `Viewport` is a writer saying something twice, its own `IHDR` height already being that number.
 */
test('every stitch carries a `Viewport` smaller than itself, and no screen carries one', () => {
  const faults = STITCHES.flatMap((file) => {
    const bytes = readFileSync(new URL(`fixtures/${file}`, import.meta.url));
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    const [stated, tall] = (textIn(file).Viewport ?? '').split('x').map(Number);

    if (stated !== width || Number.isNaN(tall as number)) {
      return [`${file} is ${width}x${height} and says Viewport ${JSON.stringify(textIn(file).Viewport)}`];
    }

    // Smaller, not merely different: a `Viewport` at or above the stitch's own height would crop to the whole file,
    // which is the one value that would leave every reader handed a stitch and nothing saying so.
    return (tall as number) < height ? [] : [`${file} is ${width}x${height} and says Viewport ${stated}x${tall}`];
  });

  expect(faults, 'a stitch states a `Viewport` that is not a screen inside it').toStrictEqual([]);

  expect(
    SCREENS.filter((file) => 'Viewport' in textIn(file)),
    'a screen carries a `Viewport`, which its own height already states',
  ).toStrictEqual([]);
});

/**
 * The shape of the corpus, in one place that fails when any of it stops being true — so a claim about it is a figure a
 * test reads rather than prose nothing does. Counted off `FIXTURES` and `overlayOf`, so this is free and cannot
 * disagree with the loop.
 */
const COVERAGE = {
  rows: 44,
  negatives: 3,
  answeredAsThemselves: 43,
  oneLevel: 44,
  crossCheckAgrees: 44,
  crossCheckDisagrees: 0,
  severalLevels: 0,
  noLevel: 0,
  noDefects: 36,
  unseparated: 8,
  noOverlayDrawn: 0,
  boxNotFound: 0,
  overlayNotRead: 0,
};

test('the corpus is the shape `COVERAGE` says it is', () => {
  const settled = FIXTURES.filter((f) => overlayOf(f).levels.length === 1);

  expect(
    {
      rows: FIXTURES.length,
      negatives: NEGATIVE.length,
      answeredAsThemselves: FIXTURES.filter((f) => f.defects?.label === undefined).length,
      oneLevel: settled.length,
      crossCheckAgrees: settled.filter((f) => f.defects?.cp === undefined).length,
      crossCheckDisagrees: settled.filter((f) => f.defects?.cp !== undefined).length,
      severalLevels: FIXTURES.filter((f) => overlayOf(f).levels.length > 1).length,
      noLevel: FIXTURES.filter((f) => overlayOf(f).levels.length === 0).length,
      noDefects: FIXTURES.filter((f) => f.defects === undefined).length,
      unseparated: FIXTURES.filter((f) => f.defects?.unseparated !== undefined).length,
      noOverlayDrawn: FIXTURES.filter((f) => f.overlay === null).length,
      boxNotFound: FIXTURES.filter((f) => f.defects && 'box' in f.defects).length,
      overlayNotRead: FIXTURES.filter((f) => f.defects && 'iv' in f.defects).length,
    },
    'the shape of the corpus has changed; update `COVERAGE` to match',
  ).toStrictEqual(COVERAGE);

  // The three ways a row can account for its level have to partition the corpus, or one of the counts above is reaching
  // rows another has already claimed and the three could all be right while summing to the wrong thing.
  expect(COVERAGE.oneLevel + COVERAGE.severalLevels + COVERAGE.noLevel).toBe(COVERAGE.rows);
  expect(COVERAGE.crossCheckAgrees + COVERAGE.crossCheckDisagrees).toBe(COVERAGE.oneLevel);
});

/**
 * Which of the pinned defects a scan can find for itself, which is what `scripts/inventory.mts` reads a screen again
 * on: a note is the readers contradicting each other, and a scanner with the phone still on the Pokémon takes another
 * screenshot rather than writing the contradiction into a row. The rows are what make that measurable — nothing on a
 * phone says what the Pokémon was.
 *
 * None of the 44 any more, where eight raise a note at all — so the trigger costs the corpus no extra read, and would
 * cost one only on a reading that could improve. That it costs one *there* is held by the `identify notes` test above
 * rather than here: that one asserts what `identify` answers on all 44 against `notesOf`, which is empty for a row with
 * no `defects`, so a capture that starts raising a note without earning one fails there.
 *
 * The eight it does not reach are the ones `unseparated` names, and they are a limit rather than a gap: a form sharing
 * every number the screen prints is the artwork's to separate, and it has either declined or had no icon for every
 * member. `basculin-blue.png` is the severest — the overlay is drawn over the fish's head, which is the only part of it
 * that differs between the three stripes, so the screen never stated which. A second read of the same screen cannot
 * invent a field the game does not print; only a second reader of the same thing could.
 */
test(
  'no defect left is one a scan could clear by reading the screen again',
  async () => {
    // Here at all because a reader fixed takes its row's defect with it, and the per-fixture tests and `COVERAGE` are
    // updated as part of that fix: this is what then reports the retry trigger firing on fewer captures.
    expect(
      FIXTURES.filter((f) => notesOf(f).length > 0).length,
      'how many captures `identify` raises a note on has changed',
    ).toBe(8);

    // Off `clearable` and the readings themselves rather than the rows, that function being the one the scan's own
    // fault count calls: a copy of its arithmetic here could pass while the trigger it stands for had changed.
    const chased: string[] = [];
    const reported: string[] = [];

    for (const fixture of FIXTURES) {
      const { identity } = await readingOf(fixture.file);

      if (clearable(identity) > 0) {
        chased.push(fixture.file);
      } else if (identity.notes.length > 0) {
        reported.push(fixture.file);
      }
    }

    expect(chased, 'which captures a scan reads a second time has changed').toStrictEqual([]);

    // And the other side of the split, which is what says the eight captures `unseparated` reaches cost a scan nothing:
    // their note is reported and never chased.
    expect(reported, 'a note no second read could clear is one a scan must report rather than chase').toStrictEqual([
      'basculin-blue.png',
      'charizard-gigantamax.png',
      'ho-oh.png',
      'pikachu.png',
      'pikachu-ash-hat.png',
      'pikachu-santa-hat.png',
      'pikachu-willows-assistant.png',
      'pikachu-witch-hat.png',
    ]);
  },
  WHOLE_CORPUS_TIMEOUT,
);

/**
 * The vended game master's own shape, each figure what `pnpm vend:game-master` printed as it wrote the file. This is
 * the only thing standing between a fixture truncated or swapped and a reader that has merely stopped agreeing with a
 * capture, the cast on `DATA` being unchecked.
 *
 * Expect it to move when upstream releases a species, and read that as the vend being reviewed rather than the suite
 * breaking: a form arriving that shares a dex, its types and its stamina with a capture really does change which forms
 * an HP can tell apart.
 */
test('the vended game master is the shape the readers are asserted against', () => {
  expect(
    {
      forms: DATA.forms.length,
      species: DATA.species.length,
      moves: DATA.moves.length,
      types: DATA.types.length,
      cpm: DATA.cpm.length,
    },
    'the vended game master has changed shape; re-vend and update these figures',
  ).toStrictEqual({ forms: 1473, species: 1024, moves: 328, types: 18, cpm: 101 });
});

/**
 * Which captures the CP is read off, and what it is read as — the one thing the rows cannot say, since each of them
 * states the number the game printed and a `cpOn` answering null for everything would pass every row. It is a minority
 * of them because the CP is white text over the artwork and the hardest thing on the screen to make out.
 *
 * Asserted as the whole map rather than as a count, so a reader losing one capture and gaining another cannot come out
 * even, and the misreads are then **derived** from it rather than transcribed a second time: a row already states what
 * the screen shows, so the disagreement is a filter and not a list to keep in step. A misread here is a digit or two
 * lost or gained off one end of the number, and none is left: the last was `unown-question.png` reading `4864` for
 * 486, a band too narrow to hold its last digit whole, which `CP_ACROSS` in `detail.mts` now holds.
 */
test(
  'which captures the CP is read off, and that it reads none of them wrongly',
  async () => {
    const states = new Map<string, number>();

    for (const fixture of FIXTURES) {
      const { detail } = await readingOf(fixture.file);

      if (detail.cp !== null) {
        states.set(fixture.file, detail.cp);
      }
    }

    expect(Object.fromEntries(states), 'which captures state a CP, or what they state, has changed').toStrictEqual({
      'articuno-galar.png': 1966,
      'basculin-blue.png': 253,
      'burmy-plant.png': 206,
      'burmy-sandy.png': 196,
      'charizard-gigantamax.png': 1605,
      'cherrim-overcast.png': 1025,
      'deoxys-attack.png': 1441,
      'deoxys-speed.png': 2009,
      'dialga-altered.png': 2848,
      'dialga-origin.png': 2845,
      'growlithe-nickname.png': 738,
      'meowth-alola.png': 431,
      'pikachu-ash-hat.png': 489,
      'pikachu-willows-assistant.png': 385,
      'pikachu-witch-hat.png': 625,
      'pikachu.png': 69,
      'pumpkaboo-large.png': 14,
      'rotom-wash.png': 813,
      'smoliv.png': 340,
      'spoink.png': 998,
      'unown-b.png': 487,
      'unown-exclamation.png': 517,
      'unown-question.png': 486,
      'xurkitree.png': 2197,
    });

    // And which of them it reads *wrongly*, derived from the map rather than listed again, a row already stating what
    // the screen shows. None is left, and one coming back is a reader that has started gaining or losing a digit.
    expect(
      FIXTURES.filter((f) => states.has(f.file) && states.get(f.file) !== f.cp).map((f) => f.file),
      'which captures misread their CP has changed',
    ).toStrictEqual([]);
  },
  WHOLE_CORPUS_TIMEOUT,
);

/**
 * The other half of that: which captures the CP region is *swept* for, and every number a sweep offers. The two maps
 * partition the corpus, `cps` being read on exactly the captures `cp` is null on, and only this one says what the
 * generosity costs — one capture pinned a `cps` before this, so a band that started offering five numbers where it
 * offered one changed nothing a test could see.
 *
 * The whole map, empties included, the four that read nothing being as much a measurement as the fifteen that read
 * right. The strays are **derived** from it for the reason the misreads above are, and what one costs is nothing only
 * while the arithmetic cannot reproduce it — `identify` says where that floor is, and this is what would move it.
 */
test(
  'which captures the CP region is swept for, and what each sweep offers',
  async () => {
    const swept = new Map<string, readonly number[]>();

    for (const fixture of FIXTURES) {
      const { detail } = await readingOf(fixture.file);

      if (detail.cp === null) {
        swept.set(fixture.file, detail.cps);
      }
    }

    expect(Object.fromEntries(swept), 'which captures are swept, or what a sweep offers, has changed').toStrictEqual({
      'applin.png': [286],
      'articuno-kanto.png': [1705],
      'burmy-trash.png': [],
      'castform-normal.png': [],
      'castform-rainy.png': [832],
      'castform-snowy.png': [],
      'castform-sunny.png': [979],
      'chansey-dynamax.png': [693],
      'cherrim-sunny.png': [1658],
      'deoxys-defense.png': [1569],
      'deoxys-normal.png': [1772, 172],
      'eevee-background.png': [451],
      'ho-oh.png': [2738, 238],
      'meloetta-aria.png': [169],
      'meowth-galar.png': [571],
      'meowth-kanto.png': [423],
      'pikachu-santa-hat.png': [],
      'snorlax-purified.png': [2304],
      'spinda-04.png': [511],
      'unown-m.png': [839],
    });

    // And the figures `cpsIn`'s docblock quotes, derived from the map rather than transcribed under it, so a sweep that
    // changed what it offered cannot leave that prose standing. `stray` is every number offered that the capture's own
    // row does not state.
    const offered = [...swept].map(([file, cps]) => ({ cps, cp: FIXTURES.find((f) => f.file === file)?.cp }));

    expect(
      {
        swept: offered.length,
        carryTheirOwn: offered.filter(({ cps, cp }) => cp !== undefined && cps.includes(cp)).length,
        silent: offered.filter(({ cps }) => cps.length === 0).length,
        stray: [...swept]
          .map(([file, cps]) => cps.filter((n) => n !== FIXTURES.find((f) => f.file === file)?.cp))
          .flat()
          .toSorted((a, b) => a - b),
      },
      "`cpsIn`'s docblock quotes these figures; update both or neither",
    ).toStrictEqual({ swept: 20, carryTheirOwn: 15, silent: 4, stray: [169, 172, 238] });
  },
  WHOLE_CORPUS_TIMEOUT,
);

/**
 * What a sweep number would have to be worth to be *taken*, which is the margin `identify`'s comment on `printed`
 * quotes and the one figure in that paragraph nothing else holds: the map above pins what the sweep offers, not what
 * `identify` does with it, and the figure has been wrong twice for being derived rather than driven.
 *
 * So it is driven. One number is forged into `cps` and the answer compared against the one the capture gives as it
 * stands, outwards from the CP on its screen until something is answered **differently and silently** — a form or a
 * level that is not the right one, with no alternatives and no note another read could clear. Silence is the hazard
 * rather than wrongness: `detail.cp` is null on exactly these captures, so the disagreement note cannot fire, and a
 * number the arithmetic merely agreed with is reported by nothing at all.
 *
 * Silence is `clearable` and not the note count, because `ho-oh.png` and `pikachu-santa-hat.png` raise the unseparated
 * note on every reading and it says nothing about any CP. Counted, it blocked all 380 forged readings of each of those
 * two and the loop measured nothing where it reports no floor; uncounted, all 380 of each reach the comparison.
 *
 * Nothing nearer than an arithmetic reach of `CP_SWEEP`'s own band is interesting, so the search stops at 190, which
 * is where the last of the three sits. Measuring it is what makes the comment's claim falsifiable rather than a
 * reassurance, and what would catch a later change widening the generosity.
 */
test(
  'the nearest band reading answered with a wrong form and no note is 73 CP away',
  async () => {
    const REACH = 190;
    const shape = (identity: { form: Form | null; levels: readonly number[] }) =>
      `${identity.form ? label(identity.form) : 'none'} at ${identity.levels.join(' or ')}`;
    const floors = new Map<string, string>();

    for (const fixture of FIXTURES) {
      const { detail, overlay, artwork } = await readingOf(fixture.file);

      if (detail.cp !== null) {
        // The anchored read is what those captures answer on; only a swept one takes a candidate on trust.
        continue;
      }

      const right = shape(identify(DATA, detail, overlay, artwork));

      for (let away = 1; away <= REACH && !floors.has(fixture.file); away++) {
        for (const offset of [-away, away]) {
          const taken = identify(DATA, { ...detail, cps: [fixture.cp + offset] }, overlay, artwork);

          if (taken.alternatives.length === 0 && clearable(taken) === 0 && shape(taken) !== right) {
            floors.set(fixture.file, `${away} away, answered as ${shape(taken)}`);
            break;
          }
        }
      }
    }

    expect(
      Object.fromEntries(floors),
      "`identify`'s comment on `printed` quotes this floor; update both or neither",
    ).toStrictEqual({
      'castform-rainy.png': '73 away, answered as Quaxwell at 18',
      'deoxys-normal.png': '161 away, answered as Deoxys (Speed) at 20',
      'deoxys-defense.png': '190 away, answered as Deoxys (Attack) at 25',
    });
  },
  WHOLE_CORPUS_TIMEOUT,
);

/**
 * What the bracketed form on `fixtures/spinda-04.png` is worth, which is more than a cross-check: Spinda's 20 forms are
 * identical in every field the screen shows, so the bracketed `(04)` PGSharp draws is the **only** thing on the screen
 * that can say which of the 20 it is. With the overlay unread the answer is `00` and the nineteen it cannot be told
 * from, which is the largest unseparated set the corpus reaches.
 *
 * Both halves of the `unseparated` partition are asserted here rather than only the one, because the suffix is what
 * empties it: a reader that stopped narrowing on the bracket would answer the same twenty either way, and a fold that
 * went back to collapsing them would answer `00` alone with nothing saying the other nineteen fit.
 */
test('the overlay fixtures/spinda-04.png does not read would have named one form of twenty', async () => {
  const fixture = FIXTURES.find((f) => f.file === 'spinda-04.png');
  assert.ok(fixture?.overlay, 'the capture carrying a bracketed Spinda form has left the corpus');

  const { overlay } = fixture;
  assert.ok(overlay.suffix, 'that capture has lost the bracketed form this is the measurement of');

  const { detail } = await readingOf(fixture.file);
  const stated = { levels: [overlay.level], iv: overlay.iv };
  const blind = identify(DATA, detail, { ...stated, form: null });
  const named = identify(DATA, detail, { ...stated, form: overlay.suffix });

  expect(blind.form && label(blind.form)).toBe('Spinda (00)');
  expect(blind.alternatives, 'forms with these numbers are unseparated rather than alternatives').toStrictEqual([]);
  expect(blind.unseparated, 'the fold is collapsing the 20 again, so nothing says the other nineteen fit').toHaveLength(
    19,
  );

  expect(named.form && label(named.form)).toBe(`Spinda (${overlay.suffix})`);
  expect(named.cp, 'the CP the bracket buys no longer agrees with the screen').toBe(fixture.cp);
  expect(named.unseparated, 'the bracketed form left something it could not separate').toStrictEqual([]);
  expect(named.notes, 'the readers disagree with each other').toStrictEqual([]);
});

/**
 * The two properties of the stated shortlist that make the pipeline's level handling able to fail at all. Asserted off
 * the captures rather than written into the table, a shortlist being a reading rather than a fact about a Pokémon.
 *
 * Some capture must offer a level **above** its true one, which is what catches an HP test admitting any HP at or above
 * the one read — against a shortlist whose largest member is already the answer such a break cannot move anything. And
 * a shortlist **not** containing its true level is what says the HP is the arbiter rather than a tie-breaker, which no
 * capture offers any more: the last was `charizard-gigantamax.png`'s `[9, 5, 8]` for 20, read off a band holding only
 * the top of its `L20`. So every shortlist containing its own level is asserted here as the regression it would be, and
 * the miss is forged in the test of a misread level below, without which a `levelsOf` that merely filtered the stated
 * list would pass.
 */
test(
  'the shortlists the overlay states overshoot a true level and never miss one',
  async () => {
    const stated = new Map<string, readonly number[]>();

    for (const fixture of FIXTURES) {
      const { overlay } = await readingOf(fixture.file);
      stated.set(fixture.file, overlay?.levels ?? []);
    }

    const offered = FIXTURES.filter((f) => f.overlay !== null && stated.get(f.file)?.length);
    expect(offered.length, 'how many overlays are read has changed, so these two properties say less').toBe(44);
    assert.ok(
      offered.some((f) => stated.get(f.file)?.some((level) => level > (f.overlay?.level ?? 0))),
      'no shortlist offers a level above the true one, so nothing can catch an HP test that is not exact',
    );
    expect(
      offered.filter((f) => !stated.get(f.file)?.includes(f.overlay?.level ?? 0)).map((f) => f.file),
      'a shortlist has stopped offering its own level, so the overlay is being read off a band missing some of it',
    ).toStrictEqual([]);
  },
  WHOLE_CORPUS_TIMEOUT,
);

/**
 * What the bracketed form buys, measured by taking it away. Unown's 28 forms repeat one stat line and one type between
 * them, so nothing but PGSharp's suffix can say which letter a capture is: without it the answer is a letter that is
 * not this one, and the other 27 beside it — which is wrong and says so, where it used to be wrong silently.
 *
 * The letter is asserted as *not* `B` rather than as whichever the fold leaves standing, that being a tie between 28
 * names of one character broken by the game master's own order. What matters is that it is not the one the suffix would
 * have given, and that the 27 are reported rather than dropped.
 */
test('without the form PGSharp appends, Unown is a letter and the 27 it is not', async () => {
  const { detail, overlay } = await readingOf('unown-b.png');
  assert.ok(overlay, 'the fixture has lost its overlay');

  const identity = identify(DATA, detail, { ...overlay, form: null });
  const named = identify(DATA, detail, overlay);

  expect(identity.form?.species).toBe('Unown');
  expect(identity.form?.form).not.toBe('B');
  expect(identity.alternatives, 'forms with these numbers are unseparated rather than alternatives').toStrictEqual([]);
  expect(identity.unseparated, 'the fold is collapsing the 28 again, so nothing says it was a choice').toHaveLength(27);
  expect(identity.levels, 'the numbers still settle the level; only the letter was ever in doubt').toStrictEqual([16]);

  // The other side of it, as the Spinda test states too: the suffix empties the set rather than narrowing it.
  expect(named.form && label(named.form)).toBe('Unown (B)');
  expect(named.unseparated, 'the bracketed letter left something it could not separate').toStrictEqual([]);
});

/**
 * A misread level must not switch the CP off. Deoxys' four forms share a stamina, so only the printed CP says which
 * `deoxys-attack.png` is; handed a shortlist of `1`, a level no Deoxys at this HP can be, `identify` has to check the
 * CP at every level the HP admits rather than at none.
 */
test('a level the overlay misreads leaves the CP to settle the form', async () => {
  const { detail, overlay, artwork } = await readingOf('deoxys-attack.png');
  assert.ok(overlay, 'the fixture has lost its overlay');

  const identity = identify(DATA, detail, { ...overlay, levels: [1] }, artwork);

  expect(identity.form && label(identity.form)).toBe('Deoxys (Attack)');
  expect(identity.levels, 'the HP no longer settles a level the shortlist does not hold').toStrictEqual([20]);
  expect(identity.notes).toStrictEqual(['the overlay reads as level 1, none of which this HP can be']);
});

/**
 * A CP read off the screen that the arithmetic cannot reproduce is reported rather than believed, and leaves the form
 * the numbers settled where it was. No capture reads one any more, so this forges the one the corpus last did:
 * `unown-question.png`'s band gained a digit off the back of a `6` it had cut in half and read `4864` for its 486.
 */
test('a CP the screen misreads is reported and changes nothing else', async () => {
  const { detail, overlay, artwork } = await readingOf('unown-question.png');
  assert.ok(overlay, 'the fixture has lost its overlay');

  const identity = identify(DATA, { ...detail, cp: 4864 }, overlay, artwork);

  expect(identity.form && label(identity.form)).toBe('Unown (Question Mark)');
  expect(identity.cp).toBe(486);
  expect(identity.notes).toStrictEqual(['the screen reads CP 4864, where this form at this level is 486']);
  expect(clearable(identity), 'a scan no longer reads a screen again over a CP it misread').toBe(1);
});

/**
 * The printed CP settles the level as well as the form. `cherrim-sunny.png`'s HP admits both 31 and 31.5, and the
 * overlay's `L31` is what settles it on the screen; without that, the `CP 1658` it prints is Cherrim at 31 and not at
 * 31.5, which is the same answer.
 */
test('without the level the overlay states, the CP still settles one', async () => {
  const { detail, overlay, artwork } = await readingOf('cherrim-sunny.png');
  assert.ok(overlay, 'the fixture has lost its overlay');

  const fixture = FIXTURES.find((f) => f.file === 'cherrim-sunny.png');
  assert.ok(fixture, 'the capture a printed CP settles a half-level on has left the corpus');

  // The row's CP rather than the read one, because a crop of this capture's stitch does not yield it: the label line
  // goes unfound where the page's tail differs, so `wholeCp` cannot anchor and the number arrives as a candidate. What
  // is under test is the arithmetic settling a level from the printed CP, and the row is what states that CP.
  const identity = identify(DATA, { ...detail, cp: fixture.cp }, { ...overlay, levels: [] }, artwork);

  expect(detail.cp, 'the capture reads its own CP again, so this can go back to the read one').toBe(null);
  expect(detail.cps, 'the candidate the label line would have anchored').toStrictEqual([1658]);
  expect(identity.levels).toStrictEqual([31]);
  expect(identity.cp).toBe(1658);
  expect(identity.notes, 'the readers disagree with each other').toStrictEqual([]);
});

/**
 * What the artwork may settle, measured with icons made up for the purpose since the corpus signs only Burmy, Cherrim
 * and Ho-Oh. A costume carries no icon and must not stop the forms that do from being compared — `pikachu.png` against
 * a clone given its own signature is the clone — but forms with different numbers are the numbers' to separate, so
 * Deoxys' four, with the printed CP taken away, are left as alternatives however their colours fall.
 */
test('the artwork chooses within one set of numbers, past the costumes and no further', async () => {
  const far = ARTWORK.get('Burmy (Trash)');
  assert.ok(far, 'the signature standing in for an unlike icon has left the table');

  const pikachu = await readingOf('pikachu.png');
  assert.ok(pikachu.artwork, 'the fixture has lost its artwork');

  const own = pikachu.artwork.signature;
  const clones = new Map(
    DATA.forms
      .filter((f) => f.species === 'Pikachu' && !f.costume)
      .map((f): [Form, Signature] => [f, f.form === 'Copy 2019' ? own : far]),
  );
  const clone = identify(DATA, pikachu.detail, pikachu.overlay, { signature: own, icons: clones });

  expect(clone.form && label(clone.form)).toBe('Pikachu (Copy 2019)');

  const deoxys = await readingOf('deoxys-attack.png');
  assert.ok(deoxys.artwork, 'the fixture has lost its artwork');

  const signature = deoxys.artwork.signature;
  const forms = new Map(
    DATA.forms
      .filter((f) => f.species === 'Deoxys')
      .map((f): [Form, Signature] => [f, f.form === 'Defense' ? signature : far]),
  );
  const blind = identify(DATA, { ...deoxys.detail, cp: null, cps: [] }, deoxys.overlay, { signature, icons: forms });

  expect(blind.alternatives, 'the artwork chose between forms the numbers separate').toHaveLength(3);
});

/**
 * A name that is another species' is still a nickname once the numbers have found the real one, and what is reported
 * afterwards is about the species searched rather than the one the name ruled in. `growlithe-nickname.png` renamed
 * `Eevee` matches Eevee, whose forms fit none of Fire/Rock at this HP, so every species is searched and Hisuian
 * Growlithe found; a bracketed form naming nothing is then no form of whatever fits, not of Eevee.
 */
test('a name that is another species is a nickname once the numbers say otherwise', async () => {
  const { detail, overlay, artwork } = await readingOf('growlithe-nickname.png');
  assert.ok(overlay, 'the fixture has lost its overlay');

  const identity = identify(DATA, { ...detail, name: 'Eevee' }, { ...overlay, form: 'Zz' }, artwork);

  expect(identity.form && label(identity.form)).toBe('Growlithe (Hisuian)');
  expect(identity.nickname).toBe('Eevee');
  expect(identity.notes).toStrictEqual([
    'the numbers do not fit any form of Eevee; searched every species',
    'the overlay says form "Zz", which is no form of any species that fits',
  ]);
});

/**
 * And a nickname that hides the species with no types read has nothing to be searched by, so the note says so rather
 * than that the numbers fit nothing — they were never asked.
 */
test('a nickname with no types read is reported as unsearched, not as unfitted', async () => {
  const { detail, overlay, artwork } = await readingOf('growlithe-nickname.png');

  const identity = identify(DATA, { ...detail, types: [] }, overlay, artwork);

  expect(identity.form).toBe(null);
  expect(identity.nickname).toBe('Nickname');
  expect(identity.notes).toStrictEqual([
    'a nickname hides the species, and only the IVs, the HP and the types together can say what it is',
  ]);
});

/**
 * That `alternatives` names one form per set of numbers rather than every form that has them, which is the half of the
 * split `unseparated` does not cover: the answer's own group is named in full, and every other group is worth the one
 * name the fold always gave it. This capture's real numbers narrow to one species and so say nothing about that —
 * Psychic at 55 HP with 10/10/10 and no CP is the search that reaches Unown, whose 28 forms share one stat line, and
 * naming all 28 made a 606-character `could also be …` out of a 281-character one.
 *
 * Deoxys is the other half of the claim, and the reason the fold is per numbers and not per species: its four forms
 * share a dex and both types and differ in attack and defense, so a CP this reading has not got would separate them and
 * all four belong in the list. Asserted together, since a fold that was wrong either way passes one of the two.
 */
test('a search across every species names one form per set of numbers', async () => {
  const { detail, overlay } = await readingOf('growlithe-nickname.png');
  assert.ok(overlay, 'the fixture has lost its overlay');

  // Without Growlithe's 0.91m, which no Unown's middle band holds: the forged reading is of nothing in particular, and a
  // height would narrow the search to whatever species is that tall.
  const searched = identify(
    DATA,
    { ...detail, types: ['Psychic'], hp: 55, cp: null, cps: [], height: null },
    { ...overlay, iv: { attack: 10, defense: 10, stamina: 10 }, levels: [10] },
  );

  const named = (species: string) => searched.alternatives.filter((f) => f.species === species).map(label);

  expect(named('Unown'), 'one set of numbers is being named once per form that has it').toStrictEqual(['Unown (A)']);

  expect(named('Deoxys'), 'forms a CP could still separate are being folded into one').toStrictEqual([
    'Deoxys',
    'Deoxys (Speed)',
    'Deoxys (Attack)',
    'Deoxys (Defense)',
  ]);
});

/**
 * That some capture still carries a line a loose measurement would take. This is the half of a regression fixture that
 * gets left out: a row asserts what the readers answer, and would answer exactly the same on a capture whose status bar
 * held nothing to trip over — so the trap has to be asserted present rather than assumed. A capture is a file and
 * cannot change, but which lines Tesseract finds in it can, so what this pins is that the decoy is still being read.
 *
 * Swept over the whole corpus and pinned as the set, rather than read off the one capture that used to carry it. That
 * is the lesson of the re-snap: `xurkitree.png` was the one, its row saying so, and the capture that replaced it reads
 * nothing a measurement pattern takes — where `castform-snowy.png`'s status bar now reads `6372 026M,`. A test naming
 * a single file would have gone red on a corpus that had not lost the trap at all, and the obvious repair would have
 * been to point it at the next file and learn nothing.
 */
test(
  'some capture carries a line a loose measurement would take',
  async () => {
    const decoys: string[] = [];

    for (const file of CORPUS.toSorted()) {
      const { image, lines } = await readingOf(file);
      const height = lines.find((line) => /\d+[.,]\d+\s*m\b/i.test(line.text));
      const decoy = lines.find(
        (line) => /\d+\s*m\b/i.test(line.text) && line !== height && line.top < image.height * 0.1,
      );

      if (decoy) {
        decoys.push(file);
      }
    }

    expect(decoys, 'which captures read a loose measurement in the status bar has changed').toStrictEqual([
      'ho-oh.png',
    ]);
  },
  WHOLE_CORPUS_TIMEOUT,
);

/**
 * What `sizeSettings` means, measured where `fitsHeight` takes it on trust: every row's height is in the band its
 * badge names, or the middle one where it wears none, and the badged rows are in no band but their own. The second
 * half is what makes the first worth stating — 39 heights in a middle band as wide as Pikachu's 0.3m to 0.5m would fit
 * plenty of wrong readings of the six numbers, where five badged rows each alone in a narrow band fit few.
 *
 * `smoliv.png` is the exception the rounding makes: 0.15m is where Smoliv's XXS band ends and its XS band begins.
 */
test("every row's height is in the band its size badge names", () => {
  const SIZES = ['XXS', 'XS', null, 'XL', 'XXL'] as const;
  const misfits: string[] = [];
  const straddling: string[] = [];

  for (const fixture of FIXTURES) {
    const truth = fixture.form ? `${fixture.species} (${fixture.form})` : fixture.species;
    const form = DATA.forms.find((f) => label(f) === truth);
    assert.ok(form, `${truth} is not in the vended game master`);

    const fitting = SIZES.filter((size) => fitsHeight(form, fixture.height, size));

    if (!fitting.includes(fixture.size ?? null)) {
      misfits.push(`${fixture.file} is ${fixture.height}m, which ${truth} wears as ${fitting.join(' or ')}`);
    } else if (fixture.size && fitting.length > 1) {
      straddling.push(fixture.file);
    }
  }

  expect(misfits).toStrictEqual([]);
  expect(straddling, 'a badged height fits a band besides its own').toStrictEqual(['smoliv.png']);
});

/**
 * One stray coloured pixel in the size badge's band, which no capture happens to carry and any could: the band is
 * cropped from the screen round the height, artwork and all. Placed at the band's far corner from the pill, where a
 * crop to every coloured pixel would take in the white panel between them, and the white text isolated out of that
 * comes back as nothing.
 */
test('a stray coloured pixel beside the size pill does not cost the badge', async () => {
  const { image, lines } = await readingOf('smoliv.png');
  const height = lines.find((l) => HEIGHT.test(l.text));
  assert.ok(height, 'smoliv.png has no height line to find the badge by');

  const stray = { ...image, data: Uint8Array.from(image.data) };
  const at = (Math.round(height.top - height.height * 1.9) * image.width + Math.round(height.left - height.height)) * 4;
  stray.data.set([255, 0, 0], at);

  // Against the same capture unaltered rather than against `XXS` directly, which keeps the two claims apart: this one
  // is the stray pixel costing nothing, and stated as invariance it held across the misread this capture used to pin
  // and its fix. What the badge reads as is the line below, and the row's own `size` is what says that is right.
  expect(await sizeOf(stray, height)).toBe(await sizeOf(image, height));
  expect(await sizeOf(image, height), 'what `sizeOf` reads off this badge has changed').toBe('XXS');
});

/**
 * What `identify` answers for a screen with no Pokémon on it, which it declines without comment. One definition, and a
 * whole object, so a field added to `Identity` fails each screen asserted against it until it is accounted for.
 */
const DECLINED = { form: null, cp: null, alternatives: [], unseparated: [], levels: [], nickname: null, notes: [] };

/**
 * `fixtures/overworld.png` is the map, and this is what the detail readers answer on it: nothing, in every field. That
 * is the half a corpus of valid screens cannot state — every row asserts that a reader found the right thing and not
 * one of them asserts that a reader declines to find a thing that is not there, so a `hpOn` returning a constant would
 * pass every row it appears in. Written as one `toStrictEqual` over the whole `Detail` rather than ten assertions,
 * because the claim is about the object and a field added to `Detail` should fail here until it is accounted for.
 *
 * `identify` declines it too, and for a reason worth knowing rather than by luck: with no name read there is no
 * species, so the first filter — `f.species === species` over a `species` of `null` — admits nothing, and the fallback
 * that searches every species is gated on an IV, an HP and a type the map has none of. So `fits` is never reached over
 * the whole table at all, and the answer is a property of the pipeline rather than of whichever form the table folds
 * first — which the vended 1,473 forms say outright, where a cut-down table had to have the claim measured against a
 * real one before it could be believed at all.
 */
test('overworld.png is the map, and every reader declines it', async () => {
  const { detail, box, identity } = await readingOf('overworld.png');

  expect(box, 'a band of the map read as an overlay').toBe(null);
  expect({ ...detail }).toStrictEqual({
    cp: null,
    cps: [],
    favourite: false,
    gender: null,
    height: null,
    hp: null,
    name: null,
    size: null,
    tags: [],
    types: [],
    weight: null,
  });

  expect({ ...identity }, 'something was identified on the map').toStrictEqual(DECLINED);
});

/**
 * That the overlay sweep declines every screen that is not a detail screen with an overlay on it. A box found on one
 * would be worse than none: the sweep runs over the middle 70% of every screen a walk opens, and a false box is read as
 * a level and three IVs.
 */
test(
  'no screen without an overlay on it reads as having one',
  async () => {
    const found: string[] = [];

    for (const file of NEGATIVE) {
      if ((await readingOf(file)).box !== null) {
        found.push(file);
      }
    }

    expect(found, 'a band of a screen with no overlay on it read as one').toStrictEqual([]);
  },
  WHOLE_CORPUS_TIMEOUT,
);

/**
 * One Squirtle captured twice, once with PGSharp not running at all and once with its toolbar up and no overlay drawn.
 * That makes the pair a control on each other rather than two similar captures: the same Pokémon on the same screen,
 * so every field of the two readings must agree, and whatever does differ is attributable to the toolbar alone.
 *
 * Exactly one thing does, and it is the CP — `330` where PGSharp is absent and the `390` the screen prints where it is
 * there. Which is a reading rather than a fact about the Pokémon, so it is asserted per capture rather than as a row's
 * `cp`: nothing about the toolbar should move it, and it is worth knowing that it does.
 */
test('the two Squirtle captures agree on everything but the CP each reads', async () => {
  const bare = await readingOf('no-pgsharp.png');
  const toolbar = await readingOf('pgsharp-no-overlay.png');

  expect({ ...bare.detail, cp: null }).toStrictEqual({ ...toolbar.detail, cp: null });
  expect(bare.detail.cp, 'the capture PGSharp is absent from no longer misreads its CP').toBe(330);
  expect(toolbar.detail.cp, 'the capture with the toolbar up no longer reads the CP the screen prints').toBe(390);

  for (const { box, identity } of [bare, toolbar]) {
    expect(box, 'a band of a screen with no overlay on it read as one').toBe(null);
    expect(identity.form && label(identity.form)).toBe('Squirtle');
    expect(identity.levels, 'a level was settled on a screen that states none').toStrictEqual([]);
    expect(identity.cp).toBe(null);
    expect(identity.notes, 'an absent overlay is the ordinary case and not worth a note').toStrictEqual([]);
  }
});

/**
 * That **no** capture in this corpus names a dex number, which is the half of `dexOn` a corpus of detail screens can
 * state and the half that matters. A reader that answered a dex off a detail screen would be worse than one that
 * answered nothing, since the walk calls it exactly when the name could not be trusted.
 *
 * The three Pokédex entry captures this was written against are gone, so the other half — that an entry *is* read —
 * lives in `pokedex.test.mts` over lines built there. `dexOn` takes lines and a game master and no image, so a capture
 * bought it nothing a line cannot state; what a capture could state, and this still does, is that Tesseract reading a
 * real screen never hands it something it mistakes for a title.
 *
 * What makes a capture decline is the cross-check rather than the screen being bare: a number is believed only where it
 * resolves to a species and the name printed beside it folds to that same species. A detail screen carries four-digit
 * numbers — a CP, a stardust count — and none of them has a species beside it.
 */
test(
  'no capture in the corpus names a dex number',
  async () => {
    const named: string[] = [];
    let asked = 0;

    for (const file of CORPUS) {
      const { lines } = await readingOf(file);
      asked++;

      if (dexOn(lines, DATA) !== null) {
        named.push(file);
      }
    }

    expect(named, 'a capture that is not a Pokédex entry answered a dex number').toStrictEqual([]);

    // The count, because an empty list of offenders is also what a loop that asked nothing produces — which is the
    // failure this whole test exists to rule out, one level up.
    expect(asked, 'the reader was not asked about every capture').toBe(CORPUS.length);
  },
  WHOLE_CORPUS_TIMEOUT,
);

/**
 * That a species read off the Pokédex does not cost the nickname, which is the half of `identify` the override could
 * most easily have broken: the dex decides the species, and the name is still what says whether there is a nickname,
 * which is what keeps `ho-oh.png` a Ho-Oh called `96%`.
 *
 * It is also the case where the fallback changes nothing, and that is worth asserting rather than assuming: the CP
 * narrowing already settles this capture, so the dex has to agree with an answer that was right without it.
 */
test('a species read off the Pokédex leaves the nickname alone', async () => {
  const { detail, overlay, artwork, identity: without } = await readingOf('ho-oh.png');
  const dex = DATA.forms.find((f) => f.species === 'Ho-Oh')?.dex ?? null;
  const identity = identify(DATA, detail, overlay, artwork, dex);

  expect(identity.form && label(identity.form)).toBe('Ho-Oh');

  // Against what the same capture answers *without* the override rather than against `96%` directly, which is the claim
  // worth making: the override leaves the nickname alone, whatever the name pass made of it. Stated as invariance it
  // survived the name pass starting to read this screen correctly — it used to answer `LUCKY POKEMON`, the green line
  // under the nickname taken for the name, and a `96%` written out here would have been a second thing to remember.
  expect(identity.nickname, 'the dex override swallowed the nickname the screen prints').toBe(without.nickname);
  expect(without.nickname, 'what `ho-oh.png` reads as its nickname has changed').toBe('96%');

  // Stated as invariance for the same reason the nickname is: the Pokédex and the numbers agree here, so the override
  // may not add a note of its own — and the one note this capture does raise is the artwork declining its two icons,
  // which the override has no part in.
  expect(identity.notes, 'the dex override reports something the capture did not').toStrictEqual(without.notes);
  expect(without.notes, 'what `ho-oh.png` raises a note about has changed').toStrictEqual([
    'nothing on the screen separates it from Ho-Oh (S)',
  ]);
});

/**
 * The distinct values a column of the table holds, as words. Written out rather than left to `Array#sort`, which
 * stringifies an `undefined` and so files it after every capital letter — `['XL', 'XS', 'XXL', 'XXS', undefined]`,
 * which is the right set in an order nobody would write down on purpose.
 */
const distinct = (rows: readonly Fixture[], of: (row: Fixture) => unknown): string[] =>
  [...new Set(rows.map((row) => String(of(row))))].sort();

/**
 * What the artwork match answers for the captures whose form shares its dex, types and all three base stats with
 * another, nothing `parseDetail` or the overlay reads being able to separate them. The whole map, so a reader that
 * gained one answer and lost another cannot come out even.
 *
 * Five answered and one declined, which is both halves rather than one: `MARGIN` mattering is something this would
 * notice, where on a corpus that answered every one the margin could have been 0 unremarked. The decline is `ho-oh.png`
 * and it is the icons' doing rather than the capture's, the two being 0.25 apart; its own nearest is **Ho-Oh (S)** by
 * 0.190, which is the wrong one. `identify` still answers `Ho-Oh` there, the fold keeping the shorter name — right by
 * the same luck that made it wrong on Cherrim's Overcast, and the reason that capture's row pinned a `defects.label`
 * until the mask stopped being PGSharp's box welded to a pink head.
 */
test(
  'the artwork settles five of six forms the numbers cannot, and declines the family it cannot separate',
  async () => {
    const { drawn } = ambiguous(DATA);
    const answers = new Map<string, string>();

    for (const fixture of FIXTURES) {
      const truth = fixture.form ? `${fixture.species} (${fixture.form})` : fixture.species;

      // The forms this one is indistinguishable from, which is the only situation the artwork is consulted in.
      const family = drawn.find((members) => members.some((f) => label(f) === truth));

      if (!family?.every((f) => ARTWORK.has(label(f)))) {
        continue;
      }

      // Floored on the overlay's box where one was found, PGSharp drawing over the artwork, so no fraction of one
      // phone's screen is written down here.
      const { image, box } = await readingOf(fixture.file);
      const signature = signatureOf(image, box ? box.y + box.height : undefined);
      assert.ok(signature, `${fixture.file} yields no artwork signature at all`);

      const icons = new Map(
        family.flatMap((f): [string, Signature][] => {
          const icon = ARTWORK.get(label(f));

          return icon ? [[label(f), icon]] : [];
        }),
      );

      answers.set(fixture.file, nearest(signature, icons) ?? 'declined');
    }

    expect(Object.fromEntries(answers)).toStrictEqual({
      'burmy-plant.png': 'Burmy (Plant)',
      'burmy-sandy.png': 'Burmy (Sandy)',
      'burmy-trash.png': 'Burmy (Trash)',
      'cherrim-overcast.png': 'Cherrim (Overcast)',
      'cherrim-sunny.png': 'Cherrim (Sunny)',
      'ho-oh.png': 'declined',
    });
  },
  WHOLE_CORPUS_TIMEOUT,
);

/**
 * What `parseMoves` reads off every committed capture, read by eye and asserted as the whole map so a reader that
 * gained one move and lost another cannot come out even. The *whole* file in each case: a stitch is the only artifact
 * that holds the moves entire, an unscrolled capture reaching them at its foot and stopping there, and `parseMoves` is
 * the one reader that can be handed one — it anchors on the `GYMS & RAIDS` line where every other reader anchors on a
 * fraction of the image's height.
 *
 * Two cases carry it. `overworld.png` is the map, with no tab and no moves, so a reader that invented one fails here —
 * the half a corpus of valid screens cannot state. And the two Squirtle captures end halfway through Water Pulse, so a
 * charged move cut off is answered as absent rather than guessed. The captions matter too: three captures draw
 * `WEATHER BONUS` under a move and carry Weather Ball in their pool, so a reader taking the caption for a move would
 * answer one that is not there.
 *
 * The form comes off `readingOf`, which is the crop, every reader that could answer one being anchored on a height the
 * whole stitch does not have.
 */
test(
  'the moves read off every committed capture are the ones on it',
  async () => {
    const read: Record<string, Moves> = {};

    for (const file of COMMITTED) {
      const { identity } = await readingOf(file);
      const image = decodePng(readFileSync(new URL(`fixtures/${file}`, import.meta.url)));

      read[file] = await parseMoves(await readLines(image), DATA, identity.form, image);
    }

    expect(read).toStrictEqual({
      'applin.png': { fast: 'Astonish', charged: ['Struggle'] },
      'articuno-galar.png': { fast: 'Confusion', charged: ['Fly'] },
      'articuno-kanto.png': { fast: 'Powder Snow', charged: ['Ice Beam'] },
      'basculin-blue.png': { fast: 'Water Gun', charged: ['Muddy Water'] },
      'burmy-plant.png': { fast: 'Tackle', charged: ['Struggle'] },
      'burmy-sandy.png': { fast: 'Tackle', charged: ['Struggle'] },
      'burmy-trash.png': { fast: 'Bug Bite', charged: ['Struggle'] },
      'castform-normal.png': { fast: 'Tackle', charged: ['Weather Ball'] },
      'castform-rainy.png': { fast: 'Tackle', charged: ['Thunder'] },
      'castform-snowy.png': { fast: 'Powder Snow', charged: ['Blizzard'] },
      'castform-sunny.png': { fast: 'Tackle', charged: ['Fire Blast'] },
      'chansey-dynamax.png': { fast: 'Pound', charged: ['Psychic'] },
      'charizard-gigantamax.png': { fast: 'Air Slash', charged: ['Air Cutter'] },
      'cherrim-overcast.png': { fast: 'Bullet Seed', charged: ['Hyper Beam'] },
      'cherrim-sunny.png': { fast: 'Razor Leaf', charged: ['Solar Beam'] },
      'deoxys-attack.png': { fast: 'Poison Jab', charged: ['Psycho Boost'] },
      'deoxys-defense.png': { fast: 'Counter', charged: ['Psycho Boost'] },
      'deoxys-normal.png': { fast: 'Zen Headbutt', charged: ['Hyper Beam'] },
      'deoxys-speed.png': { fast: 'Charge Beam', charged: ['Thunderbolt'] },
      'dialga-altered.png': { fast: 'Dragon Breath', charged: ['Thunder'] },
      'dialga-origin.png': { fast: 'Dragon Breath', charged: ['Iron Head'] },
      'eevee-background.png': { fast: 'Tackle', charged: ['Swift'] },
      'growlithe-nickname.png': { fast: 'Ember', charged: ['Flamethrower'] },
      'ho-oh.png': { fast: 'Extrasensory', charged: ['Brave Bird'] },
      'meloetta-aria.png': { fast: 'Quick Attack', charged: ['Thunderbolt'] },
      'meowth-alola.png': { fast: 'Scratch', charged: ['Foul Play'] },
      'meowth-galar.png': { fast: 'Metal Sound', charged: ['Trailblaze'] },
      'meowth-kanto.png': { fast: 'Bite', charged: ['Night Slash'] },
      'no-pgsharp.png': { fast: 'Bubble', charged: [] },
      'overworld.png': { fast: null, charged: [] },
      'pgsharp-no-overlay.png': { fast: 'Bubble', charged: [] },
      'pikachu-ash-hat.png': { fast: 'Thunder Shock', charged: ['Thunderbolt'] },
      'pikachu-santa-hat.png': { fast: 'Present', charged: ['Wild Charge'] },
      'pikachu-willows-assistant.png': { fast: 'Quick Attack', charged: ['Thunderbolt'] },
      'pikachu-witch-hat.png': { fast: 'Quick Attack', charged: ['Discharge'] },
      'pikachu.png': { fast: 'Thunder Shock', charged: ['Thunderbolt'] },
      'pumpkaboo-large.png': { fast: 'Astonish', charged: ['Grass Knot'] },
      'rotom-wash.png': { fast: 'Thunder Shock', charged: ['Hydro Pump'] },
      'smoliv.png': { fast: 'Tackle', charged: ['Energy Ball'] },
      'snorlax-purified.png': { fast: 'Lick', charged: ['Return'] },
      'spinda-04.png': { fast: 'Sucker Punch', charged: ['Icy Wind'] },
      'spoink.png': { fast: 'Splash', charged: ['Psybeam'] },
      'unown-b.png': { fast: 'Hidden Power', charged: ['Struggle'] },
      'unown-exclamation.png': { fast: 'Hidden Power', charged: ['Struggle'] },
      'unown-m.png': { fast: 'Hidden Power', charged: ['Struggle'] },
      'unown-question.png': { fast: 'Hidden Power', charged: ['Struggle'] },
      'xurkitree.png': { fast: 'Thunder Shock', charged: ['Power Whip'] },
    });

    // And that no stitch reads *less* than the screen inside it, which is the relation rather than the map: a stitch
    // assembled at the wrong offset could hold a plausible pair of moves and still have lost one its own first frame
    // shows. One file on either side of it — `readingOf` is the crop `screenIn` takes, `read` above is the whole.
    for (const file of STITCHES) {
      const { lines, image, identity } = await readingOf(file);
      const shown = await parseMoves(lines, DATA, identity.form, image);
      const whole = read[file];

      assert.ok(whole, `${file} read no moves at all`);
      expect(whole.charged.length, `${file} lost a charged move the screen in it shows`).toBeGreaterThanOrEqual(
        shown.charged.length,
      );

      if (shown.fast !== null) {
        expect(whole.fast, `${file} lost the fast move the screen in it shows`).toBe(shown.fast);
      }
    }
  },
  WHOLE_CORPUS_TIMEOUT,
);

/**
 * The property `assetBundleValue` quietly broke and the whole artwork narrowing rests on: within a family the numbers
 * cannot separate, no two forms may be handed the same icon. Zygarde's `FIFTY_PERCENT` and `COMPLETE_FIFTY_PERCENT`
 * both carried `1`, so one file was fetched twice and the two scored identically — a guaranteed abstention that read
 * as the artwork being indecisive rather than as the key being wrong. Asserted off the vended game master, so it needs
 * no network and moves only when a re-vend moves it.
 *
 * Both halves of the partition are asserted non-empty, since a resolver answering null for everything would leave
 * `drawn` empty and every family short, and one answering a name for everything would leave `short` empty — and each
 * of those passes a clash test that has nothing to compare.
 */
test('no family the artwork narrows has two forms sharing an icon', () => {
  const { drawn, short } = ambiguous(DATA);
  const clashes = drawn
    .filter((family) => new Set(family.map((f) => f.icon)).size !== family.length)
    .map((family) => family.map((f) => `${label(f)}=${f.icon}`).join(' '));

  expect(clashes, 'two forms a family is narrowed within are being compared against one icon').toStrictEqual([]);

  assert.ok(drawn.length > 0, 'no family has an icon for every form, so the clash check compares nothing');
  assert.ok(short.length > 0, 'every family has an icon for every form, so nothing exercises the gap it reports');
});

/**
 * Which families are short of an icon, named rather than counted, because `ICON_DIR` once pointed at a directory
 * `pogo_assets` had stopped filling and nothing could tell: the listing answered `truncated: false` over 3,522 valid
 * names, every form resolved as before, and three families were short of every icon for a year. A stale index fails
 * open twice over — the assertions above pass on any listing that is neither empty nor total.
 *
 * **A full set is what the artwork needs, not what it is given.** `drawn` means every member has a file, which is the
 * precondition `identify` checks; it is not a claim the family can be told apart. Run against their own families at
 * `MARGIN`, only 15 of the 44 identify every member, and several hold two icons whose signatures are identical — none
 * of them named here, this listing the families with no full set rather than the ones the margin defeats.
 *
 * Expect it to move when upstream publishes art or the game master releases a form. A name **arriving** is the case
 * worth stopping on: it says a family lost an icon it had, which is what going stale looked like.
 */
test('the families short of an icon are the ones upstream draws no full set for', () => {
  const { short } = ambiguous(DATA);

  expect(
    short.map((family) => `${family[0]?.species} (${family.length})`),
    'a name arriving means a family lost an icon it had; re-vend and update both or neither',
  ).toStrictEqual([
    'Raikou (2)',
    'Entei (2)',
    'Suicune (2)',
    'Spinda (20)',
    'Scatterbug (20)',
    'Spewpa (20)',
    'Magearna (2)',
  ]);
});

test('the corpus reaches both sides of every attribute', () => {
  for (const flag of ['favourite', 'lucky', 'purified', 'shiny'] as const) {
    assert.ok(
      FIXTURES.some((f) => f[flag]) && FIXTURES.some((f) => !f[flag]),
      `every capture is ${flag} or none is, so nothing separates the two`,
    );
  }

  // `shadow` is the fifth of those and cannot be asserted that way: no capture is shadow, so the column is false on all
  // 44. Stated here as the gap it is rather than quietly dropping `shadow` from the list above and leaving a reader to
  // find the hole.
  expect(
    FIXTURES.filter((f) => f.shadow).map((f) => f.file),
    'a shadow capture is back, so `shadow` belongs in the loop above again',
  ).toStrictEqual([]);

  for (const described of ['background', 'costume'] as const) {
    assert.ok(
      FIXTURES.some((f) => f[described] !== undefined) && FIXTURES.some((f) => f[described] === undefined),
      `every capture wears a ${described} or none does, so nothing separates the two`,
    );
  }

  expect(
    distinct(FIXTURES, (f) => f.size),
    'three of the four bands and none; no capture wears an `XS`, which is a gap and not a licence to drop the band',
  ).toStrictEqual(['XL', 'XXL', 'XXS', 'undefined']);
  expect(distinct(FIXTURES, (f) => f.gender)).toStrictEqual(['female', 'genderunknown', 'male']);
  assert.ok(
    FIXTURES.some((f) => !f.form) && FIXTURES.some((f) => Boolean(f.form)),
    'every capture is a named form or none is, so nothing separates a form name from a base one',
  );
  assert.ok(
    FIXTURES.some((f) => (f.tags ?? []).length > 1) && FIXTURES.some((f) => (f.tags ?? []).length === 1),
    'no capture carries two chips beside one that carries a single chip, so nothing says the columns separate them',
  );
  assert.ok(FIXTURES.some((f) => f.types.length === 2) && FIXTURES.some((f) => f.types.length === 1));

  // A name the species list answers against one it does not, which is what separates a species from a nickname. Three
  // captures print a nickname, and two of those print `96%`.
  assert.ok(
    FIXTURES.some((f) => f.name !== undefined) && FIXTURES.some((f) => f.name === undefined),
    'nothing separates a name that matched a species from one left as a nickname',
  );

  // Both kinds of absent overlay, which the loop asserts apart and so a corpus holding one kind alone would let it
  // conflate. The corpus now holds **neither**, and that is a hole rather than a measurement: `snorlax-purified.png`
  // was the one screen PGSharp had drawn no overlay on at all, and the capture that replaced it carries one. So nothing
  // here reaches the `boxed === false` half of `overlayOf` any more, and a capture with PGSharp switched off is what
  // would close it.
  //
  // Both are asserted as empty rather than dropped, because either coming back is news: the first says the gap has
  // closed, the second that `findOverlay` has started missing a box that is on the screen.
  expect(
    FIXTURES.filter((f) => f.overlay === null).map((f) => f.file),
    'a capture with no overlay drawn is back, so this gap has closed and `some` can assert it again',
  ).toStrictEqual([]);
  expect(
    FIXTURES.filter((f) => f.defects && 'box' in f.defects).map((f) => f.file),
    'a capture needs `defects.box` again, so `findOverlay` has started missing a box that is on the screen',
  ).toStrictEqual([]);

  // The same shape for the types, and the same reason: `typesOf` reads a type off every screen that states one, so no
  // capture needs `defects.types`, and one that does is a regression this reports.
  expect(
    FIXTURES.filter((f) => f.defects && 'types' in f.defects).map((f) => f.file),
    'a capture needs `defects.types` again, so `typesOf` has started reading no type off a screen that states one',
  ).toStrictEqual([]);

  // And the size, which was pinned until the badge was read with no whitelist: `smoliv.png` read `XS` off its `XXS`,
  // and all four badged captures now answer the band their row states. So this is the third key the corpus holds
  // against a reader rather than for one.
  expect(
    FIXTURES.filter((f) => f.defects && 'size' in f.defects).map((f) => f.file),
    'a capture needs `defects.size` again, so `sizeOf` has started misreading a badge',
  ).toStrictEqual([]);

  // And the two the CP cross-check used to need, the fourth and fifth, now that it agrees with the screen on all 44.
  // What still exercises its note is the other direction, a CP *read* off a screen disagreeing with the derived one,
  // which no capture does any more and the test forging `unown-question.png`'s old `4864` does instead.
  expect(
    FIXTURES.filter((f) => f.defects && 'cp' in f.defects).map((f) => f.file),
    'a capture needs `defects.cp` again, so the cross-check has started disagreeing with a screen',
  ).toStrictEqual([]);
  expect(
    FIXTURES.filter((f) => f.defects && 'alternatives' in f.defects).map((f) => f.file),
    'a capture needs `defects.alternatives` again, so `identify` has stopped narrowing to one set of numbers',
  ).toStrictEqual([]);

  // And the triple and the level it carries, the sixth and seventh: `readOverlay` now reads a triple on every capture
  // that has one — the last on the line rather than the first got `rotom-wash.png`, and assembling the fields across
  // the passes got `articuno-galar.png`. `COVERAGE.overlayNotRead` already counts the first of these, so what the pair
  // adds is the reader named in the failure, as for the five above.
  expect(
    FIXTURES.filter((f) => f.defects && 'iv' in f.defects).map((f) => f.file),
    'a capture needs `defects.iv` again, so `readOverlay` has started misreading a triple',
  ).toStrictEqual([]);
  expect(
    FIXTURES.filter((f) => f.defects && 'levels' in f.defects).map((f) => f.file),
    'a capture needs `defects.levels` again, so `identify` has started settling on a level the row denies',
  ).toStrictEqual([]);

  // And both kinds of bracketed form: some captures carry a suffix that names a form of their species, and two carry
  // one that names no form at all, those being PGSharp's `[` and `\` for Unown's two punctuation forms.
  assert.ok(
    FIXTURES.some((f) => f.overlay?.suffix !== undefined && f.overlay.suffix === f.form) &&
      FIXTURES.some((f) => f.overlay?.suffix !== undefined && f.overlay.suffix !== f.form),
    'nothing separates a bracketed form that names one from a bracketed form that names nothing',
  );

  // Which `Defects` keys any capture pins, as the whole set rather than one `ok` per key, so that a key arriving is as
  // loud as a key leaving. The keys rather than the values, because some of the defects are `null` — a triple never
  // read, a suffix that reads as nothing — and a truth test would file those as absent. A key nothing pins is a reader
  // free to change its answer unremarked, which is the same hazard an unasserted field is and reads exactly the same
  // way.
  expect(
    [...new Set(FIXTURES.flatMap((f) => Object.keys(f.defects ?? {})))].sort(),
    'a reader has started or stopped disagreeing with the screen about something',
  ).toStrictEqual(['label', 'unseparated']);

  // And the other side of it, which the keys above cannot give: that some capture carries no defect at all. Without it
  // a reader that was wrong everywhere would pass every row it had a `defects` entry in.
  assert.ok(
    FIXTURES.some((f) => f.defects === undefined),
    'every capture carries a defect, so nothing says a reader ever agrees with its screen outright',
  );
});
