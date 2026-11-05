/**
 * What a Pokédex row says, which is more than a copy of `pokedex.js` in four places: a flag read across a species and
 * every form under it, a shiny weighed only over the released ones, a hunt the feed cannot watch, and a form of a
 * regional variant named by both. Each fails by showing a reader something false rather than by failing to render.
 */

import { expect, test } from 'vitest';

import {
  CATEGORIES,
  ENTRIES,
  GENERATION_NUMBERS,
  HUNTS,
  entryOf,
  generationOf,
  heldIn,
  huntsOf,
  numbered,
} from './entries.js';
import PGSHARP_FILTERS from '../pgsharp/filters.js';
import { GENERATIONS } from '../pokemon/generations.js';
import { fold } from '../pokemon/names.js';
import POKEMON, { PALDEA } from '../pokemon/pokedex.js';
import Pokemon from '../pokemon/pokemon.js';

/** One row by the name the page shows. It throws rather than narrowing: a species gone is a precondition gone. */
function entry(name: string) {
  const found = ENTRIES.find((row) => row.name === name);

  if (!found) {
    throw new Error(`\`entries.js\` carries no row named ${name}`);
  }

  return found;
}

test('a dex number belongs to the generation whose last number it reaches, both ends included', () => {
  const lasts = GENERATIONS.map(({ last }) => last);

  // The lookup is the first generation the number reaches the end of, which is the right answer only while the table is
  // in dex order — so that is a precondition of the function rather than an observation about the table.
  expect(lasts).toEqual([...lasts].sort((one, two) => one - two));
  expect(GENERATION_NUMBERS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

  // 151 beside 152 is the pair that separates `<=` from `<`. Off by one and every generation's last species is filed
  // under the next one, which on the page is Mew shown as a Gen 2 Pokémon.
  expect([generationOf(151), generationOf(152)]).toEqual([1, 2]);
  expect([generationOf(251), generationOf(252)]).toEqual([2, 3]);

  // The table reaches 1025 and so does the dex, so no row can take the `null`: it is reachable by asking about a number
  // no species has, which is how a tenth generation arrives before `generations.js` has heard of it.
  expect([Math.max(...lasts), Math.max(...ENTRIES.map(({ dex }) => dex))]).toEqual([1025, 1025]);
  expect(ENTRIES.filter(({ generation }) => generation === null)).toEqual([]);
  expect(generationOf(1026)).toBe(null);
});

test('a category one form carries files the whole species under it', () => {
  const flabebe = entry('Flabébé');

  // Flabébé itself is not regional and three of its five flowers are, so reading the species alone would leave it off
  // the Regional filter on a page that shows a regional form directly beneath it.
  expect(flabebe.species.regional).toBe(false);
  expect(flabebe.variants.filter(({ pokemon }) => pokemon.regional).map(({ name }) => name)).toEqual([
    'Flabébé (Red Flower)',
    'Flabébé (Yellow Flower)',
    'Flabébé (Blue Flower)',
  ]);

  expect(flabebe.categories).toEqual(['regional']);
});

test("the categories are a list in the table's order, and a species in none of them gets an empty one", () => {
  // Regional overlaps the other four, which is the whole reason a species carries a list rather than one field: Mime
  // Jr. is a Baby and a regional both, and either read as the single answer loses the other.
  expect(entry('Mime Jr.').categories).toEqual(['baby', 'regional']);

  // In the table's order rather than the species', so two cards compared side by side are compared in one order.
  expect(CATEGORIES.map(({ id }) => id)).toEqual(['legendary', 'mythical', 'ultraBeast', 'baby', 'regional']);

  // An empty array rather than a missing field, since the page maps over it to draw the chips.
  expect(entry('Bulbasaur').categories).toEqual([]);
});

/**
 * The species here are built for the case rather than read from the dex: whether Phione or Rotom's Fan form is in the
 * game is Niantic's to change, and a release would otherwise break a test of code that is still right.
 */
test('a shiny that exists only on a part of the dex nobody can catch is not a shiny the page offers', () => {
  // A part with a shiny that is not released: weighing every part rather than the released ones would put a shiny chip
  // on a card for a species that cannot be caught at all, shiny or otherwise.
  const unreleased = new Pokemon(900).isNotReleased();

  expect([unreleased.released, unreleased.shinyEligible]).toEqual([false, true]);
  expect(entryOf('UNRELEASED', unreleased)).toMatchObject({ released: false, shiny: false });

  // The same gate over `spawns`, where ignoring it is the louder error: the table still carries the spawn flag the
  // species would have, so weighing every part would promise a wild encounter with something that cannot be met.
  expect(unreleased.spawns).toBe(true);
  expect(entryOf('UNRELEASED', unreleased).spawns).toBe(false);

  // The same reading from the other side: a species is in the game, and has a shiny, if any one part of it does.
  expect(entryOf('RELEASED', new Pokemon(901))).toMatchObject({ released: true, shiny: true, spawns: true });
});

test('a species is in the game if any part of it is, rather than only if all of it is', () => {
  // The species itself is out and so is one form while another is in, so asking for every part would leave the row off
  // the released filter altogether — a card hidden for a species a reader already has in their bag.
  const species = new Pokemon(902).isNotReleased().addForms('OUT', 'IN');

  species.form('IN').isReleased();

  expect([species, ...species.forms('OUT', 'IN')].map((part) => part.released)).toEqual([false, false, true]);
  expect(entryOf('MIXED', species).released).toBe(true);
});

test('a hunt can want a species the feed will never turn up, and the row says which', () => {
  // A hunt wanting a species nothing of which spawns, so the feed PGSharp is handed cannot alert on one. A page that
  // cannot tell this from a live hunt shows a checklist as something it is still watching for.
  const silent = new Pokemon(903).isLegendary();
  const live = new Pokemon(904);
  const hunt = {
    id: 'wanted',
    label: 'Wanted',
    members: new Set([silent, live]),
    watched: (p: Pokemon) => p.spawns,
    fillable: (p: Pokemon) => p.released,
    perForm: false,
  };

  expect(silent.spawns).toBe(false);
  expect(huntsOf([silent], [hunt])).toEqual([{ id: 'wanted', watched: false }]);
  expect(huntsOf([live], [hunt])).toEqual([{ id: 'wanted', watched: true }]);

  // A hunt the row is not on is left out rather than carried as `false`, because the page reads the array itself —
  // carrying all four would file every species under every list with nothing to say it was not wanted.
  expect(huntsOf([new Pokemon(905)], [hunt])).toEqual([]);
  expect(HUNTS.map(({ id }) => id)).toEqual(['shiny', 'xxl', 'xxs', 'perfect']);
});

test('a hunt is watched where any member it wants is, not where every one of them is', () => {
  // A made-up hunt wanting both parts of one row and watching only the species, since the real lists reach this split
  // only while one of them happens to want a form the feed cannot alert on beside one it can. Under `every` the row
  // would call the hunt dead while the feed was alerting on the part it does watch, which on the page is a checklist
  // shown as finished.
  const species = POKEMON.TAUROS;
  const variant = species.region(PALDEA);
  const hunt = {
    id: 'split',
    label: 'Split',
    members: new Set([species, variant]),
    watched: (p: Pokemon) => p === species,
    fillable: (p: Pokemon) => p.released,
    perForm: false,
  };

  expect(huntsOf([species, variant], [hunt])).toEqual([{ id: 'split', watched: true }]);
});

/** A hunt over exactly these members, filled by whatever is in the game. */
const huntOf = (members: Pokemon[], over: { perForm?: boolean; fillable?: (p: Pokemon) => boolean } = {}) => ({
  id: 'held',
  label: 'Held',
  members: new Set(members),
  watched: () => true,
  fillable: (p: Pokemon) => p.released,
  perForm: false,
  ...over,
});

test('a hunt that lists a species bare wants every form of it, and one form listed leaves the rest held', () => {
  const species = new Pokemon(910).addForms('RED', 'BLUE');
  const [red] = species.forms('RED', 'BLUE');

  expect(heldIn(species, huntOf([species]))).toBe(false);
  expect(heldIn(species, huntOf([red as Pokemon]))).toBe(true);
  expect(heldIn(species, huntOf([]))).toBe(true);
});

test('a regional variant carries its species’ answer unless the hunt is written a form at a time', () => {
  const species = new Pokemon(911).addRegion('GALARIAN');
  const regional = species.region('GALARIAN');

  // One entry per species: the bare species stands for the regional variant too, so nothing of it is left held.
  expect(heldIn(species, huntOf([species]))).toBe(false);

  // Per form: the variant is a slot of its own and the list did not name it, so the species is held through it.
  expect(heldIn(species, huntOf([species], { perForm: true }))).toBe(true);
  expect(heldIn(species, huntOf([species, regional], { perForm: true }))).toBe(false);
  expect(heldIn(species, huntOf([regional], { perForm: true }))).toBe(true);
});

test('a slot the hunt cannot fill does not hold the species, however the list reads', () => {
  const species = new Pokemon(912).addForms('OUT', 'IN');
  const [out, inGame] = species.forms('OUT', 'IN');

  out?.isNotReleased();

  // Only the form that is out is unwanted, and an unreleased form cannot be registered, so the species is not held.
  expect(heldIn(species, huntOf([inGame as Pokemon]))).toBe(false);
  expect(heldIn(species, huntOf([out as Pokemon]))).toBe(true);

  // A fillable that asks for more than being released, as the shiny hunt's does.
  const plain = new Pokemon(913).isNotShinyEligible();

  expect(heldIn(plain, huntOf([], { fillable: (p) => p.released && p.shinyEligible }))).toBe(false);
  expect(heldIn(plain, huntOf([]))).toBe(true);
});

test('a hunt is watched for exactly the species the PGSharp feed built from its list carries', () => {
  // The page's `watched` and the feed are two readings of one narrowing, and checking `watched` against itself cannot
  // see them drift: a filter added to `WILD_SPAWN_FILTERS` would change the feed and leave the page's counts describing
  // the old one. So each hunt is checked against the feed it stands for, compared by dex number since that is all the
  // feed keeps. The Hisuian and Regional shiny feeds are narrower cuts of the shiny list and are left out.
  const feeds: Record<string, string> = { shiny: 'Shiny Hunting', xxl: 'XXL', xxs: 'XXS', perfect: '100%' };
  const dexes = (pokemon: Iterable<unknown>) => [...new Set([...pokemon].map(Number))].sort((one, two) => one - two);

  expect(Object.keys(feeds)).toEqual(HUNTS.map(({ id }) => id));

  for (const { id, members, watched } of HUNTS) {
    const feed = PGSHARP_FILTERS.find(({ name }) => name === feeds[id]);

    expect(feed, id).toBeDefined();
    expect(dexes([...members].filter(watched)), id).toEqual(dexes(feed?.pokemons ?? []));
  }
});

test('a form of a regional variant is named by both, so it is not read as a form of the species', () => {
  // The three breeds hang off Paldean Tauros rather than off Tauros, and the recursion carries the label down with
  // them: naming a form from the species would give `Tauros (Combat Breed)`, a Kantonian bull that does not exist.
  expect(entry('Tauros').variants.map(({ name }) => name)).toEqual([
    'Paldean Tauros',
    'Paldean Tauros (Combat Breed)',
    'Paldean Tauros (Blaze Breed)',
    'Paldean Tauros (Aqua Breed)',
  ]);

  // A region goes in front and a form in brackets. Which of the two a variant is cannot be shown here to turn on a
  // `!== null` rather than on truthiness: the dex carries four regions and no empty one, so no data can separate them,
  // and the check is held by the compiler instead — a truthiness test is `TS2345: Argument of type 'string | null' is
  // not assignable to parameter of type 'string'` on that line, because `''` leaves the form nullable in the branch
  // that names it.
  expect(entry('Articuno').variants.map(({ name }) => name)).toEqual(['Galarian Articuno']);
  expect(entry('Flabébé').variants[0]?.name).toBe('Flabébé (Red Flower)');
});

test('the searchable name is folded from what the page shows rather than from the constant', () => {
  // Nidoran is the one place the two disagree, and the accented names cannot show it: the constant spells the symbol as
  // a letter, so folding it leaves an `f` the displayed name has no character for. A reader typing `nidoran` would then
  // match neither, and `nidoranf` — which nobody can type at all — would be the only way to either.
  expect([entry('Nidoran♀').constant, entry('Nidoran♀').folded]).toEqual(['NIDORAN_F', 'nidoran']);
  expect(fold('NIDORAN_F')).toBe('nidoranf');

  // Which also makes the two Nidoran one search, as the game has them, so nothing downstream may take a fold as unique.
  expect(entry('Nidoran♂').folded).toBe('nidoran');

  // The accent and the punctuation fold too; those two agree with the constant, which is what left them unable to say
  // where the fold was read from.
  expect([entry('Flabébé').name, entry('Flabébé').folded]).toEqual(['Flabébé', 'flabebe']);
  expect([entry('Mime Jr.').name, entry('Mime Jr.').folded]).toEqual(['Mime Jr.', 'mimejr']);
});

test('the rows are the whole dex in strictly ascending order', () => {
  // Strictly rather than merely ascending: two rows at one number would draw two cards a reader cannot tell apart, and
  // the page offers no second key to order them by.
  expect(ENTRIES).toHaveLength(1025);
  expect(ENTRIES.filter((row, at) => at > 0 && row.dex <= (ENTRIES[at - 1]?.dex ?? 0))).toEqual([]);
  expect([ENTRIES[0]?.name, ENTRIES.at(-1)?.name]).toEqual(['Bulbasaur', 'Pecharunt']);
});

test('a dex number is printed four wide', () => {
  // The games print `#0001`, and the padding is what makes a column of numbers line up. `padStart` does not truncate,
  // which is why the four-digit end of the dex is worth asserting beside the one-digit start.
  expect([numbered(1), numbered(151), numbered(1025)]).toEqual(['#0001', '#0151', '#1025']);
});
