/**
 * The search-string builder page: the query laid out as cards, and a sheet of everything that can go on one.
 *
 * Every card has to match and any one pill on a card will do, which is the game's own shape — `&` between clauses, `,`
 * within one — so the cards *are* the clauses and the string above them says what they say. `cards.js` holds every
 * tree to that shape, a link or a typed query with brackets in it arriving multiplied out.
 *
 * A query can be typed in as well, and that is an import rather than a second composer: `parse.js` reads the brackets
 * into a tree, the cards draw it, and the one composer takes it from there.
 *
 * **The two panes are two views of one state, which is why they are tabs and not pages.** Arranging and typing reach
 * the same tree, so the output card sits above both and stays put as they swap: the answer is the constant and the
 * pane is only how this reader is feeding it. Nothing about the pane is in the link, a link carrying the arrangement
 * and the arrangement drawing in either.
 *
 * The catalogue is a modal sheet rather than a column under the cards, because on a phone that column was most of the
 * page and the cards scrolled away while it was in use. A sheet is opened for one card, so each press in it is one
 * more alternative on that card, and nothing a press does needs a group picked out first.
 *
 * Nothing here knows how a clause is written. The page asks `compose` what the query says and draws what it answers.
 */

import { useEffect, useRef, useState } from 'preact/hooks';

import { said } from '../errors.js';
import { usePhone } from '../phone-store.js';
import { compose, emptyState, fromFragment, names, presetTree, toFragment, type State } from '../search/query.js';
import {
  loadFavourites,
  storeFavourites,
  withFavourite,
  withoutFavourite,
  type Favourite,
} from '../search/favourites.js';
import { optimise, type Lossy } from '../search/optimise.js';
import { read } from '../search/parse.js';
import { replaceQuery } from '../router.js';
import { suggestions, written as speciesTerm, type Offer } from '../search/species.js';
import { bounded, GROUPS, PRESETS, RANGES, RANGES_BY_ID, type Range } from '../search/terms.js';
import { added, asCards, holds, pillsOf, toggled } from '../search/cards.js';
import { clausesOf } from '../search/clauses.js';
import {
  emptyTree,
  isGroup,
  leafLabel,
  leafText,
  spanned,
  update,
  type Group,
  type Leaf,
  type Node,
  type Path,
} from '../search/tree.js';

/** An icon drawn in the text colour of the button it sits in, so it follows the theme and a button's states. */
const icon = (path: string) => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d={path} />
  </svg>
);

const COPY_ICON = 'M8 8h12v12H8zM4 16V4h12';
const DONE_ICON = 'M5 12l5 5L19 7';
const SAVE_ICON = 'M6 3h12v18l-6-4-6 4z';
const SEARCH_ICON = 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13zM20 20l-4.9-4.9';

/**
 * What a chip in the sheet wears in each of its two states — the glyph, and the words a screen reader is given instead
 * of the colour. The state is whether the card the sheet was opened for already holds it.
 */
const CHIP = {
  off: { glyph: '+', said: 'not on this card' },
  in: { glyph: '✓', said: 'on this card' },
} as const;

/**
 * How long a reader has to stop typing in the Advanced box before what is there is laid out, in milliseconds. Long
 * enough to sit between the keys of a word, short enough that a pause to look at the cards finds them up to date.
 */
const IDLE = 800;

/** Which way of writing the query is on show. Both feed the one arrangement; neither is a second state. */
type Pane = 'builder' | 'advanced';

/**
 * The two panes, and what each is for.
 *
 * *Advanced* names the pane for what a reader is doing in it — writing the search out themselves — rather than for any
 * one thing the box accepts. Brackets are the part of it the game cannot do at all, so they are what the help leads
 * with, but a query typed in there needs none: `shiny&lucky` is this pane as much as `(a&b),(c&d)` is, and a tab that
 * said *Brackets* turned one capability into the name of the mode.
 *
 * Not *raw* either, which would point the word at the wrong half: what goes in that box is the *richer* of the two
 * strings, and the raw one is the output above it.
 */
const PANES: readonly { id: Pane; label: string; said: string }[] = [
  { id: 'builder', label: 'Builder', said: 'Arrange pills from the catalogue' },
  { id: 'advanced', label: 'Advanced', said: 'Write the search out yourself, brackets and all' },
];

/**
 * The move slots the game numbers, and what each of them is. A bare `@` asks about every slot at once, which is the
 * common case and so where a fresh search starts.
 *
 * Slot 4 is the extra charged move a Mega can hold, and it is the one that takes a move *name* and nothing else: the
 * community phrase list has `@4{criteria}` not working with a type, with `special` or with `weather`, which is a
 * search a reader can write here and the game will not answer. Said in the help rather than by withholding the option,
 * the slot itself working perfectly well for the move names it is mostly wanted for.
 */
const SLOTS: readonly { value: string; label: string }[] = [
  { value: '', label: 'Any slot' },
  { value: '1', label: 'Fast move' },
  { value: '2', label: 'First charged' },
  { value: '3', label: 'Second charged' },
  { value: '4', label: 'Mega extra move' },
];

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
 * Exported whole for the test rather than in pieces, for the reason the ordering above gives.
 */
export const marked = (mark: string, text: string) => names(text).map((part) => `${mark}${unmarked(mark, part)}`);

/** What a term chip's tooltip says: the word the game reads, then what pressing it does. */
const chipTitle = (term: string) => `${term} — press to add it to this card, again to take it off`;

/**
 * What a range chip's tooltip says: the shape a span of it is written in, then what pressing the chip does.
 *
 * The shape comes through `spanned`, the writer that owns which end of a span a phrase sits on, so `cp{N}` and
 * `{N}attack` are one answer rather than two spellings. The dex is the one range with no phrase at either end and so
 * nothing for that to show, which is what the words are for — and reaching them off an empty `prefix` is what gave
 * all three IVs the dex's tooltip, every one of them having an empty prefix too.
 *
 * Exported for the test, which holds every range in the table to naming its own phrase.
 */
export const rangeTitle = (range: Range) => {
  const shape = range.prefix === '' && range.suffix === undefined ? 'a dex span' : spanned(range, '{N}');

  return `${shape} — press to add a span to this card, again to take it off`;
};

/** A path as a key. */
const pathAttribute = (path: Path) => path.join('.');

/** Whether two paths name the same node, which is how a span's box knows it is the one being typed in. */
const same = (one: Path, two: Path) => one.length === two.length && one.every((index, at) => two[at] === index);

/** The length of the string, said in words. A one-character query is what the shortening makes reachable. */
const characters = (length: number) => `${length} character${length === 1 ? '' : 's'}`;

