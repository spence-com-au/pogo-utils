/**
 * A query as a tree: pills in nested groups, each group asking for all of its parts or any of them.
 *
 * This is the page's whole state. The Builder draws it as cards, which is a tree two levels deep (`cards.js`), but a
 * typed query and a link can both arrive deeper, and every reader of a tree here takes any depth.
 *
 * **Negation is on the pill and nowhere else, and that is enough.** A group is `all` or `any` with no third state,
 * because De Morgan says a negated group is the other junction with its parts negated: `!(a&b)` is `!a,!b` and
 * `!(a,b)` is `!a&!b`. So a reader building `Any[!a, !b]` has written the first of those directly, every boolean
 * function is still reachable, and nothing here has to push a negation inwards — the tree is in negation normal form
 * the moment it is built. `clauses.js` is the whole of what happens to it afterwards.
 *
 * **A pill that asks nothing yet asks nothing.** A range pill with neither bound filled is one the reader has added
 * and not finished, and `leafText` answers null for it. `clauses.js` turns that into no clauses at all, which is the
 * same thing it does with a clause true of everything — so an unfinished pill drops out of an `all` and takes its
 * whole `any` with it, each of which is what the arithmetic says and what a reader would expect to see.
 *
 * Paths rather than ids are how the page names a node: `[2, 0]` is the first part of the third part of the root. They
 * are what a render already knows, so nothing has to mint an identity or keep one in step with the tree it describes.
 * The cost is that an edit has to rebuild the spine down to the node it changes, which is `update` below, and that a
 * path goes stale the moment something before it is taken out.
 */

import { RANGES_BY_ID, TERMS_BY_ID, type Range } from './terms.js';

/**
 * How deep a tree may be, which is one number because two readers build one: a fragment a stranger wrote and a typed
 * query. Each recurses as it descends, and the descent is what a pathological input exhausts — a link claiming ten
 * thousand groups would blow the stack before anything could refuse it — so this is checked on the way down rather
 * than measured afterwards.
 *
 * Two copies of the figure would let the fragment reader accept what the typed-query reader refuses, which reads as the
 * parser being broken rather than as the two disagreeing.
 */
export const NESTING = 64;

/** Which way a group joins its parts. `all` is the game's `&` and `any` its comma. */
export type Junction = 'all' | 'any';

/**
 * One pill. The three kinds are the three things in the catalogue that write differently: a term is a word the table
 * owns, a name is whatever the reader typed, and a range is a span written from its own prefix.
 */
export type Leaf =
  | { kind: 'term'; id: string; negated: boolean }
  | { kind: 'name'; text: string; negated: boolean }
  | { kind: 'range'; id: string; from: number | null; to: number | null; negated: boolean };

/** Several nodes, joined. */
export interface Group {
  kind: 'group';
  junction: Junction;
  parts: readonly Node[];
}

export type Node = Leaf | Group;

/** Where a node is: the index to take at each level, from the root down. The root itself is the empty path. */
export type Path = readonly number[];

/** Whether a node holds others, which is the one question the cards and the path edits below both keep asking. */
export const isGroup = (node: Node): node is Group => node.kind === 'group';

/**
 * An empty query, which is what the Clear button returns to and what a link that says nothing restores. The root is
 * `all` because the game's own string is a conjunction of clauses: a reader adding two pills to it means both.
 */
export const emptyTree = (): Group => ({ kind: 'group', junction: 'all', parts: [] });

/** A group holding these parts, for the presets and for a reader creating one. */
export const group = (junction: Junction, parts: readonly Node[] = []): Group => ({
  kind: 'group',
  junction,
  parts,
});

/**
 * A span wrapped in its range's own phrase, which sits in front of the numbers for every range but the three IVs: `cp`
 * writes `cp3000-` where `attack` writes `3-attack`. One function, so each of the four shapes below says which span it
 * is and not one of them says where the phrase goes.
 *
 * Exported because the catalogue's own chips want the same answer about a shape rather than a value — `spanned(range,
 * '{N}')` is `cp{N}` and `{N}attack`. Spelling that at the chip instead left every range with an empty `prefix`
 * sharing the dex's tooltip, so all three IVs advertised themselves as a dex span.
 */
export const spanned = (range: Range, span: string) => `${range.prefix}${span}${range.suffix ?? ''}`;

/**
 * What one pill writes into a clause, or null where it has nothing to write yet.
 *
 * Null is not a failure. A range with neither bound is a pill the reader has added and not filled, and a name that is
 * blank is the same; both ask nothing, and `clauses.js` reads that as the search for everything it is. A term whose id
 * names nothing in the table is the one case that is a fault, and it answers null too — a link that rotted past a
 * rename drops the pill it can no longer spell rather than writing a term the game will not match.
 *
 * A bound left empty is written as an open end rather than filled from the range's own floor or ceiling. The community
 * phrase list states both forms outright — "`{phrase}{N}-` matches values ≥ `{N}`", "`{phrase}-{N}` matches values ≤
 * `{N}`" — which is what an earlier reading here lacked: it filled the bound in because `cp3000-` only *may well* be
 * read the way it looks, and preferred a spelling that could not be read any other way.
 *
 * That preference is still the rule; it just no longer reaches the open ends. What it reaches instead is the nought the
 * same list makes an irregularity of: "If `{M}` is 0, the search is treated as `{phrase}{N}-` instead".
 *
 * Those are two cases and only the first is settled. A `{N}-0` *is* the span's own opposite, which is why `parse.js`
 * reads one as an open top rather than as a bound to swap round — `cp3000-0` is CP at or above 3000 and came back as
 * `cp0-3000`. A bare `-0` has no `{N}` for the rule to leave behind, so the rule and `{phrase}-{N}` both claim it and
 * the list settles neither; `text` below writes the one spelling a single rule claims and guesses at nothing.
 */
