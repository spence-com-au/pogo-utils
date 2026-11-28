/**
 * The reader's own Pokémon the search finds, drawn under the query as cards in a grid of three, the way the game's
 * storage screen lays them out: CP over the picture, the name under it, then the HP bar and the badges. Read from the
 * PGSharp export the 📱 panel holds, so nothing shows until one is read or opened there.
 *
 * **Only the cards in view are drawn.** An account holds thousands of Pokémon, and every pill pressed judges them all
 * again, so a grid that drew each one would rebuild thousands of cards a press. Every card is the same height, which
 * lets the grid stand at its full height while it holds only the rows near the window, the rest of it empty space a
 * scroll brings rows into.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { gameData } from '../core/browser/fetch.js';
import type { GameData } from '../core/game-master.mts';
import { said } from '../errors.js';
import { useInventory } from '../inventory-store.js';
import { judging } from '../search/judge.js';
import { loadSort, resultsOf, shownName, SORTS, sorted, sprites, storeSort, type Sort } from '../search/results.js';
import type { Node } from '../search/tree.js';
import type { Row } from '../tools/inventory/snapshot.mts';

const COLUMNS = 3;

/** The rows of cards drawn past each edge of the window, so a quick scroll does not outrun them. */
const OVERSCAN = 4;

/** The rows drawn before the first card has been measured: enough to fill a tall window. */
const FIRST_ROWS = 8;

const STAR = (
  <svg class="fav" viewBox="0 0 24 24" width="18" height="18" role="img" aria-label="Favourite">
    <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.5L12 17.3 6.1 20.5l1.3-6.5L2.5 9.4l6.6-.8z" />
  </svg>
);

/** The badges a card carries under its HP, each named in words, as a chip's colour alone would not say which it is. */
function badgesOf(row: Row): { kind: string; label: string }[] {
  return [
    row.shiny && { kind: 'shiny', label: 'Shiny' },
    row.lucky && { kind: 'lucky', label: 'Lucky' },
    row.shadow && { kind: 'shadow', label: 'Shadow' },
    row.purified && { kind: 'purified', label: 'Purified' },
    row.max !== null && { kind: 'max', label: row.max === 'gigantamax' ? 'G-Max' : 'Dynamax' },
  ].filter((badge) => badge !== false);
}

function Card({ row, sprite, place, of }: { row: Row; sprite: string | null; place: number; of: number }) {
  return (
    <li class={row.lucky ? 'mon lucky' : 'mon'} aria-posinset={place} aria-setsize={of}>
      <span class="top">
        <span class="cp">
          <small>CP</small> {row.cp ?? '?'}
        </span>
        {row.favourite && STAR}
      </span>
      <span class="sprite">
        {sprite === null ? (
          <span class="unknown" aria-hidden="true">
            ?
          </span>
        ) : (
          <img src={sprite} alt="" width={256} height={256} loading="lazy" decoding="async" />
        )}
      </span>
      <span class="name">{shownName(row)}</span>
      <span class="hp">
        <span class="bar" aria-hidden="true" />
        {row.hp === null ? '' : `${row.hp} HP`}
      </span>
      <span class="badges">
        {badgesOf(row).map(({ kind, label }) => (
          <span key={kind} class={`badge ${kind}`}>
            {label}
          </span>
        ))}
      </span>
    </li>
  );
}

/** Which rows of cards are near the window, and how tall a row is with the gap under it, once one is measured. */
interface View {
  first: number;
  last: number;
  height: number;
}

/**
 * A grid of `rows` that draws only the rows of cards near the window. It measures a card rather than knowing its size,
 * since the stylesheet sizes cards to the column, and measures again whenever the window scrolls or resizes or the
 * rows change, which is when the cards near the window can.
 */
