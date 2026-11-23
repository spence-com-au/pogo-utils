/**
 * What the inventory read off the phone says the reader owns, in the shape the Pokédex marks against: the species by
 * dex number, for the grid's tiles. A row with no dex resolved — an egg, or a species the game master did not name — is
 * owned nothing can be marked by, so it is left out rather than marked against dex 0.
 *
 * Species only: the export names a form `Attack` where the dex names it `Deoxys (Attack)`, so marking a tile's forms
 * needs a reconciliation between the two namings that does not exist yet, left to its own change.
 */

import { type Row } from '../tools/inventory/snapshot.mts';

/** The dex numbers the reader owns at least one of. */
export const ownedSpecies = (rows: readonly Row[]): ReadonlySet<number> =>
  new Set(rows.flatMap((row) => (row.dex === null ? [] : [row.dex])));
