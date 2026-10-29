/**
 * The query tree, written out as the clauses the game reads.
 *
 * Pokémon GO's search box takes no brackets. What it takes is clauses separated by `&`, each a list of alternatives
 * separated by `,`, `:` or `;`, each alternative a term or a term behind a `!` — which is all Niantic's own list
 * documents, mentioning no grouping of any kind.
 *
 * That shape is conjunctive normal form, and every boolean expression has one. So the Advanced pane can let a reader
 * write the search they actually mean and this writes it back out as something the box will take: two pills in an `any`
 * inside an `all` beside two more comes out as four clauses, not one of which anybody would have thought to write.
 *
 * **The precedence is the one assumption under all of this, and it is documented.** A clause list joined with `&`
 * only means what the cards say if a comma binds tighter than an ampersand — `fire,water&shiny` has to read as a
 * shiny that is Fire or Water. The community phrase list — `https://leidwesen.github.io/SearchPhrases/`, the same
 * reference the two negation bugs below are read off — says so in its storage table: "Ambiguity is resolved by always
 * considering `,`s nested inside `&`s", with `meowth,alola&vulpix,galar` as the example. Niantic's own list never
 * combines the two operators, so the community one is what settles it.
 *
 * That reference also notes that searches "do not take priority over each other", which is about its *Pokédex* table —
 * a different box with its own phrase list. This file read that as doubt about the line above for a while: a claim from
 * a three-table reference is worth nothing until you know which search it is a claim about.
 *
 * What the form costs is characters, an `any` multiplying where an `all` adds, which is its nature rather than a
 * shortcoming: `(a&b),(c&d)` really is four clauses in a language with no brackets.
 *
 * Nothing here pushes a negation anywhere, `tree.js` keeping negation on the pills: the tree arrives in negation
 * normal form and De Morgan is the reader's own doing.
 */

import { RANGES_BY_ID, SHORTCUTS, type RangeId } from './terms.js';
import { group, isGroup, leafText, whole, type Leaf, type Node } from './tree.js';

/**
 * As many clauses as the distribution is let reach. A query ORing a dozen pairs is 4096 clauses out of 24 pills, and
 * one ORing a dozen triples is 531441. The number bounds the whole tree rather than judging the length — a thousand
 * clauses is already a string no search box will show the end of, and the character count under the output box is what
 * says so to the reader. This is here so that a pathological query comes back at all, rather than locking the tab up
 * building a megabyte nobody can use.
 *
 * `size` is what enforces it, and the *whole tree* is the point. A check inside the distribution can only bound the
 * node it sits in: guarding an `any`'s product left twenty `all`-joined groups of nine OR'd pairs — each inside the
 * cap — summing to 10,240 clauses and half a megabyte of query with nothing reported.
 *
 * Exported so the test can work out the smallest tree that reaches it rather than carrying a copy of the number.
 */
export const CLAUSES = 1000;

/**
 * The terms whose negation the game gets wrong, as the fullest community reference records them, each written to match
 * however its number was spelled — the game reads `4hp`, `3-defense` and `-1attack` alike, and takes a bare `mega` as
 * `mega0-`.
 *
 * The reference's capture has the game ignoring the negation on an IV term outright: `!1hp` is `1hp`, so the clause
 * asks for the Pokémon it was meant to rule out and looks entirely right doing it. A negated mega level answers only
 * with species that can Mega Evolve, rather than with everything else.
 *
 * The buddy level is the third and the one that is not a quirk of the term itself: the same reference records that a
 * level search "will only return current buddy" where the game has failed to load, citing `https://redd.it/1hdfboq`.
 * That is a state rather than a spelling, so it reaches the positive form too — it is named here because the negative
 * is where it costs something, *Safe to transfer* ruling out the one Pokémon in hand instead of every one ever walked.
 *
 * Which is a choice rather than an oversight, and the asymmetry is in what the reader can see. A positive `buddy2-`
 * under that state answers with the one Pokémon in hand, and a list of one where a reader expected their Good Buddies
 * is a result they can disbelieve. A negated one answers the other way: the transfer list it guards fills up with the
 * Pokémon it was supposed to hold back, and nothing about it looks wrong. `mishandling` reads the negated clauses for
 * that reason rather than for want of the other half.
 *
 * None of the three is this page's doing — nothing between here and the string manufactures a negation. They are named
 * because this page's output ends up in a mass transfer, where a term that means its own opposite is worth a sentence.
 */

