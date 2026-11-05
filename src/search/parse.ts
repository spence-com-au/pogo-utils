/**
 * A typed search read back into an arrangement.
 *
 * This is the inverse of `clauses.js`, and the reason it exists is that the inverse is the easy direction: a reader can
 * write the search they mean with brackets in it, and the page can put the pills where the brackets say and let the
 * composer write out something the game will take. `(pikachu&shiny),(pumpkaboo&xxl)` arrives as two groups inside an
 * `any` and leaves as the four clauses the game needs.
 *
 * What it is *not* is a second composer. Nothing here writes a string; it writes a tree, the cards draw it, and the one
 * composer takes it from there. So a typed query is an import rather than another way to ask the same question — the
 * pills land on the cards and can be edited afterwards like any others.
 *
 * **The operators are the game's own, and both sources agree on them.** Niantic's list groups `|` with `&` as an AND,
 * and the community phrase list says it outright: "`&` or `|` — AND combination", "`,` or `;` or `:` — OR combination".
 * `pkgosearch.com` reads `|` as an OR, but two lists against one converter are enough to accept it as an AND.
 *
 * A negation is carried down rather than kept as a node, which is De Morgan's law applied while reading: a negated
 * `all` is an `any` of negated parts. That is not a convenience but the whole of why this fits — `tree.js` keeps
 * negation on the pills and has no negated group, so a tree whose only negations are on its leaves is the only kind
 * the cards can draw.
 */

import { bounded, GROUPS, RANGES, RANGES_BY_ID, SHORTCUTS, SPAN, type Range } from './terms.js';
import { group, NESTING, type Junction, type Leaf, type Node } from './tree.js';

/** The punctuation, and what each piece of it is. Everything else is part of a term. */
const PUNCTUATION: Record<string, Token['kind']> = {
  '&': 'all',
  '|': 'all',
  ',': 'any',
  ';': 'any',
  ':': 'any',
  '!': 'not',
  '(': 'open',
  ')': 'close',
};

interface Token {
  kind: Junction | 'not' | 'open' | 'close' | 'term';
  text: string;
}

/** Every catalogue term by the text the game reads it as, which is what a reader will have typed. */
const IDS_BY_TERM = new Map(GROUPS.flatMap((category) => category.terms).map((term) => [term.term, term.id]));

/** What a typed query came to, for the page to put on the cards or to complain about. */
export interface Read {
  tree: Node | null;
  error: string | null;
}

/**
 * The span inside a range's own phrase, or null where the text is not that range's at all. The phrase is in front of
 * the numbers for every range but the three IVs, which carry it behind, so `cp3000-` and `3-defense` are one shape read
 * from either end.
 *
 * The phrase is matched folded, the game being case-insensitive, while the span is cut out of the text as it was typed:
 * digits read the same either way, and a word that matches no range falls through to a name that keeps its capitals.
 */
function inside(text: string, range: Range): string | null {
  const folded = text.toLowerCase();
  const suffix = range.suffix ?? '';

  if (!folded.startsWith(range.prefix) || !folded.endsWith(suffix)) {
    return null;
  }

  return text.slice(range.prefix.length, text.length - suffix.length);
}

/**
 * The pill a word becomes.
 *
 * A catalogue term is tried first, so `shiny` arrives as the Status pill rather than as a name that happens to read
 * the same — which matters because the chip above it then shows as required, and the pill carries its category's
 * colour. It beats the ranges and the shortcuts too, which is where the three overlap: `1-151` is both the Gen 1 term
 * and a dex span, and `dynamax` both a Mega and Max chip and the shortcut for `dynamax1-`. Each pair asks the same
 * thing, and in each the chip is the pill worth drawing — it says *Gen 1*, and it is the shorter of the two.
 *
 * Anything left is a name, which is what the game does with it: a word it does not know is matched against the names
 * and nicknames in storage.
 */