/**
 * A sentence split on its backticks: prose at the even positions and the quoted characters at the odd ones, the string
 * having begun outside a pair.
 *
 * **An unpaired tick is prose rather than markup**, so the tail it opens is rejoined and left as text. One caller of
 * `ticked` below is a refusal from `parse.js` that quotes a token the reader typed, and a reader can type a tick — in
 * a name, where the box splits on commas and leaves everything else alone. Pairing from the left and giving
 * up on the last one is what keeps that from setting the rest of the refusal in `<code>`: `terms.test.js` holds the
 * help table to pairs, and this holds the strings that arrive from outside any table.
 *
 * Exported for the test; `ticked` is the only caller.
 */
export function spans(message: string): string[] {
  const parts = message.split('`');

  return parts.length % 2 === 0 ? [...parts.slice(0, -2), parts.slice(-2).join('`')] : parts;
}

/**
 * A sentence's backticked parts set in `<code>`, so that prose written in this repository's convention reads on screen
 * the way the caveat beside it does rather than showing its own punctuation.
 *
 * Four callers: the two refusals, from `clauses.js` and `parse.js`; a category's own help in `terms.js`, which was
 * showing its ticks as ticks — `the game has no \`gen1\`` had been on the page since before the canvas; and the
 * caveats beside a phrase the game mishandles, one of which quotes the span it reads a shortcut as instead.
 */
const ticked = (message: string) =>
  spans(message).map((part, index) => (index % 2 === 0 ? part : <code key={index}>{part}</code>));

/**
 * A bound as the tree should hold it: a number inside the range's limits, or nothing where the box is empty.
 *
 * Exported for the test, which walks a year in beside `boxText` below.
 */
export function readBound(value: string, range: Range) {
  if (value.trim() === '') {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isNaN(parsed) ? null : bounded(parsed, range);
}

/** Which end of a span a box edits, which is the field it writes. */
type Edge = 'from' | 'to';

/** What each end of a span is called, which is the whole of what its box needs beyond the range's own two limits. */
const EDGES: Record<Edge, string> = { from: 'lowest', to: 'highest' };

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
 * Exported for the test, which sweeps the pairs the two ends can reach in either order of picking.
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
   * takes, which `search.test.js` walks the transitions for rather than this sentence claiming it. Refusing to open a
   * span already open would be the wrong reading of this: what is refused is opening one that is not.
   */
  const opens = bound === null || (edge === 'from' ? other !== range.max : other !== floor);

  return opens ? [{ level: null, name: 'Any level' }, ...levels] : levels;
};

/**
 * A span pill with one of its ends written. Anything else is handed back as it is: a box's path names its own pill,
 * which the narrowing says rather than a cast asserting it.
 */
function withBound(node: Node, edge: Edge, bound: number | null): Node {
  if (node.kind !== 'range') {
    return node;
  }

  return edge === 'from' ? { ...node, from: bound } : { ...node, to: bound };
}

