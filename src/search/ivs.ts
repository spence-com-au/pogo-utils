/**
 * The IV percentage pill: a comparison against the percentage PGSharp prints, written out as the game's own IV terms.
 *
 * The game has no percentage term. It sees IVs only in the bands its appraisal draws — stars for the sum of the three,
 * `0*` to `4*`, and a bar for each one alone, `0attack` to `4attack` — so to the search box a Pokémon is one of the
 * cells those bands cut storage into. 14/14/12 and 14/14/13 are both 3★ with every bar on 3, and no string takes one
 * without the other, so a percentage falling inside a cell cannot be written exactly.
 *
 * **So the pill never misses.** It writes the narrowest string taking every Pokémon the comparison holds for, which is
 * every cell holding one, and `ivNote` says what else that brings in. A list a little too long is one the appraisal
 * settles; one that left out a Pokémon it asked for leaves the reader nothing to check.
 *
 * The percentage is PGSharp's, `floor((a + d + s) / 45 * 100)` as `confirmed` in `tools/inventory/overlay.mts` reads
 * it, so `= 95%` is the IVs summing to 43, which the overlay shows as 95%.
 */

import type { Group, Leaf, Node } from './tree.js';
import type { Range, RangeId } from './terms.js';

/**
 * Where each band starts, which is everything the game reads of an IV. The community phrase list gives `0=0, 1=1-5,
 * 2=6-10, 3=11-14, 4=15` for one IV and `0=0-22, 1=23-29, 2=30-36, 3=37-44, 4=45` for the stars.
 */
const BARS = [0, 1, 6, 11, 15];
const STARS = [0, 23, 30, 37, 45];

/** The three IVs' ranges, in the order a cell holds their bars after its stars. */
const STATS: readonly RangeId[] = ['ivattack', 'ivdefense', 'ivhp'];

const TOP = BARS.length - 1;

/** Every sum three IVs can come to. */
const SUMS = Array.from({ length: 46 }, (_, sum) => sum);

/** The percentage box's limits, a `Range` so the box and the link clamp it as they clamp a span. */
export const PERCENT: Range = { id: 'ivpercent', prefix: '', label: 'IV percentage', max: 100 };

interface Compare {
  id: string;
  sign: string;
  words: string;
  opposite: string;
  holds: (value: number, percent: number) => boolean;
}

/**
 * The comparisons a pill can make: the id a link carries, the sign it is drawn with, and the words a note uses for it
 * and for the pill ruled out, which is the comparison turned round rather than a "not" in front of it.
 */
export const COMPARISONS = [
  { id: 'gt', sign: '>', words: 'above', opposite: 'at or below', holds: (value, percent) => value > percent },
  { id: 'ge', sign: '≥', words: 'at or above', opposite: 'below', holds: (value, percent) => value >= percent },
  { id: 'eq', sign: '=', words: 'at', opposite: 'other than', holds: (value, percent) => value === percent },
  { id: 'le', sign: '≤', words: 'at or below', opposite: 'above', holds: (value, percent) => value <= percent },
  { id: 'lt', sign: '<', words: 'below', opposite: 'at or above', holds: (value, percent) => value < percent },
] as const satisfies readonly Compare[];

export type Comparison = (typeof COMPARISONS)[number]['id'];

export type IvLeaf = Extract<Leaf, { kind: 'iv' }>;

/** The percentage PGSharp prints for IVs summing to this. */
const shown = (sum: number) => Math.floor((sum * 100) / 45);

const band = (starts: readonly number[], value: number) => starts.findLastIndex((start) => start <= value);

/** A cell's place in `CELLS`: its stars, then each IV's bar, as the digits of a number in base five. */
const place = (bands: readonly number[]) => bands.reduce((at, one) => at * BARS.length + one, 0);

/**
 * Every cell the search box can tell apart, each with the sums of the IVs inside it. Most are empty — no 0★ has three
 * bars on 4 — and an empty cell is one a clause is free to rule out or not.
 */
