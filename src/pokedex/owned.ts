/**
 * What the inventory read off the phone says the reader owns, in the shape the Pokédex marks against: the species by
 * dex number for the grid's tiles, and the forms by variant name for an open species' forms table.
 *
 * A row with no dex resolved — an egg, or a species the game master did not name — is owned nothing can be marked by,
 * so it is left out rather than marked against dex 0.
 */

import { formNameOf } from '../pokemon/names.js';
import { squash, type Row } from '../tools/inventory/snapshot.mts';
import { type Entry } from './entries.js';

/** The dex numbers the reader owns at least one of. */
export const ownedSpecies = (rows: readonly Row[]): ReadonlySet<number> =>
  new Set(rows.flatMap((row) => (row.dex === null ? [] : [row.dex])));

/**
 * A dex variant's own token for matching against a row, squashed to letters and digits: its region adjective where it
 * is a regional variant (`Alolan`), or its form name as the dex spells it otherwise (`BLUE_FLOWER` named out to
 * `Blue Flower`). Empty for the two Unown whose form is a bare `!` or `?`, which squash to nothing and can match no
 * form but by accident, so the caller drops them.
 */
const variantToken = (variant: Entry['variants'][number]): string =>
  squash(variant.region ?? formNameOf(variant.form ?? ''));

/**
 * The forms of `entry` the reader owns, by variant name, from a read's rows. The export resolves a row's form to the
 * game master's own name — `Alola`, `Blue`, `Attack` — where the dex spells the variant `Alolan Marowak`,
 * `Flabébé (Blue Flower)`, `Deoxys (Attack)`. The two meet once squashed when the game master's name is a prefix of
 * the dex's, which an exact match (`attack` of `attack`) and the game master's shorter regional and flower spellings
 * (`alola` of `alolan`, `blue` of `blueflower`) both are.
 *
 * A form is ticked only where exactly one variant claims the row's token. A token no variant claims — a Paldean breed
 * the game master names `Paldea Aqua` against the dex's `Aqua Breed`, longer and so no prefix — or one that two would,
 * marks nothing: an owned form left unticked reads as the species-only mark that preceded this, where a guess drawn as
 * a tick would read as fact. An ordinary-form row carries no form name and marks only the species.
 */
export const ownedForms = (rows: readonly Row[], entry: Entry): ReadonlySet<string> => {
  const owned = new Set<string>();

  const tokens = new Set(rows.flatMap((row) => (row.dex === entry.dex && row.form !== null ? [squash(row.form)] : [])));

  for (const token of tokens) {
    if (token === '') {
      continue;
    }

    const claimants = entry.variants.filter((variant) => {
      const part = variantToken(variant);

      return part !== '' && part.startsWith(token);
    });

    const [only] = claimants;

    if (only && claimants.length === 1) {
      owned.add(only.name);
    }
  }

  return owned;
};
