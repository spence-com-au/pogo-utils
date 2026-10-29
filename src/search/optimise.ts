/**
 * Compressing a finished query. Every reduction here rewrites the *tree* rather than the string and hands back another
 * tree for `query.js` to compose, so the shortened string goes through the same distribution and the same clause
 * writer as the plain one. Nothing takes apart a search string that was just written.
 *
 * Three kinds of redundancy are worth removing. A **name longer than it has to be**, since the game reads
 * `charmander`, `charma` and `4` alike — a pill is shortened wherever it sits, this being the one reduction that needs
 * to know nothing about what is around it. **Dex numbers said twice**, the AND'd spans collapsing into their
 * intersection. And **a category saying what its own terms already settle**, which `terms.js` declares through
 * `exclusive`, `exhaustive` and `covers`.
 *
 * **Every one of the three is local to one node**, which is what the canvas changed: the earlier builder AND'd one
 * clause per category, so "this category's terms" and "the terms AND'd with everything else" were the same set. An
 * arrangement can put a category's terms in two groups, or inside an `any` the rest of the query is not AND'd with, so
 * each reduction asks only about one junction's own parts. A pill one group over is a pill this knows nothing about,
 * which is the only reading that cannot make a search broader than it was.
 *
 * What is *not* reduced is a category's terms arriving at one junction with mixed polarity — an `any` holding `shadow`
 * beside `!purified` is `!purified`, and goes out as it came in. The facts in `terms.js` are stated for the reading
 * where a category's choices sit on one side.
 *
 * What is not here at all is folding `+charmander` into `4,5,6`, which needs to know which species share a family —
 * nothing in this repository holds that. So a `+` keeps its name and gets the name shortening alone, which widens it as
 * it does any name: a shorter fragment reaches more nicknames, and a family search takes their families too.
 */

import POKEMON from '../pokemon/pokedex.js';
import { GROUPS, RANGES_BY_ID, SPAN, type Group as Category, type Term } from './terms.js';
import { isGroup, leafText, whole, type Group, type Leaf, type Node } from './tree.js';
import type { State } from './query.js';

/** A run of dex numbers, inclusive at both ends, which is every shape of number the game reads: `4` is `[4, 4]`. */
type Span = [number, number];

/** What one pass over the tree collected, for the page to show under the string. */
interface Told {
  rewrites: [string, string][];
  lossy: Lossy;
}

/**
 * How the shortened string strays from the one arranged, in each of the two directions it can. A name matches
 * nicknames as well as species, so the two rewrites of a name miss in opposite directions: a dex number matches the
 * species alone and so *narrows*, and a shorter fragment matches every nickname beginning with it and so *widens*.
 * They are kept apart because the second is the one that matters on a mass transfer — an added match is a Pokémon the
 * reader did not ask to see, and may not notice in the list.
 */
export interface Lossy {
  narrowed: boolean;
  widened: boolean;
}

/**
 * The three species whose English name the dex cannot spell. `pokedex.js` names a species by the constant it is bound
 * to, which is that name uppercased with its punctuation dropped or turned into an underscore. An underscore is honest
 * enough to match against — `MR_MIME` stands in for `Mr. Mime` one character for two, so `mime` reaches it and `mrmime`
 * reaches nothing either way, which is how the game behaves. A dropped apostrophe or accent leaves no such mark:
 * `FARFETCHD` reads as an ordinary word where the game's own name is `Farfetch'd`, and a search for `farfetchd` finds
 * nothing at all. So a fragment that could reach one of these is left alone rather than guessed at.
 *
 * Three entries is what `pokedex.js` not carrying display names costs. A fourth belongs there rather than here.
 */
const UNSPELLABLE = new Set(['FARFETCHD', 'SIRFETCHD', 'FLABEBE']);

/** Every species as the name a search sees and the dex number it answers to. */
const SPECIES = Object.values(POKEMON).map((species) => ({
  dex: Number(species),
  name: String(species).toLowerCase(),
  spellable: !UNSPELLABLE.has(String(species)),
}));

/** The dex range's own floor and ceiling, which is the span that says nothing and so earns no pill. */
const DEX = RANGES_BY_ID.get('dex');

// Every reduction below the name shortening is about the dex, so a table missing this range is a broken page rather
// than a query to shorten — the same reading `dom.js` takes of markup a script cannot find its element in.
if (!DEX) {
  throw new Error('`terms.js` declares no `dex` range');
}

