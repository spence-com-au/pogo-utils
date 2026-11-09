/**
 * The flag passes, driven over a storage made up of readings: each search holds the readings a test gives it, the
 * first opens as the first of them, and the walk visits them in turn up to however many it is let reach.
 */

import { type Detail } from './detail.mts';
import { type Overlay } from './overlay.mts';
import { flagPasses } from './passes.mts';
import { keyOf, type Flag } from './scan.mts';
import { expect, test } from 'vitest';

interface Shown {
  key: string | null;
  detail: Detail;
  overlay: Overlay | null;
}

/** A Pikachu read with `hp` and IVs of `attack`/15/15, which is a key of its own for each. */
function pikachu(hp: number | null, attack = 15): Shown {
  const detail: Detail = {
    cp: null,
    cps: [],
    name: 'Pikachu',
    hp,
    weight: 6.1,
    height: 0.41,
    types: ['Electric'],
    gender: null,
    favourite: false,
    lucky: false,
    size: null,
    tags: [],
    evolveCandy: null,
    powerUp: null,
    max: null,
  };
  const overlay: Overlay = { levels: [20], iv: { attack, defense: 15, stamina: 15 }, checked: true, form: null };

  return { key: keyOf(detail, overlay), detail, overlay };
}

/** What a search that matched nothing opens: storage again, which reads as no Pokémon at all. */
const UNREAD = pikachu(null);

/**
 * Storage whose searches hold what `holds` says, the game counting `counts` of them where it says otherwise, and a walk
 * that reaches `reach` Pokémon of a search at most. Answers the passes' marks, what they said and what they searched.
 */
async function passes(
  flags: readonly Flag[],
  term: string | undefined,
  holds: (term: string) => readonly Shown[],
  {
    counts = (found) => found.length,
    reach = Infinity,
  }: { counts?: (found: readonly Shown[]) => number | null; reach?: number } = {},
) {
  const searched: string[] = [];
  const said: string[] = [];
  let open: readonly Shown[] = [];

  const marked = await flagPasses(
    flags,
    term,
    {
      search: async (typed) => {
        searched.push(typed);
        open = holds(typed);

        // Each grid is a line naming the search it answers, which is all the fakes below look at.
        return [{ text: typed, left: 0, top: 0, width: 0, height: 0 }];
      },
      matches: () => counts(open),
      matched: () => open.length > 0,
      openFirst: async () => open[0] ?? UNREAD,
      walk: async (visit, total, max, from, first) => {
        const visits = [first, ...open.slice(1)].slice(0, Math.min(reach, max));

        for (const [index, reading] of visits.entries()) {
          await visit(reading, from + index);
        }

        return visits.length;
      },
    },
    (message) => said.push(message),
  );

  return { marked, said, searched };
}

test('each flag searches for itself, narrowed by `--search`, and marks what its walk read', async () => {
  const shiny = [pikachu(50, 1), pikachu(51, 2)];
  const lucky = [pikachu(52, 3)];
  const { marked, said, searched } = await passes(['shiny', 'lucky'], 'pikachu', (typed) =>
    typed === 'shiny&pikachu' ? shiny : typed === 'lucky&pikachu' ? lucky : [],
  );

  expect(searched).toStrictEqual(['shiny&pikachu', 'lucky&pikachu']);
  expect(said).toStrictEqual(['shiny: 2', 'lucky: 1']);

  // Each Pokémon its pass read is marked once, and one the pass did not read is not.
  const take = (flag: Flag, { detail, overlay }: Shown) => marked.get(flag)?.take(detail, overlay);

  expect(shiny.map((reading) => take('shiny', reading))).toStrictEqual([true, true]);
  expect(take('shiny', lucky[0] ?? expect.unreachable())).toBe(false);
  expect(take('lucky', lucky[0] ?? expect.unreachable())).toBe(true);
});

test('a flag searches for itself alone where there is no `--search`', async () => {
  const { searched } = await passes(['costume'], undefined, () => []);

  expect(searched).toStrictEqual(['costume']);
});

test('a search that matched nothing marks nothing, which writes `false` in every row', async () => {
  const { marked, said } = await passes(['shiny'], undefined, () => []);
  const { detail, overlay } = pikachu(50);

  expect(said).toStrictEqual(['shiny: 0']);
  expect(marked.get('shiny')?.take(detail, overlay)).toBe(false);
});

test('a search whose first Pokémon would not read is left out, which writes null in every row', async () => {
  const { marked, said } = await passes(['shiny', 'lucky'], undefined, (typed) =>
    typed === 'shiny' ? [UNREAD, pikachu(50)] : [pikachu(51)],
  );

  expect(said).toStrictEqual(['shiny: the first Pokémon would not read, so this field is left null', 'lucky: 1']);
  expect([...marked.keys()]).toStrictEqual(['lucky']);
});

test('a pass short of the count the game shows fails, rather than write `false` against the rest', async () => {
  const run = passes(['shiny'], undefined, () => [pikachu(50, 1), pikachu(51, 2), pikachu(52, 3)], { reach: 2 });

  await expect(run).rejects.toThrow(
    'shiny: the game counts 3 Pokémon, but the pass stopped after 2; marking only those would write `false` against ' +
      'the rest',
  );
});

test('a pass whose count did not read is taken as far as it went', async () => {
  const { marked, said } = await passes(['shiny'], undefined, () => [pikachu(50, 1), pikachu(51, 2)], {
    counts: () => null,
    reach: 1,
  });

  expect(said).toStrictEqual(['shiny: 1']);
  expect(marked.get('shiny')?.size).toBe(1);
});