/**
 * The four spellings of a level, as a pattern taken from the range's own bounds rather than transcribed from them. A
 * `[0-3]` written here beside a `max: 3` in `terms.js` is the copy of a bound that fails quietly: a `megalevel` raised
 * the day Super Max is confirmed would drop every `mega4` string out of the note below, with nothing failing in a
 * string this page says is worth a sentence because it ends up in a mass transfer.
 *
 * The levels are an alternation rather than a character class, so a ceiling that ever reaches double digits still means
 * the number it says where `[0-10]` would mean nought, one and nought. `bare` is the prefix on its own, which the
 * phrase list documents for `mega` — "`mega` is a shortcut of `mega0-`" — and documents for nothing else.
 *
 * The affix is whichever side of the span the range writes, which `spanned` in `tree.js` composes the same way round:
 * a prefix for a level, a suffix for an IV — `hp{N}` is the stat where `{N}hp` is the band. It is held to a bare word
 * of at least one letter, the alternative being a `.` or a `+` in one that over-matches silently rather than failing,
 * and one letter rather than none because `dex` carries neither: a pattern built without an affix would attach a
 * caveat to every negated dex pill, `!151` reported as a mishandled level search.
 *
 * `RangeId` on the parameter, not `string`: this runs while the module initialises and `query.js` imports it, so a
 * range renamed in `RANGE_TABLE` would otherwise compile and then throw on the way to a blank Search page.
 */
function spanOf(id: RangeId, bare: boolean) {
  const range = RANGES_BY_ID.get(id);

  if (!range) {
    throw new Error(`\`terms.js\` carries no ${id} range`);
  }

  if (!/^[a-z]+$/.test(`${range.prefix}${range.suffix ?? ''}`)) {
    throw new Error(`\`${id}\` carries no bare-word affix, so its span cannot be spliced into a pattern`);
  }

  const floor = range.min ?? 0;
  const digits = `(?:${Array.from({ length: range.max - floor + 1 }, (_, step) => floor + step).join('|')})`;
  const span = `(?:${digits}|${digits}-${digits}?|-${digits})`;

  return new RegExp(`^${range.prefix}${span}${bare ? '?' : ''}${range.suffix ?? ''}$`);
}

const IGNORES_NEGATION = 'the game ignores a negation on an IV term, so this asks for the Pokémon it means to rule out';

const MISHANDLED = [
  { pattern: spanOf('ivattack', false), note: IGNORES_NEGATION },
  { pattern: spanOf('ivdefense', false), note: IGNORES_NEGATION },
  { pattern: spanOf('ivhp', false), note: IGNORES_NEGATION },
  {
    pattern: spanOf('megalevel', true),
    note: 'a negated mega level answers only with species that can Mega Evolve, rather than with everything else',
  },
  {
    pattern: spanOf('buddylevel', false),
    note:
      'a buddy level answers only the buddy you have out where the game has not loaded properly, so this rules out ' +
      'that one rather than every Pokémon you have walked',
  },
];

/** One phrase worth a caveat, written as the reader will see it, and what the game does with it. */
export interface Mishandled {
  term: string;
  note: string;
}

/** What a query comes to, said in clauses the page can hand to the game. */
export interface Written {
  /** Each a comma-separated list of alternatives, for the page to join with `&`. */
  clauses: readonly string[];

  /** Why nothing came back, in words for the reader under the box rather than for a log. */
  error: string | null;

  /** The phrases the game gets wrong or that rule nothing out, each named once however many clauses it reached. */
  mishandled: readonly Mishandled[];
}