/** The box a reader has their caret in, and the digits they have typed into it. */
interface Typed {
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
 * Exported for the test, which walks a year in a digit at a time.
 */
export function boxText(typed: Typed | null, path: Path, edge: Edge, bound: number | null): string {
  if (typed !== null && typed.edge === edge && same(typed.path, path)) {
    return typed.text;
  }

  return bound === null ? '' : String(bound);
}

/** What a string nobody shortened says about itself: it is the search arranged, in neither direction. */
const EXACT: Lossy = { narrowed: false, widened: false };

/**
 * The string the page is showing, which is the string the Copy button writes — one answer rather than two compositions
 * that could disagree about which of them the reader is looking at.
 *
 * The optimiser is offered the state and its answer taken only where it is genuinely shorter, so the toggle can never
 * cost characters. Empty does not count as shorter: every star rating at once really does reduce to no clause at all,
 * but a blank output box beside cards full of pills reads as a page that has broken rather than as a search for
 * everything.
 */
function current(state: State) {
  const plain = compose(state);

  if (!state.optimise) {
    return { ...plain, was: null, rewrites: [] as readonly [string, string][], lossy: EXACT };
  }

  const { state: shortened, rewrites, lossy } = optimise(state);
  const short = compose(shortened);
  const worth = short.query.length > 0 && short.query.length < plain.query.length;

  return worth
    ? { ...short, was: plain.query.length, rewrites, lossy }
    : { ...plain, was: null, rewrites: [] as readonly [string, string][], lossy: EXACT };
}

/**
 * Where the last string sent to the phone has got to, and which string that was: an answer is about the string sent, so
 * it is shown only while that is still the string on the page.
 *
 * `unheld` is a press with no phone to send to, a kind of its own because it stops being true in a way the others do
 * not: connecting a phone in Settings leaves this page mounted and the string unchanged.
 */
interface Sent {
  query: string;
  kind: 'busy' | 'done' | 'failed' | 'unheld';
  message: string;
}

/**
 * A tree as the cards the Builder draws. One spreading past what a search box takes has none: only a hand-made link
 * can arrive like that, the Advanced pane refusing such a query before it reaches here.
 */
const cards = (tree: Node): Group => asCards(tree) ?? emptyTree();

/** The state a link describes, laid out as cards. */
function arrived(fragment: string): State {
  const state = fromFragment(fragment);

  return { ...state, tree: cards(state.tree) };
}

export default function SearchPage({ query: fragment }: { query: string }) {
  const [state, setState] = useState<State>(() => arrived(fragment));

  /**
   * The card the sheet is open for, by its index among the cards: one past the last for *Add a filter*, which starts a
   * card with its first press. Null while the sheet is shut.
   */
  const [adding, setAdding] = useState<number | null>(null);

  /** What is typed into the sheet's box: a name to add, and what narrows the chips beneath it. */
  const [typing, setTyping] = useState('');

  /** The two operator searches being typed, and the slot the `@` one asks about. A slot sticks; the text does not. */
  const [marking, setMarking] = useState('');
  const [slot, setSlot] = useState('');
  const [tagging, setTagging] = useState('');

  /** The span pill's box being typed in, if any — `boxText` above says why that is worth a piece of state. */
  const [typedBound, setTypedBound] = useState<Typed | null>(null);

  /** The query being typed into the import box, and why what is in it now cannot be laid out. */
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState<string | null>(null);

  /**
   * Which pane is open. Not in the link and not stored: the arrangement is what a link carries, and it draws in either
   * pane, so the pane is how *this* reader is working rather than anything about the query. Builder to begin with,
   * being the one that needs no syntax known in advance.
   */
  const [pane, setPane] = useState<Pane>('builder');

  /**
   * The name being typed for the next favourite, and whether the last write of the list was refused. The list itself is
   * not state: it is read from storage on every render and every write, as `release-store.ts` reads its version, so an
   * import from Settings is what the next save builds on rather than something a copy held here would overwrite.
   * `redraw` is for a removal, which changes nothing else a render reads.
   */
  const [naming, setNaming] = useState('');
  const [unsaved, setUnsaved] = useState(false);
  const [, redraw] = useState(0);
  const favourites = loadFavourites();

  const [offered, setOffered] = useState<readonly Offer[]>([]);
  const [active, setActive] = useState(-1);
  const [copyLabel, setCopyLabel] = useState('Copy');
  const phone = usePhone();
  const [sent, setSent] = useState<Sent | null>(null);

  const textRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const queryRef = useRef<HTMLElement>(null);
  const namingRef = useRef<HTMLDialogElement>(null);
  const sheetRef = useRef<HTMLDialogElement>(null);

  /** The pause `IDLE` is waiting out in the Advanced box, if one is running. */
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { query, was, rewrites, lossy, error, mishandled } = current(state);
  const root = cards(state.tree);

  /**
   * The fragment this state would be linked as, which is both what goes in the address bar and when to put it there.
   */
  const mine = toFragment(state);

  /**
   * The arrangement as a favourite carries it, which is the link without the Shorten toggle: that is how this reader
   * likes their strings rather than part of what they searched for, so loading a favourite leaves it as it is, the way
   * a preset does.
   */
  const keeping = toFragment({ ...state, optimise: false });

  /**
   * A link pasted into the address bar of a page already open changes the fragment without reloading, and the shell
   * hands the new query down as a prop. Reading it again here is what stops the cards describing the previous visit.
   */
  useEffect(() => {
    setState(arrived(fragment));
    setTyping('');
    setMarking('');
    setTagging('');
    setTypedBound(null);
    setTyped('');
    setTypedError(null);
    settle();
    closeSuggestions();
  }, [fragment]);

  /**
   * Written whenever it changes, which is what keeps the link and the cards from disagreeing about what has been
   * arranged. Keyed on the fragment rather than running after every render, which matters on the way *in*: a link
   * arriving sets the state from an effect, so the render it arrives on still holds the previous visit's.
   */
  useEffect(() => {
    replaceQuery('search', mine);
  }, [mine]);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function closeSuggestions() {
    setOffered([]);
    setActive(-1);
  }

  /**
   * A whole arrangement put on the cards in place of the one there, which is what a preset, a favourite and a typed
   * query each are, laid out as cards on the way in. A span box being typed in names a path in the tree being
   * replaced.
   */
  function arrange(tree: Node) {
    setState((was) => ({ ...was, tree: cards(tree) }));
    setTypedBound(null);
  }

  /**
   * The favourites written back with one change made, and the reader told if this browser would not keep it. Answers
   * whether it did, which is what the naming dialog closes on.
   */
  function changeFavourites(change: (list: readonly Favourite[]) => Favourite[]) {
    const stored = storeFavourites(change(loadFavourites()));

    setUnsaved(!stored);
    redraw((count) => count + 1);

    return stored;
  }

  /**
   * The cards with one edit made to them. Every change to the arrangement comes through here, and through `cards` on
   * the way out, so a card a removal has left with one pill or none is tidied whichever edit it was.
   */
  const edit = (change: (tree: Group) => Node) => setState((was) => ({ ...was, tree: cards(change(cards(was.tree))) }));

  /** A term from the catalogue, as the pill it will become. */
  const termLeaf = (id: string): Leaf => ({ kind: 'term', id, negated: false });

  /** A numeric range from the catalogue, as the pill it will become: its own two boxes, neither filled in yet. */
  const rangeLeaf = (id: string): Leaf => ({ kind: 'range', id, from: null, to: null, negated: false });

  /**
   * The sheet opened for a card, or for a new one past the last. The box starts empty so the whole catalogue shows, and
   * nothing in the sheet is given the focus: the dialog's own first button takes it, which keeps a phone's keyboard
   * from covering the chips most readers came for.
   */
  function openSheet(at: number) {
    setAdding(at);
    setTyping('');
    closeSuggestions();
    sheetRef.current?.showModal();
  }

  /** One press of a chip in the sheet, which adds it to the card being filled or takes it back off. */
  function pressChip(leaf: Leaf) {
    if (adding !== null) {
      edit((tree) => toggled(tree, adding, leaf));
    }
  }

  /** What a chip in the sheet wears, read off the card being filled. */
  const chipState = (leaf: Leaf) => (adding !== null && holds(root, adding, leaf) ? 'in' : 'off');

  /** Whether a catalogue entry matches what is typed into the sheet's box, by its label or the word the game reads. */
  const wanted = (label: string, term: string) => {
    const typed = typing.trim().toLowerCase();

    return typed === '' || label.toLowerCase().includes(typed) || term.toLowerCase().includes(typed);
  };

  /**
   * Back to the blank page, which is every box on it rather than the cards alone: a typed query left behind would sit
   * full above an output box saying nothing was arranged, and the three text boxes are emptied for the same reason.
   *
   * The move slot is not, and nor is the Shorten toggle above it. Both are settings for whatever the reader does next
   * rather than leftovers of what they did last, and both say on screen which way they are set — where a box holds
   * text that has already gone into a pill, and so says nothing true once the cards are gone.
   */
  function clear() {
    setState((was) => ({ ...emptyState(), optimise: was.optimise }));
    setTyping('');
    setMarking('');
    setTagging('');
    setTypedBound(null);
    setTyped('');
    setTypedError(null);
    settle();
    closeSuggestions();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(query);
      setCopyLabel('Copied');
    } catch {
      const shown = queryRef.current;

      if (shown !== null) {
        getSelection()?.selectAllChildren(shown);
      }

      setCopyLabel('Press ⌘C');
    }
  }

  function openNaming() {
    setNaming('');
    setUnsaved(false);
    namingRef.current?.showModal();
  }

  /** The cards saved as a favourite under the name typed, the dialog staying open on a refusal to say so. */
  function saveFavourite(event: Event) {
    event.preventDefault();

    if (changeFavourites((list) => withFavourite(list, { label: naming.trim(), fragment: keeping }))) {
      namingRef.current?.close();
    }
  }

