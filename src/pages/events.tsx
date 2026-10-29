/**
 * The events calendar page. Loads Leek Duck's event list from `data/events-feed.json` — the copy of ScrapedDuck's JSON
 * mirror that `scripts/vend-feed.mts` refreshes hourly — and merges it with `data/events.json`, a repo-defined list in
 * the same shape whose entries override a feed event of the same `eventID` or add one the feed does not carry. Either
 * source failing still renders the other. `data/entries-by-event.json` says which events have routes here, so a card
 * can link through to them on the map.
 *
 * Three views over the same data: a card list grouped by status, a month grid where every event is a bar spanning the
 * days it covers within each week, and a Tracks timeline laying events out as horizontal bars in fixed category rows.
 * The search box, type filters and dismissals apply to all three.
 */

import { Fragment, type ComponentChildren, type HTMLAttributes } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { routeSummary } from '../event-feed.js';
import { hiddenFor, type Prefs } from '../event-prefs.js';
import {
  addDays,
  DAY_MS,
  overlaps,
  packLanes,
  relativeUnit,
  startOfDay,
  statusOf,
  typeClass,
  weekColumns,
  windowOf,
  type ParsedEvent,
  type StatusKind,
  type TrackItem,
} from '../event-schedule.js';
import {
  admits,
  isNew as isNewIn,
  isRevealed as isRevealedIn,
  newlyVisible as newlyVisibleIn,
  NOTHING_REVEALED,
  useEventStore,
  type Reveals,
} from '../event-store.js';
import { ENTRIES_BY_EVENT, EVENTS_FEED } from '../generated.js';
import { toHash } from '../router.js';

import type { RouteIndex } from '../types.js';

/** Which of the three views is showing. A page concept, so it stays here rather than beside the schedule. */
type View = 'cards' | 'calendar' | 'tracks';

/**
 * How often to recompute the relative labels against the wall clock, and — every `REFETCH_EVERY` ticks — pull the feed
 * again. Pages serves the feed with `cache-control: max-age=600`, so the ten minutes these multiply to is the soonest
 * a refetch can reach the network rather than the browser cache. For a tab left open all day.
 */
const TICK_MS = 60_000;
const REFETCH_EVERY = 10;

/**
 * How near an event's start or end has to be for the card's label to read as urgent — the `soon` class. A day covers
 * the "today or tonight" window a reader would actually change their plans over.
 */
const SOON_MS = DAY_MS;

/**
 * The largest per-card delay step in the grid's entry animation, in card positions. Past this the cards share the last
 * step, so a bucket of sixty does not leave its tail arriving a second and a half late.
 */
const STAGGER_MAX = 14;

const dateFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const relFmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

// Taken from a week starting on a known Sunday (2023-01-01) so they follow the reader's locale without hard-coding
// English. The grid itself is Sunday-first.
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => weekdayFmt.format(new Date(2023, 0, 1 + i)));

function relative(target: Date, now: Date) {
  const { value, unit } = relativeUnit(target, now);

  return relFmt.format(value, unit);
}

/**
 * The cards view's status buckets, in the order they are drawn. An array rather than an object keyed by kind, the
 * order being the point and an object saying it only by insertion — and `Object.entries` answers a `string` key
 * whatever the object's own keys are, where a row carrying its own kind narrows to one of the four.
 */
const GROUPS: readonly { kind: StatusKind; label: string }[] = [
  { kind: 'active', label: 'Happening now' },
  { kind: 'upcoming', label: 'Upcoming' },
  { kind: 'tbd', label: 'Date unknown' },
  { kind: 'ended', label: 'Recently ended' },
];

/**
 * The Tracks view's rows, in display order, keyed by the feed's `eventType` slug rather than its `heading` so the
 * match survives a wording change upstream. GO Battle League and GO Pass are deliberately absent, so an event of
 * either type never lands on the timeline. The labels are ours where they read better than the feed's.
 */
const TRACKS = [
  { type: 'choose-your-path', label: 'Choose Your Path' },
  { type: 'community-day', label: 'Community Day' },
  { type: 'event', label: 'Events' },
  { type: 'max-battles', label: 'Max Battles' },
  { type: 'max-mondays', label: 'Max Mondays' },
  { type: 'raid-battles', label: 'Raid Battles' },
  { type: 'raid-day', label: 'Raid Day' },
  { type: 'raid-hour', label: 'Raid Hour' },
  { type: 'regional-event', label: 'Regional Event' },
  { type: 'research', label: 'Research' },
  { type: 'season', label: 'Season' },
  { type: 'pokemon-spotlight-hour', label: 'Spotlight Hour' },
  { type: 'wild-area', label: 'Wild Area' },
];

/**
 * The three reveals at the foot of the filter panel, each with its label and whether it is only offered to the cards
 * view. Both bucket reveals only mean anything there: the calendar and tracks views show a fixed window regardless,
 * and neither can draw a dateless event at all, `windowOf` giving it no window to place.
 */
const REVEALS = [
  { name: 'showPast', label: 'Ended', cardsOnly: true },
  { name: 'showUndated', label: 'Undated', cardsOnly: true },
  { name: 'showHidden', label: 'Hidden', cardsOnly: false },
] as const satisfies readonly { name: keyof Reveals; label: string; cardsOnly: boolean }[];

