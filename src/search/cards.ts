/**
 * The query as the Builder draws it: a list of cards that all have to match, each holding pills of which any one will
 * do. That is the game's own shape — clauses joined by `&`, alternatives within one joined by `,` — so a card is a
 * clause, and the string above the cards is the cards as they stand rather than a rearrangement of them.
 *
 * In the tree, a card is one part of the root `all`: a pill on its own, or an `any` of pills. Nothing deeper, which is
 * what `asCards` holds every tree to on its way in — a link or a typed query with brackets in it arrives multiplied out
 * into the clauses `clauses.js` would have written it as anyway.
 */

import { spreadOut } from './clauses.js';
import { emptyTree, group, isGroup, type Group, type Leaf, type Node } from './tree.js';

/** The pills one card holds. */
export const pillsOf = (card: Node): readonly Leaf[] =>
  isGroup(card) ? card.parts.filter((part): part is Leaf => !isGroup(part)) : [card];

/** A card holding these pills, or nothing where there are none. A lone pill is a card itself, not an `any` of one. */
const cardOf = (pills: readonly Leaf[]): Node | null => {
  const [only] = pills;

  return only === undefined ? null : pills.length === 1 ? only : group('any', pills);
};

/** Whether a tree is already cards: an `all` at the root, and nothing under it deeper than an `any` of pills. */
const drawable = (tree: Node): tree is Group =>
  isGroup(tree) &&
  tree.junction === 'all' &&
  tree.parts.every((part) => !isGroup(part) || (part.junction === 'any' && part.parts.every((one) => !isGroup(one))));

/**
 * Any tree as cards, or null where it multiplies out past what a search box takes.
 *
 * A tree already in the shape is tidied rather than rewritten: an empty card goes and an `any` of one pill becomes that
 * pill, so every edit can pass through here and the link stays the shortest spelling of the cards on screen. Only a
 * deeper tree is spread out, and a pill asking nothing yet — a span with neither end set — is lost from one, there
 * being no clause for it to be written in.
 */
export function asCards(tree: Node): Group | null {
  const cards = drawable(tree) ? tree.parts.map(pillsOf) : spreadOut(tree);

  return cards === null
    ? null
    : group(
        'all',
        cards.map(cardOf).filter((card) => card !== null),
      );
}

/**
 * A tree as the cards the Builder draws. One spreading past what a search box takes has none: only a hand-made link
 * can arrive like that, the Advanced pane refusing such a query before it reaches here.
 */
export const cardsOf = (tree: Node): Group => asCards(tree) ?? emptyTree();

/** Which catalogue entry a pill is, which two pills are compared by: a term or a range by id, a name by its text. */
const entry = (leaf: Leaf) => (leaf.kind === 'name' ? `name:${leaf.text}` : `${leaf.kind}:${leaf.id}`);

/** Whether the card at `at` holds a pill for the same entry as this one. A card past the end holds nothing. */
export function holds(root: Group, at: number, leaf: Leaf) {
  const card = root.parts[at];

  return card !== undefined && pillsOf(card).some((pill) => entry(pill) === entry(leaf));
}

/**
 * The cards with one of them changed. `at` one past the last card is a new one, which is how *Add a filter* starts a
 * card without an empty one ever being in the tree, and a card left with no pills goes.
 */
function withPills(root: Group, at: number, change: (pills: readonly Leaf[]) => readonly Leaf[]): Group {
  const card = root.parts[at];
  const changed = cardOf(change(card === undefined ? [] : pillsOf(card)));

  if (card === undefined) {
    return changed === null ? root : { ...root, parts: [...root.parts, changed] };
  }

  return { ...root, parts: changed === null ? root.parts.toSpliced(at, 1) : root.parts.with(at, changed) };
}

/** A pill added to a card as one more alternative, unless the card already has one for that entry. */
export const added = (root: Group, at: number, leaf: Leaf) =>
  holds(root, at, leaf) ? root : withPills(root, at, (pills) => [...pills, leaf]);

/** A catalogue chip pressed for a card: its pill added where the card has none, and taken out where it has. */
export const toggled = (root: Group, at: number, leaf: Leaf) =>
  holds(root, at, leaf)
    ? withPills(root, at, (pills) => pills.filter((pill) => entry(pill) !== entry(leaf)))
    : withPills(root, at, (pills) => [...pills, leaf]);
