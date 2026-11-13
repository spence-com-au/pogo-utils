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

import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { loadChunk } from '../chunks.js';
import { said } from '../errors.js';
import { usePhone } from '../phone-store.js';
import { compose, emptyState, fromFragment, names, presetTree, toFragment, type State } from '../search/query.js';
import {
  loadFavourites,
  loadHidden,
  shelved,
  storeFavourites,
  storeHidden,
  toggled,
  withFavourite,
  withoutFavourite,
  type Favourite,
} from '../search/favourites.js';
import { current } from '../search/optimise.js';
import { read } from '../search/parse.js';
import { replaceQuery } from '../router.js';
import { ticked } from '../ticked.js';
import { stepped, suggestions, written as speciesTerm, type Offer } from '../search/species.js';
import { GROUPS, PRESETS, RANGES, RANGES_BY_ID, type Range } from '../search/terms.js';
import {
  answered,
  boxText,
  chipTitle,
  marked,
  pickable,
  rangeTitle,
  readBound,
  type Edge,
  type Sent,
  type Typed,
} from '../search/controls.js';
import { added, afterPress, asCards, cardsOf, holds, pillsOf } from '../search/cards.js';
import { clausesOf } from '../search/clauses.js';
import {
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

/** A chip in the sheet: what it is called, what it writes and whether the card the sheet was opened for holds it. */
function Chip({
  label,
  title,
  state,
  onPress,
}: {
  label: string;
  title: string;
  state: keyof typeof CHIP;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      class="chip"
      data-state={state}
      title={title}
      aria-label={`${label} — ${CHIP[state].said}`}
      aria-pressed={state === 'in'}
      onClick={onPress}
    >
      <span class="state" aria-hidden="true">
        {CHIP[state].glyph}
      </span>
      <span class="name">{label}</span>
    </button>
  );
}

/**
 * One of the boxes that put a mark in front of what is typed — the `@` move box and the `#` tag box. Anything given as
 * children, the move box's slot dropdown, sits ahead of the field.
 */
function MarkedBox({
  value,
  placeholder,
  label,
  onValue,
  take,
  children,
}: {
  value: string;
  placeholder: string;
  label: string;
  onValue: (value: string) => void;
  take: (text: string) => boolean;
  children?: ComponentChildren;
}) {
  return (
    <div class="marked">
      {children}

      <input
        class="field"
        type="text"
        value={value}
        placeholder={placeholder}
        autocomplete="off"
        spellcheck={false}
        aria-label={label}
        onInput={(event) => onValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && take(value)) {
            event.preventDefault();
            onValue('');
          }
        }}
      />

      <button
        type="button"
        onClick={() => {
          if (take(value)) {
            onValue('');
          }
        }}
      >
        Add
      </button>
    </div>
  );
}

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
  { id: 'builder', label: 'Builder', said: 'Pick filters from a list' },
  { id: 'advanced', label: 'Advanced', said: 'Type the search yourself, brackets included' },
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

/** A path as a key. */
const pathAttribute = (path: Path) => path.join('.');

/** The length of the string, said in words. A one-character query is what the shortening makes reachable. */
const characters = (length: number) => `${length} character${length === 1 ? '' : 's'}`;

/** What each end of a span is called, which is the whole of what its box needs beyond the range's own two limits. */
const EDGES: Record<Edge, string> = { from: 'lowest', to: 'highest' };

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