// Tracks view geometry. TRACK_DAY_PX is the single source for a day column's width: the bars are positioned in pixels
// from it, and the same value is handed to CSS as the --track-day custom property for the gridline background, so the
// two cannot drift. The timeline runs from a couple of days before today to the latest event end, clamped to a sane
// span.
const TRACK_DAY_PX = 40;
const TRACK_BAR_H = 22;
const TRACK_LANE_GAP = 4;
const TRACK_LABEL_PX = 132;
const TRACK_LEAD_DAYS = 2;
const TRACK_MIN_DAYS = 30;
const TRACK_MAX_DAYS = 120;

/**
 * A card's picture, which takes itself off the card when it fails to load rather than leaving the browser's
 * broken-image glyph. Its own component so the failure is state rather than a node removing itself from a tree the
 * reconciler believes it still owns.
 *
 * What failed is remembered as the URL rather than as a boolean, for the reason `Sprite` gives on the Pokédex: a fresh
 * `src` deserves a fresh chance to load. Cards are keyed by event ID, so the refetch hands this same instance a rehosted
 * image under an unchanged event, and a flag would keep it hidden for the life of the page.
 */
function Thumb({ src }: { src: string }) {
  const [failed, setFailed] = useState<string | null>(null);

  return failed === src ? null : <img class="thumb" src={src} alt="" loading="lazy" onError={() => setFailed(src)} />;
}

/**
 * The absolute dates as a line of prose — a range, an open start, an open end, or that there are none. Four branches
 * for four cases rather than three and a fallthrough, so the checker confirms each `format` call has a date rather
 * than taking it on trust.
 */
function timeRange(ev: ParsedEvent) {
  const local = ev.start && !ev.startHasZone ? ' (your local time)' : '';

  if (ev.start && ev.end) {
    return `${dateFmt.format(ev.start)} – ${dateFmt.format(ev.end)}${local}`;
  }

  if (ev.start) {
    return `From ${dateFmt.format(ev.start)}${local}`;
  }

  if (ev.end) {
    return `Until ${dateFmt.format(ev.end)}`;
  }

  return 'Date unknown';
}

/**
 * An event's bar in the calendar or on the tracks: a link to its source page, or a `<span>` for an event whose link
 * `webLink` dropped — the reason the cards view leaves its overlay out. An `<a>` with no `href` would still be drawn as
 * a bar to click, yet take no focus and open nothing.
 */
function eventBar(
  ev: ParsedEvent,
  bar: Pick<HTMLAttributes<HTMLElement>, 'class' | 'style' | 'title'>,
  children: ComponentChildren,
) {
  return ev.link === undefined ? (
    <span key={ev.eventID} {...bar}>
      {children}
    </span>
  ) : (
    <a key={ev.eventID} {...bar} href={ev.link} target="_blank" rel="noopener">
      {children}
    </a>
  );
}

/**
 * The route and waypoint counts per event. Unchecked, and the return type therefore a claim about a file this
 * repository generates rather than one this function verified — `validate-gpx.mts` is what holds the file and the GPX
 * tree in step. A card tolerates a miss either way: an event the index does not name simply gets no map link.
 */
async function fetchRouteIndex(): Promise<RouteIndex> {
  const res = await fetch(ENTRIES_BY_EVENT);

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }

  return res.json();
}

