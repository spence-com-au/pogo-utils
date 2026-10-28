/**
 * Where the national dex divides into generations: each generation number beside the first and last dex number it
 * covers. A fact about the games rather than about either page that reads it, which is why it lives here — the search
 * builder renders it as the `1-151` the game's search box takes and the Pokédex reads the bounds to label a card, and
 * neither owns the boundaries themselves.
 *
 * The bounds are numbers rather than a rendered `'1-151'`, so the one consumer that wants that string writes it and the
 * other compares dex numbers without parsing it back out again.
 *
 * The last generation's `last` is the dex itself, and moves when a generation is added to the game.
 */
export const GENERATIONS: readonly { number: number; first: number; last: number; region: string }[] = [
  { number: 1, first: 1, last: 151, region: 'Kanto' },
  { number: 2, first: 152, last: 251, region: 'Johto' },
  { number: 3, first: 252, last: 386, region: 'Hoenn' },
  { number: 4, first: 387, last: 493, region: 'Sinnoh' },
  { number: 5, first: 494, last: 649, region: 'Unova' },
  { number: 6, first: 650, last: 721, region: 'Kalos' },
  { number: 7, first: 722, last: 809, region: 'Alola' },
  { number: 8, first: 810, last: 905, region: 'Galar' },
  { number: 9, first: 906, last: 1025, region: 'Paldea' },
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
export const regionsOf = (generation: number) => {
  const row = GENERATIONS.find(({ number }) => number === generation);

  return row === undefined
    ? `Generation ${generation}`
    : [
        row.region,
        ...SUB_REGIONS.filter(({ first }) => first >= row.first && first <= row.last).map((r) => r.region),
      ].join(' & ');
};
