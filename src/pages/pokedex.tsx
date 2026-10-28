/**
 * The Pokédex page: a card per species, narrowed by the controls above them, and a dialog for the one picked.
 *
 * Every card is rendered and the filtered-out ones hidden, rather than the grid being rebuilt from what survives: 1025
 * of them is enough that rebuilding on every keystroke would drop their sprites and the reader's scroll position.
 * Keying each by its dex number is what holds the reconciler to that.
 *
 * What is chosen lives in the fragment, as on the search page, so a filtered view or an open species is a link.
 */

import { useEffect, useRef, useState } from 'preact/hooks';

import { CATEGORIES, ENTRIES, GENERATION_NUMBERS, HUNTS, numbered, type Entry } from '../pokedex/entries.js';
import { spriteOf, type Icons } from '../pokedex/icons.js';
import { colourOf, typeIcon, type Types } from '../pokedex/types.js';
import {
  availabilityOf,
  emptyState,
  FLAGS,
  fromFragment,
  HUNT_FLAGS,
  matches,
  toFragment,
  type State,
} from '../pokedex/state.js';
import { said } from '../errors.js';
import { POKEMON_ICONS, POKEMON_TYPES } from '../generated.js';
import { replaceQuery, toHash } from '../router.js';
import { nameFragment } from '../search/query.js';

const HUNT_LABELS = new Map(HUNTS.map(({ id, label }) => [id, label]));
const CATEGORY_LABELS = new Map(CATEGORIES.map(({ id, label }) => [id, label]));

/**
 * The region each generation is named by, which is how the game's own Pokédex divides itself: a row of region tabs
 * across the top rather than generation numbers.
 *
 * Generation 8 is two regions: Galar, and Hisui from Wyrdeer (899) to Enamorus (905). The tabs filter by generation, so
 * that one tab is named for both — splitting it would change what `g=8` means in a link already shared — while an entry
 * names the one region it is from.
 */
const REGIONS = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova', 'Kalos', 'Alola', 'Galar & Hisui', 'Paldea'];

const FIRST_HISUIAN = 899;
const LAST_HISUIAN = 905;

const regionOf = (generation: number) => REGIONS[generation - 1] ?? `Generation ${generation}`;

const regionOfEntry = ({ dex, generation }: Entry) =>
  generation === null
    ? '?'
    : dex >= FIRST_HISUIAN && dex <= LAST_HISUIAN
      ? 'Hisui'
      : generation === 8
        ? 'Galar'
        : regionOf(generation);

