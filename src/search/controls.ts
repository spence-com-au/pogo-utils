/**
 * What the Search page's boxes, chips and tooltips say, taken out of the page so they can be tested without a DOM: the
 * marks the `@` and `#` boxes put in front of what a reader types, a chip's tooltip, a sentence's backticked parts, what
 * a span pill's boxes show and offer and which answer to a send to the phone is still worth showing.
 */

import { names } from './query.js';
import { bounded, type Range } from './terms.js';
import { spanned, type Path } from './tree.js';

/**
 * The reader's own text with a mark they typed themselves taken off the front, so a phrase pasted out of the reference
 * is not marked a second time: `#keepers` into the tag box composed `##keepers` and `@3crunch` into the move box
 * `@@3crunch`, neither of which matches anything or says so anywhere.
 *
 * **Digits go with an `@` and stay with a `#`.** A slot is part of the `@` mark, so the dropdown beside the box is
 * what settles which slot the pill ends up in and a pasted `@3` is dropped with the rest of the mark — which is the
 * one rule here that can ignore something the reader typed, and it is the rule that never writes a string the game
 * cannot read: taking the paste instead would make *First charged* and a pasted `@3` into `@23crunch`. A tag, on the
 * other hand, has every right to be called `3things`, and stripping its digits would search a tag nobody has.
 *
 * Exported for the test, which walks both marks over text that carries one and text that does not.
 */