function Grid({
  rows,
  spriteOf,
  label,
}: {
  rows: readonly Row[];
  spriteOf: (row: Row) => string | null;
  label: string;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [view, setView] = useState<View>({ first: 0, last: FIRST_ROWS, height: 0 });
  const lines = Math.ceil(rows.length / COLUMNS);

  useLayoutEffect(() => {
    const list = listRef.current;

    if (list === null) {
      return;
    }

    let frame = 0;

    const measure = () => {
      const card = list.querySelector('li');

      if (card === null) {
        return;
      }

      const height = card.offsetHeight + (parseFloat(getComputedStyle(list).rowGap) || 0);
      const top = list.getBoundingClientRect().top;
      const first = Math.max(0, Math.floor(-top / height) - OVERSCAN);
      const last = Math.min(lines, Math.ceil((innerHeight - top) / height) + OVERSCAN);

      setView((was) =>
        was.first === first && was.last === last && was.height === height ? was : { first, last, height },
      );
    };

    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    measure();
    addEventListener('scroll', later, { passive: true });
    addEventListener('resize', later);

    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('scroll', later);
      removeEventListener('resize', later);
    };
  }, [rows, lines]);

  const start = Math.min(view.first, lines);
  const end = Math.max(start, Math.min(view.last, lines));
  const shown = rows.slice(start * COLUMNS, end * COLUMNS);

  /*
   * The space the undrawn rows would take, as padding above and below the drawn ones, so the scrollbar and the page
   * under the grid sit where they would with every card drawn. None until a card has been measured.
   */
  const above = start * view.height;
  const below = (lines - end) * view.height;

  return (
    <ul ref={listRef} class="mons" aria-label={label} style={{ paddingTop: `${above}px`, paddingBottom: `${below}px` }}>
      {shown.map((row, index) => (
        <Card key={row.index} row={row} sprite={spriteOf(row)} place={start * COLUMNS + index + 1} of={rows.length} />
      ))}
    </ul>
  );
}

/** The pills that left a Pokémon unsure, as code the reader can find among their cards. */
function Unchecked({ terms }: { terms: readonly string[] }) {
  return (
    <>
      {terms.map((term, index) => (
        <span key={term}>
          {index > 0 && (index === terms.length - 1 ? ' or ' : ', ')}
          <code>{term}</code>
        </span>
      ))}
    </>
  );
}

/** The results of `tree` against the export the 📱 panel holds. */
export function Results({ tree }: { tree: Node }) {
  const { rows, status } = useInventory();
  const [data, setData] = useState<GameData | null>(null);
  const [sort, setSort] = useState<Sort>(loadSort);
  const held = rows !== null;

  // The game data the export was read against, fetched once by the read and so answered from memory here.
  useEffect(() => {
    if (held) {
      gameData().then(setData, (error: unknown) => console.error(`game data: ${said(error)} — no results to show`));
    }
  }, [held]);

  const judge = useMemo(() => (rows && data ? judging({ rows, data, now: Date.now() }) : null), [rows, data]);
  const spriteOf = useMemo(() => (data ? sprites(data.forms) : null), [data]);
  const found = useMemo(() => (rows && judge ? resultsOf(tree, rows, judge) : null), [tree, rows, judge]);
  const sure = useMemo(() => (found ? sorted(found.sure, sort) : []), [found, sort]);
  const unsure = useMemo(() => (found ? sorted(found.unsure, sort) : []), [found, sort]);

  if (rows === null || found === null || spriteOf === null) {
    return (
      <section class="results" aria-label="Your Pokémon">
        <p class="empty">
          {status.state === 'reading' || held
            ? 'Reading your Pokémon…'
            : 'Open your PGSharp export with 📱 in the top bar to see which of your Pokémon match.'}
        </p>
      </section>
    );
  }

  return (
    <section class="results" aria-labelledby="resultsLabel">
      <div class="results-head">
        <h2 id="resultsLabel" aria-live="polite">
          {sure.length} of {rows.length} match
        </h2>
        <label class="sort">
          <span class="sr">Sort by</span>
          <select
            value={sort}
            onChange={(event) => {
              const picked = event.currentTarget.value as Sort;

              setSort(picked);
              storeSort(picked);
            }}
          >
            {SORTS.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Grid rows={sure} spriteOf={spriteOf} label="Matches" />

      {unsure.length > 0 && (
        <div class="unsure">
          <h3>Might match ({unsure.length})</h3>
          <p class="help">
            Can't check <Unchecked terms={found.unchecked} /> against the export.
          </p>
          <Grid rows={unsure} spriteOf={spriteOf} label="Might match" />
        </div>
      )}
    </section>
  );
}