/**
 * A node said as one string, so two parts of a junction can be compared for asking the same thing. Structural rather
 * than canonical: the parts are not sorted, so `all(a, b)` and `all(b, a)` are two keys. Sorting them was in the first
 * draft and bought only recognising two differently-ordered subgroups as one shared part — which, measured, writes the
 * same clauses one intermediate clause later, and which no mutation could be made to fail a test over.
 *
 * The junction is in the key and has to be: without it `all(a, b)` and `any(a, b)` read as one shared part, and the
 * search narrows from `s and (a or b)` to `s and a and b`.
 *
 * A pill's text is quoted, which is what makes the whole key injective rather than merely unlikely to collide. A name
 * is whatever a reader typed and the game's own punctuation is all typeable, so a reserved first character is not
 * enough: `(` and `)` and the `|` this joins siblings with are as much the pill's alphabet as the key's. Quoting
 * escapes its own delimiter, so `all("a|=b")` and `all("a"|"b")` are two keys however the names are spelled — where
 * unquoted both read as `all(=a|=b)`, and the one pill was lifted out of a branch whose own `a&b` went with it.
 */
function key(node: Node): string {
  return isGroup(node) ? `${node.junction}(${node.parts.map(key).join('|')})` : JSON.stringify(leafText(node) ?? '');
}

/** What a part of a junction asks for, as keys: an `all`'s own parts, or the part itself where it is not one. */
const asks = (node: Node) => new Set((isGroup(node) && node.junction === 'all' ? node.parts : [node]).map(key));

/**
 * A pill every part of an `any` asks for, lifted out of it: `any(all(s, a), all(s, b))` is `all(s, any(a, b))` — the
 * same search said as a sum where it was said as a product.
 *
 * This decides whether a realistic arrangement can be written at all. *A shiny Fire, or a shiny Water, or a shiny
 * Grass* is a natural thing to place, one `any` holding an `all` per type, and it spreads to two to the power of
 * however many types are named: 64 clauses at six, past the cap at ten, where the answer is `shiny` and one clause of
 * types. Dropping those clauses afterwards cannot help, the cap being reached while they are built.
 *
 * Here rather than in `optimise.js` because it is not optional: that toggle is for reductions a reader might want
 * undone, where this changes only how much work the distribution is. `clauses.test.js` holds it to the same clauses
 * either way, over a sweep of arrangements with something in common between their parts.
 *
 * A part asking for *nothing but* what is shared needs no case of its own — it is left an `all` of nothing, which the
 * arithmetic below reads as the search for everything, and an `any` holding everything is everything. The branch that
 * noticed was another no mutation could kill.
 */
function factored(node: Node): Node {
  if (!isGroup(node)) {
    return node;
  }

  const parts = node.parts.map(factored);

  if (node.junction !== 'any' || parts.length < 2) {
    return { ...node, parts };
  }

  const sets = parts.map(asks);
  const [first] = sets;
  const shared = first === undefined ? [] : [...first].filter((text) => sets.every((one) => one.has(text)));

  if (shared.length === 0) {
    return { ...node, parts };
  }

  const within = (part: Node) => (isGroup(part) && part.junction === 'all' ? part.parts : [part]);
  const own = within(parts[0] ?? node);
  const lifted = own.filter((part) => shared.includes(key(part)));
  const left = parts.map((part) => within(part).filter((one) => !shared.includes(key(one))));

  // Each remainder is wrapped whatever its length: an `all` of one part spreads to exactly what that part does, and an
  // `all` of none is the search for everything, which is what a part asking only for the shared pills has become.
  const rest = factored(
    group(
      'any',
      left.map((one) => group('all', one)),
    ),
  );

  // The alternatives stand where the first unshared pill stood, rather than after everything lifted, so that a shared
  // pill arranged last is still written last — the order `clausesOf` promises. Every pill before that one was shared,
  // which is what makes the index into `own` an index into `lifted` as well.
  const unshared = own.findIndex((part) => !shared.includes(key(part)));
  const at = unshared < 0 ? lifted.length : unshared;

  return group('all', [...lifted.slice(0, at), rest, ...lifted.slice(at)]);
}