/** The state a link describes, laid out as cards. */
function arrived(fragment: string): State {
  const state = fromFragment(fragment);

  return { ...state, tree: cardsOf(state.tree) };
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
   * import from Settings is what the next save builds on rather than something a copy held here would overwrite. The
   * hidden presets are read the same way. `redraw` is for a removal or a hide, which change nothing else a render
   * reads.
   */
  const [naming, setNaming] = useState('');
  const [unsaved, setUnsaved] = useState(false);
  const [, redraw] = useState(0);
  const favourites = loadFavourites();
  const hidden = loadHidden();

  /**
   * Counted over the presets rather than the stored ids, as the Events page counts its dismissed events: an id whose
   * preset has since been dropped is nothing the toggle could show again.
   */
  const hiddenCount = PRESETS.filter(({ id }) => hidden.includes(id)).length;

  /** Whether the hidden presets are drawn, dimmed, to be shown again. Not stored, as `pane` is not. */
  const [showHidden, setShowHidden] = useState(false);

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

  const { query, was: before, rewrites, lossy, error, mishandled } = current(state);
  const root = cardsOf(state.tree);

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
    resetBoxes();
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

  /** The sheet's box emptied, and the suggestions under it closed. */
  function clearName() {
    setTyping('');
    closeSuggestions();
  }

  /**
   * Every text box on the page emptied, and the pause before the Advanced box is read called off. A new box is emptied
   * here too, or a pasted link and Clear would each leave it holding what it held before.
   */
  function resetBoxes() {
    clearName();
    setMarking('');
    setTagging('');
    setTypedBound(null);
    setTyped('');
    setTypedError(null);
    settle();
  }

  /**
   * A whole arrangement put on the cards in place of the one there, which is what a preset, a favourite and a typed
   * query each are, laid out as cards on the way in. A span box being typed in names a path in the tree being
   * replaced.
   */
  function arrange(tree: Node) {
    setState((was) => ({ ...was, tree: cardsOf(tree) }));
    setTypedBound(null);
  }

  /**
   * The favourites written back with one change made, and the reader told if this browser would not keep it. Answers
   * whether it did, which is what the naming dialog closes on.
   */
  function changeFavourites(change: (list: readonly Favourite[]) => Favourite[]) {
    return written(storeFavourites(change(loadFavourites())));
  }

  /**
   * Showing the hidden presets ends with the last of them shown again, as the toggle is taken away. Left on, it would
   * draw the next preset hidden dimmed in place, a ✕ that seemed to do nothing.
   */
  function toggleHidden(id: string) {
    const left = toggled(loadHidden(), id);

    if (written(storeHidden(left)) && !PRESETS.some((preset) => left.includes(preset.id))) {
      setShowHidden(false);
    }
  }

  function written(stored: boolean) {
    setUnsaved(!stored);
    redraw((count) => count + 1);

    return stored;
  }

  /**
   * The cards with one edit made to them. Every change to the arrangement comes through here, and through `cardsOf` on
   * the way out, so a card a removal has left with one pill or none is tidied whichever edit it was.
   */
  const edit = (change: (tree: Group) => Node) =>
    setState((was) => ({ ...was, tree: cardsOf(change(cardsOf(was.tree))) }));

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
    clearName();
    sheetRef.current?.showModal();
  }

  /** One press of a chip in the sheet, which adds it to the card being filled or takes it back off. */
  function pressChip(leaf: Leaf) {
    if (adding !== null) {
      const { tree, at } = afterPress(root, adding, leaf);

      edit(() => tree);
      setAdding(at);
    }
  }

  /** What a chip in the sheet wears, read off the card being filled. */
  const chipState = (leaf: Leaf) => (adding !== null && holds(root, adding, leaf) ? 'in' : 'off');

  /** Whether a catalogue entry matches what is typed into the sheet's box, by its label or the word the game reads. */
  const wanted = (label: string, term: string) => {
    const sought = typing.trim().toLowerCase();

    return sought === '' || label.toLowerCase().includes(sought) || term.toLowerCase().includes(sought);
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
    resetBoxes();
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
      setSent({
        query,
        kind: 'unheld',
        message: 'No phone connected. Connect one with 📱 in the top bar.',
      });

      return;
    }

    const term = query;
    const say = (kind: Sent['kind'], message: string) => setSent({ query: term, kind, message });

    say('busy', `Searching on ${phone.name}…`);

    try {
      const { searchStorage } = await loadChunk(() => import('../inventory/reader.js'));
      const found = await searchStorage(
        phone.transport,
        term,
        (fraction) => say('busy', `Downloading the OCR model (first time only), ${Math.round(fraction * 100)}%…`),
        (message) => say('busy', `${message}, finding storage…`),
      );
      const counted = found === null ? '' : found === 0 ? ': nothing matched' : `: ${found} Pokémon matched`;

      say('done', `Searched storage on ${phone.name}${counted}.`);
    } catch (e) {
      say('failed', `Could not search on ${phone.name}: ${said(e)}`);
    }
  }

  const sending = sent?.kind === 'busy';
  const answer = answered(sent, query, phone !== null);

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
    const { tree, error: readError } = read(text);
    const laid = tree === null ? null : asCards(tree);

    // A tree that parsed but will not lay out is one spreading past what a search box takes, which the composer says.
    setTypedError(tree === null ? readError : laid === null ? clausesOf(tree).error : null);

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

    clearName();
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

      // Move the active row by `step`, which `stepped` wraps through what was typed.
      setActive(stepped(active, step, offered.length));
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
    const press = leaf.negated ? 'ruled out, press to require it' : 'required, press to rule it out';

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
          aria-label={`${leafLabel(leaf)} — ${press}`}
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
  const ranges = RANGES.filter((range) => wanted(range.label, spanned(range, '')));

  return (
    <>
      <header class="page">
        <h1 class="sr">Search Strings</h1>
        <p class="sub">
          Build a search string for Pokémon GO's storage screen. Pick filters in <em>Builder</em>, or type the search
          yourself in <em>Advanced</em>. Both edit the same search, and the string to copy is at the top.
        </p>
      </header>

      <main class="builder">
        <section class="output" aria-label="The search string">
          <div class="string">
            {/* Plain text, not a label: the live region reads the string out, so nothing reaches it by name. */}
            <span class="side">For the game</span>
            <code id="query" ref={queryRef} class={query ? undefined : 'empty'} aria-live="polite">
              {query || 'Nothing yet'}
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
                    ? 'Connect a phone with 📱 in the top bar to search its storage'
                    : `Search storage on ${phone.name}`
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
            <span class="count">
              {query ? `${characters(query.length)}${before ? `, down from ${before}` : ''}` : ''}
            </span>
            <span class="actions">
              <label class="toggle" title="Write the same search in fewer characters">
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
              <span key={`${from} ${to}`} class="rewrite">
                <code>{from}</code> → <code>{to}</code>
                {index < rewrites.length - 1 ? ', ' : ''}
              </span>
            ))}
            {lossy.narrowed && (
              <span class="lossy">
                {' A dex number matches only the species, where the name would also match nicknames.'}
              </span>
            )}
            {lossy.widened && (
              <span class="lossy">{' A shortened name also matches nicknames that start with it.'}</span>
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
          {PANES.map(({ id, label, said: summary }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`pane-${id}`}
              class="pane-tab"
              title={summary}
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
              <ol class="cards" aria-label="Cards, all of which must match">
                {root.parts.map(renderCard)}
              </ol>
            )}

            <button type="button" class="add-card" onClick={() => openSheet(root.parts.length)}>
              + Add a filter
            </button>

            <p class="help">
              A Pokémon has to match every card, but only one pill on each. Press a pill to switch it between{' '}
              <em>required</em> and <em>ruled out</em>, <kbd>✕</kbd> to remove it, or <em>+ or</em> to add an
              alternative.
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
              {shelved(
                PRESETS.filter(({ id }) => showHidden || !hidden.includes(id)),
                favourites,
              ).map((entry) => {
                if ('preset' in entry) {
                  const { preset } = entry;

                  // A preset is the site's rather than the reader's, so its ✕ hides it, to be shown again, where a
                  // favourite's removes it.
                  const action = hidden.includes(preset.id) ? 'Unhide' : 'Hide';

                  return (
                    <span key={`preset:${preset.id}`} class={action === 'Hide' ? 'saved' : 'saved hidden'}>
                      <button type="button" onClick={() => arrange(presetTree(preset))}>
                        <span>{preset.label}</span>
                        <span class="note">{preset.note}</span>
                      </button>
                      <button
                        type="button"
                        class="drop"
                        title={action}
                        aria-label={`${action} ${preset.label}`}
                        onClick={() => toggleHidden(preset.id)}
                      >
                        {action === 'Hide' ? '✕' : '↩'}
                      </button>
                    </span>
                  );
                }

                // A saved search notes the string it composes, which is the one thing about it a name cannot say.
                const { label, fragment: saved } = entry.favourite;
                const { tree } = fromFragment(saved);

                return (
                  <span key={`saved:${label}`} class="saved">
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

            {hiddenCount > 0 && (
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={(event) => setShowHidden(event.currentTarget.checked)}
                />
                Show {hiddenCount} hidden
              </label>
            )}

            <p class="broken" role="alert" hidden={!unsaved}>
              This browser could not save your favourites. To keep this search, bookmark the page: its link holds the
              search.
            </p>

            <p class="help">
              Save a search with the button beside Copy. Favourites are kept in this browser and included in a backup
              from Settings.
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

          {/* Laid out by hand: Prettier leaves a trailing `{' '}` out of the width it fills to, and so set a line past
              120. */}
          {/* prettier-ignore */}
          <p class="help" id="importHelp">
            <code>&amp;</code> and <code>|</code> mean <em>and</em>; <code>,</code> <code>;</code> and{' '}
            <code>:</code> mean <em>or</em>; <code>!</code> rules out what follows. So{' '}
            <code>(pikachu&amp;shiny),(pumpkaboo&amp;xxl)</code> matches a shiny Pikachu <em>or</em> an XXL Pumpkaboo.
            The game has no brackets, so when you stop typing, the search is rewritten as cards in Builder without them.
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
            This browser could not save it. To keep this search, bookmark the page: its link holds the search.
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
          clearName();
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
              Typing filters the chips below, and <kbd>Enter</kbd> adds what you typed as a name. Partial names match,
              so <code>char</code> finds Charmander and Charizard. After two letters, matching species appear: pick one
              with <kbd>↓</kbd> and <kbd>Enter</kbd>. <em>Charmander (family)</em> writes <code>+charmander</code>,
              which also matches the rest of its evolution line.
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
                      <Chip
                        key={term.id}
                        label={term.label}
                        title={chipTitle(term.term)}
                        state={chip}
                        onPress={() => pressChip(termLeaf(term.id))}
                      />
                    );
                  })}
                </div>
                {category.help && <p class="help">{ticked(category.help)}</p>}
              </section>
            ))}
          </div>
          <section class="panel" aria-labelledby="rangesLabel" hidden={ranges.length === 0}>
            <h2 class="label" id="rangesLabel">
              Ranges
            </h2>
            <div class="chips">
              {ranges.map((range) => {
                const chip = chipState(rangeLeaf(range.id));

                return (
                  <Chip
                    key={range.id}
                    label={range.label}
                    title={rangeTitle(range)}
                    state={chip}
                    onPress={() => pressChip(rangeLeaf(range.id))}
                  />
                );
              })}
            </div>
            {/* Laid out by hand, for the reason the Advanced pane's help gives. */}
            {/* prettier-ignore */}
            <p class="help">
              Leave an end empty, or on <em>Any level</em>, to leave that side open. IVs count in the appraisal's
              bars: <code>0</code> is an IV of 0, <code>1</code> is 1–5, <code>2</code> is 6–10, <code>3</code> is 11–14
              and <code>4</code> is 15, so <code>4</code> to <code>4</code> is a perfect IV.
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

            <MarkedBox
              value={marking}
              placeholder="hydro pump"
              label="Move name, type, special or weather"
              onValue={setMarking}
              take={(text) => takeMarked(`@${slot}`, text)}
            >
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
            </MarkedBox>

            {/* Laid out by hand, for the reason the Advanced pane's help gives. */}
            {/* prettier-ignore */}
            <p class="help">
              A move name, a type, <code>special</code> or <code>weather</code>, in the slot you pick:{' '}
              <em>Second charged</em> and <code>crunch</code> write <code>@3crunch</code>. The <code>@</code> and slot
              come from the dropdown, replacing any you paste. Separate several with commas. The game completes move
              names, so <code>@hydro</code> finds Hydro Pump and Hydro Cannon. Three catches: a type wins over a move of
              the same name, so search <code>@psychi</code> for the move Psychic; <em>Mega extra move</em> takes only
              move names; and a move starting with <code>count</code>, <code>dynamax</code> or{' '}
              <code>gigantamax</code> cannot be searched, because the game reads it as that filter.
            </p>
          </section>

          <section class="panel" aria-labelledby="tagLabel">
            <h2 class="label" id="tagLabel">
              Tag
            </h2>

            <MarkedBox
              value={tagging}
              placeholder="keepers"
              label="Tag name"
              onValue={setTagging}
              take={(text) => takeMarked('#', text)}
            />

            <p class="help">
              A tag by its name, which the game completes too. The <code>#</code> is added for you. For any tag at all,
              use the <em>Tagged</em> chip.
            </p>
          </section>

          <p class="help" hidden={shelves.length > 0 || ranges.length > 0}>
            No filter matches. Press <kbd>Enter</kbd> to add it as a name.
          </p>
        </div>
      </dialog>

      <footer>
        <p>
          Uses Pokémon GO's own search syntax. Everything runs in your browser, and the link updates as you build, so
          you can share or bookmark a search.
        </p>
        <p>This site is unofficial.</p>
      </footer>
    </>
  );
}