/**
 * A sprite that says nothing when it fails. The name over it is the card; a hotlinked picture that does not arrive —
 * offline, or blocked — should leave a blank tile rather than the browser's broken-image glyph.
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
 * The icons are most of a page visit's wait on anything. A fetch that fails leaves the derived name on every card —
 * right for 912 of the 1025, and the rest keep their name and number — and the types only colour an entry, so neither
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
    <span class="type" style={{ '--type': colourOf(type) }}>
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
  step,
  first,
  last,
}: {
  entry: Entry;
  icons: Icons;
  types: readonly string[];
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
   * Held as the species it was turned on for, so stepping to the next one shows its ordinary picture. Not by keying
   * this component by dex number, which would remount the step buttons inside it and drop the focus off the one just
   * pressed — and with it the dialog's arrow keys, until the reader tabbed back in.
   */
  const [shinyDex, setShinyDex] = useState<number | null>(null);
  const shiny = shinyDex === entry.dex;
  const name = entry.name.toLowerCase();

  return (
    <>
      {/*
       * The band is the first type's colour fading into the second's, as the game blends a dual type; a species whose
       * types have not arrived is drawn in the page's own teal until they do.
       */}
      <div class="hero" style={{ '--type': colourOf(types[0]), '--type2': colourOf(types[1] ?? types[0]) }}>
        <button type="button" class="step prev" aria-label="Previous species" disabled={first} onClick={() => step(-1)}>
          ‹
        </button>
        <figure class="picture">
          <Sprite src={spriteOf(entry.dex, shiny, icons)} size={240} eager />
        </figure>
        <button type="button" class="step next" aria-label="Next species" disabled={last} onClick={() => step(1)}>
          ›
        </button>
        {entry.shiny && (
          <button
            type="button"
            class="shiny"
            aria-pressed={shiny}
            aria-label="Shiny"
            title="Shiny"
            onClick={() => setShinyDex(shiny ? null : entry.dex)}
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

      <div class="grid2">
        <dl class="facts">
          <dt>Region</dt>
          <dd>{entry.generation === null ? '?' : `${regionOfEntry(entry)} — generation ${entry.generation}`}</dd>

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

        {/* A species not in the game cannot be in the storage a search string is typed into, so it gets no search. */}
        {entry.released && (
          <p class="links">
            {[
              { text: 'Search for it', term: name },
              { text: 'Search its family', term: `+${name}` },
            ].map(({ text, term }) => (
              <a key={term} class="ghost" href={toHash('search', nameFragment(term))}>
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
  const types: Types = useTable<Types>(POKEMON_TYPES, 'entries will not be coloured by type');

  const dialogRef = useRef<HTMLDialogElement>(null);

  /** Each card's button by the species it stands for, so a closing dialog can hand the focus back to the right one. */
  const cards = useRef(new Map<number, HTMLButtonElement>());

  /**
   * The entries the filters leave, in dex order — what the grid shows and what the dialog's arrows step through.
   *
   * Derived on every render rather than kept, which is what retires the ordering the imperative page had to arrange by
   * hand: it filtered before rendering the dialog so the arrows were decided against the current list, since a link
   * that changed the query and the open species together would otherwise place the entry in the list it was replacing.
   */
  const visible = ENTRIES.filter((entry) => matches(entry, state));
  const shown = new Set(visible.map((entry) => entry.dex));
  const filtered = visible.length !== ENTRIES.length;

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
      cards.current.get(target.dex)?.scrollIntoView({ block: 'nearest' });
    }
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

  return (
    <>
      <header class="page banner">
        <h1>Pokédex</h1>
        <p class="sub">
          Every species, what of it is in the game, which have a shiny, and which of the hunts still want it. Pick one
          to see its forms.
        </p>

        {/*
         * The counts over what the filters leave, which is also how the page says a filter did anything: it is the
         * only part of the page that answers them, so it carries the live region rather than a second line of text
         * saying the same number again.
         *
         * The word is the `<dt>` and the figure its `<dd>` — "species, which is 1025" — rather than the other way
         * round, which would be markup defining the number. Source order is the one HTML allows, and the stylesheet is
         * what paints the figure above its word.
         */}
        <dl class="tally" aria-live="polite">
          {[
            { label: 'species', of: visible },
            { label: 'in Pokémon GO', of: visible.filter((entry) => entry.released) },
            { label: 'with a shiny', of: visible.filter((entry) => entry.shiny) },
          ].map(({ label, of }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{of.length}</dd>
            </div>
          ))}
        </dl>
      </header>

      <main class="dex">
        <section class="controls" aria-label="Filter the Pokédex">
          {/*
           * The region tabs the game's Pokédex opens on, each standing for its generation. Toggles rather than tabs to
           * a screen reader: they narrow the one list below rather than switching between panels, and pressing the
           * pressed one again goes back to the whole dex.
           */}
          <div class="regions" role="group" aria-label="Region">
            <button
              type="button"
              class="region"
              aria-pressed={state.generation === null}
              onClick={() => setState((was) => ({ ...was, generation: null }))}
            >
              All
            </button>
            {GENERATION_NUMBERS.map((number) => (
              <button
                key={number}
                type="button"
                class="region"
                aria-pressed={state.generation === number}
                title={`Generation ${number}`}
                onClick={() => setState((was) => ({ ...was, generation: was.generation === number ? null : number }))}
              >
                {regionOf(number)}
              </button>
            ))}
          </div>

          <div class="row">
            <input
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
            <button
              type="button"
              class="ghost"
              disabled={!filtered}
              onClick={() => setState((was) => ({ ...emptyState(), open: was.open }))}
            >
              Reset
            </button>
          </div>
        </section>

        <ul class="grid">
          {ENTRIES.map((entry) => (
            <li key={entry.dex} hidden={!shown.has(entry.dex)}>
              <button
                type="button"
                class={entry.released ? 'card' : 'card unreleased'}
                style={{ '--type': colourOf(types[entry.dex]?.[0]) }}
                ref={(node) => {
                  if (node === null) {
                    cards.current.delete(entry.dex);
                  } else {
                    cards.current.set(entry.dex, node);
                  }
                }}
                onClick={() => setState((was) => ({ ...was, open: entry.dex }))}
              >
                {/*
                 * The number above the picture and the name under it, as the game's own grid has them. The name is
                 * first in the markup all the same, so a screen reader says the species before its number.
                 */}
                <span class="name">{entry.name}</span>
                <span class="num">{numbered(entry.dex)}</span>
                <Sprite src={spriteOf(entry.dex, false, icons)} size={112} />

                <span class="marks">
                  {entry.shiny && <Mark kind="shiny" glyph="✨" words="shiny available" />}
                  {!entry.released && <Mark kind="out" glyph="🔒" words="not in Pokémon GO yet" />}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <p class="empty" hidden={visible.length > 0}>
          No species match those filters.
        </p>
      </main>

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
          // inside a dialog now closed. Send it to the card for the species last shown, which is where the reader is.
          if (dex !== null) {
            cards.current.get(dex)?.focus();
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
                step={step}
                first={at <= 0}
                last={at === -1 || at >= visible.length - 1}
              />
            </div>

            {/* The round close button the game puts at the foot of every screen, pinned there while the entry scrolls. */}
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
          Read from the same Pokédex and hunt lists the PGSharp backup is built from, so the two cannot disagree.
          Pictures are the game's own, from PokeMiners, with PokeAPI's sprite for a species the game has no artwork for.
          The link updates as you filter, so a view can be shared or bookmarked.
        </p>
        <p>This site is unofficial.</p>
      </footer>
    </>
  );
}