function pill(text: string, negated: boolean): Leaf {
  const term = IDS_BY_TERM.get(text.toLowerCase());

  if (term !== undefined) {
    return { kind: 'term', id: term, negated };
  }

  /*
   * A shortcut phrase is the span it stands for, which is the game's own reading of it and so the one this has to
   * take: `terms.js` lists the four and says why none is written back out. The two that are chips were matched above,
   * leaving `mega` and `count` — and a bound this repository wrote still goes through `bounded`, a pill out of any of
   * the readers having to be one the other readers could have made.
   */
  const shortcut = SHORTCUTS.find((one) => one.phrase === text.toLowerCase());
  const stands = shortcut ? RANGES_BY_ID.get(shortcut.range) : undefined;

  if (shortcut && stands) {
    return { kind: 'range', id: stands.id, from: bounded(shortcut.from, stands), to: null, negated };
  }

  for (const range of RANGES) {
    const tail = inside(text, range);
    const [, low, dash, high] = (tail === null ? null : SPAN.exec(tail)) ?? [];

    /*
     * A match with neither bound is not a span: `cp` alone, and the `-` the dex range sees in any text holding one.
     * It is also the whole of why the table needs no ordering where one prefix starts another — `countcandy248-` has
     * `candy248-` for its `count` tail, which is no number, so the range it really names is the one that takes it.
     */
    if (low === undefined && high === undefined) {
      continue;
    }

    /*
     * Which ends the dash leaves open. One stays open rather than being filled from the range, which is what lets the
     * writer put the same string back: a `cp3000-` read as `cp3000-5000` would come out spelled the other way. Without
     * a dash there is no open end at all — a bare `{phrase}{N}` is the one value, which is both bounds at once.
     *
     * A nought on the right of the dash opens the top too, that being the one irregularity the phrase list records:
     * "If `{M}` is 0, the search is treated as `{phrase}{N}-` instead". Read as the bound it looks like, `cp3000-0`
     * came back as the *complementary* half of the range — the swap below saw 3000 above 0 and turned the span round
     * into `cp0-3000` — so a reader pasting the game's own spelling got the Pokémon it does not match. `tree.js`
     * refuses to write that string; this is the same rule on the half that reads one.
     *
     * Only where there is an `{N}` for the rule to leave behind. A bare `-0` has none, so it stays the `{phrase}-{N}`
     * it looks like, which `tree.js` then writes as the single value nothing sits below.
     */
    const opened = dash !== undefined && (high === undefined || (low !== undefined && Number(high) === 0));

    /*
     * Bounded on the way in, so a typed span is a pill the number boxes could have made. A digit run of 22 or more is
     * a float `String` writes in exponential form, and `1e+21` went into the search box as the term it is not.
     */
    const from = low === undefined ? null : bounded(Number(low), range);
    const to = opened ? null : high === undefined ? from : bounded(Number(high), range);
    const turned = from !== null && to !== null && from > to;

    return { kind: 'range', id: range.id, from: turned ? to : from, to: turned ? from : to, negated };
  }

  return { kind: 'name', text, negated };
}

/**
 * The query in pieces. A term is whatever sits between two bits of punctuation, trimmed — and kept in the reader's own
 * case, since the game is case-insensitive and a nickname they typed with capitals should read back as theirs.
 */
function tokenise(text: string): Token[] {
  const found: Token[] = [];
  let word = '';

  const end = () => {
    const term = word.trim();

    word = '';

    if (term) {
      found.push({ kind: 'term', text: term });
    }
  };

  for (const character of text) {
    const kind = PUNCTUATION[character];

    if (kind) {
      end();
      found.push({ kind, text: character });
    } else {
      word += character;
    }
  }

  end();

  return found;
}

/**
 * The tree the tokens describe, read with a comma binding tighter than an ampersand — which is the game's own rule,
 * its phrase list resolving the ambiguity "by always considering `,`s nested inside `&`s".
 *
 * A junction is only built where there are two parts to join, so nothing downstream reads a group of one.
 */
function parse(all: readonly Token[]): Node {
  let at = 0;

  const next = () => all[at];

  function conjunction(negated: boolean, depth: number): Node {
    const first = disjunction(negated, depth);
    const parts = [first];

    while (next()?.kind === 'all') {
      at += 1;
      parts.push(disjunction(negated, depth));
    }

    return parts.length === 1 ? first : group(negated ? 'any' : 'all', parts);
  }

  function disjunction(negated: boolean, depth: number): Node {
    const first = literal(negated, depth);
    const parts = [first];

    while (next()?.kind === 'any') {
      at += 1;
      parts.push(literal(negated, depth));
    }

    return parts.length === 1 ? first : group(negated ? 'all' : 'any', parts);
  }

  function literal(negated: boolean, depth: number): Node {
    const token = next();

    if (!token) {
      throw new Error('The query stops where a term was expected');
    }

    if (depth > NESTING) {
      throw new Error(`That nests more than ${NESTING} deep — there is no search in there to read`);
    }

    at += 1;

    if (token.kind === 'not') {
      return literal(!negated, depth + 1);
    }

    if (token.kind === 'open') {
      const inside = conjunction(negated, depth + 1);

      if (next()?.kind !== 'close') {
        throw new Error('A `(` is never closed');
      }

      at += 1;

      return inside;
    }

    if (token.kind !== 'term') {
      throw new Error(`\`${token.text}\` needs a term in front of it`);
    }

    return pill(token.text, negated);
  }

  const node = conjunction(false, 0);
  const over = next();

  /*
   * Whatever is left is something the grammar had nowhere to put, and it is not always a stray bracket. Every
   * parenthesis in `(shiny,lucky)(fire,water)` is paired: what is missing is the operator between the two groups, and
   * a reader who expected one group beside another to mean AND — as several search syntaxes do — is owed that rather
   * than a complaint about a `)` that was perfectly fine.
   */
  if (over) {
    throw new Error(
      over.kind === 'close'
        ? 'A `)` has no `(` to close'
        : `An \`&\` or a \`,\` is missing in front of \`${over.text}\``,
    );
  }

  return node;
}

/**
 * The arrangement a typed query describes, or why it describes none.
 *
 * An empty box is neither: there is nothing to put on the cards and nothing wrong with that, so both come back null
 * and the page does nothing.
 *
 * The root is a group whatever arrives, the cards having to have something to be the parts of — a query that is one
 * term is wrapped in the `all` that an arrangement of one pill would have been.
 */
export function read(text: string): Read {
  if (text.trim() === '') {
    return { tree: null, error: null };
  }

  try {
    const node = parse(tokenise(text));

    return { tree: node.kind === 'group' ? node : group('all', [node]), error: null };
  } catch (cause) {
    return { tree: null, error: cause instanceof Error ? cause.message : String(cause) };
  }
}