  /**
   * The string typed into storage on the phone, the way `snap --search` types it: from wherever the game is, to the
   * grid and into its box. The OCR it reads its way there with is fetched only now, so a reader with no phone never
   * downloads it.
   */
  async function sendToPhone() {
    // Said where the answer to a search goes, so a reader pressing the greyed-out button learns why it did nothing.
    if (phone === null) {
      setSent({ query, kind: 'unheld', message: 'No phone is connected. Connect one in Settings to search on it.' });

      return;
    }

    const term = query;
    const say = (kind: Sent['kind'], message: string) => setSent({ query: term, kind, message });

    say('busy', `Searching on ${phone.name}…`);

    try {
      const { searchStorage } = await import('../inventory/reader.js');
      const found = await searchStorage(
        phone.transport,
        term,
        (fraction) =>
          say('busy', `Fetching the OCR model, ${Math.round(fraction * 100)}% — once, then kept in this browser…`),
        (message) => say('busy', `${message}, finding storage…`),
      );
      const counted = found === null ? '' : found === 0 ? ': nothing matched' : `: ${found} Pokémon matched`;

      say('done', `Searched storage on ${phone.name}${counted}.`);
    } catch (e) {
      say('failed', `Could not search on ${phone.name}: ${said(e)}`);
    }
  }

  const sending = sent?.kind === 'busy';
  const answer =
    sent !== null && (sending || sent.query === query) && !(sent.kind === 'unheld' && phone !== null) ? sent : null;

  useEffect(() => {
    if (copyLabel === 'Copy') {
      return;
    }

    const restore = setTimeout(() => setCopyLabel('Copy'), 1400);

    return () => clearTimeout(restore);
  }, [copyLabel]);

  /**
   * The arrow keys a tablist promises: left and right step between the tabs, wrapping, and the tab stepped onto is
   * both focused and opened. `Home` and `End` are left out — with two tabs they would be the arrows under other
   * names.
   *
   * **The step counts from the tab the key was pressed on, not from the open one.** Keeping both tabs in the tab
   * order is what lets focus sit on a tab that is not selected, and read off the selection the arrows there did the
   * wrong thing twice over: with two panes, `at + 1` and `at - 1` are the same index, so both keys selected the
   * focused tab and neither moved focus. A roving `tabindex` is what ordinarily keeps the two from diverging, so the
   * reading that gets away with the selection is the one this tablist is not.
   *
   * Focus is then moved by hand, since pressing an arrow has to land on the other button for the next press to come
   * back.
   */
  function onPaneKeyDown(event: KeyboardEvent, from: Pane) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;

    if (step === 0) {
      return;
    }

    event.preventDefault();

    const at = PANES.findIndex((one) => one.id === from);
    const next = PANES[(at + step + PANES.length) % PANES.length];

