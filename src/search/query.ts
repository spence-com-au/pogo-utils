/**
 * Turning the cards' arrangement into a search string, and back out of a link. Kept apart from the page so what the
 * string means is readable without the DOM around it — this is the part that has to be right, and it is the part a
 * reader will check against what the game does.
 *
 * The state is the tree and one toggle: everything a pill, a group, a name or a bound can say lives in the tree, the
 * arrangement now being the reader's. Nothing here holds a node of the document.
 */

import { clausesOf } from './clauses.js';
import { read as readTyped } from './parse.js';
import { emptyTree, group, isGroup, NESTING, type Leaf, type Node } from './tree.js';
import { bounded, RANGES_BY_ID, TERMS_BY_ID, type Preset } from './terms.js';

/** The state above, named. */
export interface State {
  tree: Node;
  optimise: boolean;
}

/** An empty state, which every reader of a link starts from and the Clear button returns to. */
export const emptyState = (): State => ({ tree: emptyTree(), optimise: false });

/**
 * The names a pasted string holds. Commas separate them, and the spaces a reader types around one are theirs rather
 * than part of the name. Exported because the page turns each into a pill of its own, so a pasted `pikachu, eevee`
 * arrives as two.
 *
 * A name is left otherwise alone, since the game matches partial names and a reader typing `char` means it.
 */
export const names = (text: string) =>
  text
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

/**
 * The search string, and whatever is worth saying about it.
 *
 * A string mixing `,` and `&` only means what the cards say it means if a comma binds tighter than an ampersand,
 * which the reference `clauses.js` cites states outright for this search box. So the page does not warn when a string
 * mixes the two: there is nothing to warn about.
 */
export function compose(state: State) {
  const { clauses, error, mishandled } = clausesOf(state.tree);

  return {
    query: clauses.join('&'),
    clauses: clauses.length,
    error,
    mishandled,
  };
}

/**
 * A link into the Search page asking for one name, which is what the Pokédex offers for a species and for its family.
 *
 * Built by writing a state out rather than by spelling the fragment, so the one place that knows the encoding is the
 * writer below: the Pokédex's link was `t=` while the name box was a box, and a fragment hand-made at the call site is
 * a fragment that goes on saying so after the page it points at has stopped reading it.
 */
export const nameFragment = (text: string) =>
  toFragment({ ...emptyState(), tree: group('all', [{ kind: 'name', text, negated: false }]) });

/**
 * The tree a preset describes: its query read as the page's box reads a typed one, or everything it excludes, ruled
 * out. A query that reads as nothing throws, as a missing range does below.
 *
 * An excluded span's top bound is null because the span has none: `leafText` writes that as the open end the phrase
 * list spells `{phrase}{N}-`, so *ever buddied* is `buddy1-` rather than a ceiling this would have to name and the
 * table already carries.
 *
 * The bottom bound goes through `bounded` like every other span this page builds. A preset is written here rather than
 * by a reader, so the bound is only ever wrong by this repository's own mistake — but an unclamped one would compose a
 * string the link beside it disagrees with, `fromFragment` clamping what it reads back, and that is the one failure
 * `bounded` exists to rule out.
 *
 * A range the table does not carry throws rather than answering a pill with no bounds, which `leafText` would write as
 * nothing and drop out of the clauses in silence. `RangeId` already makes that unreachable; what the throw is for is
 * that the silent form is unreachable *too*, and this is the one string where an exclusion going missing costs a
 * shiny. `optimise.js` refuses the missing `dex` range the same way.
 */
export const presetTree = (preset: Preset): Node => {
  if ('query' in preset) {
    const { tree, error } = readTyped(preset.query);

    if (!tree) {
      throw new Error(`${preset.label} reads as no search: ${error ?? 'its query is empty'}`);
    }

    return tree;
  }

  return group(
    'all',
    preset.exclude.map((one): Leaf => {
      if (typeof one === 'string') {
        return { kind: 'term', id: one, negated: true };
      }

      const range = RANGES_BY_ID.get(one.range);

      if (!range) {
        throw new Error(`\`terms.js\` carries no ${one.range} range`);
      }

      return { kind: 'range', id: one.range, from: bounded(one.from, range), to: null, negated: true };
    }),
  );
};

/**
 * A name as a token carries it. `encodeURIComponent` leaves `_` and `!` alone and the reader below takes both for its
 * own, so those two are escaped by hand on top. `_` separates the tokens, so a nickname holding one would otherwise end
 * the token early and the rest of the name would read as a pill of its own. `!` at a token's head is what rules a pill
 * out, so a name typed as `!pikachu` would otherwise write the token a ruled-out `pikachu` does and come back as one.
 *
 * Which only holds because the whole stream is escaped again on its way into the fragment. `URLSearchParams` decodes
 * the value it hands back, so a `%5F` written straight into the link arrives as the `_` it was standing in for and the
 * name is split anyway: `my_shiny` came back as `my`. Escaping the stream means the reader below is handed the stream
 * as it was written, `%5F` and all.
 */