/**
 * How many clauses `spread` builds at most, which is the same arithmetic it performs and none of the
 * allocation: a pill is one, an `all` is the sum of its parts and an `any` is their product.
 *
 * Counted rather than measured as it is built, so the cap is a precondition `written` can check before anything is
 * allocated instead of a limit the distribution runs into part-way through. Every running total is clamped at one past
 * the cap, so nothing here can overflow however deep or wide the tree: past that point the exact figure is of no
 * interest to anyone, only that it is over.
 *
 * A pill with nothing to write is nought clauses, and drops out of an `all` that holds it. It zeroes the `any` that does
 * too, but only once `spread` reaches it, every part before it having been multiplied out by then — so in a product it
 * counts as one. Counted as nought it would wave through `Rcp..` beside twenty OR'd triples, 3^20 clauses built only to
 * be thrown away. An empty group is nought by the same arithmetic: the sum of no parts is nought, and the product of
 * none is one, so an empty `any` would be a clause of nothing at all, which is why it is read as the unfinished group
 * it is.
 */
export function size(node: Node): number {
  if (!isGroup(node)) {
    return leafText(node) === null ? 0 : 1;
  }

  if (node.parts.length === 0) {
    return 0;
  }

  const sum = node.junction === 'all';

  return node.parts.reduce(
    (total, part) => Math.min(sum ? total + size(part) : total * Math.max(size(part), 1), CLAUSES + 1),
    sum ? 0 : 1,
  );
}

/**
 * The tree as clauses, which is the distribution and the walk over it in one function. A pill is a clause of itself
 * and an `all` is its parts' clauses laid end to end. An `any` is the one product in here: a clause per way of taking
 * one clause from each part, since every clause written by any one part has to be satisfied for that part to be.
 *
 * A part that wrote no clauses makes its `any` write none either, the product of nothing being nothing — which is the
 * right answer, an unfinished pill beside two alternatives leaving a group that asks for nothing in particular.
 */
function spread(node: Node): Leaf[][] {
  if (!isGroup(node)) {
    return leafText(node) === null ? [] : [[node]];
  }

  // A group with nothing in it is one the reader has just made, and asks nothing until a pill lands in it. Left to the
  // arithmetic below an empty `any` would seed a clause offering no alternatives at all, which nothing can write.
  if (node.parts.length === 0) {
    return [];
  }

  if (node.junction === 'all') {
    return node.parts.flatMap(spread);
  }

  return node.parts
    .map(spread)
    .reduce<Leaf[][]>((left, right) => left.flatMap((one) => right.map((two) => [...one, ...two])), [[]]);
}

/** The pill as the game writes it, which is also the text two of them are compared by. Never null in a clause. */
const written = (leaf: Leaf) => leafText(leaf) ?? '';

/** The same text the other way round, for the pair that leaves a clause asking nothing. */
const opposite = (text: string) => (text.startsWith('!') ? text.slice(1) : `!${text}`);

/**
 * One clause's pills with nothing redundant left in them, or null where the clause has earned no place at all. A term
 * repeated in it is one alternative, and a term beside its own negation leaves the clause true of everything — every
 * Pokémon either is Fire or is not — so that clause goes rather than being written. Distribution produces both on its
 * own: an `any` of `all[a,b]` and `all[!a,c]` spreads to four clauses of which `a,!a` is one.
 *
 * Pills rather than their text, so that what each surviving clause is made of is still known further down. Only the
 * last step writes anything.
 */
function clause(leaves: readonly Leaf[]): Leaf[] | null {
  const offered = new Set<string>();
  const unique: Leaf[] = [];

  for (const leaf of leaves) {
    const text = written(leaf);

    if (!offered.has(text)) {
      offered.add(text);
      unique.push(leaf);
    }
  }

  return [...offered].some((text) => offered.has(opposite(text))) ? null : unique;
}

