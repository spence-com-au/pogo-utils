/**
 * The Pokédex as the page reads it: every species in `pokedex.js`, with its name, generation, what is true of it and
 * its forms, and which hunt lists in `filters/` still want it. Kept out of the page so what an entry says is readable
 * without a DOM around it.
 *
 * Nothing here is a second copy — the flags, names and hunts are the very ones the filters and the backup read, so a
 * species crossed off `filters/xxl.js` drops off the page's XXL filter with no other edit.
 */

import { fold, formNameOf, nameOf } from '../pokemon/names.js';
import POKEMON from '../pokemon/pokedex.js';
import { allOf, SHINY_HUNTING_FILTERS, WILD_SPAWN_FILTERS, type Predicate } from '../filters/narrow.js';
import PERFECT_IV_POKEMON from '../filters/perfect-ivs.js';
import SHINY_POKEMON from '../filters/shiny.js';
import XXL_POKEMON from '../filters/xxl.js';
import XXS_POKEMON from '../filters/xxs.js';
import { GENERATIONS } from '../pokemon/generations.js';
import type Pokemon from '../pokemon/pokemon.js';

/**
 * A key of `Pokemon` answering a boolean, which is all a category or a hunt asks about one. Derived rather than written
 * out, because the class carries a builder method beside almost every flag and a method is truthy for every species —
 * so a category naming one would file the whole dex under it. Against this both are a `TS2820`; against
 * `keyof Pokemon` both are silent.
 */
export type Flag = { [K in keyof Pokemon]: Pokemon[K] extends boolean ? K : never }[keyof Pokemon];

type Hunt = {
  id: string;
  label: string;
  members: ReadonlySet<Pokemon>;
  watched: Predicate;
  fillable: Predicate;
  perForm: boolean;
};
type EntryHunt = { id: string; watched: boolean };
type Variant = { name: string; pokemon: Pokemon; hunts: EntryHunt[] };

/**
 * One row of the dex as the page reads it. Exported for `pages/pokedex.tsx` and `pokedex/state.ts`, which render and
 * filter these and have no other source for what an entry carries.
 */
export interface Entry {
  constant: string;
  dex: number;
  name: string;
  folded: string;
  generation: number | null;
  species: Pokemon;
  variants: Variant[];
  released: boolean;
  shiny: boolean;
  spawns: boolean;
  categories: Flag[];
  hunts: EntryHunt[];

  /** Each hunt's dex: whether it holds this species, which is filled in that hunt's tab. See `heldIn`. */
  held: Readonly<Record<HuntId, boolean>>;
}

/**
 * What a scanner can ever report, read off the very filter list `filters/narrow.js` hands the feeds — so a filter added
 * there changes what the page calls watched with no edit here.
 */
const feedable = allOf(WILD_SPAWN_FILTERS);

const inGame: Predicate = (pokemon) => pokemon.released;

/**
 * The hunt lists, in the order the page shows them. A list names a species or one of its forms, so an entry is on a
 * hunt when anything it holds is a member.
 *
 * A list is a checklist of what is still wanted, where the feed PGSharp is handed is that list narrowed to what it can
 * alert on. `watched` is that narrowing, so the page can tell "wanted, and the feed is looking" from "wanted, but only
 * a raid or an egg will turn one up".
 *
 * `fillable` is what a slot of the hunt's dex has to be before it can be filled at all: in the game, and for the shiny
 * hunt with its shiny out too, since a shiny nobody can catch is not one the dex is missing.
 *
 * `perForm` is how the list is written. The shiny list names a regional variant apart, as the game's shinies differ by
 * region; the other three hold one entry per species, as their headers say, so a bare Meowth there stands for the
 * Alolan and Galarian ones too.
 */
export const HUNTS = [
  {
    id: 'shiny',
    label: 'Shiny hunt',
    members: SHINY_POKEMON,
    watched: allOf(SHINY_HUNTING_FILTERS),
    fillable: (pokemon) => pokemon.released && pokemon.shinyEligible,
    perForm: true,
  },
  { id: 'xxl', label: 'XXL wanted', members: XXL_POKEMON, watched: feedable, fillable: inGame, perForm: false },
  { id: 'xxs', label: 'XXS wanted', members: XXS_POKEMON, watched: feedable, fillable: inGame, perForm: false },
  {
    id: 'perfect',
    label: '100% wanted',
    members: PERFECT_IV_POKEMON,
    watched: feedable,
    fillable: inGame,
    perForm: false,
  },
] as const satisfies readonly Hunt[];

/**
 * The hunt lists by id, which the Pokédex's modes name too. Read off `HUNTS` itself, so a mode can name only a list
 * that is there, and a list renamed or dropped there is a compile error at every mode that named it.
 */
export type HuntId = (typeof HUNTS)[number]['id'];

/**
 * The categories a species can belong to, as the getter on `Pokemon` that says so. Legendary, Mythical, Ultra Beast and
 * Baby are exclusive in practice; Regional is not, which is why this is a list of flags rather than a single field.
 */
export const CATEGORIES: readonly { id: Flag; label: string }[] = [
  { id: 'legendary', label: 'Legendary' },
  { id: 'mythical', label: 'Mythical' },
  { id: 'ultraBeast', label: 'Ultra Beast' },
  { id: 'baby', label: 'Baby' },
  { id: 'regional', label: 'Regional' },
];

