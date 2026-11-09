/**
 * The flag passes `pnpm inventory scan` makes before its full pass: one search a flag, walked to its end, whose
 * Pokémon the full pass then knows by their keys. Here rather than in the script so the suite can drive them against
 * a storage it makes up, the script reaching storage and the walk only through what it hands in.
 */

import { type Line } from './ocr.mts';
import { Marks, shortfall, type Flag, type Reading } from './scan.mts';

/** What a pass needs of storage, as `storage` answers it, and of the walk the script makes over the phone. */
export interface Passing<R extends Pick<Reading, 'key' | 'detail' | 'overlay'>> {
  search: (term: string) => Promise<Line[]>;
  matches: (grid: readonly Line[]) => number | null;
  matched: (grid: readonly Line[]) => boolean;

  /** Opens the first Pokémon the grid shows and reads it, answering a reading with no key where none would read. */
  openFirst: (grid: readonly Line[]) => Promise<R>;

  /** Visits each Pokémon from the one open, `first`, of `total` the game counts, answering how many it visited. */
  walk: (
    visit: (reading: R, index: number) => Promise<void>,
    total: number | null,
    max: number,
    from: number,
    first: R,
  ) => Promise<number>;
}

/**
 * The Pokémon each flag's search holds, by flag, `term` narrowing every search as `--search` narrows the full pass. A
 * flag is left out where its search matched Pokémon and the first would not read, which leaves the field null in every
 * row rather than `false`; a search that matched nothing marks nothing, which is every row's `false`.
 *
 * Throws where a pass stops short of the count the game shows for its search: what cut it short would cut the full
 * pass short too, which is hours of phone time to find that out in.
 */
export async function flagPasses<R extends Pick<Reading, 'key' | 'detail' | 'overlay'>>(
  flags: readonly Flag[],
  term: string | undefined,
  { search, openFirst, walk, matches, matched }: Passing<R>,
  say: (message: string) => void = console.error,
): Promise<Map<Flag, Marks>> {
  const marked = new Map<Flag, Marks>();

  for (const flag of flags) {
    const marks = new Marks();
    const grid = await search(term === undefined ? flag : `${flag}&${term}`);
    const first = await openFirst(grid);

    if (first.key !== null) {
      const total = matches(grid);
      const visited = await walk(async ({ detail, overlay }) => marks.add(detail, overlay), total, Infinity, 0, first);
      const short = shortfall(flag, visited, total);

      if (short) {
        throw new Error(`${short}; marking only those would write \`false\` against the rest`);
      }
    } else if (matched(grid)) {
      // The search matched Pokémon and the first would not read, which is not the answer a search matching nothing
      // gives: marking nothing would write `false` against every Pokémon the search holds. So the field is left null
      // instead.
      say(`${flag}: the first Pokémon would not read, so this field is left null`);
      continue;
    }

    say(`${flag}: ${marks.size}`);
    marked.set(flag, marks);
  }

  return marked;
}