const encodeName = (text: string) => encodeURIComponent(text).replaceAll('_', '%5F').replaceAll('!', '%21');

/**
 * The tree as tokens. A group writes how it joins and *how many parts it has*, rather than opening and closing a
 * bracket: an arity needs no matching, so the reader below is a descent with a counter where a bracketed form would
 * want a stack and a story about what an unbalanced link means.
 *
 * Every character used here — the letters, the digits, `!`, `.` and the `_` between tokens — is one a fragment carries
 * as itself, so only a name is escaped and a link stays legible. No range id or term id holds a `.`, which is what
 * lets a range write its two bounds without one.
 */
function tokens(node: Node): string[] {
  if (isGroup(node)) {
    return [`${node.junction === 'all' ? 'A' : 'O'}${node.parts.length}`, ...node.parts.flatMap(tokens)];
  }

  const not = node.negated ? '!' : '';

  if (node.kind === 'term') {
    return [`T${not}${node.id}`];
  }

  if (node.kind === 'name') {
    return [`N${not}${encodeName(node.text)}`];
  }

  return [`R${not}${node.id}.${node.from ?? ''}.${node.to ?? ''}`];
}

/**
 * The state as a link fragment, and back.
 *
 * `s=1` is the optimiser being on, so a link arrives showing the string its sender was looking at. It carries only the
 * toggle and never the compression: the arrangement travels as itself, and the short string is composed again at the
 * other end from a tree that still says `charmander`.
 */
export function toFragment(state: State) {
  const parts = [];
  const written = tokens(state.tree);

  // An empty root group is a query that says nothing, and a link saying nothing is better off saying it with no key.
  if (written.length > 1) {
    parts.push(`q=${encodeURIComponent(written.join('_'))}`);
  }

  if (state.optimise) {
    parts.push('s=1');
  }

  return parts.join('&');
}

/** A bound from a link, which is whatever a stranger put there: a number inside the range's limits, or nothing. */
function bound(text: string | undefined, id: string) {
  const range = RANGES_BY_ID.get(id);
  const value = Number.parseInt(text ?? '', 10);

  return !range || Number.isNaN(value) ? null : bounded(value, range);
}

/**
 * One node from the tokens, or null where the token describes nothing the tables carry. A dropped pill is the same
 * answer the earlier fragment reader gave an id that named no term: a link that has rotted past a rename restores the
 * pills that still mean something rather than failing whole.
 *
 * A group always consumes the parts it declared, dropped or not, so one bad pill cannot shift everything after it. The
 * count is clamped to the tokens actually left, so a link claiming a billion parts is a short tree rather than a hang.
 */
function read(all: readonly string[], at: { index: number }, depth: number): Node | null {
  const token = all[at.index];

  at.index += 1;

  if (token === undefined) {
    return null;
  }

  const kind = token[0];
  const rest = token.slice(1);
  const negated = rest.startsWith('!');
  const body = negated ? rest.slice(1) : rest;

  if (kind === 'A' || kind === 'O') {
    const declared = Number.parseInt(rest, 10);
    const count = Number.isNaN(declared) ? 0 : Math.max(0, Math.min(declared, all.length - at.index));

    // Checked before descending rather than after, the descent itself being what a deep link would exhaust.
    if (depth >= NESTING) {
      at.index += count;

      return null;
    }

    const parts = Array.from({ length: count }, () => read(all, at, depth + 1)).filter((part) => part !== null);

    return group(kind === 'A' ? 'all' : 'any', parts);
  }

  if (kind === 'T') {
    return TERMS_BY_ID.has(body) ? { kind: 'term', id: body, negated } : null;
  }

  if (kind === 'N') {
    const text = decodeName(body);

    return text ? { kind: 'name', text, negated } : null;
  }

  if (kind === 'R') {
    const [id, from, to] = body.split('.');

    return id !== undefined && RANGES_BY_ID.has(id)
      ? { kind: 'range', id, from: bound(from, id), to: bound(to, id), negated }
      : null;
  }

  return null;
}

/** A name back out of a fragment. A stranger can write a `%` that decodes to nothing, which reads as no pill at all. */
function decodeName(body: string) {
  try {
    return decodeURIComponent(body).trim();
  } catch {
    return '';
  }
}

/**
 * The state a fragment describes. Every part is checked against the tables rather than trusted, so a link that has
 * rotted past a renamed id or been typed by hand restores what still means something instead of failing whole.
 *
 * The root is a group whatever arrives, the cards having to have something to be the parts of. A fragment this wrote
 * always names one; a hand-made one naming a single pill is wrapped rather than thrown away.
 */
export function fromFragment(fragment: string) {
  const state = emptyState();
  const params = new URLSearchParams(fragment);

  state.optimise = params.get('s') === '1';

  const written = params.get('q');

  if (written) {
    const root = read(written.split('_'), { index: 0 }, 0);

    state.tree = root === null ? emptyTree() : isGroup(root) ? root : group('all', [root]);
  }

  return state;
}