export const unmarked = (mark: string, text: string) => text.replace(mark.startsWith('@') ? /^@\d*/ : /^#/, '');

/**
 * The pills one of the marked boxes makes of what a reader typed: the text split the way the name box splits it, each
 * part behind the mark the game reads it by.
 *
 * These are `name` pills, which is what they are: the game matches a word it does not know against the names in
 * storage, and `@hydro pump` and `#keepers` are two more texts the catalogue cannot hold. So they need no kind of
 * their own — they compose, read back and shorten as any name does, the mark being what keeps the shortener off them.
 *
 * **Split on the comma**, through the same `names` the name box uses. A pill is one alternative within a clause and a
 * comma inside one is the game's own *or*, so `crunch,bite` left whole composed `@3crunch,bite` out of a single pill:
 * the game reads two alternatives there, `parse.js` reads it back as an `any` of two, and the cards go on showing one
 * pill that asks neither.
 *
 * **Split first, unmark second**, which is the order and not an arrangement of it. Unmarking the string instead took
 * the mark off its head alone, so a pasted `#keepers,#dupes` came out `#keepers` and `##dupes` — the same silent miss
 * the unmarking was added to stop, one comma along. The two halves were each right and wrong together, which is why
 * this is one exported function rather than two: a test of the pieces passed over it.
 *
 * The rest of the game's punctuation is left alone, and **what that costs is a silent split rather than a refusal.**
 * `parse.js` reads four of those characters as operators and says nothing: `&` and `|` come back as two pills in an
 * `all`, `;` and `:` as two in an `any`, and in each the mark is lost off everything after the first — so a tag
 * genuinely called `a&b` composes `#a&b` and reads back as a pill asking for the ordinary word `b`. Only `!`, `(` and
 * `)` are refused. It is left alone because the game has no quoting syntax either and no string searches that tag, and
 * because it is a limitation of all three boxes rather than of these two; `parse.test.js` pins it from the other side,
 * `a|b` composing and reading back as `a&b`.
 *
 * Exported whole rather than in pieces, for the reason the ordering above gives: the test calls it as the page does.
 */
export const marked = (mark: string, text: string) => names(text).map((part) => `${mark}${unmarked(mark, part)}`);

/** What a term chip's tooltip says: the word the game reads, then what pressing it does. */
export const chipTitle = (term: string) => `${term} — press to add it to this card, again to take it off`;

/**
 * What a range chip's tooltip says: the shape a span of it is written in, then what pressing the chip does.
 *
 * The shape comes through `spanned`, the writer that owns which end of a span a phrase sits on, so `cp{N}` and
 * `{N}attack` are one answer rather than two spellings. The dex is the one range with no phrase at either end and so
 * nothing for that to show, which is what the words are for — and reaching them off an empty `prefix` is what gave
 * all three IVs the dex's tooltip, every one of them having an empty prefix too.
 *
 * The test holds every range in the table to naming its own phrase.
 */
export const rangeTitle = (range: Range) => {
  const shape = range.prefix === '' && range.suffix === undefined ? 'a dex span' : spanned(range, '{N}');

  return `${shape} — press to add a span to this card, again to take it off`;
};

/** Whether two paths name the same node, which is how a span's box knows it is the one being typed in. */
const same = (one: Path, two: Path) => one.length === two.length && one.every((index, at) => two[at] === index);

/**
 * A sentence split on its backticks: prose at the even positions and the quoted characters at the odd ones, the string
 * having begun outside a pair.
 *
 * **An unpaired tick is prose rather than markup**, so the tail it opens is rejoined and left as text. One caller of
 * `ticked` in `pages/search.js` is a refusal from `parse.js` that quotes a token the reader typed, and a reader can
 * type a tick — in a name, where the box splits on commas and leaves everything else alone. Pairing from the left and
 * giving up on the last one is what keeps that from setting the rest of the refusal in `<code>`: `terms.test.js` holds
 * the help table to pairs, and this holds the strings that arrive from outside any table.
 *
 * The page's `ticked` is the only caller; the test calls it directly.
 */
export function spans(message: string): string[] {
  const parts = message.split('`');

  return parts.length % 2 === 0 ? [...parts.slice(0, -2), parts.slice(-2).join('`')] : parts;
}

/**
 * A bound as the tree should hold it: a number inside the range's limits, or nothing where the box is empty.
 *
 * The test walks a year in beside `boxText` below.
 */
export function readBound(value: string, range: Range) {
  if (value.trim() === '') {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isNaN(parsed) ? null : bounded(parsed, range);
}

/** Which end of a span a box edits, which is the field it writes. */
export type Edge = 'from' | 'to';

/**
 * The levels an end of a named span offers: every level that leaves the span saying something, plus whichever one the
 * end is already set to.
 *
 * **A span covering the whole range says nothing, and three picks reached one.** A `from` on the floor with the other
 * end open writes `buddy0-`, which the phrase list reads as values at or above nought; a `to` on the ceiling with the
 * lowest open writes `buddy-5`, values at or below five; and the two of them picked the other way round — lowest five,
 * highest nought — is inverted, which `leafText` swaps into `buddy0-5`. All three are the whole of storage, and on a
 * *Safe to transfer* search the negated form of one excludes every Pokémon the reader owns from the string.
 *
 * So the floor goes from the lowest end, the ceiling from the highest, and each end is held to the other's side of the
 * span. Nothing is lost by any of it: a span that starts on the floor asks for the same set as one with that end left
 * open, and so does one that ends on the ceiling — `buddy0-3` and `buddy-3` are two spellings of levels nought to
 * three, `buddy2-5` and `buddy2-` two of levels two to five. *Shorten* drops a no-op span and the caveat under the box
 * names one, but both are after the fact, and a dropdown can decline to offer it in the first place.
 *
 * **The bound comes in because a tree can hold what the control would not offer.** `buddy0` is the documented
 * spelling of *never a buddy*, so the Advanced pane and a shared link both arrive with a `from` of nought, and a
 * `select` whose value matches none of its options selects nothing at all — the end rendered blank over a query
 * matching the whole of storage, measured rather than reasoned about. Offering a bound where it is already set leaves
 * it unpickable while keeping the control honest about the state it is showing.
 *
 * The test sweeps the pairs the two ends can reach in either order of picking.
 */
export const pickable = (
  range: Range,
  edge: Edge,
  bound: number | null,
  other: number | null,
): readonly { level: number | null; name: string }[] => {
  const floor = range.min ?? 0;
  const levels = (range.levels ?? [])
    .map((name, level) => ({ level, name }))
    .filter(({ level }) => {
      const within = edge === 'from' ? level > floor : level < range.max;
      const beside = other === null || (edge === 'from' ? level <= other : level >= other);

      return level === bound || (within && beside);
    });

  /*
   * The blank is one of the options rather than a fixture beside them, because it reaches the same span as a bound on
   * the limit does and has to be refused on the same terms: clearing the lowest end while the highest sits on the
   * ceiling writes `buddy-5`, and clearing the highest while the lowest sits on the floor writes `buddy0-`. Both are
   * two picks from a state the Advanced pane or a link supplies — `buddy5` and `buddy0` are the natural spellings —
   * and neither was reachable by picking a level, which is why holding the levels alone left this open.
   *
   * It stays where this end is already blank, or clearing a pill would need the other end moved first. The pill can
   * always be emptied, though not always in one step: with the lowest on five the highest still clears, and with the
   * highest on nought the lowest does, each end pinning the other and so leaving one of them free. A span the floor
   * and the ceiling hold *both* ends of — `buddy0-5`, which only the Advanced pane or a link supplies — pins each by
   * the other, so it empties in three: a level moved, and then each end cleared in turn. Three is the worst any state
   * takes, which `controls.test.js` walks the transitions for rather than this sentence claiming it. Refusing to open a
   * span already open would be the wrong reading of this: what is refused is opening one that is not.
   */
  const opens = bound === null || (edge === 'from' ? other !== range.max : other !== floor);

  return opens ? [{ level: null, name: 'Any level' }, ...levels] : levels;
};

/** The box a reader has their caret in, and the digits they have typed into it. */
export interface Typed {
  path: Path;
  edge: Edge;
  text: string;
}

/**
 * What one of a span pill's boxes shows: the digits the reader is typing in *that* box, and the bound the tree holds
 * in every other one.
 *
 * **A box cannot show the clamp back to the reader typing in it.** Every part of a year short of the whole is below
 * the floor of 2016, so a box echoing its own clamp rewrites the text under the caret and the next digit lands on the
 * end of that instead — `year` had two reachable values. The tree still takes a bounded number from every keystroke,
 * a pill the boxes make being one a typed query or a link could have made, which is what `bounded` in `terms.js` is
 * for.
 *
 * The test walks a year in a digit at a time.
 */
export function boxText(typed: Typed | null, path: Path, edge: Edge, bound: number | null): string {
  if (typed !== null && typed.edge === edge && same(typed.path, path)) {
    return typed.text;
  }

  return bound === null ? '' : String(bound);
}

/**
 * Where the last string sent to the phone has got to, and which string that was: an answer is about the string sent, so
 * it is shown only while that is still the string on the page.
 *
 * `unheld` is a press with no phone to send to, a kind of its own because it stops being true in a way the others do
 * not: connecting a phone from the top bar leaves this page mounted and the string unchanged.
 */
export interface Sent {
  query: string;
  kind: 'busy' | 'done' | 'failed' | 'unheld';
  message: string;
}

/**
 * The send the page has an answer to show for, or null where there is none.
 *
 * **A send in flight is shown whatever the string has become**, since the phone is still typing the one it was given
 * and the button is shut until it finishes. Every other answer is about the string sent, so it goes the moment the
 * string on the page is a different one. And an `unheld` press goes the moment a phone is held, string unchanged,
 * because the answer it gave — connect one — has been done.
 */
export const answered = (sent: Sent | null, query: string, held: boolean): Sent | null =>
  sent !== null && (sent.kind === 'busy' || sent.query === query) && !(sent.kind === 'unheld' && held) ? sent : null;
