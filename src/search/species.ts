/**
 * The species the name box offers, and what a row of them writes. Kept out of the page for the reason `query.js` is:
 * what a row means is worth being able to check without a DOM around it.
 *
 * The list is the Pokédex rather than a copy of it, and only the released species are offered — one the game has not
 * put out cannot be in the storage this string is typed into.
 *
 * Forms and regional variants are left out. The game searches the name it shows, and that name is the species' —
 * `pokemon_name_0019` is `Rattata` for the Alolan one as much as the Kantonian — so `Alolan Rattata` answers to
 * nothing, and the Regional forms chips are how a reader asks for that.
 *
 * A family is written rather than expanded: `+charmander` goes to the game as it stands, which three species that is
 * being something `pokedex.js` cannot say, carrying forms, regions and rarity but no evolution links.
 */

import { fold, nameOf } from '../pokemon/names.js';
import POKEMON from '../pokemon/pokedex.js';

/** One species the list can offer: its name, and the folded form every keystroke is compared against. */
interface Species {
  name: string;
  folded: string;
}

/**
 * Every species of a dex that can be in your boxes, in the dex's order, so the suggestions for `char` read as a family
 * rather than alphabetically. The folded form is kept beside the name, being what every keystroke is compared against.
 *
 * Takes the dex as an argument so a test can offer from one made for the case, rather than from the game's, whose
 * releases are Niantic's to make.
 */
export const offerable = (dex: Record<string, { released: boolean }>): Species[] =>
  Object.entries(dex)
    .filter(([, species]) => species.released)
    .map(([constant]) => nameOf(constant))
    .map((name) => ({ name, folded: fold(name) }));

const SPECIES = offerable(POKEMON);

/**
 * How many rows are offered at once, the list being a shortcut past spelling a name rather than a way to read the dex.
 * A family takes a row of its own, so eight rows is four species.
 */
const LIMIT = 8;

/** Shorter than this names too much of the dex for eight rows to say anything useful about it. */
const SHORTEST = 2;

/** The game's mark for a species and the rest of its evolutionary line, written in front of the name. */
const FAMILY = '+';

/** One row of the list: a species, and whether the row asks for its family rather than for the species alone. */
export interface Offer {
  name: string;
  family: boolean;
}

/**
 * What the list offers for the name being typed. Prefixes first — `char` offers Charmander before Hitmonchan — and
 * each of the two groups keeps its dex order.
 *
 * A family is a row of its own rather than a mode over the list, so which of the two searches a row writes is settled
 * by taking that row and nothing else, and it sits directly beside the species it came from. Every match gets one, and
 * three can be the same search: collapsing them would need to know which species share a family, which nothing here
 * does.
 *
 * The marker is not part of the name, so `+charm` offers what `charm` offers — as families alone, a reader who typed
 * the marker having already said which of the two they mean.
 */
export function suggestions(value: string, species: readonly Species[] = SPECIES): Offer[] {
  const typed = value.trim();
  const family = typed.startsWith(FAMILY);
  const needle = fold(family ? typed.slice(FAMILY.length) : typed);

  if (needle.length < SHORTEST) {
    return [];
  }

  const starting = [];
  const containing = [];

  for (const { name, folded } of species) {
    const at = folded.indexOf(needle);

    if (at === 0) {
      starting.push(name);
    } else if (at > 0) {
      containing.push(name);
    }
  }

  const matched = [...starting, ...containing];

  const offers = family
    ? matched.map((name) => ({ name, family: true }))
    : matched.flatMap((name) => [
        { name, family: false },
        { name, family: true },
      ]);

  return offers.slice(0, LIMIT);
}

/**
 * A row as the search writes it. The offer is the whole of the answer — nothing about what was typed reaches this, not
 * even a marker the reader put there themselves, which is the whole of why a family is a row rather than a mode: what a
 * row writes is decided by taking it, and there is nothing else left to have changed it.
 *
 * Written in lower case, matching the placeholder and every term the chips write. The game does not care, and a string
 * that is lower case throughout reads as one thing rather than as two pasted together.
 */
export const written = (offer: Offer) => (offer.family ? FAMILY : '') + offer.name.toLowerCase();

/**
 * The row the arrow keys land on, from the one now active and a step of one either way. `-1` is no row: what was typed.
 *
 * One slot more than there are rows, so arrowing off either end lands on what was typed rather than wrapping straight
 * past it: the reader can always get their own text back the way they came.
 */
export const stepped = (active: number, step: -1 | 1, rows: number) => ((active + step + rows + 2) % (rows + 1)) - 1;