const WHOLE: Span = [DEX.min ?? 0, DEX.max];

/**
 * One span from a piece of text, or null where that text is not a number at all.
 *
 * An end the dash leaves open is closed against `WHOLE`, a span here being a closed interval: `-151` is Gen 1 spelled
 * the other way round, and the arithmetic below has to see it as the `[1, 151]` it is rather than refuse it. `parse.js`
 * leaves the same end open, which is the difference between reading a span to compute with and reading one to draw.
 */
function spanOf(text: string): Span | null {
  const [, low, dash, high] = SPAN.exec(text) ?? [];

  if (low === undefined && high === undefined) {
    return null;
  }

  const from = low === undefined ? WHOLE[0] : Number(low);
  const to = high === undefined ? (dash === undefined ? from : WHOLE[1]) : Number(high);

  return [Math.min(from, to), Math.max(from, to)];
}

/** Spans sorted and run together, so `4,5,6` is `4-6` and `1-151,152-251` is the single span it describes. */
function merged(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((one, two) => one[0] - two[0] || one[1] - two[1]);
  const runs: Span[] = [];

  for (const [from, to] of sorted) {
    const last = runs.at(-1);

    // Touching counts as overlapping: there is no dex number between 151 and 152, so those two spans are one.
    if (last && from <= last[1] + 1) {
      last[1] = Math.max(last[1], to);
    } else {
      runs.push([from, to]);
    }
  }

  return runs;
}

/** Two sets of spans AND'd, which is every pair's overlap, because the pills they came from are AND'd. */
function intersected(one: readonly Span[], two: readonly Span[]): Span[] {
  const overlaps: Span[] = [];

  for (const [from, to] of one) {
    for (const [otherFrom, otherTo] of two) {
      const start = Math.max(from, otherFrom);
      const end = Math.min(to, otherTo);

      if (start <= end) {
        overlaps.push([start, end]);
      }
    }
  }

  return merged(overlaps);
}