const CELLS: readonly (readonly number[])[] = (() => {
  const cells: Set<number>[] = Array.from({ length: BARS.length ** 4 }, () => new Set());

  for (let attack = 0; attack <= 15; attack += 1) {
    for (let defense = 0; defense <= 15; defense += 1) {
      for (let hp = 0; hp <= 15; hp += 1) {
        const sum = attack + defense + hp;
        const bands = [band(STARS, sum), band(BARS, attack), band(BARS, defense), band(BARS, hp)];

        cells[place(bands)]?.add(sum);
      }
    }
  }

  return cells.map((sums) => [...sums]);
})();

/** A run of bands, `[low, high]`, which is what one side of a box is cut to. */
type Run = readonly [number, number];

/** Every run five bands hold, fifteen of them. A box is four indices into these: its stars, then each IV's bar. */
const RUNS: readonly Run[] = BARS.flatMap((_, low) => BARS.slice(low).map((__, step): Run => [low, low + step]));

const run = (index: number): Run => RUNS[index] ?? [0, TOP];

/** The six orders a box's three IVs can be put in, its stars staying first. */
const ORDERS = [
  [0, 1, 2, 3],
  [0, 1, 3, 2],
  [0, 2, 1, 3],
  [0, 2, 3, 1],
  [0, 3, 1, 2],
  [0, 3, 2, 1],
];

/** Each run's index one band wider below it and above it, or -1 where it already reaches that end. */
const WIDER = RUNS.map(([low, high]) =>
  [
    [low - 1, high],
    [low, high + 1],
  ].map(([from, to]) => RUNS.findIndex(([one, two]) => one === from && two === to)),
);

/** The summed-volume table's side, one wider than the bands for the corner below the lowest, and its strides. */
const EDGE = BARS.length + 1;
const STRIDES = [EDGE ** 3, EDGE ** 2, EDGE, 1];

/**
 * Each run's two faces on each axis as offsets into the table, `[axis][run][side]` laid out flat: the corner below its
 * lowest band and the one past its highest. A box's sixteen corners are sums of these, so counting one allocates
 * nothing.
 */
const FACES = Int32Array.from(
  STRIDES.flatMap((stride) => RUNS.flatMap(([low, high]) => [low * stride, (high + 1) * stride])),
);

/**
 * A box of cells, its stars and then each IV's bar cut to a run. A clause rules a box out, offering every band outside
 * it: the box of 0★ to 2★ with every bar on anything is the clause `3*,4*`.
 */
interface Box {
  runs: readonly Run[];
  cells: readonly number[];
  offered: number;
}

/** The bands outside a run, as the runs either side of it. */
const outside = ([low, high]: Run): Run[] => [
  ...(low > 0 ? [[0, low - 1] as const] : []),
  ...(high < TOP ? [[high + 1, TOP] as const] : []),
];

/** The cells inside a box, by their place. */
function inside(runs: readonly Run[]): number[] {
  return runs.reduce<number[]>(
    (places, [low, high]) =>
      places.flatMap((at) => Array.from({ length: high - low + 1 }, (_, step) => at * BARS.length + low + step)),
    [0],
  );
}

/**
 * How many of the marked cells a box holds, read off a summed-volume table: each entry counts every cell between the
 * origin and it, so a box is the sixteen corners around it added and taken away in turn. Sixteen lookups a box rather
 * than one per cell, which is the difference between this answering as a percentage is typed and not.
 */