/**
 * The generation a dex number falls in, or null for one past the last generation `pokemon/generations.js` knows about.
 * The generations are in dex order, so the first whose `last` the number reaches is the one it belongs to.
 */
export const generationOf = (dex: number) => GENERATIONS.find(({ last }) => dex <= last)?.number ?? null;

export const GENERATION_NUMBERS = GENERATIONS.map(({ number }) => number);

/**
 * Every variant under one, depth first, each carrying the name it reads as. A form of a regional variant is named by
 * both, so Paldean Tauros's breeds read as `Paldean Tauros (Combat Breed)` rather than as a breed of the Kantonian
 * bull.
 */
function variantsOf(pokemon: Pokemon, name: string): Variant[] {
  return pokemon.variants.flatMap((variant) => {
    // A variant is a region or a form and never both, which is a pairing the object holds and two bindings lose. The
    // test is `!== null` rather than truthiness because `''` is a falsy string, so truthiness cannot rule the region
    // out and leaves the form nullable in the branch that names it.
    const label = variant.region !== null ? `${variant.region} ${name}` : `${name} (${formNameOf(variant.form)})`;
    const child = variant.pokemon;

    return [{ name: label, pokemon: child, hunts: huntsOf([child]) }, ...variantsOf(child, label)];
  });
}

/**
 * The hunts that want any one of these, each saying whether the feed watches for any member it wants. A species can be
 * on a list and unwatched — Terapagos is wanted as an XXL like the rest of the dex, and nothing will turn one up in the
 * wild to alert on. The hunts are a parameter so a test can hand it one that splits a row, which the real lists only
 * sometimes do.
 */
export function huntsOf(pokemon: readonly Pokemon[], hunts: readonly Hunt[] = HUNTS) {
  return hunts.flatMap(({ id, members, watched }) => {
    const wanted = pokemon.filter((p) => members.has(p));

    return wanted.length > 0 ? [{ id, watched: wanted.some(watched) }] : [];
  });
}

/**
 * The slots a hunt's dex has for a species, each with whether the hunt's list still wants it. A list names what it
 * still wants: a single form where only that is wanted, and the bare species where every form of it is (Keldeo,
 * Burmy). So a listed species carries its forms with it, and a species declared as forms is those forms rather than a
 * slot of its own. A regional variant is its own slot, as the game's dex files it apart, and carries the species'
 * answer only where the list is one entry per species — the shiny list names Galarian Weezing apart when it wants it.
 */
function slotsOf(hunt: Hunt, pokemon: Pokemon, inherited = false): { pokemon: Pokemon; wanted: boolean }[] {
  const wanted = inherited || hunt.members.has(pokemon);
  const forms = pokemon.variants.filter(({ region }) => region === null);
  const regions = pokemon.variants.filter(({ region }) => region !== null);

  return [
    ...(forms.length > 0 ? forms.flatMap((form) => slotsOf(hunt, form.pokemon, wanted)) : [{ pokemon, wanted }]),
    ...regions.flatMap((variant) => slotsOf(hunt, variant.pokemon, !hunt.perForm && wanted)),
  ];
}

/**
 * Whether a hunt's dex holds a species: some slot of it is one the hunt can fill — its `fillable` — and no longer
 * wanted by the list, as the game fills a species' tile once any of its forms is registered. Galarian Weezing on the
 * shiny list leaves the Kantonian one held; Keldeo listed bare leaves neither of its forms, and Meowth on the XXL list
 * none of its regions.
 */
export function heldIn(species: Pokemon, hunt: Hunt) {
  return slotsOf(hunt, species).some(({ pokemon, wanted }) => !wanted && hunt.fillable(pokemon));
}

/**
 * One row per species, in dex order.
 *
 * The species-level answers ask the species and its variants together: an entry is in the game if any of it is, and
 * has a shiny if any released part of it does — Galarian Darumaka's shiny is still a Darumaka shiny to hunt. `spawns`
 * reads the same way, so Paldean Tauros not spawning does not stop Tauros from counting as a wild spawn.
 */
export const ENTRIES: readonly Entry[] = Object.entries(POKEMON).map(([constant, species]) => {
  const name = nameOf(constant);
  const variants = variantsOf(species, name);
  const all = [species, ...variants.map(({ pokemon }) => pokemon)];
  const released = all.filter((pokemon) => pokemon.released);

  return {
    constant,
    dex: species.dex,
    name,
    folded: fold(name),
    generation: generationOf(species.dex),
    species,
    variants,
    released: released.length > 0,
    shiny: released.some((pokemon) => pokemon.shinyEligible),
    spawns: released.some((pokemon) => pokemon.spawns),
    categories: CATEGORIES.filter(({ id }) => all.some((pokemon) => pokemon[id])).map(({ id }) => id),
    hunts: huntsOf(all),
    held: Object.fromEntries(HUNTS.map((hunt) => [hunt.id, heldIn(species, hunt)])) as Record<HuntId, boolean>,
  };
});

/** The dex number zero-padded to four places, the way the games print it: bare, as under a tile in the GO Pokédex. */
export const tileNumber = (dex: number) => String(dex).padStart(4, '0');

/** And with the `#` ahead of it, as an entry's title prints it. */
export const numbered = (dex: number) => `#${tileNumber(dex)}`;