/** Spans as the game writes them: a bare number where the ends meet, `1-3` where they do not. */
const spansText = (spans: readonly Span[]) =>
  spans.map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`)).join(',');

/** Whether a set of spans is the whole dex, in which case it says nothing and has earned no pill. */
const everything = (spans: readonly Span[]) =>
  spans.length === 1 && spans.every(([from, to]) => from <= WHOLE[0] && to >= WHOLE[1]);

/**
 * The species a fragment of a name reaches, as dex numbers, or null where the answer cannot be trusted — the gate every
 * name reduction below has to pass.
 *
 * Two readings of a partial name are in play and the sources do not agree on which the game uses. The wiki's table says
 * `T` "Returns all Pokémon that begins with T (including nicknames)", where this page's own help has a partial name
 * matching anywhere in it. `char` reaches Charmander under both readings; `saur` reaches Bulbasaur under one and
 * nothing under the other. So a fragment whose two readings disagree is refused rather than guessed at. That costs
 * `saur` and `mime` their reductions and leaves every reduction that is taken true whichever reading is right.
 *
 * The community phrase list looks like it settles this and does not: both its rows saying a name matches "anywhere"
 * are *Pokédex* rows, where its storage row for `{name}` gives `vulpix` and `vulp` — two prefixes. Widening this on
 * those quotations would trade every shortened name for a search that finds nothing.
 */
function dexOf(fragment: string): number[] | null {
  const contains = SPECIES.filter((species) => species.name.includes(fragment));
  const begins = SPECIES.filter((species) => species.name.startsWith(fragment));

  // Anything beginning with the fragment contains it, so one set is inside the other and equal sizes are equal sets.
  if (contains.length === 0 || contains.length !== begins.length) {
    return null;
  }

  return contains.every((species) => species.spellable) ? contains.map((species) => species.dex) : null;
}

/**
 * One name written as short as it goes. The name itself, the shortest leading fragment of it that still reaches the
 * same species, and those species as dex numbers are three spellings of one search *as far as species go* — the game
 * matches a name against nicknames too, which the fragment widens and the numbers drop, and `short` says so.
 *
 * Leading fragments rather than fragments from anywhere, for the reason `dexOf` gives, which also keeps what is
 * written recognisable as the name it came from. A name resolving to nothing is passed through untouched.
 *
 * `spans` is the dex numbers the text stands for, or null where it stands for a name the arithmetic cannot join.
 */
function shortName(token: string, negated: boolean): { text: string; spans: Span[] | null; numbered: boolean } {
  const span = spanOf(token);

  if (span) {
    return { text: token, spans: [span], numbered: false };
  }

  const family = token.startsWith('+');
  const name = family ? token.slice(1) : token;
  const dex = dexOf(name);

  if (!dex) {
    return { text: token, spans: null, numbered: false };
  }

  let shortest = name;

  for (let length = 1; length < name.length; length += 1) {
    const fragment = name.slice(0, length);

    if (dexOf(fragment)?.join() === dex.join()) {
      shortest = fragment;
      break;
    }
  }

  // Which species share a family is the thing not known here, so the numbers are not on offer and a `+` keeps a name.
  if (family) {
    return { text: `+${shortest}`, spans: null, numbered: false };
  }

  const spans = merged(dex.map((number) => [number, number] as Span));
  const numbers = spansText(spans);

  // A comma is the game's OR within a clause, so a ruled-out `nidoran` written as `29,32` would compose `!29,32` — not
  // 29, *or* 32, which is every Pokémon. Ruling out each span is `!29&!32`, an `all` that an enclosing `any` spreads
  // into a clause per span with every neighbour copied into each, a length nothing here measures. So a ruled-out name
  // reaching several spans keeps its fragment.
  const numbered = numbers.length < shortest.length && (spans.length === 1 || !negated);

  return numbered ? { text: numbers, spans, numbered: true } : { text: shortest, spans: null, numbered: false };
}

/** Every category a term belongs to, by term id, so a junction's parts can be sorted into the ones they came from. */
const CATEGORY_BY_TERM = new Map(
  GROUPS.flatMap((category) => category.terms.map((term) => [term.id, category] as [string, Category])),
);

type TermPill = Leaf & { kind: 'term' };

/** One term pill, required or ruled out, which is the only kind of part the category reductions read. */
const termPill = (node: Node): TermPill | null => (!isGroup(node) && node.kind === 'term' ? node : null);

/** A name pill, which is the only kind the shortening reads. */
const namePill = (node: Node): (Leaf & { kind: 'name' }) | null =>
  !isGroup(node) && node.kind === 'name' ? node : null;

/** One term pill as a node, which is the only shape the reductions below hand back. */
const pillOf = (id: string, negated: boolean): TermPill => ({ kind: 'term', id, negated });

/**
 * What a junction writes for these pills and nothing else, so the two spellings weighed against each other below are
 * measured by the writer that will produce one of them rather than by a second copy of its join rules.
 */
const spelling = (junction: Group['junction'], pills: readonly Leaf[]) =>
  pills.map((pill) => leafText(pill) ?? '').join(junction === 'all' ? '&' : ',').length;

/**
 * A union term written in place of the whole of what it covers, on the one side of the junction where that is the same
 * search: either backdrop is a backdrop, so in an `any` the required ones go, and neither backdrop rules out both, so in
 * an `all` the refused ones do. The other side is not an equivalence — two backdrops AND'd ask for one that is both, and
 * two refusals OR'd let through everything short of both — so it is left for the reader to see. `terms.js` names a
 * union more briefly than the terms it covers and a test holds the table to it, so there is nothing to weigh.
 *
 * Null is "nothing to do here", which is every arrangement short of the whole of what the union covers.
 */
function shortUnion(junction: Group['junction'], union: Term, pills: readonly TermPill[]): TermPill[] | null {
  const covers = union.covers;

  if (!covers) {
    return null;
  }

  const negated = junction === 'all';
  const side = pills.filter((pill) => pill.negated === negated);
  const covered = side.filter((pill) => covers.includes(pill.id));

  if (covered.length === 0) {
    return null;
  }

  // Beside the union itself a term it covers adds nothing to that side, so it goes — however many are on it.
  if (side.some((pill) => pill.id === union.id)) {
    return pills.filter((pill) => !covered.includes(pill));
  }

  if (new Set(covered.map((pill) => pill.id)).size === covers.length) {
    return [...pills.filter((pill) => !covered.includes(pill)), pillOf(union.id, negated)];
  }

  return null;
}

/**
 * One category's terms within one junction, said as shortly as the category's own arithmetic allows. The pills handed
 * back replace the ones that were read; an empty list is a category that has turned out to ask for everything, which
 * only an `any` can do, and which makes that whole `any` ask for nothing.
 *
 * Null is "leave these alone", which is the answer for every arrangement the facts in `terms.js` do not settle.
 */
function shortCategory(junction: Group['junction'], category: Category, pills: readonly TermPill[]): TermPill[] | null {
  const union = category.terms.find((term) => term.covers);

  // A category holding a union term overlaps itself and so cannot be exclusive, and Background — the one holding one —
  // declares neither fact below. The two reductions therefore never reach for the same pill.
  if (union) {
    return shortUnion(junction, union, pills);
  }

  const required = pills.filter((pill) => !pill.negated);
  const refused = pills.filter((pill) => pill.negated);

  // An `all` asking for one of a category's terms has ruled the rest out already, so a refusal of another one beside it
  // says nothing. A refusal of that same term is the one that says everything — `shadow&!shadow` matches nothing — and
  // stays where the reader can see it.
  const [only] = required;

  if (junction === 'all' && category.exclusive && only && required.length === 1 && refused.length > 0) {
    const kept = refused.filter((pill) => pill.id === only.id);

    return kept.length === refused.length ? null : [...required, ...kept];
  }

  // Mixed polarity at one junction is the arrangement nothing below is stated for. Nor is an `all`: two terms of an
  // exclusive category AND'd match nothing, and the reader is owed the sight of that rather than a rewrite of it.
  if (junction !== 'any' || !category.exhaustive || refused.length > 0) {
    return null;
  }

  // Every term of an exhaustive category, OR'd: a search for anything at all. Exclusivity is not wanted here, only
  // that every Pokémon has one of these — which is why all eighteen types reduce where seventeen of them do not.
  // Distinct terms are what is counted, a link carrying five copies of one chip asking for that chip and no more.
  const chosen = new Set(required.map((pill) => pill.id));

  if (chosen.size === category.terms.length) {
    return [];
  }

  // Short of that, the terms left out say exactly what the ones asked for say — but only where no Pokémon is two of
  // them. Gyarados is Flying, which is among the seventeen types that are not Water, and it is still not `!water`.
  if (!category.exclusive || required.length === 0) {
    return null;
  }

  const left = category.terms.filter((term) => !chosen.has(term.id)).map((term) => pillOf(term.id, true));

  // The terms left out say it only AND'd, and they are spliced into this `any` to be OR'd: `!3*,!4*` is every Pokémon,
  // none being both. Two or more would want an `all` of their own, which the composer distributes across every
  // neighbour in this `any`, so what it costs is not the length of those pills and cannot be weighed here.
  if (left.length > 1) {
    return null;
  }

  // `0*,1*,2*,3*` against `!4*`, measured by the writer that will produce one of them.
  return spelling('all', left) < spelling('any', required) ? left : null;
}

/**
 * The dex spans among one junction's own parts, collapsed into the one thing they say between them.
 *
 * Which way they collapse is the junction's to say, and this is where the canvas changed the arithmetic rather than
 * just where it is applied: an `all` of spans is their overlap — Gen 1 with Gen 2 is nothing, no species being in
 * both — where an `any` of them is their union.
 *
 * A negated pill is left out, ruling a span out not being asking for one, and so is a span inside a nested group,
 * whose own pass will have seen it.
 *
 * An empty overlap is left alone: writing it would be writing no clause at all, turning a search that finds nothing
 * into one that finds everything — the same trap an exhaustive category with every term refused is kept out of above.
 */
function shortSpans(junction: Group['junction'], parts: readonly Node[]): Node[] | null {
  const spanned = parts.flatMap((part) => {
    const pill = !isGroup(part) && !part.negated ? part : null;
    const text = pill && pill.kind !== 'range' ? leafText(pill) : null;
    const span = text ? spanOf(text) : null;

    if (span) {
      return [{ part, spans: [span] }];
    }

    // A dex pill is read through the writer that produced it, so the two cannot drift over which bound an empty box
    // falls back to.
    const written = pill?.kind === 'range' && pill.id === 'dex' ? leafText(pill) : null;
    const bounds = written ? spanOf(written) : null;

    return bounds ? [{ part, spans: [bounds] }] : [];
  });

  if (spanned.length < 2) {
    return null;
  }

  const lists = spanned.map((one) => one.spans);
  const settled = junction === 'all' ? lists.reduce(intersected, [WHOLE]) : merged(lists.flat());
  const [only] = settled;

  if (only === undefined) {
    return null;
  }

  const taken = spanned.map((one) => one.part);

  // Spans covering the whole dex say nothing. In an `all` they are pills that have earned no clause; in an `any` they
  // are a part that asks nothing, which makes the whole group ask nothing.
  if (everything(settled)) {
    return junction === 'all' ? parts.filter((part) => !taken.includes(part)) : [];
  }

  // One span is a dex pill, the most legible thing to leave on a card. Several are alternatives, so in an `any`
  // they go in as themselves and in an `all` they want a group of their own to be alternatives within.
  const written = settled.map((span): Leaf => ({ kind: 'name', text: spansText([span]), negated: false }));
  const replacement: readonly Node[] =
    settled.length === 1
      ? [{ kind: 'range', id: 'dex', from: only[0], to: only[1], negated: false }]
      : junction === 'any'
        ? written
        : [{ kind: 'group', junction: 'any', parts: written }];

  return spliced(parts, taken, replacement);
}

/**
 * `parts` with the ones in `taken` replaced by `written`, where the first of them stood. In place, because the order
 * of a group's parts is the order the reader arranged them in and so the order the clauses come out in — a reduction
 * that moved its answer to the end would shuffle the string for no reason a reader could see.
 */
function spliced(parts: readonly Node[], taken: readonly Node[], written: readonly Node[]): Node[] {
  const at = parts.findIndex((part) => taken.includes(part));

  return [...parts.slice(0, at), ...written, ...parts.slice(at + 1).filter((part) => !taken.includes(part))];
}

/** One node with every reduction that applies to it applied, and to everything inside it first. */
function short(node: Node, told: Told): Node {
  if (!isGroup(node)) {
    const name = namePill(node);

    if (!name) {
      return node;
    }

    const shortened = shortName(name.text, name.negated);

    if (shortened.text !== name.text) {
      told.rewrites.push([name.text, shortened.text]);
    }

    if (shortened.numbered) {
      told.lossy.narrowed = true;
    } else if (shortened.text !== name.text) {
      told.lossy.widened = true;
    }

    return { ...name, text: shortened.text };
  }

  let parts = node.parts.map((part) => short(part, told));

  /*
   * A span over the whole of its range is true of every Pokémon, so it gets the two answers the dex spans get below:
   * in an `all` it is a pill that has earned no clause, and in an `any` it makes the whole group ask nothing. A
   * negated one is left alone for the reason the empty overlap is — it matches nothing, and dropping it would turn
   * that into a search for everything.
   */
  const saying = parts.filter((part) => isGroup(part) || part.negated || !whole(part));

  if (saying.length < parts.length) {
    if (node.junction === 'any') {
      return { ...node, parts: [] };
    }

    parts = saying;
  }

  // Each category settled among this junction's own parts, which neither reads nor disturbs the spans below.
  for (const category of GROUPS) {
    const pills = parts.filter((part) => {
      const pill = termPill(part);

      return pill !== null && CATEGORY_BY_TERM.get(pill.id) === category;
    });

    const shortened =
      pills.length > 0
        ? shortCategory(
            node.junction,
            category,
            pills.map(termPill).filter((pill) => pill !== null),
          )
        : null;

    // A category asking for everything in an `any` is a part that asks nothing, which makes the whole group ask
    // nothing — the same answer the spans give below. Splicing only the category away would leave its neighbours
    // standing, a strictly narrower search than the one arranged.
    if (shortened?.length === 0) {
      return { ...node, parts: [] };
    }

    if (shortened !== null) {
      parts = spliced(parts, pills, shortened);
    }
  }

  // Generation is the one category whose terms are spans, and it is also the one declaring neither fact above, so the
  // two reductions never reach for the same pill.
  parts = shortSpans(node.junction, parts) ?? parts;

  return { ...node, parts };
}

/**
 * The tree the same arrangement composes to in fewer characters, and what was done to get there.
 *
 * The tree handed back is for composing and nothing else: the cards and the link go on carrying what the reader
 * arranged, so turning the optimiser off puts the original string back rather than having to undo a rewrite.
 *
 * `rewrites` is the pairs worth showing, a reader who cannot see why `charmander` became `4` having been handed a
 * string to trust on a mass transfer with no way to check it. `lossy` marks the reductions that are not an
 * equivalence, both of them rewrites of a name, which is the one leaf matching nicknames as well as species.
 */
export function optimise(state: State) {
  const told: Told = { rewrites: [], lossy: { narrowed: false, widened: false } };
  const tree = short(state.tree, told);

  return { state: { ...state, tree }, rewrites: told.rewrites, lossy: told.lossy };
}