/**
 * The clauses with the ones asking nothing of their own taken out. A clause holding every alternative another holds
 * asks no more than that other already does, so it adds nothing beside it: `shiny` AND `shiny,lucky` is `shiny`, and
 * two clauses offering the same alternatives are one clause. The earlier of an equal pair is the one kept, so the
 * string follows the order the pills were arranged in.
 *
 * Each clause's alternatives are written once, up front, rather than spread out of their set inside the comparison:
 * this is a pair of nested loops over as many clauses as the cap allows, so an array built per comparison is an
 * allocation per pair of clauses rather than one per clause.
 *
 * A length test ahead of the subset test would be the obvious thrift and is not here. Distribution gives every clause
 * out of one `any` node the same length, so on anything this receives the test would never fire — no mutation of it
 * could be made to fail, and runs over the 512-clause case put it inside the noise.
 */
function absorbed(all: readonly (readonly Leaf[])[]) {
  const clauses = all.map((leaves) => {
    const texts = leaves.map(written);

    return { leaves, texts, offered: new Set(texts) };
  });

  return clauses
    .filter((mine, index) =>
      clauses.every((other, at) => {
        if (at === index || !other.texts.every((text) => mine.offered.has(text))) {
          return true;
        }

        // An equal pair subsumes both ways round, so the tie is broken on which of the two was arranged first.
        return other.texts.length === mine.texts.length && index < at;
      }),
    )
    .map((mine) => mine.leaves);
}

/**
 * The text a shortcut phrase swallows, each piece named once.
 *
 * The community phrase list calls these shortcuts "internally a range", and that is exactly what goes wrong with
 * them: `{search}{text}` collapses to `{search}`, and `@{search}` loses its `@`. So a nickname, a tag or a move name
 * that begins with one is searched as a span instead — `@counter` is `count2-`, which answers with everything you hold
 * two of and looks entirely deliberate doing it.
 *
 * **Only the text a reader wrote is read**, which is the whole of what this can catch: a term comes out of `terms.js`
 * and a span out of the writer, so `count10-` is the range search it looks like rather than a word being eaten. The
 * one phrase the list records as patched is left out of it by its own `greedy`.
 *
 * A `#` is the way out and the list names it as one, the difficulty arising "for tags starting with a shortcut phrase
 * (when not using '#')" — so `#counter` is the tag, and `counter` is not. An `@` is the opposite: it is dropped
 * whatever follows it, so even an `@count` that swallows nothing is still read as the span.
 *
 * **A slot digit between the two is deliberately not named**, and the reason is where these notes stop. The list's
 * bullets are `{search}{text}` and `@{search}`, both of them the phrase against the start of a token; `@3counter`
 * puts a `3` in between and is a case the reference does not record, so there is no span to claim it comes to. These
 * notes are the phrases the game is *known* to get wrong, which is the contract the negations above are held to as
 * well — a reading nothing records belongs in the panel's own help, and `pages/search.js` carries it there.
 *
 * The span is spelled by the writer that composes one, rather than carried in the table beside the floor: a note
 * quoting a string nothing produces is a note that can go stale on its own.
 */
function swallowed(clauses: readonly (readonly Leaf[])[]): Mishandled[] {
  const supplied = new Set(
    clauses
      .flat()
      .filter((leaf) => leaf.kind === 'name')
      .map(written),
  );

  const named: Mishandled[] = [];

  for (const text of supplied) {
    /*
     * The negation comes off to find the phrase and goes back on to name it. `term` is the text as the reader will see
     * it in the string, which `Mishandled` says and `mishandling` below honours by putting the `!` back — a caveat
     * reported against `counter` beside a query reading `!counter` points at a string that is not there, and a negated
     * nickname is exactly the case where a swallowed phrase is hardest to spot.
     */
    const folded = text.toLowerCase().replace(/^!/, '');
    const marked = folded.startsWith('@');
    const rest = marked ? folded.slice(1) : folded;

    // Behind an `@` the phrase is the span whatever follows it, including nothing. In front of a word it has to have
    // something to swallow, a phrase standing alone being the shortcut `parse.js` reads as the span it stands for.
    const eaten = SHORTCUTS.find((one) => one.greedy && rest.startsWith(one.phrase) && (marked || rest !== one.phrase));
    const span = eaten && leafText({ kind: 'range', id: eaten.range, from: eaten.from, to: null, negated: false });

    if (eaten && span) {
      const note = `\`${eaten.phrase}\` is a shortcut for \`${span}\`, and the game reads this as that`;

      named.push({ term: text, note });
    }
  }

  return named;
}

