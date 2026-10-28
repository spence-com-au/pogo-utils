/**
 * The Pokédex page: a tile per species, narrowed by the search behind the button at its foot, and a dialog for the one
 * picked.
 *
 * Every tile is rendered and the filtered-out ones hidden, rather than the grid being rebuilt from what survives: 1025
 * of them is enough that rebuilding on every keystroke would drop their sprites and the reader's scroll position.
 * Keying each by its dex number is what holds the reconciler to that.
 *
 * What is chosen lives in the fragment, as on the search page, so a filtered view or an open species is a link.
 */

import { useEffect, useRef, useState } from 'preact/hooks';

import { CATEGORIES, ENTRIES, GENERATION_NUMBERS, HUNTS, numbered, type Entry } from '../pokedex/entries.js';
import { spriteOf, typeIcon, type Icons } from '../pokedex/icons.js';
import { colourOf, inkOn, type Types } from '../pokedex/types.js';
import {
  availabilityOf,
  emptyState,
  FLAGS,
  fromFragment,
  HUNT_FLAGS,
  matches,
  MODES,
  registered,
  toFragment,
  type State,
} from '../pokedex/state.js';
import { said } from '../errors.js';
import { POKEMON_ICONS, POKEMON_TYPES } from '../generated.js';
import { GENERATIONS, regionOf, regionsOf } from '../pokemon/generations.js';
import { replaceQuery, toHash } from '../router.js';
import { nameFragment } from '../search/query.js';

const HUNT_LABELS = new Map(HUNTS.map(({ id, label }) => [id, label]));
const CATEGORY_LABELS = new Map(CATEGORIES.map(({ id, label }) => [id, label]));

/** A tile's number as the game prints it under the picture: four digits and no `#`. */
const tileNumber = (dex: number) => String(dex).padStart(4, '0');

/**
 * A sprite that says nothing when it fails. The number under it is the tile; a hotlinked picture that does not arrive
 * — offline, or blocked — should leave it looking like an empty slot rather than the browser's broken-image glyph.
 *
 * What failed is remembered as the URL rather than as a boolean, because a fresh `src` deserves a fresh chance to load
 * and a flag would deny it one. `key` on the `<img>` cannot do that job: it replaces the child node while this
 * component's own instance — same type, same position — is reused, so a hook on it survives. The icon table landing is
 * exactly that case, changing the `src` of the 113 species it holds a row for after the derived name has 404d; and a
 * 404 that resolves late calls back into a live component whichever way the two race, so only comparing against the
 * `src` in hand can tell a stale failure from this one's.
 */
function Sprite({ src, size, eager }: { src: string; size: number; eager?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);

  return (
    <img
      class={failed === src ? 'sprite missing' : 'sprite'}
      src={src}
      alt=""
      width={size}
      height={size}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(src)}
    />
  );
}

/**
 * One of the tables `build:sprites` writes, empty until it arrives.
 *
 * The icons are most of a page visit's wait on anything. A fetch that fails leaves the derived name on every tile —
 * right for 912 of the 1025, and the rest keep their number — and an entry without its types loses only its colour and badges, so neither
 * missing table is worth withholding the grid over.
 */