function counter(marked: readonly boolean[]): (box: readonly number[]) => number {
  const table = new Int32Array(EDGE ** 4);

  marked.forEach((mark, at) => {
    const corner = STRIDES.reduce(
      (index, stride, axis) => index + ((Math.floor(at / BARS.length ** (3 - axis)) % BARS.length) + 1) * stride,
      0,
    );

    table[corner] = mark ? 1 : 0;
  });

  for (const stride of STRIDES) {
    for (let index = 0; index < table.length; index += 1) {
      if (Math.floor(index / stride) % EDGE > 0) {
        table[index] = (table[index] ?? 0) + (table[index - stride] ?? 0);
      }
    }
  }

  // Plain loops rather than a callback per corner: this runs for every one of the fifty thousand boxes.
  return (box) => {
    let total = 0;

    for (let corners = 0; corners < 16; corners += 1) {
      let index = 0;
      let sign = 1;

      for (let axis = 0; axis < STRIDES.length; axis += 1) {
        const below = (corners >> axis) % 2 === 1;

        index += FACES[((axis * RUNS.length + (box[axis] ?? 0)) << 1) + (below ? 0 : 1)] ?? 0;
        sign = below ? -sign : sign;
      }

      total += sign * (table[index] ?? 0);
    }

    return total;
  };
}

/** What a pill's comparison comes to over storage: the clauses ruling out every cell it holds for none of. */
interface Cut {
  boxes: readonly Box[];

  /** The percentages the string takes that the comparison does not hold for. */
  extra: readonly number[];

  /** Whether the comparison holds for no IVs at all, or for every one. */
  none: boolean;
  every: boolean;
}

const cuts = new Map<string, Cut>();

/**
 * The boxes ruling out every cell holding nothing the comparison wants, found greedily: the box ruling out the most
 * cells still in, and the fewest alternatives between equals. A box holding a cell the comparison wants is never
 * taken, which is what makes the string never miss; covering every other cell is what makes it the narrowest.
 *
 * Kept by the sums wanted rather than by the comparison, so `≥ 90%` and `> 88%`, which want the same sums, are worked
 * out once between them.
 */
function cut(compare: Comparison, percent: number, negated: boolean): Cut {
  const { holds } = COMPARISONS.find(({ id }) => id === compare) ?? COMPARISONS[0];
  const wanted = (sum: number) => holds(shown(sum), percent) !== negated;
  const key = SUMS.map((sum) => (wanted(sum) ? 1 : 0)).join('');
  const known = cuts.get(key);

  if (known) {
    return known;
  }

  const taken = CELLS.map((sums) => sums.some(wanted));
  const left = CELLS.map((sums, at) => sums.length > 0 && !taken[at]);
  const open = new Set(left.flatMap((out, at) => (out ? [at] : [])));
  const holding = counter(taken);
  const leaving = counter(left);
  const free = (box: readonly number[]) => holding(box) === 0;

  // Only a box that cannot reach a band further on any side, which rules out at least what any box inside it does and
  // offers no more alternatives to.
  const grows = (box: readonly number[]) =>
    box.some((index, axis) => WIDER[index]?.some((wider) => wider >= 0 && free(box.with(axis, wider))));

  const boxes: Box[] = [];

  /*
   * A comparison of the sum alone treats the three IVs alike, so a box is free exactly when it is with its IVs' runs
   * in any other order. Only the runs in order are tried, then, and each box found is taken in every order it has —
   * a fifth of the boxes to count.
   */
  for (let stars = 0; stars < RUNS.length; stars += 1) {
    for (let attack = 0; attack < RUNS.length; attack += 1) {
      for (let defense = attack; defense < RUNS.length; defense += 1) {
        for (let hp = defense; hp < RUNS.length; hp += 1) {
          const box = [stars, attack, defense, hp];

          if (free(box) && leaving(box) > 0 && !grows(box)) {
            const orders = new Set(ORDERS.map((order) => order.map((at) => box[at] ?? 0).join()));

            for (const order of orders) {
              const runs = order.split(',').map((index) => run(Number(index)));
              const [low, high] = run(stars);

              // Each star outside the run is a term of its own, where an IV's bars outside it are a span either side.
              const offered = TOP - high + low + runs.slice(1).flatMap(outside).length;

              boxes.push({ runs, cells: inside(runs), offered });
            }
          }
        }
      }
    }
  }

  const chosen: Box[] = [];

  while (open.size > 0) {
    let best: { box: Box; gain: number } | null = null;

    for (const box of boxes) {
      const gain = box.cells.filter((at) => open.has(at)).length;

      if (gain > 0 && (best === null || gain > best.gain || (gain === best.gain && box.offered < best.box.offered))) {
        best = { box, gain };
      }
    }

    if (best === null) {
      break;
    }

    chosen.push(best.box);
    best.box.cells.forEach((at) => open.delete(at));
  }

  // The stars first, then the shortest clauses, then each IV in turn: the order a reader checks one against the
  // appraisal in, the star rating first and the bars after it.
  const rank = (box: Box) => {
    const at = box.runs.findIndex(([low, high]) => low > 0 || high < TOP);

    return [at === 0 ? 0 : 1, box.offered, at, box.runs[at]?.[0] ?? 0];
  };

  chosen.sort((one, two) => {
    const [mine, theirs] = [rank(one), rank(two)];

    return mine.map((value, at) => value - (theirs[at] ?? 0)).find((difference) => difference !== 0) ?? 0;
  });

  const taking = CELLS.flatMap((sums, at) => (taken[at] ? sums : []));
  const extra = [...new Set(taking.filter((sum) => !wanted(sum)).map(shown))].sort((one, two) => one - two);

  const found = { boxes: chosen, extra, none: !SUMS.some(wanted), every: SUMS.every(wanted) };

  cuts.set(key, found);

  return found;
}

