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

type Variant = Entry['variants'][number];

/**
 * The forms table's variants an owned form was matched to, as `yours`, and those it could not be told apart from, as
 * `unsure`. A variant missing from the map is one no owned form could be.
 */
export type OwnedForms = ReadonlyMap<string, 'yours' | 'unsure'>;

/** The dex numbers the reader owns at least one of. */
export const ownedSpecies = (rows: readonly Row[]): ReadonlySet<number> =>
  new Set(rows.flatMap((row) => (row.dex === null ? [] : [row.dex])));

/**
 * A dex variant's own token for matching against a row, squashed to letters and digits: its region adjective where it
 * is a regional variant (`Alolan`), or its form name as the dex spells it otherwise (`BLUE_FLOWER` named out to
 * `Blue Flower`). Empty for the two Unown whose form is a bare `!` or `?`, which squash to nothing and so are claimed
 * by no form.
 */
const variantToken = (variant: Variant): string => squash(variant.region ?? formNameOf(variant.form ?? ''));

/**
 * Whether `variant` could be the form the export resolved a row to. A named form meets the dex's once both are squashed
 * and the game master's is a prefix of the dex's, which an exact match (`attack` of `attack`) and the game master's
 * shorter regional and flower spellings (`alola` of `alolan`, `blue` of `blueflower`) all are. A null form is the game
 * master's ordinary form, which the dex lists as a `NORMAL` form for the species declared as forms that have one
 * (Deoxys, Castform, Kyurem) — `DEOXYS_NORMAL` is the game master's null, as `ORDINARY` in `core/node/download.mts`
 * reads it.
 */
function claims(variant: Variant, form: string | null): boolean {
  if (form === null) {
    return variant.region === null && variant.form === 'NORMAL';
  }

  const token = squash(form);
  const part = variantToken(variant);

  return token !== '' && part !== '' && part.startsWith(token);
}

/**
 * The forms of `entry` the reader owns, from a read's rows. The export resolves a row's form to the game master's own
 * name — `Alola`, `Blue`, `Attack` — where the dex spells the variant `Alolan Marowak`, `Flabébé (Blue Flower)`,
 * `Deoxys (Attack)`, and `claims` reconciles the two.
 *
 * A form is `yours` only where exactly one variant claims it. One that no variant claims — a Paldean breed the game
 * master names `Paldea Aqua` against the dex's `Aqua Breed`, longer and so no prefix — could be any of them, and one
 * two variants claim could be either, so those are `unsure` rather than drawn as owned or as not: a guess either way
 * would read as fact.
 *
 * An ordinary-form row of a species whose own variants are all regional, as Marowak's are, is the species itself, which
 * the table has no row for, so it marks nothing here. One of a species declared as forms is one of those forms.
 */
export const ownedForms = (rows: readonly Row[], entry: Entry): OwnedForms => {
  const owned = new Map<string, 'yours' | 'unsure'>();
  const declaredAsForms = entry.species.variants.some(({ region }) => region === null);

  const forms = new Set(
    rows.flatMap((row) => (row.dex === entry.dex && (row.form !== null || declaredAsForms) ? [row.form] : [])),
  );

  for (const form of forms) {
    const claimants = entry.variants.filter((variant) => claims(variant, form));
    const [only] = claimants;

    if (only && claimants.length === 1) {
      owned.set(only.name, 'yours');
      continue;
    }

    for (const { name } of claimants.length === 0 ? entry.variants : claimants) {
      if (!owned.has(name)) {
        owned.set(name, 'unsure');
      }
    }
  }

  return owned;
};