export default function EventsPage({ query: fragment }: { query: string }) {
  /**
   * The feed and the reader's saved choices, shared with the notifications in the top bar so that a card's New mark and
   * its notification are one fact: clearing either redraws both. The page redraws whenever the store changes.
   */
  const store = useEventStore();

  /**
   * The reader's saved choices, held as the one mutable object the store hands out: `hiddenFor` answers a set the
   * caller adds to and deletes from, and the dismissals and seen set are read and written the same way. So this is a
   * reference rather than state, and `commit` is the one way it changes. Re-read from storage as the page
   * opens, so nothing a previous visit changed in memory alone is carried in.
   */
  const [prefs] = useState(() => store.reloadPrefs());

  /**
   * Write one preference back and redraw this page and the top bar. Named rather than keyed so a call site cannot pair
   * a key with the wrong value.
   */
  const commit = (name: Parameters<typeof store.commit>[0]) => store.commit(name);

  /**
   * The feed entries the page is drawing, sorted by start, and how the load that fetched them went. `generation` is
   * which fetch the events on screen came from, which is what the cards' entry animation is keyed by. A CSS animation
   * runs when its element mounts, so a new number builds a new grid and plays it while the same number leaves the grid
   * alone — which is what keeps the minute's re-render from twitching every card as the relative labels move.
   */
  const { events, failed, loading, generation } = store;

  /**
   * How many routes and waypoints each event has here, by `eventID`. Empty until the index has loaded, and it stays
   * empty if that fetch fails — see `load`, which tolerates any one of the three sources going missing.
   */
  const [routeIndex, setRouteIndex] = useState<RouteIndex>({});

  /** Recomputed every minute, which is what keeps the relative labels honest without anything else being redrawn. */
  const [now, setNow] = useState(() => new Date());

  const [view, setView] = useState<View>('cards');
  const [search, setSearch] = useState('');

  // A session's choices rather than saved preferences; `prefs` is what survives a reload.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reveals, setReveals] = useState<Reveals>(NOTHING_REVEALED);

  /**
   * Whether the reader has narrowed the page to the events the header reports as new, by pressing that count. Read
   * live rather than as a snapshot of the IDs, so a card opened or marked as seen drops out as its mark does.
   */
  const [onlyNew, setOnlyNew] = useState(false);

  /** The first-of-month the calendar view is showing, or the current month until the reader steps off it. */
  const [calMonth, setCalMonth] = useState<Date | null>(null);

  /**
   * An `?event=` the fragment named and the feed had not yet arrived to apply. Held rather than re-read so the arrival
   * is spent once: a ten-minute re-fetch must not re-apply it over whatever the reader has since typed.
   */
  const pending = useRef<string | null>(null);

  /** What the cards view is drawing under beyond the saved filters, which the top bar's count reads too. */
  const filter = { reveals, search, now };

  /**
   * Whether an event survives the type-filter, dismissal and search-term filters of the view that is open, and the new
   * events filter while that is on. `newlyVisible` is not built on this, so narrowing the page does not change the
   * count the reader pressed to narrow it, nor the top bar's.
   */
  const isVisible = (ev: ParsedEvent) =>
    admits(ev, prefs, hiddenFor(prefs, view), filter) && (!filteringNew || isNew(ev));

  /** Whether the reader has revealed the status bucket this event falls in. */
  const isRevealed = (ev: ParsedEvent) => isRevealedIn(ev, filter);

  /** Whether the event has turned up since the reader last acknowledged what was on the page. */
  const isNew = (ev: ParsedEvent) => isNewIn(prefs, ev);

  /**
   * The events the reader is being told are new, which is also what the top bar lists: unacknowledged, and among
   * those the ones the cards view admits.
   */
  const newlyVisible = () => newlyVisibleIn(events, prefs, filter);

  /**
   * A link from the Routes page arrives as `#/events?event=<eventID>` and lands by searching for that event's name.
   * Reusing the search box rather than scrolling to the card leaves the term visible, and emptying it is how a reader
   * already knows to get the other cards back. The event is always there to find, the linter rejecting a `<pgr:event>`
   * naming an ID `data/events.json` does not carry.
   */
  function applyPending(against: readonly ParsedEvent[]) {
    const id = pending.current;
    const match = id === null ? undefined : against.find((ev) => ev.eventID === id);

    if (match === undefined) {
      return;
    }

    pending.current = null;

    /**
     * Unhide its type, or a reader with that filter off would follow the link and be shown nothing. Not persisted:
     * this is for the one arrival. A card dismissed individually stays dismissed, that being a decision about the
     * event rather than a blanket rule.
     */
    hiddenFor(prefs, view).delete(match.eventType);
    setSearch(match.name);

    // Arriving acknowledges the event, so the new events filter would hide the very card the link was followed to.
    setOnlyNew(false);

    // Arriving on the event is reading it, as opening its card is. A notification's link relies on this to take itself
    // off the list, and a shared link would otherwise leave the card marking an event the reader is looking at as new.
    if (isNew(match)) {
      store.acknowledge([match]);
    }
  }

  /**
   * The events and the route index, concurrently, tolerating either failing: a missing index costs the cards their map
   * link and nothing else. The events are the store's, which the top bar has usually loaded already by the time this
   * page opens — so opening the page reuses that load, and only Refresh and the ten-minute tick fetch them again.
   */
  async function load(fresh: boolean) {
    const [, index] = await Promise.allSettled([fresh ? store.load() : store.ensureLoaded(), fetchRouteIndex()]);

    setRouteIndex(index.status === 'fulfilled' ? index.value : {});
    applyPending(store.events);
  }

  // The fragment's `?event=` is read before the first fetch, so the arrival is applied as soon as there is a feed to
  // find the event in. A link followed from this page changes only the fragment, so this lands that too.
  useEffect(() => {
    pending.current = new URLSearchParams(fragment).get('event');
    applyPending(events);
  }, [fragment]);

  useEffect(() => {
    void load(false);
  }, []);

  /**
   * Hand the cards view's filters to the store while the page is open, so the top bar counts under the same ones, and
   * take them back as it closes. Closing also re-reads the saved choices, dropping a type `applyPending` unhid for one
   * arrival without saving: every other tab counts under what is stored.
   */
  useEffect(() => {
    store.publish(filter);
  }, [reveals, search, now]);

  useEffect(
    () => () => {
      store.reloadPrefs();
      store.publish(null);
    },
    [],
  );

  /**
   * An import from the top bar's settings has written over storage, which the store has re-read already. What is left
   * is the page's own: a change this wholesale cannot leave a session reveal widening the page. Skipped on the first
   * render, so opening the page after an import keeps the defaults it opened with rather than resetting them for an
   * import it never saw.
   */
  const restores = useRef(store.restores);

  useEffect(() => {
    if (store.restores !== restores.current) {
      restores.current = store.restores;
      setReveals(NOTHING_REVEALED);
    }
  }, [store.restores]);

  /**
   * Re-render every minute so relative labels stay honest, and re-fetch every tenth to catch new events. A tab coming
   * back into view re-renders straight away rather than waiting out its minute, a background tab having its timers
   * throttled. The feed waits for the next re-fetch tick either way.
   */
  useEffect(() => {
    let tick = 0;

    const timer = setInterval(() => {
      tick += 1;

      if (tick % REFETCH_EVERY === 0) {
        void load(true);
      } else {
        setNow(new Date());
      }
    }, TICK_MS);

    const woken = () => {
      if (!document.hidden) {
        setNow(new Date());
      }
    };

    document.addEventListener('visibilitychange', woken);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', woken);
    };
  }, []);

  /**
   * Switch which hidden-type set the chips edit and the views read. Persisted, unlike the view itself, because the sets
   * it chooses between are: a scope falling back to global on reload would leave per-view filtering saved and silently
   * out of force, which is worse than not having offered it.
   */
  function setScope(next: Prefs['filterScope']) {
    prefs.filterScope = next;
    commit('filterScope');
  }

  function toggleType(eventType: string) {
    const hidden = hiddenFor(prefs, view);

    if (!hidden.delete(eventType)) {
      hidden.add(eventType);
    }

    // Named from the scope rather than the set, so the two cannot disagree about where a click just went — the one way
    // a chip could take effect and then not survive a reload.
    commit(prefs.filterScope === 'view' ? 'hiddenByView' : 'hiddenTypes');
  }

  function toggleGroup(kind: StatusKind) {
    if (!prefs.collapsed.delete(kind)) {
      prefs.collapsed.add(kind);
    }

    commit('collapsed');
  }

  /**
   * Acknowledge exactly the events the header just reported, so the number always falls to zero.
   *
   * That population is what the cards view draws, which the other two cannot match — the calendar paints one month and
   * the tracks only the types `TRACKS` has a row for. Cards is the one worth making exact, being the only view whose
   * own total sits in the same header.
   *
   * Revealing a hidden type months later therefore surfaces a batch of marks, which is right: those events genuinely
   * are ones the reader has never been shown, and this clears them in one press.
   */
  function markAllSeen() {
    store.acknowledge(newlyVisible());
  }

  /**
   * The per-type filter chips, from the categories the feed currently carries. Each is keyed by the `eventType` slug,
   * which is what the filters store and the colours are keyed by, and labelled with the human `heading` — so the
   * pairing is read off the events rather than kept as a second list that could drift. An event the feed gives no
   * heading still gets a chip, labelled with its slug as the badge on its card is, until one of its type carries a
   * heading to put there instead.
   *
   * The entries are sorted by label rather than the keys, so the chips read alphabetically as a reader sees them, and
   * the comparator is spelled out because a bare `.sort()` over pairs would stringify each one whole.
   */
  const labels = new Map<string, string>();

  for (const ev of events) {
    const label = labels.get(ev.eventType);

    if (label === undefined || (label === ev.eventType && ev.heading)) {
      labels.set(ev.eventType, ev.heading || ev.eventType);
    }
  }

  const types = [...labels].sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0));
  const hidden = hiddenFor(prefs, view);
  const newly = newlyVisible().length;

  /**
   * The filter is only in force while there is something new to narrow to: the count that turns it off is hidden at
   * zero, and would leave the page reading "No events to show" with no control to undo it. Turned off for good once
   * the count reaches zero, so an event a later refetch brings does not narrow the page again unasked; the check above
   * covers the render before that lands.
   */
  const filteringNew = onlyNew && newly > 0;

  useEffect(() => {
    if (newly === 0) {
      setOnlyNew(false);
    }
  }, [newly]);

  /**
   * One card. The overlay link covers it, so every other control has to be a sibling of that link.
   *
   * A function returning markup rather than a component, which is load-bearing: a component declared inside another is
   * a new function identity on every render, which the reconciler reads as a different type — it threw away all sixty
   * cards on every keystroke in the search box, re-requesting sixty `cdn.leekduck.com` thumbnails each time. Called
   * directly it contributes no component boundary, so the keyed `<article>` is diffed against the last render's.
   */
  function renderCard(ev: ParsedEvent, index: number) {
    const status = statusOf(ev, now);
    const dismissed = prefs.dismissed.has(ev.eventID);
    const fresh = isNew(ev);
    const here = routeIndex[ev.eventID];
    const summary = here ? routeSummary(here) : null;

    /**
     * Opening the event acknowledges it. `target="_blank"` leaves the reader on this page, so a card they have just
     * gone and read would otherwise still be announcing itself as new when they come back.
     *
     * `auxclick` as well as `click` because a middle click — how a reader opens something in a background tab without
     * losing their place — fires only the second of the two.
     */
    const acknowledge = (event: MouseEvent) => {
      // Left and middle are the two that open the link. Chrome reports a right click as an `auxclick` too, and that
      // opens a menu rather than the event.
      if (event.button > 1 || !fresh) {
        return;
      }

      store.acknowledge([ev]);
    };

    return (
      <article
        key={ev.eventID}
        class={`card ${status.kind}${dismissed ? ' dismissed' : ''}${typeClass(ev.eventType)}`}
        style={{ '--i': String(Math.min(index, STAGGER_MAX)) }}
      >
        {/*
         * A transparent overlay link makes the whole card open the event's source page while keeping the dismiss button
         * a sibling rather than a child: an anchor may not contain interactive content. Left out for an event whose
         * link `webLink` dropped, rather than drawn as an overlay that opens nothing.
         */}
        {ev.link !== undefined && (
          <a
            class="card-link"
            href={ev.link}
            target="_blank"
            rel="noopener"
            aria-label={`Open “${ev.name}”`}
            onClick={acknowledge}
            onAuxClick={acknowledge}
          />
        )}

        {/*
         * A dismissed card only appears while "Hidden" is on; there the same corner button restores it rather than
         * dismissing it again.
         */}
        <button
          type="button"
          class="dismiss"
          title={dismissed ? 'Restore this event' : 'Dismiss this event'}
          aria-label={`${dismissed ? 'Restore' : 'Dismiss'} “${ev.name}”`}
          onClick={() => {
            if (dismissed) {
              prefs.dismissed.delete(ev.eventID);
            } else {
              prefs.dismissed.add(ev.eventID);
            }

            commit('dismissed');
          }}
        >
          {dismissed ? '↩' : '×'}
        </button>

        {/*
         * The mark for an event that has appeared since the reader last acknowledged the page, and the button that
         * clears it. A sibling of the overlay link for the same reason the dismiss button is one: that link covers the
         * card and would swallow the click. It takes the opposite corner, so the card's two controls read as a pair —
         * and the left edge is already the status stripe.
         */}
        {fresh && (
          <button
            type="button"
            class="new-mark"
            title="Mark as seen"
            aria-label={`Mark “${ev.name}” as seen`}
            onClick={() => store.acknowledge([ev])}
          >
            New
          </button>
        )}

        {ev.image && <Thumb src={ev.image} />}

        <div class="body">
          <span class="badge">{ev.heading || ev.eventType}</span>
          <h2>{ev.name}</h2>
          <p class="when">{timeRange(ev)}</p>

          {/*
           * An event already over is never urgent however recently it ended, so only a pending edge takes the `soon`
           * accent.
           */}
          {status.at && (
            <p class={status.kind !== 'ended' && status.at.getTime() - now.getTime() < SOON_MS ? 'rel soon' : 'rel'}>
              {status.kind === 'upcoming' ? 'Starts' : status.kind === 'ended' ? 'Ended' : 'Ends'}{' '}
              {relative(status.at, now)}
            </p>
          )}

          {/*
           * What this repository added for the event, linking through to it on the map. Last, so that the absolute
           * dates and the relative ones stay together above it. The query is what lands the link on the entry rather
           * than on a page of 81 rows. The stylesheet puts the Map tab's own glyph in front, so the destination is
           * named the same way twice; the accessible name says it in words instead.
           */}
          {summary !== null && (
            <a
              class="routes"
              href={toHash('map', `event=${encodeURIComponent(ev.eventID)}`)}
              title="Show on the map"
              aria-label={`Show ${summary} for “${ev.name}” on the map`}
            >
              {summary}
            </a>
          )}
        </div>
      </article>
    );
  }

  /**
   * One week's segment of an event, from a span of one column to all seven. A function rather than a component for the
   * reason `renderCard` is one: declared in here, a component is a fresh type on every render and the whole month is
   * rebuilt rather than diffed.
   */
  function renderCalBar(
    ev: ParsedEvent,
    [first, last]: readonly [number, number],
    { contLeft, contRight }: { contLeft: boolean; contRight: boolean },
  ) {
    const classes = ['cal-bar', statusOf(ev, now).kind];

    if (contLeft) {
      classes.push('cont-left');
    }

    if (contRight) {
      classes.push('cont-right');
    }

    // A ring, not a badge: there is no room for a control in eleven pixels, so a bar says an event is new and the
    // header carries the only way to clear it.
    if (isNew(ev)) {
      classes.push('new');
    }

    return eventBar(
      ev,
      {
        class: classes.join(' ') + typeClass(ev.eventType),
        style: { gridColumn: `${first + 1} / span ${last - first + 1}` },
        title: `${ev.name} — ${timeRange(ev)}`,
      },
      <span class="cal-bar-name">{ev.name}</span>,
    );
  }

  /** The cards view: a bucket per status, each a grid of cards. */
  function cards() {
    const buckets: Record<StatusKind, ParsedEvent[]> = { active: [], upcoming: [], tbd: [], ended: [] };
    let shown = 0;

    for (const ev of events) {
      if (!isVisible(ev) || !isRevealed(ev)) {
        continue;
      }

      buckets[statusOf(ev, now).kind].push(ev);
      shown += 1;
    }

    // Upcoming reads best soonest-first; ended reads best most-recent-first. `events` is already sorted by start, so
    // reversing the ended bucket is enough.
    buckets.ended.reverse();

    const parts = [shown ? `${shown} event${shown === 1 ? '' : 's'}` : 'No events to show'];

    if (buckets.active.length) {
      parts.push(`${buckets.active.length} happening now`);
    }

    if (prefs.dismissed.size) {
      parts.push(`${prefs.dismissed.size} dismissed`);
    }

    return {
      count: parts.join(' · '),

      /**
       * Keyed by the bucket, which an anonymous `<>` cannot be — and a bucket is what comes and goes here, only the
       * non-empty ones being drawn. Unkeyed, the four are matched by position, so a search term emptying "Happening
       * now" slides "Upcoming" into slot nought and the reconciler rebuilds its grid: measured at 0 of 62 cards reused
       * on one keystroke, each taking its thumbnail with it.
       */
      body: GROUPS.filter(({ kind }) => buckets[kind].length > 0).map(({ kind, label }) => (
        <Fragment key={kind}>
          {/*
           * The kind rides along on the heading so the stylesheet can pick out the running events. The button sits
           * inside the `<h2>` rather than replacing it, so the bucket stays a heading to navigate by as well as a
           * control that folds it.
           */}
          <h2 class={`group group-${kind}`}>
            <button
              type="button"
              aria-controls={`group-${kind}`}
              aria-expanded={!prefs.collapsed.has(kind)}
              onClick={() => toggleGroup(kind)}
            >
              {label}
              <span class="gcount">{buckets[kind].length}</span>
            </button>
          </h2>
          <div
            key={`g-${kind}-${generation}`}
            id={`group-${kind}`}
            class="grid enter"
            hidden={prefs.collapsed.has(kind)}
          >
            {buckets[kind].map(renderCard)}
          </div>
        </Fragment>
      )),
    };
  }

  /** The calendar view: a month grid where every event is a bar spanning the days it covers within each week. */
  function calendar() {
    const month = calMonth ?? new Date(now.getFullYear(), now.getMonth(), 1);
    const year = month.getFullYear();
    const index = month.getMonth();
    const lead = new Date(year, index, 1).getDay(); // blank days before the 1st (Sunday-first)
    const daysInMonth = new Date(year, index + 1, 0).getDate();
    const weeks = Math.ceil((lead + daysInMonth) / 7);
    const gridStart = new Date(year, index, 1 - lead);
    const todayKey = startOfDay(now).getTime();

    /**
     * Every event the grid can place, resolved once ahead of the week loop. `events` is already sorted by start, so
     * the longest-running bars settle at the top of each week.
     *
     * One `flatMap` rather than a `map` and a `filter`, a predicate not narrowing what it filtered: the pair would
     * stay `Span | null` past a `win !== null` test, which is two assertions' worth of noise where `win[0]` is read.
     */
    const placed = events.filter(isVisible).flatMap((ev) => {
      const win = windowOf(ev);

      return win === null ? [] : [{ ev, win }];
    });

    const monthStart = new Date(year, index, 1).getTime();
    const monthEnd = new Date(year, index + 1, 1).getTime();
    const inMonth = placed.filter(({ win }) => overlaps(win, monthStart, monthEnd)).length;

    return {
      count: `${monthFmt.format(month)} · ${inMonth} event${inMonth === 1 ? '' : 's'}`,
      body: (
        <>
          <div class="calbar">
            <button
              type="button"
              class="navbtn"
              aria-label="Previous month"
              onClick={() => setCalMonth(new Date(year, index - 1, 1))}
            >
              ‹
            </button>
            <span class="callabel">{monthFmt.format(month)}</span>
            <button
              type="button"
              class="navbtn"
              aria-label="Next month"
              onClick={() => setCalMonth(new Date(year, index + 1, 1))}
            >
              ›
            </button>
            <button
              type="button"
              class="navbtn"
              onClick={() => setCalMonth(new Date(now.getFullYear(), now.getMonth(), 1))}
            >
              Today
            </button>
          </div>

          <div class="cal">
            <div class="cal-wd-row">
              {WEEKDAYS.map((name) => (
                <div key={name} class="cal-wd">
                  {name}
                </div>
              ))}
            </div>

            {Array.from({ length: weeks }, (_, week) => {
              const weekStart = addDays(gridStart, week * 7);
              const weekStartMs = weekStart.getTime();
              const weekEndMs = addDays(weekStart, 7).getTime();

              return (
                <div key={weekStartMs} class="cal-week">
                  {/* The cells first, so the bars that share their grid area paint over them rather than under. */}
                  <div class="cal-days">
                    {Array.from({ length: 7 }, (_, col) => {
                      const day = addDays(weekStart, col);
                      const classes = ['cal-day'];

                      if (day.getMonth() !== index) {
                        classes.push('other');
                      }

                      // The class is the pill and the tint; `aria-current` is the same fact for a reader who is getting
                      // neither, and is the only thing on the grid that says which day is today rather than a colour.
                      const today = day.getTime() === todayKey;

                      if (today) {
                        classes.push('today');
                      }

                      return (
                        <div key={col} class={classes.join(' ')} aria-current={today ? 'date' : undefined}>
                          <span class="daynum">{day.getDate()}</span>
                        </div>
                      );
                    })}
                  </div>

                  <div class="cal-bars">
                    {placed.flatMap(({ ev, win }) => {
                      const columns = weekColumns(win, weekStart);

                      /**
                       * A segment continues past the week only where the week's own edge is what stopped it. Reaching
                       * column 0 while having begun earlier means it ran in from the row above; anything starting later
                       * than column 0 began inside this week, because it misses the column before.
                       */
                      return columns === null
                        ? []
                        : [
                            renderCalBar(ev, columns, {
                              contLeft: columns[0] === 0 && win[0] < weekStartMs,
                              contRight: columns[1] === 6 && win[1] > weekEndMs,
                            }),
                          ];
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ),
    };
  }

  /** The Tracks view: a Gantt chart, one fixed row per event type. */
  function tracks() {
    const rangeStart = addDays(startOfDay(now), -TRACK_LEAD_DAYS);
    const rangeStartMs = rangeStart.getTime();

    /**
     * The rows this render will draw, one per TRACKS entry, each carrying the events that landed on it. A type with no
     * track (GO Battle League, GO Pass) has no row, so it is dropped; an event ending before the window's left edge is
     * skipped.
     */
    const byType = new Map<string, { type: string; label: string; items: TrackItem[] }>(
      TRACKS.map((track) => [track.type, { ...track, items: [] }]),
    );

    let latestEnd = rangeStartMs + TRACK_MIN_DAYS * DAY_MS;

    // Track types whose filter chip is off, so the whole row can be dropped rather than left as an empty ghost. Keyed
    // by the chip's state alone — a track emptied by dismissals or a search term keeps its row.
    const filteredTypes = new Set<string>();

    for (const ev of events) {
      const row = byType.get(ev.eventType);

      if (!row) {
        continue;
      }

      if (hidden.has(ev.eventType)) {
        filteredTypes.add(ev.eventType);
      }

      if (!isVisible(ev)) {
        continue;
      }

      const win = windowOf(ev);

      if (win === null || win[1] <= rangeStartMs) {
        continue;
      }

      latestEnd = Math.max(latestEnd, win[1]);
      row.items.push({ ev, startMs: win[0], endMs: win[1], lane: 0 });
    }

    const span = Math.min(TRACK_MAX_DAYS, Math.max(TRACK_MIN_DAYS, Math.ceil((latestEnd - rangeStartMs) / DAY_MS)));
    const rangeEndMs = rangeStartMs + span * DAY_MS;
    const width = span * TRACK_DAY_PX;
    const todayX = ((startOfDay(now).getTime() - rangeStartMs) / DAY_MS) * TRACK_DAY_PX;

    let shown = 0;

    const rows = [...byType.values()].flatMap((track) => {
      /**
       * The right edge needs a guard of its own, mirroring the `win[1] <= rangeStartMs` one above: `span` is clamped
       * to `TRACK_MAX_DAYS` where `latestEnd` is not, so an event starting past `rangeEndMs` clips to a negative width
       * and draws at the 20px minimum past the lane's right edge, counted in the tally. Dropped before `packLanes` so
       * it cannot claim a lane and raise the row's height for a bar nobody can see.
       */
      const items = track.items.filter((item) => item.startMs < rangeEndMs).sort((a, b) => a.startMs - b.startMs);

      // A track the filter has switched off drops out entirely. A row is one `eventType`, which is what the chips
      // switch, so there is no still-visible part of it to keep.
      if (filteredTypes.has(track.type)) {
        return [];
      }

      const lanes = packLanes(items);
      const height = Math.max(1, lanes) * (TRACK_BAR_H + TRACK_LANE_GAP) + TRACK_LANE_GAP;

      shown += items.length;

      return [
        <div key={`l-${track.type}`} class="track-label" style={{ height: `${height}px` }}>
          {track.label}
        </div>,
        <div key={`r-${track.type}`} class="track-lane" style={{ width: `${width}px`, height: `${height}px` }}>
          {items.map((item) => {
            const left = Math.max(item.startMs, rangeStartMs);
            const right = Math.min(item.endMs, rangeEndMs);
            const status = statusOf(item.ev, now).kind;

            return eventBar(
              item.ev,
              {
                class: `bar ${status}${isNew(item.ev) ? ' new' : ''}${typeClass(item.ev.eventType)}`,
                title: `${item.ev.name} — ${timeRange(item.ev)}`,
                style: {
                  left: `${((left - rangeStartMs) / DAY_MS) * TRACK_DAY_PX}px`,
                  width: `${Math.max(TRACK_DAY_PX / 2, ((right - left) / DAY_MS) * TRACK_DAY_PX)}px`,
                  top: `${TRACK_LANE_GAP + item.lane * (TRACK_BAR_H + TRACK_LANE_GAP)}px`,
                  height: `${TRACK_BAR_H}px`,
                },
              },
              item.ev.name,
            );
          })}
        </div>,
      ];
    });

    return {
      count: shown ? `${shown} event${shown === 1 ? '' : 's'} across the tracks` : 'No events to show',
      body: (
        <div class="tracks">
          <div class="tracks-scroll">
            <div
              class="tracks-inner"
              style={{ 'gridTemplateColumns': `${TRACK_LABEL_PX}px ${width}px`, '--track-day': `${TRACK_DAY_PX}px` }}
            >
              <div class="track-corner">Tracks</div>
              <div class="track-axis" style={{ width: `${width}px` }}>
                {/* One date label per week down the axis; the daily gridline comes from the CSS background. */}
                {Array.from({ length: Math.ceil(span / 7) }, (_, week) => (
                  <span key={week} class="axis-tick" style={{ left: `${week * 7 * TRACK_DAY_PX}px` }}>
                    {dayFmt.format(addDays(rangeStart, week * 7))}
                  </span>
                ))}
              </div>
              {rows}
              <div class="track-today" style={{ left: `${TRACK_LABEL_PX + todayX}px` }} />
            </div>
          </div>
        </div>
      ),
    };
  }

  const drawn = view === 'calendar' ? calendar() : view === 'tracks' ? tracks() : cards();

  const count = failed !== null ? `Could not load events: ${failed}` : loading ? 'Loading events…' : drawn.count;

  return (
    <>
      <header class="page">
        <h1>Pokémon GO Events</h1>
        {/*
         * The live region, rather than `<main>`: the count is the one line that answers a search, a filter or a load,
         * where the body under it changes on every keystroke and with the relative times on the minute tick.
         */}
        <p class="sub" aria-live="polite">
          {count}
        </p>

        {/*
         * How many events have appeared since this browser last acknowledged them, and the one control that clears them
         * all. Its own line rather than part of the count because all three views write that one themselves, and this
         * says the same thing in each of them. Hidden until there is a number to report.
         *
         * The number is a toggle narrowing every view to those events, `aria-pressed` saying which way it is set.
         */}
        <p class="sub newly" hidden={newly === 0}>
          <button
            type="button"
            class="new-count"
            aria-pressed={filteringNew}
            title={filteringNew ? 'Show every event' : 'Show only these events'}
            onClick={() => setOnlyNew(!filteringNew)}
          >
            {newly} new event{newly === 1 ? '' : 's'}
          </button>
          <button type="button" class="ghost" title="Stop marking these events as new" onClick={markAllSeen}>
            Mark all as seen
          </button>
        </p>
      </header>

      <section class="controls">
        <div class="viewtoggle" role="group" aria-label="View">
          {(
            [
              ['cards', 'Cards'],
              ['calendar', 'Calendar'],
              ['tracks', 'Tracks'],
            ] as const
          ).map(([name, label]) => (
            <button
              key={name}
              type="button"
              class={view === name ? 'active' : undefined}
              aria-pressed={view === name}
              onClick={() => setView(name)}
            >
              {label}
            </button>
          ))}
        </div>

        <input
          type="search"
          placeholder="Search events…"
          autocomplete="off"
          value={search}
          onInput={(event) => setSearch(event.currentTarget.value)}
        />
        <button type="button" onClick={() => void load(true)}>
          Refresh
        </button>
        {/*
         * `aria-expanded` carries the state and the title says which way a click goes, so the label stays neutral in
         * both. The ellipsis is a real character rather than CSS content so it survives the stylesheet not loading,
         * and needs no `aria-hidden`, `aria-label` already replacing the contents in the accessible name.
         */}
        <div class="disclose-row">
          <button
            type="button"
            class="disclose"
            aria-controls="filters"
            aria-expanded={filtersOpen}
            aria-label="Filters"
            title={`${filtersOpen ? 'Hide' : 'Show'} filters`}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            …
          </button>
        </div>
      </section>

      {/* Hidden until the handle above discloses it: everything in here narrows or widens what the views draw. */}
      <section class="filters" id="filters" aria-label="Filters" hidden={!filtersOpen}>
        {/*
         * What a chip click applies to, immediately above the chips it governs. The label is a real element and the
         * group takes `aria-labelledby` rather than repeating it in an `aria-label`, so the two cannot drift.
         */}
        <div class="scope">
          <span id="scopeLabel">Type filters apply to</span>
          <div class="viewtoggle" role="group" aria-labelledby="scopeLabel">
            {(
              [
                ['global', 'All views'],
                ['view', 'This view'],
              ] as const
            ).map(([scope, label]) => (
              <button
                key={scope}
                type="button"
                class={prefs.filterScope === scope ? 'active' : undefined}
                aria-pressed={prefs.filterScope === scope}
                onClick={() => setScope(scope)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/*
         * A `group` rather than a labelled `section`, being nested inside one: two regions one wrapping the other is a
         * landmark a reader has to step past to reach the chips.
         *
         * The type chips are painted from the hidden set in force rather than their own appearance, which matters
         * because under a per-view scope that set changes with the view — a row showing the last view's would be a
         * stale legend.
         *
         * The reveals are the same chip, and buttons for the same reason: `aria-pressed` is what carries on or off to a
         * reader who cannot see the dimming. Last in the row and so last in the tab order, the type chips being the
         * legend for all three views where these only widen a window.
         */}
        <div class="type-filters" role="group" aria-label="Filter events">
          {types.map(([eventType, label]) => (
            <button
              key={eventType}
              type="button"
              class={`chip${hidden.has(eventType) ? ' off' : ''}${typeClass(eventType)}`}
              aria-pressed={!hidden.has(eventType)}
              onClick={() => toggleType(eventType)}
            >
              {label}
            </button>
          ))}
          {REVEALS.map(({ name, label, cardsOnly }) => (
            <button
              key={name}
              type="button"
              class={reveals[name] ? 'chip' : 'chip off'}
              aria-pressed={reveals[name]}
              hidden={cardsOnly && view !== 'cards'}
              onClick={() => setReveals((was) => ({ ...was, [name]: !was[name] }))}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <main>{failed === null && drawn.body}</main>

      <footer>
        <p>
          Event data from{' '}
          <a href="https://leekduck.com/events/" target="_blank" rel="noopener">
            Leek Duck
          </a>{' '}
          via{' '}
          <a href="https://github.com/bigfoott/ScrapedDuck" target="_blank" rel="noopener">
            ScrapedDuck
          </a>
          , copied here every hour, plus events defined in this repository. Times are shown in your device's local
          timezone.
        </p>
        <p>
          <a href={EVENTS_FEED}>Subscribe in your own calendar</a>, without the weekly Spotlight and Raid Hours. In
          Google Calendar, copy the link into <em>Other calendars → From URL</em>.
        </p>
        <p>This site is unofficial. Click an event to open its source page.</p>
      </footer>
    </>
  );
}