/** One box ruled out, as the clause offering every band outside it. */
function clauseOf(box: Box): Group {
  const [stars, ...bars] = box.runs;

  const offered: Leaf[] = [
    ...(stars ? outside(stars) : []).flatMap(([low, high]) =>
      Array.from({ length: high - low + 1 }, (_, step): Leaf => ({
        kind: 'term',
        id: `star${low + step}`,
        negated: false,
      })),
    ),
    ...bars.flatMap((bar, at) =>
      outside(bar).map(([low, high]): Leaf => ({
        kind: 'range',
        id: STATS[at] ?? 'ivhp',

        // Open at the end a run reaches, which `leafText` writes as `3-attack` and `-2attack`.
        from: low === high || low > 0 ? low : null,
        to: low === high || high < TOP ? high : null,
        negated: false,
      })),
    ),
  ];

  return { kind: 'group', junction: 'any', parts: offered };
}

/**
 * What an IV percentage pill asks, as the clauses the game reads. A pill with no percentage yet asks nothing, and so
 * does one taking every Pokémon or holding for none: an `all` of no clauses or a clause of no alternatives, which
 * `clauses.js` reads as the search for everything and leaves out of the string.
 */
export function ivTree(leaf: IvLeaf): Node {
  if (leaf.percent === null) {
    return { kind: 'group', junction: 'all', parts: [] };
  }

  return { kind: 'group', junction: 'all', parts: cut(leaf.compare, leaf.percent, leaf.negated).boxes.map(clauseOf) };
}

/** What a pill's string comes to beyond what it asks for, in words for its card, or null where it is exact. */
export function ivNote(leaf: IvLeaf): string | null {
  if (leaf.percent === null) {
    return null;
  }

  const { boxes, extra, none, every } = cut(leaf.compare, leaf.percent, leaf.negated);
  const comparison = COMPARISONS.find(({ id }) => id === leaf.compare);
  const said = `${(leaf.negated ? comparison?.opposite : comparison?.words) ?? ''} ${leaf.percent}%`;
  const [low] = extra;
  const high = extra.at(-1);

  if (none) {
    return `No Pokémon is ${said}, so the string leaves this out.`;
  }

  if (every) {
    return `Every Pokémon is ${said}, so the string leaves this out.`;
  }

  if (boxes.length === 0) {
    return 'The game reads IVs only in bands, so this takes in every Pokémon and the string leaves it out.';
  }

  if (low === undefined || high === undefined) {
    return null;
  }

  return `The game reads IVs only in bands, so this also finds some at ${low === high ? low : `${low}–${high}`}%.`;
}
