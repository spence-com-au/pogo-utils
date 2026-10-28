/**
 * What the Pokédex page's controls are set to, and which entries that admits. The state lives in the fragment, so a
 * filtered view is a link — which makes the round trip the contract: a state written out and read back is the same
 * state, and a hand-edited fragment can only produce one the controls could have. Nothing here touches the DOM.
 */

import { CATEGORIES, ENTRIES, GENERATION_NUMBERS, HUNTS, type Entry, type HuntId } from './entries.js';
import { fold } from '../pokemon/names.js';

export type Availability = '' | 'in' | 'out';

/**
 * The tabs along the foot of the game's Pokédex, which redraw the same grid as what has been registered in each: every
 * species, then the shinies, then the XXL, XXS and perfect ones. A view rather than a filter — the grid keeps every
 * slot, and the mode decides which are drawn filled and which are left as an empty numbered tile.
 */
export type Mode = 'pokemon' | HuntId;
export type Toggle = { id: string; label: string; test: (entry: Entry) => boolean };

/**
 * What the controls are set to, and which species is open. Held as one object so a link, Reset and a control change are
 * the same kind of thing: replace or amend it and call `update`.
 */
export interface State {
  mode: Mode;
  q: string;
  generation: number | null;
  availability: Availability;
  flags: Set<string>;
  open: number | null;
}

/**
 * The toggles, each with the question it asks of an entry. Every one that is on has to hold, so two of them narrow to
 * what both are true of — Legendary with Shiny is the legendaries that have one.
 */
export const FLAGS: readonly Toggle[] = [
  { id: 'shiny', label: '✨ Has a shiny', test: (entry) => entry.shiny },
  { id: 'wild', label: '🌿 Spawns in the wild', test: (entry) => entry.spawns },
  { id: 'forms', label: 'Has forms', test: (entry) => entry.variants.length > 0 },

  // The annotation above reaches the three literals written here and stops at the `map`, so the callback says what it
  // answers itself — as `HUNT_FLAGS` below has to for the same reason.
  ...CATEGORIES.map(({ id, label }): Toggle => ({ id, label, test: (entry) => entry.categories.includes(id) })),
];

export const HUNT_FLAGS = HUNTS.map(({ id, label }): Toggle => ({
  id: `hunt-${id}`,
  label,
  test: (entry) => entry.hunts.some((hunt) => hunt.id === id),
}));

export const TOGGLES = new Map([...FLAGS, ...HUNT_FLAGS].map((flag) => [flag.id, flag]));

/**
 * Which of the three the availability control is set to. Both the fragment and the `<select>` are read through this:
 * the one is a reader's URL and the other is markup the script does not own, so neither can be taken at its word.
 */
export const availabilityOf = (value: string | null): Availability => (value === 'in' || value === 'out' ? value : '');

/**
 * The modes in the order the game's tabs run. Every one but the plain dex is a hunt list's id, the list whose absence
 * counts as registered: a hunt list is what is still wanted, so a species off the XXL list is one the XXL dex already
 * holds — which is the same reading the game's own XXL tab makes of the storage it looks at.
 */
export const MODES: readonly { id: Mode; label: string }[] = [
  { id: 'pokemon', label: 'Pokémon' },
  { id: 'shiny', label: 'Shiny' },
  { id: 'xxl', label: 'XXL' },
  { id: 'xxs', label: 'XXS' },
  { id: 'perfect', label: '100%' },
];

export const modeOf = (value: string | null): Mode => MODES.find(({ id }) => id === value)?.id ?? 'pokemon';

/**
 * Whether a species fills its tile in a mode: in the plain dex once it is in the game, and in a hunt's once some form
 * of it is in the game, with its shiny out for the shiny hunt, and off the hunt's list — `heldIn`, which `ENTRIES`
 * reads for every hunt as it is built.
 */
export function registered(entry: Entry, mode: Mode) {
  return mode === 'pokemon' ? entry.released : entry.held[mode];
}

export function emptyState(): State {
  return { mode: 'pokemon', q: '', generation: null, availability: '', flags: new Set(), open: null };
}

export function fromFragment(fragment: string) {
  const params = new URLSearchParams(fragment);
  const state = emptyState();
  const generation = Number(params.get('g'));
  const open = Number(params.get('n'));

  state.mode = modeOf(params.get('m'));
  state.q = params.get('q') ?? '';
  state.generation = GENERATION_NUMBERS.includes(generation) ? generation : null;
  state.availability = availabilityOf(params.get('a'));
  state.flags = new Set((params.get('f') ?? '').split('.').filter((id) => TOGGLES.has(id)));
  state.open = ENTRIES.some((entry) => entry.dex === open) ? open : null;

  return state;
}

export function toFragment(state: State) {
  const params = new URLSearchParams();

  if (state.mode !== 'pokemon') {
    params.set('m', state.mode);
  }

  if (state.q.trim()) {
    params.set('q', state.q.trim());
  }

  if (state.generation) {
    params.set('g', String(state.generation));
  }

  if (state.availability) {
    params.set('a', state.availability);
  }

  if (state.flags.size > 0) {
    params.set('f', [...state.flags].join('.'));
  }

  if (state.open) {
    params.set('n', String(state.open));
  }

  return params.toString();
}

/**
 * Whether an entry answers what was typed. A number is a dex number — `25`, `#25` and `#0025` all mean Pikachu, and
 * only Pikachu, since a reader typing a number has one species in mind rather than every number with a 25 in it. Any
 * other text is part of a name, folded the way the search page folds it so `flabebe` still finds Flabébé.
 *
 * The digits are bounded because `0*` and an unbounded `\d+` overlap, and a run of zeros that ends in anything but a
 * digit then backtracks quadratically — over a query read out of a shared link, for every entry in the grid. Seven is
 * already far past the end of the dex, so the bound turns nothing away that could have named a species.
 */
export function matchesQuery(entry: Entry, query: string) {
  const typed = query.trim();

  if (!typed) {
    return true;
  }

  const number = typed.match(/^#?0*(\d{1,7})$/);

  if (number) {
    return entry.dex === Number(number[1]);
  }

  return entry.folded.includes(fold(typed));
}

/**
 * Whether an entry survives every control that is set. The state is a parameter rather than module-scope, so the
 * predicate is a function of what was asked for and nothing else — which is also what lets a test ask it about a state
 * no sequence of clicks would have to be replayed to reach.
 */
export function matches(entry: Entry, state: State) {
  if (!matchesQuery(entry, state.q)) {
    return false;
  }

  if (state.generation && entry.generation !== state.generation) {
    return false;
  }

  if (state.availability === 'in' && !entry.released) {
    return false;
  }

  if (state.availability === 'out' && entry.released) {
    return false;
  }

  // Reading the slot rather than testing `has` first, since nothing at the type level joins the two lookups. An id no
  // toggle answers to is a bug rather than a case — `fromFragment` drops them and the chips only ever add their own —
  // and an empty grid says so where the `TypeError` this used to throw took the page down.
  return [...state.flags].every((id) => TOGGLES.get(id)?.test(entry));
}