/**
 * The spans that take in their whole range, each named once: a `cp0-` beside a `shiny` in an `all` filters nothing,
 * and beside one in an `any` leaves the clause it is in ruling nothing out.
 *
 * Computed off the span's bounds by `whole` rather than looked up as a pattern, so it reaches a span however the reader
 * arrived at it. The number boxes accept one on purpose — a box records what it is given, and a reader typing `0` in
 * the lowest on the way to `3` in the highest passes through exactly the span this names — so the page says so instead.
 *
 * Only the positive form, which is the opposite of the reason `mishandling` reads only the negated one. A `!cp0-`
 * standing alone matches nothing, and the empty list that comes back says so on its own; a `cp0-` contributes nothing
 * to a list that still looks like an answer, so the reader believes the clause did some work.
 */
function inert(clauses: readonly (readonly Leaf[])[]): Mishandled[] {
  const spans = new Set(
    clauses
      .flat()
      .filter((leaf) => !leaf.negated && whole(leaf))
      .map(written),
  );

  return [...spans].map((term) => ({
    term,
    note: 'this takes in every value the range has, so it matches every Pokémon',
  }));
}

/** The negated terms the game gets wrong, each named once however many of the clauses it reached. */
function mishandling(clauses: readonly (readonly Leaf[])[]): Mishandled[] {
  const negated = new Set(
    clauses
      .flat()
      .filter((leaf) => leaf.negated)
      .map((leaf) => written(leaf).slice(1)),
  );

  return [...negated].flatMap((term) => {
    const found = MISHANDLED.find((entry) => entry.pattern.test(term));

    return found ? [{ term: `!${term}`, note: found.note }] : [];
  });
}

/**
 * The pills of each clause a query comes to, or null where it spreads past `CLAUSES`. Exported for `cards.js`, which
 * lays a tree out as these when it is deeper than a card can draw: the cards are then the clauses the string is
 * written from, and nothing the Builder shows is a rearrangement the string does not make.
 */
export function spreadOut(node: Node): readonly (readonly Leaf[])[] | null {
  // Factored before it is measured, the point of factoring being to bring the measurement under the cap.
  const tree = factored(node);

  if (size(tree) > CLAUSES) {
    return null;
  }

  return absorbed(
    spread(tree)
      .map(clause)
      .filter((one) => one !== null),
  );
}

/**
 * The clauses a query comes to, and whatever is worth saying about it. No cards at all is a query for everything rather
 * than a broken one, that being the state the page spends most of its life in.
 *
 * The clauses follow the order the pills were arranged in, nothing here being sorted: the arrangement is the reader's
 * own, and a string they can still recognise is a string they can check. A pill lifted out of an `any` is written
 * where the reader had it rather than at the front, which is as far as that carries — factoring changes which
 * intermediate clauses the absorption above sees, so two of them surviving a nested `any` can come out the other way
 * round than they would unfactored.
 *
 * Every note is read off the clauses that survived rather than off everything the distribution produced. A clause
 * dropped for asking nothing takes its pills with it, so a query can spread a `!1hp` and then write no clause holding
 * one — naming it would have named a term the string does not contain, which is the one thing the page says these
 * notes are for.
 */
export function clausesOf(node: Node): Written {
  const kept = spreadOut(node);

  if (kept === null) {
    return {
      clauses: [],
      error: `That spreads past ${CLAUSES} clauses, which is longer than any search box will take`,
      mishandled: [],
    };
  }

  return {
    clauses: kept.map((leaves) => leaves.map(written).join(',')),
    error: null,
    mishandled: [...mishandling(kept), ...swallowed(kept), ...inert(kept)],
  };
}
