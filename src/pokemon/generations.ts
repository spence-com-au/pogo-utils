/**
 * Where the national dex divides into generations: each generation number beside the first and last dex number it
 * covers. A fact about the games rather than about either page that reads it, which is why it lives here — the search
 * builder renders it as the `1-151` the game's search box takes and the Pokédex reads the bounds to label a card, and
 * neither owns the boundaries themselves.
 *
 * The bounds are numbers rather than a rendered `'1-151'`, so the one consumer that wants that string writes it and the
 * other compares dex numbers without parsing it back out again.
 *
 * Each also names its region and its three starters, which the Pokédex's region cards are drawn with. The starters are
 * written out rather than counted from `first`: Unova opens on Victini, one ahead of Snivy.
 *
 * The last generation's `last` is the dex itself, and moves when a generation is added to the game.
 */
export const GENERATIONS: readonly {
  number: number;
  first: number;
  last: number;
  region: string;
  starters: readonly [number, number, number];
}[] = [
  { number: 1, first: 1, last: 151, region: 'Kanto', starters: [1, 4, 7] },
  { number: 2, first: 152, last: 251, region: 'Johto', starters: [152, 155, 158] },
  { number: 3, first: 252, last: 386, region: 'Hoenn', starters: [252, 255, 258] },
  { number: 4, first: 387, last: 493, region: 'Sinnoh', starters: [387, 390, 393] },
  { number: 5, first: 494, last: 649, region: 'Unova', starters: [495, 498, 501] },
  { number: 6, first: 650, last: 721, region: 'Kalos', starters: [650, 653, 656] },
  { number: 7, first: 722, last: 809, region: 'Alola', starters: [722, 725, 728] },
  { number: 8, first: 810, last: 905, region: 'Galar', starters: [810, 813, 816] },
  { number: 9, first: 906, last: 1025, region: 'Paldea', starters: [906, 909, 912] },
];

/**
 * A region a generation shares with the one it is named for: Hisui, whose seven species close generation 8 after
 * Galar's. A species in one of these spans is from that region rather than its generation's.
 */
export const SUB_REGIONS: readonly { region: string; first: number; last: number }[] = [
  { region: 'Hisui', first: 899, last: 905 },
];

/** The region a species is from, by its dex number, or null for one past the last generation. */
export const regionOf = (dex: number) =>
  SUB_REGIONS.find(({ first, last }) => dex >= first && dex <= last)?.region ??
  GENERATIONS.find(({ first, last }) => dex >= first && dex <= last)?.region ??
  null;

/** Every region a generation covers, joined as one name — `Galar & Hisui` — for a control that picks by generation. */
export const regionsOf = (row: (typeof GENERATIONS)[number]) =>
  [row.region, ...SUB_REGIONS.filter(({ first }) => first >= row.first && first <= row.last).map((r) => r.region)].join(
    ' & ',
  );