export function leafText(leaf: Leaf): string | null {
  const written = text(leaf);

  return written === null ? null : leaf.negated ? `!${written}` : written;
}

function text(leaf: Leaf): string | null {
  if (leaf.kind === 'term') {
    return TERMS_BY_ID.get(leaf.id)?.term ?? null;
  }

  if (leaf.kind === 'name') {
    return leaf.text.trim() || null;
  }

  const range = RANGES_BY_ID.get(leaf.id);

  if (!range || (leaf.from == null && leaf.to == null)) {
    return null;
  }

  const { from, to } = leaf;

  if (from == null) {
    /*
     * Two spans open at the bottom need no dash, and they are two tests rather than one because the two ranges whose
     * floor is not nought separate them — six of the eight make these the same test.
     *
     * A span open below the range's *own floor* is the single value sitting on it, `min` being the whole of what a
     * bound can be and `bounded` enforcing that on every builder — so `-1` is the dex number 1, and `year-2016` is
     * every catch there has ever been.
     *
     * And a nought is never written to the right of a dash whatever the floor is, because `-0` is the one spelling
     * *two* of the list's rules both claim: `{phrase}-{N}` makes it values at or below nought, where a `{M}` of nought
     * makes it `{phrase}{N}-` — which has no `{N}` here to leave behind — and the list does not say which rule wins.
     * `0` is claimed by `{phrase}{N}` alone, so it is the spelling with one reading, which is the whole of why it is
     * preferred. What the game actually answers for `-0` is not written down and is not guessed at here.
     */
    return to === 0 || to === (range.min ?? 0) ? spanned(range, `${to}`) : spanned(range, `-${to}`);
  }

  if (to == null) {
    return spanned(range, `${from}-`);
  }

  // A reader can type the higher number into the lower box, and two numbers describe a span whichever way round.
  const low = Math.min(from, to);
  const high = Math.max(from, to);

  // A span whose ends meet is the one number it holds, which is how the game reads a bare `{phrase}{N}` and two
  // characters shorter than saying it twice. The optimiser's dex collapse reaches this often — `charmander` inside
  // Gen 1 is one species, and `4-4` is a clumsy way to write `4`.
  return low === high ? spanned(range, `${low}`) : spanned(range, `${low}-${high}`);
}

/**
 * Whether a span pill takes in every value its range holds, and so cannot change what a query matches — `cp0-`,
 * `hp-500` and `buddy0-5` alike. Read off the range's own bounds rather than any one spelling, so it reaches a span
 * however it was arrived at: typed into the boxes, pasted, shared or picked. An open end reaches past its bound, and
 * two ends filled the wrong way round are the span `text` swaps them into.
 *
 * A `sparse` range is never whole, a span over all of it being the search for the species that hold one. Neither is a
 * span with no bounds, which writes nothing.
 *
 * The negation is not read: `!cp0-` is whole as much as `cp0-` is, and what each costs is for the caller to say.
 */
export function whole(leaf: Leaf): boolean {
  const range = leaf.kind === 'range' ? RANGES_BY_ID.get(leaf.id) : undefined;

  if (leaf.kind !== 'range' || !range || range.sparse || (leaf.from == null && leaf.to == null)) {
    return false;
  }

  const { from, to } = leaf;
  const low = from == null ? -Infinity : Math.min(from, to ?? from);
  const high = to == null ? Infinity : Math.max(to, from ?? to);

  return low <= (range.min ?? 0) && high >= range.max;
}

/** What a pill calls itself on screen, which is the chip's label for a term and the text itself for the other two. */
export function leafLabel(leaf: Leaf): string {
  if (leaf.kind === 'term') {
    return TERMS_BY_ID.get(leaf.id)?.label ?? leaf.id;
  }

  if (leaf.kind === 'name') {
    return leaf.text;
  }

  return RANGES_BY_ID.get(leaf.id)?.label ?? leaf.id;
}

/** The node a path names, or null where the path leads nowhere. */
export function nodeAt(root: Node, path: Path): Node | null {
  let node: Node | null = root;

  for (const index of path) {
    if (node === null || !isGroup(node)) {
      return null;
    }

    node = node.parts[index] ?? null;
  }

  return node;
}

/**
 * The tree with one node changed, or taken out where `change` answers null. The spine down to it is rebuilt and
 * everything else is the node it already was, which is what lets a render decide what to redraw by identity.
 *
 * Changing the root is `update(root, [], …)`, and taking the root out is refused: the cards have to have something to
 * be the parts of, and an empty root group is how a query says nothing.
 */
export function update(root: Node, path: Path, change: (node: Node) => Node | null): Node {
  if (path.length === 0) {
    return change(root) ?? root;
  }

  const [index, ...rest] = path;

  if (index === undefined || !isGroup(root) || root.parts[index] === undefined) {
    return root;
  }

  const changed = rest.length === 0 ? change(root.parts[index]) : update(root.parts[index], rest, change);
  const parts = changed === null ? root.parts.toSpliced(index, 1) : root.parts.with(index, changed);

  return { ...root, parts };
}