function useTable<T extends object>(path: string, without: string): T | Record<string, never> {
  const [table, setTable] = useState<T | Record<string, never>>({});

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(path);

        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText}`.trim());
        }

        setTable(await res.json());
      } catch (e) {
        console.error(`${path}: ${said(e)} — ${without}`);
      }
    })();
  }, [path, without]);

  return table;
}

/** A type as the game's entry screen draws one: its round icon in a pill of its own colour, with its name beside it. */
function TypeBadge({ type }: { type: string }) {
  return (
    <span class="type" style={{ '--type': colourOf(type), '--type-ink': inkOn(type) }}>
      <img src={typeIcon(type)} alt="" width={20} height={20} decoding="async" />
      {type}
    </span>
  );
}

/** A mark whose glyph is for the eye and whose words are for a screen reader. */
function Mark({ kind, glyph, words }: { kind: string; glyph: string; words: string }) {
  return (
    <span class={`mark ${kind}`} title={words}>
      <span aria-hidden="true">{glyph}</span>
      <span class="sr">{words}</span>
    </span>
  );
}

/** A yes or a no, a tick or a dash to the eye and said as words to a screen reader. */
const YesNo = ({ value, yes, no }: { value: boolean; yes: string; no: string }) =>
  value ? <Mark kind="yes" glyph="✓" words={yes} /> : <Mark kind="no" glyph="—" words={no} />;

/** The forms table, which only a species that has forms gets. */
function Variants({ entry }: { entry: Entry }) {
  return (
    <section class="variants">
      <h3>Forms and variants ({entry.variants.length})</h3>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              {['Form', 'In GO', 'Shiny', 'Wild', 'Hunts'].map((title) => (
                <th key={title} scope="col">
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entry.variants.map(({ name, pokemon, hunts }) => (
              <tr key={name} class={pokemon.released ? undefined : 'unreleased'}>
                <th scope="row">{name}</th>
                <td>
                  <YesNo value={pokemon.released} yes="released" no="not released" />
                </td>
                <td>
                  <YesNo value={pokemon.released && pokemon.shinyEligible} yes="shiny available" no="no shiny" />
                </td>
                <td>
                  <YesNo value={pokemon.released && pokemon.spawns} yes="spawns in the wild" no="does not spawn" />
                </td>
                <td class="hunts">{hunts.map(({ id }) => HUNT_LABELS.get(id)).join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * What the dialog shows for one species, laid out as the game's entry screen is: the picture on a band of the species'
 * own colour with the arrows either side of it, the number and name under it, its types, then the facts and forms.
 */
function Detail({
  entry,
  icons,
  types,
  shinyFirst,
  step,
  first,
  last,
}: {
  entry: Entry;
  icons: Icons;
  types: readonly string[];
  shinyFirst: boolean;
  step: (by: number) => void;
  first: boolean;
  last: boolean;
}) {
  /**
   * The shiny is offered only where the game has one, and this flag is what says so rather than a missing file:
   * PokeAPI draws a shiny for every species, so each of the 64 falling back to it would offer one. The game's own
   * assets are stricter and agree — Hoopa, Volcanion, Cosmog, Kubfu, Urshifu and Zarude have no shiny render, and are
   * exactly the six `pokedex.ts` marks `isNotShinyEligible`.
   *
   * Opened on the shiny in the shiny dex, as the game's own shiny tab opens an entry, and on the ordinary picture
   * otherwise. A toggle is held with the species it was made for, so stepping to the next one starts it afresh. Not
   * by keying this component by dex number, which would remount the step buttons inside it and drop the focus off the
   * one just pressed — and with it the dialog's arrow keys, until the reader tabbed back in.
   */
  const [toggled, setToggled] = useState<{ dex: number; shiny: boolean } | null>(null);

  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  /**
   * A step can still take away the control that had the focus: the arrow just pressed, disabled at either end of the
   * list, or the Shiny toggle, which a species with no shiny does not draw. The focus then falls out of the dialog,
   * and the arrow keys with it, so it is handed to an arrow — the previous one at the end of the list and the next one
   * anywhere else, which is where a reader stepping through goes. With one species left both arrows are disabled, and
   * the dialog's close button takes it instead.
   */
  useEffect(() => {
    const dialog = prevRef.current?.closest('dialog');

    if (document.activeElement !== document.body || !dialog?.open) {
      return;
    }

    if (first && last) {
      dialog.querySelector<HTMLButtonElement>('.close')?.focus();
    } else {
      (last ? prevRef : nextRef).current?.focus();
    }
  }, [entry.dex, first, last]);
  const shiny = entry.shiny && (toggled?.dex === entry.dex ? toggled.shiny : shinyFirst);
  const name = entry.name.toLowerCase();

  return (
    <>
      {/*
       * The band is the first type's colour fading into the second's, as the game blends a dual type; a species whose
       * types have not arrived is drawn in the page's own colour — blue, or gold in the shiny dex — until they do.
       */}
      <div class="hero" style={{ '--type': colourOf(types[0]), '--type2': colourOf(types[1] ?? types[0]) }}>
        <button
          ref={prevRef}
          type="button"
          class="step prev"
          aria-label="Previous species"
          disabled={first}
          onClick={() => step(-1)}
        >
          ‹
        </button>
        <figure class="picture">
          <Sprite src={spriteOf(entry.dex, shiny, icons)} size={240} eager />
        </figure>
        <button
          ref={nextRef}
          type="button"
          class="step next"
          aria-label="Next species"
          disabled={last}
          onClick={() => step(1)}
        >
          ›
        </button>
        {entry.shiny && (
          <button
            type="button"
            class="shiny"
            aria-pressed={shiny}
            aria-label="Shiny"
            title="Shiny"
            onClick={() => setToggled({ dex: entry.dex, shiny: !shiny })}
          >
            ✨
          </button>
        )}
      </div>

      <div class="title">
        <span class="num">{numbered(entry.dex)}</span>
        <h2 id="detailName">{entry.name}</h2>
        {types.length > 0 && (
          <p class="types">
            {types.map((type) => (
              <TypeBadge key={type} type={type} />
            ))}
          </p>
        )}
      </div>

      <div class="info">
        <dl class="facts">
          <dt>Region</dt>
          <dd>{entry.generation === null ? '?' : `${regionOf(entry.dex) ?? '?'} — generation ${entry.generation}`}</dd>

          <dt>In Pokémon GO</dt>
          <dd>{entry.released ? 'Yes' : 'Not yet'}</dd>

          <dt>Shiny</dt>
          <dd>{entry.shiny ? 'Available' : entry.released ? 'Not yet' : '—'}</dd>

          <dt>In the wild</dt>
          <dd>{entry.spawns ? 'Spawns' : entry.released ? 'Never — raids, eggs, research or trades' : '—'}</dd>

          {entry.categories.length > 0 && (
            <>
              <dt>Category</dt>
              <dd>{entry.categories.map((id) => CATEGORY_LABELS.get(id)).join(', ')}</dd>
            </>
          )}

          <dt>Hunts</dt>
          <dd>
            {entry.hunts.length === 0 ? (
              'None — every hunt has it'
            ) : (
              <ul class="hunts">
                {entry.hunts.map(({ id, watched }) => (
                  <li key={id} class={watched ? 'watched' : 'unwatched'}>
                    {HUNT_LABELS.get(id)}
                    {!watched && <span class="note"> — the feed cannot alert on it</span>}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </dl>

        {/*
         * A species not in the game cannot be in the storage a search string is typed into, so it gets no search. The
         * links are keyed by their words rather than their term, which changes with every species: a link rebuilt on
         * each step would take the focus with it.
         */}
        {entry.released && (
          <p class="links">
            {[
              { text: 'Search for it', term: name },
              { text: 'Search its family', term: `+${name}` },
            ].map(({ text, term }) => (
              <a key={text} class="ghost" href={toHash('search', nameFragment(term))}>
                {text}
              </a>
            ))}
          </p>
        )}
      </div>

      {entry.variants.length > 0 && <Variants entry={entry} />}
    </>
  );
}

export default function PokedexPage({ query: fragment }: { query: string }) {
  const [state, setState] = useState<State>(() => fromFragment(fragment));

  const icons: Icons = useTable<Icons>(POKEMON_ICONS, 'some species will show no picture');
  const types: Types = useTable<Types>(POKEMON_TYPES, 'entries will show no types');

  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLDialogElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const queryRef = useRef<HTMLInputElement>(null);
  const regionsRef = useRef<HTMLDialogElement>(null);

  /** Each tile's button by the species it stands for, so a closing dialog can hand the focus back to the right one. */
  const tiles = useRef(new Map<number, HTMLButtonElement>());

  /**
   * The entries the filters leave, in dex order — what the grid shows and what the dialog's arrows step through.
   *
   * Derived on every render rather than kept, which is what retires the ordering the imperative page had to arrange by
   * hand: it filtered before rendering the dialog so the arrows were decided against the current list, since a link
   * that changed the query and the open species together would otherwise place the entry in the list it was replacing.
   */
  const visible = ENTRIES.filter((entry) => matches(entry, state));
  const shown = new Set(visible.map((entry) => entry.dex));

  const open = state.open === null ? null : (ENTRIES.find((entry) => entry.dex === state.open) ?? null);
  const at = open === null ? -1 : visible.findIndex((entry) => entry.dex === open.dex);

  const mine = toFragment(state);

  // A link pasted into the address bar of a page already open changes the fragment without reloading; the shell hands
  // the new query down, and reading it here is what stops the controls describing the previous visit.
  useEffect(() => {
    setState(fromFragment(fragment));
  }, [fragment]);

  // Keyed on the fragment for the reason the search page's is: on the render a link arrives on, the state is still the
  // previous visit's, and writing it back would overwrite the link the reader had just pasted.
  useEffect(() => {
    replaceQuery('pokedex', mine);
  }, [mine]);

  /**
   * The dialog is opened and closed from the state rather than alongside it, so a link naming a species opens it on
   * arrival and a `close` the reader asked for is just the state going back to none.
   */
  useEffect(() => {
    const dialog = dialogRef.current;

    if (dialog === null) {
      return;
    }

    if (open !== null && !dialog.open) {
      dialog.showModal();
    } else if (open === null && dialog.open) {
      dialog.close();
    }
  }, [open]);

  /** Step to the neighbouring species among those the filters leave, so the arrows walk the list the reader sees. */
  function step(by: number) {
    const target = visible[at + by];

    if (at !== -1 && target) {
      setState((was) => ({ ...was, open: target.dex }));
      tiles.current.get(target.dex)?.scrollIntoView({ block: 'nearest' });
    }
  }

  /** Clear the search and the filters, keeping the region and the mode, which are where the reader is. */
  function clearFilters() {
    setState((was) => ({ ...emptyState(), mode: was.mode, generation: was.generation }));
  }

  function toggleFlag(id: string) {
    setState((was) => {
      const flags = new Set(was.flags);

      if (!flags.delete(id)) {
        flags.add(id);
      }

      return { ...was, flags };
    });
  }

  /**
   * A search, the availability control or a toggle narrowing the grid. The region and the mode are not among them:
   * they are where the reader is rather than what they asked to hide, and clearing a search leaves both alone.
   */
  const searching = state.q.trim() !== '' || state.availability !== '' || state.flags.size > 0;

  const region = state.generation === null ? 'All regions' : regionsOf(state.generation);
  const held = visible.filter((entry) => registered(entry, state.mode)).length;

  return (
    <div class="dexroot" data-mode={state.mode}>
      {/*
       * The card the game heads a region's grid with: the region's name, how many of it are registered in this mode
       * against how many there are, and beneath that the counts for every mode but the plain one. Pressing a count
       * switches to its mode, and pressing the one already on goes back to the plain dex — a count is a toggle, where
       * a tab along the foot only ever selects.
       *
       * The counts are over what the filters leave, which is also how the page says a filter did anything, so the card
       * carries the live region rather than a second line of text saying the same number again.
       */}
      <header class="page dexhead">
        <div class="top">
          {/* Named as the page for a screen reader moving by heading, where the eye has the tab bar to say so. */}
          <h1>
            <span class="sr">Pokédex: </span>
            {region}
          </h1>
          <p class="count" aria-live="polite">
            <span class="sr">{MODES.find(({ id }) => id === state.mode)?.label} registered: </span>
            {held} / {visible.length}
          </p>
        </div>
        <ul class="stats" aria-label="Registered in each mode">
          {MODES.filter(({ id }) => id !== 'pokemon').map(({ id, label }) => (
            <li key={id}>
              <button
                type="button"
                aria-pressed={state.mode === id}
                onClick={() => setState((was) => ({ ...was, mode: was.mode === id ? 'pokemon' : id }))}
              >
                <span class="figure">{visible.filter((entry) => registered(entry, id)).length}</span>
                <span class="label">
                  {id === 'perfect' && <span aria-hidden="true">★ </span>}
                  {label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </header>

      <main class="dex">
        <ul class="grid">
          {ENTRIES.map((entry) => {
            const filled = registered(entry, state.mode);

            return (
              <li key={entry.dex} hidden={!shown.has(entry.dex)}>
                <button
                  type="button"
                  class="tile"
                  aria-label={`${tileNumber(entry.dex)} ${entry.name}${filled ? '' : ', not registered'}`}
                  ref={(node) => {
                    if (node === null) {
                      tiles.current.delete(entry.dex);
                    } else {
                      tiles.current.set(entry.dex, node);
                    }
                  }}
                  onClick={() => setState((was) => ({ ...was, open: entry.dex }))}
                >
                  {/*
                   * The game draws a tile as the picture and the number, and an empty one as the number alone. The
                   * label leads with that number, so a voice command can name the tile by what it shows, and adds the
                   * species and whether the slot is filled, which the picture says to the eye.
                   */}
                  {filled && <Sprite src={spriteOf(entry.dex, state.mode === 'shiny', icons)} size={112} />}
                  <span class="num">{tileNumber(entry.dex)}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <p class="nomatch" hidden={visible.length > 0}>
          No species match those filters.
        </p>
      </main>

      {/*
       * The bar that floats over the foot of the game's Pokédex: the mode tabs, and under them the round search, clear
       * and regions buttons. The clear button, the ✕ in the game's close button's place, clears the search and filters
       * — the name, the availability control and the toggles, but not the region or the mode; with none of them set it
       * is left out rather than drawn doing nothing.
       */}
      <nav class="dexbar" aria-label="Pokédex">
        <div class="modes" role="group" aria-label="Mode">
          {MODES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              class="mode"
              aria-pressed={state.mode === id}
              onClick={() => setState((was) => ({ ...was, mode: id }))}
            >
              {label}
            </button>
          ))}
        </div>
        <div class="actions">
          <button
            ref={searchButtonRef}
            type="button"
            class="round search"
            aria-label={searching ? 'Search and filter (filters on)' : 'Search and filter'}
            onClick={() => searchRef.current?.showModal()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10" cy="10" r="6.5" />
              <path d="M15 15l5.5 5.5" />
            </svg>
            {searching && <span class="dot" />}
          </button>
          {searching && (
            <button
              type="button"
              class="round clear"
              aria-label="Clear search and filters"
              onClick={() => {
                clearFilters();

                // The button is gone once there is nothing to clear, and the focus with it; the search beside it is
                // where a reader who has just cleared a search goes next.
                searchButtonRef.current?.focus();
              }}
            >
              ✕
            </button>
          )}
          <button type="button" class="round regions" onClick={() => regionsRef.current?.showModal()}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="6" y="3" width="12" height="6" rx="3" />
              <rect x="3" y="10" width="18" height="4" rx="2" />
              <rect x="6" y="15" width="12" height="6" rx="3" />
            </svg>
            <span class="tag">Regions</span>
          </button>
        </div>
      </nav>

      {/*
       * The search, as a sheet over the grid rather than a bar pinned above it: the game keeps its grid clear and puts
       * searching behind the glass. The grid behind narrows as the reader types, so closing it is the only "apply".
       */}
      <dialog
        ref={searchRef}
        class="sheet"
        aria-label="Search and filter"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            searchRef.current?.close();
          }
        }}
      >
        <section class="controls">
          <div class="row">
            <input
              ref={queryRef}
              type="search"
              placeholder="Name or number"
              autocomplete="off"
              spellcheck={false}
              aria-label="Name or dex number"
              value={state.q}
              onInput={(event) => setState((was) => ({ ...was, q: event.currentTarget.value }))}
            />
            <select
              aria-label="In Pokémon GO"
              value={state.availability}
              onChange={(event) =>
                setState((was) => ({ ...was, availability: availabilityOf(event.currentTarget.value) }))
              }
            >
              <option value="">Released or not</option>
              <option value="in">In Pokémon GO</option>
              <option value="out">Not released yet</option>
            </select>
          </div>

          {/*
           * Toggles rather than a three-state chip like the search page's: every one of these narrows the list, and a
           * species "not Legendary" is what the list already shows once the toggle is off.
           */}
          {[
            { key: 'flags', label: 'Only show', toggles: FLAGS },
            { key: 'hunts', label: 'On a hunt list', toggles: HUNT_FLAGS },
          ].map(({ key, label, toggles }) => (
            <div key={key} class="chips" role="group" aria-label={label}>
              {toggles.map((flag) => (
                <button
                  key={flag.id}
                  type="button"
                  class="chip"
                  aria-pressed={state.flags.has(flag.id)}
                  onClick={() => toggleFlag(flag.id)}
                >
                  {flag.label}
                </button>
              ))}
            </div>
          ))}

          <div class="meta">
            <span class="matched">
              {visible.length} of {ENTRIES.length} species
            </span>
            <button
              type="button"
              class="ghost"
              disabled={!searching}
              onClick={() => {
                clearFilters();

                // Reset disables itself, which drops the focus out of the open sheet; the box it has just emptied is
                // where to start again.
                queryRef.current?.focus();
              }}
            >
              Reset
            </button>
            <button type="button" class="ghost done" onClick={() => searchRef.current?.close()}>
              Done
            </button>
          </div>
        </section>
      </dialog>

      {/*
       * The game's region list: a card per region with its starters, how much of it is registered in this mode and a
       * bar for the rest — "Complete!" once there is none. Counted over the whole region rather than what a search
       * leaves, since it is the dex's progress the card reports and not the search's.
       */}
      <dialog
        ref={regionsRef}
        class="sheet regionlist"
        aria-labelledby="regionsTitle"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            regionsRef.current?.close();
          }
        }}
      >
        <div class="listhead">
          <h2 id="regionsTitle">Pokédex</h2>
          <p>Registered: {ENTRIES.filter((entry) => registered(entry, state.mode)).length}</p>
        </div>
        <ul>
          {[null, ...GENERATION_NUMBERS].map((generation) => {
            const of = ENTRIES.filter((entry) => generation === null || entry.generation === generation);
            const got = of.filter((entry) => registered(entry, state.mode)).length;
            const starters =
              generation === null
                ? [25, 133, 151]
                : (GENERATIONS.find(({ number }) => number === generation)?.starters ?? []);

            return (
              <li key={generation ?? 'all'}>
                <button
                  type="button"
                  class="regioncard"
                  aria-current={state.generation === generation ? 'true' : undefined}
                  onClick={() => {
                    setState((was) => ({ ...was, generation }));
                    regionsRef.current?.close();
                    window.scrollTo({ top: 0 });
                  }}
                >
                  <span class="words">
                    <span class="name">{generation === null ? 'All regions' : regionsOf(generation)}</span>
                    {got === of.length ? (
                      <span class="done">Complete!</span>
                    ) : (
                      <span class="bar" aria-hidden="true">
                        <span style={{ width: `${(100 * got) / Math.max(1, of.length)}%` }} />
                      </span>
                    )}
                    <span class="tally">
                      {got} / {of.length}
                    </span>
                  </span>
                  <span class="art" aria-hidden="true">
                    {starters.map((dex) => (
                      <Sprite key={dex} src={spriteOf(dex, state.mode === 'shiny', icons)} size={96} />
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </dialog>

      {/*
       * One dialog, filled in for whichever species is opened. A modal <dialog> brings the focus trap and Escape to
       * close, neither of which then has to be written. Focus opens on Close rather than on the first button, which is
       * the step back to the previous species and not where a reader who has just picked one means to be.
       */}
      <dialog
        ref={dialogRef}
        class="detail"
        aria-labelledby="detailName"
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            step(-1);
          } else if (event.key === 'ArrowRight') {
            step(1);
          }
        }}

        // A click on the backdrop lands on the dialog itself rather than on anything inside it, which is the one way to
        // tell the two apart without a wrapper element.
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            dialogRef.current?.close();
          }
        }}

        onClose={() => {
          const dex = state.open;

          setState((was) => ({ ...was, open: null }));

          // showModal() hands focus back to whatever had it, which after stepping with the arrows is an arrow button
          // inside a dialog now closed. Send it to the tile for the species last shown, which is where the reader is.
          if (dex !== null) {
            tiles.current.get(dex)?.focus();
          }
        }}
      >
        {open !== null && (
          <>
            <div class="body">
              <Detail
                entry={open}
                icons={icons}
                types={types[open.dex] ?? []}
                shinyFirst={state.mode === 'shiny'}
                step={step}
                first={at <= 0}
                last={at === -1 || at >= visible.length - 1}
              />
            </div>

            {/*
             * The round close button the game puts at the foot of every screen, pinned there while the entry
             * scrolls.
             */}
            <div class="foot">
              <button
                type="button"
                class="close"
                aria-label="Close"
                autofocus
                onClick={() => dialogRef.current?.close()}
              >
                ✕
              </button>
            </div>
          </>
        )}
      </dialog>

      <footer>
        <p>
          Every species, what of it is in the game, which have a shiny, and which of the hunts still want it. The
          Pokémon tab fills a tile for every species in the game; each of the others redraws the grid as that hunt's
          dex, filling a tile for a species that is in the game — with its shiny out, in the Shiny dex — and that the
          hunt's list no longer wants. Anything else is left as an empty tile.
        </p>
        <p>
          Read from the same Pokédex and hunt lists the PGSharp backup is built from, so the two cannot disagree.
          Pictures are the game's own, from PokeMiners, with PokeAPI's sprite for a species the game has no artwork for.
          The link updates as you filter, so a view can be shared or bookmarked.
        </p>
        <p>This site is unofficial.</p>
      </footer>
    </div>
  );
}
