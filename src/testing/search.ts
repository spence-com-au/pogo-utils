/**
 * The trees a search test is written in, and the truth tables it checks them against.
 *
 * Shared rather than declared per file because a copy drifts, and a case copied between two files whose `named` or
 * `holds` disagree quietly asks a different question in its new home.
 */

import { RANGES } from '../search/terms.js';
import { group, isGroup, leafText, type Leaf, type Node } from '../search/tree.js';

/** A required pill, which is what a chip pressed in the catalogue becomes. */
export const yes = (id: string): Leaf => ({ kind: 'term', id, negated: false });

/** The same pill turned round, which is one press on its face. */
export const no = (id: string): Leaf => ({ kind: 'term', id, negated: true });

/** A name pill, which writes whatever the reader typed and so needs nothing from the term table. */
export const named = (text: string, negated = false): Leaf => ({ kind: 'name', text, negated });

export const all = (...parts: Node[]) => group('all', parts);
export const any = (...parts: Node[]) => group('any', parts);

/** A tree said in the shape a failure can be read in: every pill as its text, every group as its junction. */
export const shape = (node: Node): unknown =>
  isGroup(node) ? { [node.junction]: node.parts.map(shape) } : (leafText(node) ?? '…');

/** One range from the table, so a test pins the floor and ceiling its literals were derived from. */
export function range(id: string) {
  const found = RANGES.find((entry) => entry.id === id);

  if (!found) {
    throw new Error(`\`terms.js\` carries no ${id} range`);
  }

  return found;
}

/**
 * The question a tree asks of one Pokémon, which is the set of terms that are true of it. A group with nothing in it
 * asks nothing, and so does a pill with nothing written in it yet — both of which read as true here, since a search
 * for everything is what no constraint means. A name is one of the terms as much as a chip is, the game drawing no
 * distinction between a word the catalogue owns and the same word typed in; a span is the one kind no truth table asks
 * about.
 */
export function holds(node: Node, on: ReadonlySet<string>): boolean {
  if (!isGroup(node)) {
    const asked = node.kind === 'term' ? node.id : node.kind === 'name' ? node.text.trim() : '';

    return asked === '' || on.has(asked) !== node.negated;
  }

  if (node.parts.length === 0) {
    return true;
  }

  return node.junction === 'all'
    ? node.parts.every((part) => holds(part, on))
    : node.parts.some((part) => holds(part, on));
}

/** Every set of terms that could be true of one Pokémon, which is every subset of the ones a case mentions. */
export function* assignments(terms: readonly string[]) {
  for (let bits = 0; bits < 2 ** terms.length; bits += 1) {
    yield new Set(terms.filter((_, index) => (bits >> index) % 2 === 1));
  }
}