    if (next) {
      setPane(next.id);
      document.getElementById(`pane-${next.id}`)?.focus();
    }
  }

  /**
   * A typed query put on the cards in place of whatever was there, once the reader stops typing or leaves the box.
   * Replacing rather than merging, because a reader writing a whole search means that search. `replaceQuery` is
   * `replaceState` (`router.js`), so the link in the address bar follows along and the browser's Back button leaves the
   * page rather than stepping back through every query.
   *
   * **Not on every keystroke**, because nearly every keystroke is a query half written: `(pika` is a refusal, and so is
   * `shiny&` on its way to `shiny&lucky`. Said as each key landed, the refusal was under the box from the first
   * character a reader typed, telling them off for a query they had not finished. So the box waits for a pause or a
   * blur before it reads anything, and a keystroke takes the last refusal away.
   *
   * **A query that does not read leaves the cards as they were**, the refusal said under the box and the cards going on
   * showing the last query that read. An empty box is neither, and leaves them too — clearing the text is not asking
   * for every Pokémon.
   *
   * Nothing but this function reads the box, so the two of them holding a query is no state the page has to keep in
   * step — the arrangement is still its only state, and an edit on the cards afterwards is not written back here.
   */
  function importTyped(text: string) {
    const { tree, error } = read(text);
    const laid = tree === null ? null : asCards(tree);

    // A tree that parsed but will not lay out is one spreading past what a search box takes, which the composer says.
    setTypedError(tree === null ? error : laid === null ? clausesOf(tree).error : null);

    if (laid !== null) {
      arrange(laid);
    }
  }

  /** Calls off the pause before the box is read, if one is running. */
  function settle() {
    if (idleRef.current !== null) {
      clearTimeout(idleRef.current);
      idleRef.current = null;
    }
  }

  // A pause outliving the page would lay a query out on cards nobody is looking at.
  useEffect(() => settle, []);

  /**
   * One name finished with, which becomes a pill on the card being filled. A nickname works as well as a species, and
   * several pasted at once are that many alternatives on the one card — `pikachu, eevee` is either of the two, where
   * the two required at once would match nothing.
   *
   * Through `added` rather than `toggled`: the same name twice is one pill's worth of search, and `Enter` is easy to
   * press twice without meaning to take the name off again.
   */
  function takeName(text: string) {
    for (const name of names(text)) {
      if (adding !== null) {
        edit((tree) => added(tree, adding, { kind: 'name', text: name, negated: false }));
      }
    }

    setTyping('');
    closeSuggestions();
  }

  /**
   * One operator search finished with, as pills on the card being filled. Answers whether it committed anything, so
   * the caller empties its own box and only then.
   *
   * `marked` above is the whole of what the text becomes; this is the part that needs the cards. Through `added` for
   * the reason `takeName` is.
   */
  function takeMarked(mark: string, text: string) {
    const parts = adding === null ? [] : marked(mark, text);

    for (const part of parts) {
      if (adding !== null) {
        edit((tree) => added(tree, adding, { kind: 'name', text: part, negated: false }));
      }
    }

    return parts.length > 0;
  }

  function onNameKeyDown(event: KeyboardEvent) {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;

    if (step !== 0) {
      event.preventDefault();

      if (offered.length === 0) {
        setOffered(suggestions(typing));
        setActive(-1);
        return;
      }

      // One slot more than there are rows, so arrowing off either end lands on what was typed rather than wrapping
      // straight past it: the reader can always get their own text back the way they came.
      setActive(((active + step + offered.length + 2) % (offered.length + 1)) - 1);
      return;
    }

    if (event.key === 'Enter') {
      const offer = offered[active];
      const name = offer ? speciesTerm(offer) : typing.trim();

      if (name) {
        event.preventDefault();
        takeName(name);
      }

      return;
    }

    if (event.key === 'Escape' && offered.length > 0) {
      event.preventDefault();
      closeSuggestions();
    }
  }

  /**
   * One end of a span pill, which is a dropdown of names where the range has them and a box to type a number into
   * where it does not. The box shows the reader's own text while their caret is in it, and the bound once it has
   * left, which `boxText` above gives the reason for; a dropdown has neither, and says why below.
   *
   * The box's greyed-out limit is its own `min` or `max` rather than a second spelling of one. It is a limit the
   * input enforces and no longer a bound an empty box composes to, so a placeholder transcribed separately would be
   * free to advertise one the input refuses and nothing would fail.
   */
  function renderBound(path: Path, range: Range, edge: Edge, bound: number | null, other: number | null) {
    const write = (value: string) =>
      edit((tree) => update(tree, path, (node) => withBound(node, edge, readBound(value, range))));

    /*
     * A range whose values the game names picks from them rather than taking digits: `buddy2` is a Good Buddy and a
     * reader cannot be expected to know that, where a CP of 1500 says what it is. A pill the reader has just added
     * has both ends on the blank option and so goes on asking nothing at all, which both ends picked by default would
     * have ended.
     *
     * That option names the absence rather than the end it sits on, as the Pokédex's own selects do with *All
     * generations*: a `select` has no placeholder, so `lowest` there read as a value that had been chosen and said the
     * opposite of what the pill was doing. `EDGES` still names the end, in the label a screen reader reaches it by.
     *
     * No `typedBound` here, that being for digits arriving one at a time: a pick is a whole value or none.
     */
    if (range.levels) {
      return (
        <select
          value={bound === null ? '' : String(bound)}
          aria-label={`${range.label}, ${EDGES[edge]}`}
          onChange={(event) => write(event.currentTarget.value)}
        >
          {pickable(range, edge, bound, other).map(({ level, name }) => (
            <option key={level ?? 'any'} value={level === null ? '' : String(level)}>
              {level === null ? name : `${level} ${name}`}
            </option>
          ))}
        </select>
      );
    }

    const floor = String(range.min ?? 0);
    const ceiling = String(range.max);

    return (
      <input
        type="number"
        min={floor}
        max={ceiling}
        placeholder={edge === 'from' ? floor : ceiling}
        value={boxText(typedBound, path, edge, bound)}
        aria-label={`${range.label}, ${EDGES[edge]}`}
        onInput={(event) => {
          const { value } = event.currentTarget;

          setTypedBound({ path, edge, text: value });
          write(value);
        }}
        onBlur={() => setTypedBound(null)}
      />
    );
  }

  /**
   * One pill. A term and a name say themselves; a range carries its two boxes, because a span is the only pill whose
   * content the reader goes on editing after placing it.
   *
   * Called rather than rendered as `<Pill />`, as is the card below it. A component declared inside this one is a new
   * component *type* on every render, so Preact would unmount and remount every card each time, and a span box would
   * lose the caret on every digit typed into it.
   */
  function renderPill(leaf: Leaf, path: Path) {
    const range = leaf.kind === 'range' ? RANGES_BY_ID.get(leaf.id) : undefined;

    return (
      <span
        key={pathAttribute(path)}
        class={`pill ${leaf.negated ? 'out' : 'in'}`}
        data-kind={leaf.kind}
        title={leafText(leaf) ?? 'nothing yet'}
      >
        <button
          type="button"
          class="face"
          aria-label={`${leafLabel(leaf)} — ${leaf.negated ? 'ruled out' : 'required'}, press to turn it round`}
          onClick={() =>
            edit((tree) => update(tree, path, (node) => (isGroup(node) ? node : { ...node, negated: !node.negated })))
          }
        >
          <span class="state" aria-hidden="true">
            {leaf.negated ? '!' : '✓'}
          </span>
          <span class="name">{leafLabel(leaf)}</span>
        </button>

        {range && leaf.kind === 'range' && (
          <span class="bounds">
            {renderBound(path, range, 'from', leaf.from, leaf.to)}
            <span class="dash">–</span>
            {renderBound(path, range, 'to', leaf.to, leaf.from)}
          </span>
        )}

        <button
          type="button"
          class="drop"
          aria-label={`Remove ${leafLabel(leaf)}`}
          onClick={() => edit((tree) => update(tree, path, () => null))}
        >
          ✕
        </button>
      </span>
    );
  }

  /**
   * One card: its pills, any one of which will do, the press that adds another, and the one that takes the card off.
   * A pill's path is the card's own where the card is that one pill, and a level deeper where it is an `any` of them.
   */
  function renderCard(card: Node, at: number) {
    const pills = pillsOf(card);

    return (
      <li key={at} class="card">
        <header class="card-head">
          <span>{pills.length > 1 ? 'Any of' : 'Match'}</span>
          <button
            type="button"
            class="drop"
            aria-label="Remove this card"
            onClick={() => edit((tree) => update(tree, [at], () => null))}
          >
            ✕
          </button>
        </header>

        <div class="parts">
          {pills.map((leaf, index) => renderPill(leaf, isGroup(card) ? [at, index] : [at]))}

          <button type="button" class="or" aria-label="Add an alternative to this card" onClick={() => openSheet(at)}>
            + or
          </button>
        </div>
      </li>
    );
  }

  /** The catalogue as the sheet shows it: the entries matching what its box holds, in the categories with any. */
  const shelves = GROUPS.map((category) => ({
    ...category,
    terms: category.terms.filter((term) => wanted(term.label, term.term)),
  })).filter((category) => category.terms.length > 0);
  const spans = RANGES.filter((range) => wanted(range.label, spanned(range, '')));

  return (
    <>
      <header class="page">
        <h1>Pokémon GO Search Strings</h1>
        <p class="sub">
          Build a string for the game's own search box, either way round: lay it out as cards in <em>Builder</em>, where
          every card has to match and any one pill on a card will do, or write it out yourself in <em>Advanced</em>,
          brackets and all. Both fill the one query, and the string for the game is always at the top.
        </p>
      </header>

      <main class="builder">
        <section class="output" aria-label="The search string">
          <div class="string">
            {/* Plain text, not a label: the live region reads the string out, so nothing reaches it by name. */}
            <span class="side">For the game</span>
            <code id="query" ref={queryRef} class={query ? undefined : 'empty'} aria-live="polite">
              {query || 'Nothing arranged yet'}
            </code>
            <span class="buttons">
              {/*
               * Icons rather than words, the label going to `aria-label` and `title` instead. The clipboard fallback
               * keeps its words, being an instruction no icon gives.
               */}
              <button
                type="button"
                class={copyLabel === 'Copy' ? 'copy' : 'copy done'}
                aria-label={copyLabel}
                title={copyLabel}
                disabled={!query || error !== null}
                onClick={copy}
              >
                {copyLabel === 'Copy' ? icon(COPY_ICON) : copyLabel === 'Copied' ? icon(DONE_ICON) : copyLabel}
              </button>

              <button
                type="button"
                class="save"
                aria-label="Save"
                title="Save this search as a favourite"
                disabled={keeping === ''}
                onClick={openNaming}
              >
                {icon(SAVE_ICON)}
              </button>

              {/*
               * The same string sent the other way out, which only a phone held over WebUSB gives it. Drawn with no
               * phone as well, greyed out and saying where to connect one, so a reader can find out the page does this.
               *
               * `aria-disabled` rather than `disabled` for the missing phone: a disabled button takes no press, and the
               * press is what says why nothing happened.
               */}
              <button
                type="button"
                class="send"
                aria-label="Search on the phone"
                title={
                  phone === null
                    ? 'Connect a phone in Settings to type this into its Pokémon storage search'
                    : `Type this into Pokémon storage’s search on ${phone.name}`
                }
                aria-disabled={phone === null}
                disabled={!query || error !== null || sending}
                onClick={() => void sendToPhone()}
              >
                {icon(SEARCH_ICON)}
              </button>
            </span>
          </div>

          <div class="meta">
            <span class="count">{query ? `${characters(query.length)}${was ? `, down from ${was}` : ''}` : ''}</span>
            <span class="actions">
              <label class="toggle" title="Say the same thing in fewer characters">
                <input
                  type="checkbox"
                  checked={state.optimise}
                  onChange={(event) => setState((was) => ({ ...was, optimise: event.currentTarget.checked }))}
                />
                Shorten
              </label>
              <button type="button" class="ghost" onClick={clear}>
                Clear
              </button>
            </span>
          </div>

          {answer !== null && (
            <p
              class={answer.kind === 'failed' || answer.kind === 'unheld' ? 'broken' : 'sent'}
              role={answer.kind === 'failed' || answer.kind === 'unheld' ? 'alert' : 'status'}
            >
              {answer.message}
            </p>
          )}

          <p class="broken" hidden={error === null}>
            {ticked(error ?? '')}
          </p>

          <p class="caveat" hidden={mishandled.length === 0}>
            {mishandled.map(({ term, note }) => (
              <span key={term} class="mishandled">
                <code>{term}</code> — {ticked(note)}.
              </span>
            ))}
          </p>

          <p class="help rewritten" hidden={rewrites.length === 0}>
            {rewrites.map(([from, to], index) => (
              <span key={from} class="rewrite">
                <code>{from}</code> → <code>{to}</code>
                {index < rewrites.length - 1 ? ', ' : ''}
              </span>
            ))}
            {lossy.narrowed && (
              <span class="lossy">
                {' A dex number matches the species itself, where the name would also have matched a nickname.'}
              </span>
            )}
            {lossy.widened && (
              <span class="lossy">
                {' A shortened name also matches any nickname beginning with it, which the full name would not.'}
              </span>
            )}
          </p>
        </section>

        {/*
         * The two ways to write the query. Ordinary buttons rather than links, the choice being a view of one state and
         * not a place: a link would put the pane in history beside the arrangements, so Back would step through panes.
         *
         * `role="tablist"` is announced as a tablist — *Builder, tab, selected, 1 of 2* — and that announcement is a
         * promise about the arrow keys whatever the `tabindex` says, which is why `onPaneKeyDown` is here. Selection
         * follows focus, the panes being a show-and-hide rather than anything to fetch.
         *
         * Both tabs keep their place in the tab order rather than taking a roving `tabindex`. With two of them it costs
         * a reader nothing to Tab past one, and it leaves the arrows as a second way across rather than the only one.
         */}
        <div class="panes" role="tablist" aria-label="How to write the query">
          {PANES.map(({ id, label, said }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`pane-${id}`}
              class="pane-tab"
              title={said}
              aria-selected={pane === id}
              aria-controls={`panel-${id}`}
              onClick={() => setPane(id)}
              onKeyDown={(event) => onPaneKeyDown(event, id)}
            >
              {label}
            </button>
          ))}
        </div>

        {/*
         * Hidden rather than unmounted, so the cards a reader comes back to are the ones they left — a pane switch is a
         * change of view and should cost them no scroll position and no half-filled span box.
         */}
        <div class="pane" role="tabpanel" id="panel-builder" aria-labelledby="pane-builder" hidden={pane !== 'builder'}>
          {/* The query itself, which is the pane's subject, under the sticky output that says what it comes to. */}
          <section class="panel" aria-labelledby="cardsLabel">
            <h2 class="label" id="cardsLabel">
              The query
            </h2>

            {root.parts.length === 0 ? (
              <p class="empty">Nothing here yet — add a filter to start.</p>
            ) : (
              <ol class="cards" aria-label="Cards, every one of which has to match">
                {root.parts.map(renderCard)}
              </ol>
            )}

            <button type="button" class="add-card" onClick={() => openSheet(root.parts.length)}>
              + Add a filter
            </button>

            {/* Laid out by hand, for the reason the Advanced pane's help gives. */}
            {/* prettier-ignore */}
            <p class="help">
              Every card has to match, and any one pill on a card will do — which is how the game reads a search, so the
              string above is these cards as they stand. Press a pill to swap <em>required</em> for{' '}
              <em>ruled out</em>, <kbd>✕</kbd> to take it off, and <em>+ or</em> to give its card another alternative.
            </p>
          </section>

          <section class="panel" aria-labelledby="presetsLabel">
            <h2 class="label" id="presetsLabel">
              <span class="ico" aria-hidden="true">
                ⭐
              </span>{' '}
              Favourites
            </h2>
            <div class="presets">
              {PRESETS.map((preset) => (
                <button key={preset.id} type="button" onClick={() => arrange(presetTree(preset))}>
                  <span>{preset.label}</span>
                  <span class="note">{preset.note}</span>
                </button>
              ))}

              {/* A saved search notes the string it composes, which is the one thing about it a name cannot say. */}
              {favourites.map(({ label, fragment }) => {
                const { tree } = fromFragment(fragment);

                return (
                  <span key={label} class="saved">
                    <button type="button" onClick={() => arrange(tree)}>
                      <span>{label}</span>
                      <code class="note">{compose({ tree, optimise: false }).query}</code>
                    </button>
                    <button
                      type="button"
                      class="drop"
                      aria-label={`Remove ${label} from favourites`}
                      onClick={() => changeFavourites((list) => withoutFavourite(list, label))}
                    >
                      ✕
                    </button>
                  </span>
                );
              })}
            </div>

            <p class="broken" role="alert" hidden={!unsaved}>
              This browser would not store that change to your favourites. The link in the address bar still carries the
              search on the cards, so bookmarking it keeps it.
            </p>

            <p class="help">
              Save the search on the cards with the button beside Copy to load it back here with a press; saving under a
              name already taken replaces that favourite. Yours are kept in this browser, and travel with a backup from
              Settings.
            </p>
          </section>
        </div>

        {/*
         * The other way in: the search written out, with the brackets the game has none of. It fills the cards in the
         * pane next door rather than composing a string of its own, so there is still one arrangement and one output —
         * and the pills it leaves can be edited like any others, which is the whole difference between this and a
         * second box that composed beside the first.
         *
         * It takes effect with no button to press, once the reader pauses or leaves the box: `importTyped` says why not on
         * every keystroke.
         *
         * The panel is the card, where the Builder's is a column of them, and it carries no heading of its own: the
         * field's label says what the box holds, and a tab panel is named by the tab that opened it.
         */}
        <div
          class="pane panel"
          role="tabpanel"
          id="panel-advanced"
          aria-labelledby="pane-advanced"
          hidden={pane !== 'advanced'}
        >
          <div class="import">
            {/* Named for the string rather than for its brackets, which are one of the things it may hold. */}
            <label class="side" for="typed">
              Your query
            </label>
            <input
              id="typed"
              type="text"
              value={typed}
              placeholder="(pikachu&shiny),(pumpkaboo&xxl)"
              autocomplete="off"
              spellcheck={false}
              aria-invalid={typedError !== null}
              aria-describedby="importHelp"
              onInput={(event) => {
                const { value } = event.currentTarget;

                setTyped(value);
                setTypedError(null);
                settle();
                idleRef.current = setTimeout(() => {
                  idleRef.current = null;
                  importTyped(value);
                }, IDLE);
              }}
              onBlur={() => {
                // Only where a pause is still running: a blur after it has fired has nothing new to read.
                if (idleRef.current !== null) {
                  settle();
                  importTyped(typed);
                }
              }}
            />
          </div>

          <p class="broken" hidden={typedError === null}>
            {ticked(typedError ?? '')}
          </p>

          {/* Laid out by hand: Prettier leaves a trailing `{' '}` out of the width it fills to, and so set the first
              line five characters past 120. */}
          {/* prettier-ignore */}
          <p class="help" id="importHelp">
            <code>&amp;</code> and <code>|</code> are <em>and</em>, <code>,</code> <code>;</code> and{' '}
            <code>:</code> are <em>or</em>, and <code>!</code> rules out whatever follows — so{' '}
            <code>(pikachu&amp;shiny),(pumpkaboo&amp;xxl)</code> matches a shiny Pikachu <em>or</em> an XXL Pumpkaboo.
            The game takes no brackets, so what you type is multiplied out into cards in the Builder when you pause, each
            one a clause the game does take.
          </p>
        </div>
      </main>

      {/*
       * The name to save the search under. A modal <dialog> brings the focus trap and Escape, as the Pokédex's does,
       * and a click on the backdrop lands on the dialog itself, which is how it is told from a click inside.
       */}
      <dialog
        ref={namingRef}
        class="naming"
        aria-labelledby="namingLabel"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            namingRef.current?.close();
          }
        }}
      >
        <form onSubmit={saveFavourite}>
          <h2 id="namingLabel">Save this search</h2>
          <input
            class="field"
            aria-label="Name"
            placeholder="Name"
            value={naming}
            autocomplete="off"
            autofocus
            onInput={(event) => setNaming(event.currentTarget.value)}
          />
          <p class="help" hidden={!favourites.some(({ label }) => label === naming.trim())}>
            This replaces the favourite already saved under that name.
          </p>
          <p class="broken" role="alert" hidden={!unsaved}>
            This browser would not store it. The link in the address bar still carries the query, so bookmarking it
            keeps the search.
          </p>
          <div class="buttons">
            <button type="button" class="use" onClick={() => namingRef.current?.close()}>
              Cancel
            </button>
            <button type="submit" class="confirm" disabled={naming.trim() === ''}>
              Save
            </button>
          </div>
        </form>
      </dialog>

      {/*
       * The catalogue, opened for one card. A modal <dialog> as the naming one is, for the focus trap and Escape; on a
       * phone it rises from the foot of the screen, where the thumb that opened it already is.
       */}
      <dialog
        ref={sheetRef}
        class="sheet"
        aria-labelledby="sheetLabel"
        onClose={() => {
          setAdding(null);
          setTyping('');
          closeSuggestions();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            sheetRef.current?.close();
          }
        }}
      >
        <header class="sheet-head">
          <h2 id="sheetLabel">
            {adding !== null && adding < root.parts.length ? 'Add an alternative' : 'Add a filter'}
          </h2>
          <button type="button" class="confirm" onClick={() => sheetRef.current?.close()}>
            Done
          </button>
        </header>

        <div class="sheet-body">
          <section class="panel" aria-labelledby="nameLabel">
            <h2 class="label" id="nameLabel">
              Find a filter, or type a name
            </h2>

            <div class="combobox">
              <input
                ref={textRef}
                class="field"
                id="text"
                type="text"
                value={typing}
                placeholder="pikachu"
                autocomplete="off"
                spellcheck={false}
                role="combobox"
                aria-expanded={offered.length > 0}
                aria-controls="suggestions"
                aria-autocomplete="list"
                aria-activedescendant={offered[active] ? `suggestion-${active}` : undefined}
                aria-label="Find a filter, or type a name"
                onInput={(event) => {
                  const parts = event.currentTarget.value.split(',');
                  const left = parts.pop() ?? '';

                  // A comma is what separates names, so typing or pasting one commits the name in front of it —
                  // which is also how a pasted `pikachu, eevee, snorlax` arrives as three pills rather than one.
                  if (parts.length > 0) {
                    takeName(parts.join(','));
                  }

                  setTyping(left);
                  setOffered(suggestions(left));
                  setActive(-1);
                }}
                onKeyDown={onNameKeyDown}
                onBlur={closeSuggestions}
              />

              {/* [html-validate-disable-next prefer-native-element -- a select cannot be a combobox's popup] */}
              <ul
                ref={listRef}
                class="suggestions"
                id="suggestions"
                role="listbox"
                aria-label="Matching species"
                hidden={offered.length === 0}
              >
                {offered.map((offer, index) => (
                  <li
                    key={speciesTerm(offer)}
                    id={`suggestion-${index}`}
                    role="option"
                    aria-selected={index === active}

                    // mousedown rather than click: a click arrives after the blur that closes the list, by which point
                    // there is no row left to have been clicked.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      takeName(speciesTerm(offer));
                    }}
                  >
                    {offer.name}
                    {offer.family && <span class="family"> (family)</span>}
                  </li>
                ))}
              </ul>
            </div>

            <p class="help">
              What you type narrows the chips below, and <kbd>Enter</kbd> adds it to this card as a name. Partial names
              match, so <code>char</code> finds Charmander and Charizard. Two letters bring up the species that match,
              and <kbd>↓</kbd> then <kbd>Enter</kbd> takes one. Each species is followed by its family: taking{' '}
              <em>Charmander (family)</em> writes <code>+charmander</code>, the game's shorthand for a species and the
              rest of its evolutionary line.
            </p>
          </section>

          <div class="groups">
            {shelves.map((category) => (
              <section key={category.id} class="group" style={{ '--hue': String(category.hue) }}>
                <h2 class="label">{category.label}</h2>
                <div class="chips">
                  {category.terms.map((term) => {
                    const chip = chipState(termLeaf(term.id));

                    return (
                      <button
                        key={term.id}
                        type="button"
                        class="chip"
                        data-state={chip}
                        title={chipTitle(term.term)}
                        aria-label={`${term.label} — ${CHIP[chip].said}`}
                        aria-pressed={chip === 'in'}
                        onClick={() => pressChip(termLeaf(term.id))}
                      >
                        <span class="state" aria-hidden="true">
                          {CHIP[chip].glyph}
                        </span>
                        <span class="name">{term.label}</span>
                      </button>
                    );
                  })}
                </div>
                <p class="help">{ticked(category.help)}</p>
              </section>
            ))}
          </div>
          <section class="panel" aria-labelledby="rangesLabel" hidden={spans.length === 0}>
            <h2 class="label" id="rangesLabel">
              Ranges
            </h2>
            <div class="chips">
              {spans.map((range) => {
                const chip = chipState(rangeLeaf(range.id));

                return (
                  <button
                    key={range.id}
                    type="button"
                    class="chip"
                    data-state={chip}
                    title={rangeTitle(range)}
                    aria-label={`${range.label} — ${CHIP[chip].said}`}
                    aria-pressed={chip === 'in'}
                    onClick={() => pressChip(rangeLeaf(range.id))}
                  >
                    <span class="state" aria-hidden="true">
                      {CHIP[chip].glyph}
                    </span>
                    <span class="name">{range.label}</span>
                  </button>
                );
              })}
            </div>
            {/* Laid out by hand, for the reason the Advanced pane's help gives. */}
            {/* prettier-ignore */}
            <p class="help">
              A span pill carries its own two ends — boxes to type a number into, or named dropdowns where the game
              names the values — and an end left empty, or on <em>Any level</em>, leaves that end of the span open,
              unless opening it would ask for everything. Which is why a dropdown's own lowest and highest levels each
              sit at one end: <em>never a buddy</em> is picked as the <em>highest</em> a span reaches,{' '}
              <em>Best Buddy</em> as the <em>lowest</em>, the other way round asking for every Pokémon you own. Three
              of the ranges are not the numbers they look like: an IV is the appraisal's own bucket, where{' '}
              <code>0</code> is an IV of 0, <code>1</code> is 1–5, <code>2</code> is 6–10, <code>3</code> is 11–14
              and <code>4</code> is 15 — so <code>4</code> to <code>4</code> is the perfect one. The Max move levels
              and the counts of unlocked Max moves start at 1, a Max species having its attack from the first.
            </p>
          </section>

          {/*
           * The `@` search, which is one box because the game's own priority is what sorts out what goes in it: a type
           * is read before a move of the same name, and `special` and `weather` before either. So a reader types a
           * move, a type or one of those two words, picks the slot, and the game resolves which they meant — where a
           * box per kind would have been four boxes writing one string.
           *
           * The chips cover the slotless forms a catalogue can hold — the eighteen `@{type}` and the two keywords —
           * and this is for the move names it cannot and for every slot of all of them.
           */}
          <section class="panel" aria-labelledby="moveLabel">
            <h2 class="label" id="moveLabel">
              Move or move criteria
            </h2>

            <div class="marked">
              <select
                aria-label="Which move slot"
                value={slot}
                onChange={(event) => setSlot(event.currentTarget.value)}
              >
                {SLOTS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>

              <input
                class="field"
                type="text"
                value={marking}
                placeholder="hydro pump"
                autocomplete="off"
                spellcheck={false}
                aria-label="Move name, type, special or weather"
                onInput={(event) => setMarking(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && takeMarked(`@${slot}`, marking)) {
                    event.preventDefault();
                    setMarking('');
                  }
                }}
              />

              <button
                type="button"
                onClick={() => {
                  if (takeMarked(`@${slot}`, marking)) {
                    setMarking('');
                  }
                }}
              >
                Add
              </button>
            </div>

            <p class="help">
              A move name, a type, <code>special</code> or <code>weather</code>, in any slot or in one of them — so{' '}
              <em>Second charged</em> and <code>crunch</code> write <code>@3crunch</code>. The <code>@</code> and the
              slot are added for you, the dropdown being what settles the slot, so a phrase pasted here can keep its own
              and will take that one. Several at once go in comma-separated, a pill apiece. Move names complete as you
              go, in the game rather than here, so <code>@hydro</code> finds Hydro Pump and Hydro Cannon alike. Three
              catches: a type is read ahead of a move named the same, so <code>@psychi</code> is how to ask for the move
              Psychic; <em>Mega extra move</em> answers to a move name alone, not to a type or to those two words; and a
              move beginning <code>count</code>, <code>dynamax</code> or <code>gigantamax</code> is read as that
              shortcut phrase rather than as the move, which is a search the game has no spelling for.
            </p>
          </section>

          <section class="panel" aria-labelledby="tagLabel">
            <h2 class="label" id="tagLabel">
              Tag
            </h2>

            <div class="marked">
              <input
                class="field"
                type="text"
                value={tagging}
                placeholder="keepers"
                autocomplete="off"
                spellcheck={false}
                aria-label="Tag name"
                onInput={(event) => setTagging(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && takeMarked('#', tagging)) {
                    event.preventDefault();
                    setTagging('');
                  }
                }}
              />

              <button
                type="button"
                onClick={() => {
                  if (takeMarked('#', tagging)) {
                    setTagging('');
                  }
                }}
              >
                Add
              </button>
            </div>

            <p class="help">
              A tag by the name you gave it. Only you know what you called yours, so there is no chip for one — the{' '}
              <em>Tagged</em> chip is <code>#</code>, the game's word for having any tag at all. Tag names complete in
              the game here too. The <code>#</code> is added for you, and it earns its place: a tag searched without one
              is an ordinary word, which a tag named after a search phrase then loses to.
            </p>
          </section>

          <p class="help" hidden={shelves.length > 0 || spans.length > 0}>
            No filter is called that, so <kbd>Enter</kbd> adds it as a name.
          </p>
        </div>
      </dialog>

      <footer>
        <p>
          The syntax is Pokémon GO's own, as typed into the search box on the Pokémon storage screen. Everything runs in
          your browser, and the link updates as you build so an arrangement can be shared or bookmarked.
        </p>
        <p>This site is unofficial.</p>
      </footer>
    </>
  );
}
