/**
 * The events calendar page. Draws Leek Duck's event list from `data/events-feed.json` — the copy of ScrapedDuck's JSON
 * mirror that `scripts/vend-feed.mts` refreshes hourly — merged with `data/events.json`, a repo-defined list in the
 * same shape whose entries override a feed event of the same `eventID` or add one the feed does not carry. `EventStore`
 * in `src/event-store.ts` loads and merges the two, and either source failing still renders the other.
 * `data/entries-by-event.json` says which events have routes here, so a card can link through to them on the map.
 *
 * Three views over the same data: a card list grouped by status, a month listed as the days events start and end on,
 * and a Tracks timeline laying events out as horizontal bars in fixed category rows. The search box, type filters and
 * dismissals apply to all three.
 */

import { Fragment, type ComponentChildren, type HTMLAttributes } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { byCodeUnit, routeSummary } from '../event-feed.js';
import { hiddenFor, type Prefs, type View } from '../event-prefs.js';
import {
  addDays,
  agendaOf,
  DAY_MS,
  layoutTracks,
  overlaps,
  relative,
  startOfDay,
  statusOf,
  trackBar,
  typeClass,
  windowOf,
  type AgendaEntry,
  type ParsedEvent,
  type StatusKind,
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
import { fetchOk } from '../fetch-ok.js';
import { ENTRIES_BY_EVENT, EVENTS_FEED } from '../generated.js';
import { toHash } from '../router.js';

import type { RouteIndex } from '../types.js';

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
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const monthNameFmt = new Intl.DateTimeFormat(undefined, { month: 'long' });
const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const dayYearFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const longDayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
const minuteFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * The format for a time of day, leaving the minutes off on the hour — "6 am" rather than "6:00 am" — since nearly every
 * event starts and ends on one. Given both ends of a range, so that the two read in the same style. Only on a 12-hour
 * clock, whose am and pm say it is a time: on a 24-hour one the hour alone is a bare "20".
 */
const clockFor = (...times: Date[]) =>
  hourFmt.resolvedOptions().hour12 === true && times.every((time) => time.getMinutes() === 0) ? hourFmt : minuteFmt;

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
 * match survives a wording change upstream. GO Battle League and GO Pass are deliberately absent, so an event of either
 * type never lands on the timeline — nor does one of a type the feed adds later, until it is given a row here. The
 * labels are ours where they read better than the feed's.
 */
const TRACKS = [
  { type: 'choose-your-path', label: 'Choose Your Path' },
  { type: 'community-day', label: 'Community Day' },
  { type: 'event', label: 'Events' },
  { type: 'pokemon-go-tour', label: 'GO Tour' },
  { type: 'max-battles', label: 'Max Battles' },
  { type: 'max-mondays', label: 'Max Mondays' },
  { type: 'raid-battles', label: 'Raid Battles' },
  { type: 'raid-day', label: 'Raid Day' },
  { type: 'raid-hour', label: 'Raid Hour' },
  { type: 'regional-event', label: 'Regional Event' },
  { type: 'research', label: 'Research' },
  { type: 'season', label: 'Season' },
  { type: 'pokemon-spotlight-hour', label: 'Spotlight Hour' },
  { type: 'timed-research', label: 'Timed Research' },
  { type: 'wild-area', label: 'Wild Area' },
];

/**
 * The three reveals at the foot of the filter panel, each with its label and whether it is only offered to the cards
 * view. Both bucket reveals only mean anything there: the calendar and tracks views show a fixed window regardless,
 * and neither can draw a dateless event at all, there being no day to put it on.
 */
const REVEALS = [
  { name: 'showPast', label: 'Ended', cardsOnly: true },
  { name: 'showUndated', label: 'Undated', cardsOnly: true },
  { name: 'showHidden', label: 'Hidden', cardsOnly: false },
] as const satisfies readonly { name: keyof Reveals; label: string; cardsOnly: boolean }[];

// Tracks view geometry. TRACK_DAY_PX is the single source for a day column's width: the bars are positioned in pixels
// from it, and the same value is handed to CSS as the --track-day custom property for the gridline background, so the
// two cannot drift. The timeline runs from a couple of days before today to the latest event end, clamped to a sane
// span (see `layoutTracks`).
const TRACK_DAY_PX = 40;
const TRACK_BAR_H = 22;
const TRACK_LANE_GAP = 4;
const TRACK_LABEL_PX = 132;

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
 * An event's row in the calendar or its bar on the tracks: a link to its source page, taking the `opening` handlers a
 * card's link takes, or a `<span>` for an event whose link `webLink` dropped — the reason the cards view leaves its
 * overlay out. An `<a>` with no `href` would still be drawn as something to click, yet take no focus and open nothing.
 */
function eventBar(
  ev: ParsedEvent,
  bar: Pick<HTMLAttributes<HTMLElement>, 'class' | 'style' | 'title'>,
  children: ComponentChildren,
  opened: Pick<HTMLAttributes<HTMLAnchorElement>, 'onClick' | 'onAuxClick'>,
) {
  return ev.link === undefined ? (
    <span key={ev.eventID} {...bar}>
      {children}
    </span>
  ) : (
    <a key={ev.eventID} {...bar} {...opened} href={ev.link} target="_blank" rel="noopener">
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
  return (await fetchOk(ENTRIES_BY_EVENT)).json();
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
   * reference rather than state, and `commit` is the one way it changes. Re-read from storage as the page opens:
   * another browser tab may have saved a change since this document loaded, and a chip or a dismissal writes its whole
   * set back over it.
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

  const { view } = prefs;
  const [search, setSearch] = useState('');

  // A session's choices rather than saved preferences; `prefs` is what survives a reload.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reveals, setReveals] = useState<Reveals>(NOTHING_REVEALED);

  /**
   * The type an `?event=` link unhid to land on its event, let through on every view while storage goes on hiding it.
   * Held here rather than taken out of the stored set, which every chip writes back whole, so no click can save it.
   */
  const [unhidden, setUnhidden] = useState<string>();

  /**
   * Whether the reader has narrowed the page to the events the header reports as new, by pressing that count. Read
   * live rather than as a snapshot of the IDs, so a card opened or marked as seen drops out as its mark does.
   */
  const [onlyNew, setOnlyNew] = useState(false);

  /** Whether the reader has narrowed the cards to the dismissed events, by pressing the summary's count of them. */
  const [onlyDismissed, setOnlyDismissed] = useState(false);

  /** The first-of-month the calendar view is showing, or the current month until the reader steps off it. */
  const [calMonth, setCalMonth] = useState<Date | null>(null);

  // What the calendar view has unfolded: the events covering the whole month, and the days before today.
  const [showAllMonth, setShowAllMonth] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);

  /**
   * An `?event=` the fragment named and the feed had not yet arrived to apply. Held rather than re-read so the arrival
   * is spent once: a ten-minute re-fetch must not re-apply it over whatever the reader has since typed.
   */
  const pending = useRef<string | null>(null);

  /** What the cards view is drawing under beyond the saved filters, which the top bar's count reads too. */
  const filter = { reveals, search, now, unhidden };

  /**
   * Whether an event survives the type-filter, dismissal and search-term filters of the view that is open, and the new
   * and dismissed events filters while they are on. `newlyVisible` is not built on this, so narrowing the page does not
   * change the count the reader pressed to narrow it, nor the top bar's. Narrowed to the dismissed events, the page lets
   * them through whichever way the "Hidden" chip is set.
   */
  const isVisible = (ev: ParsedEvent) =>
    admits(
      ev,
      prefs,
      hiddenFor(prefs, view),
      filteringDismissed ? { ...filter, reveals: { ...reveals, showHidden: true } } : filter,
    ) &&
    (!filteringNew || isNew(ev)) &&
    (!filteringDismissed || prefs.dismissed.has(ev.eventID));

  /** Whether the reader has revealed the status bucket this event falls in. */
  const isRevealed = (ev: ParsedEvent) => isRevealedIn(ev, filter);

  /** Whether the event has turned up since the reader last acknowledged what was on the page. */
  const isNew = (ev: ParsedEvent) => isNewIn(prefs, ev);

  /**
   * The handlers that acknowledge an event as a link opens it, from a card, a calendar row or a tracks bar alike.
   * `target="_blank"` leaves the reader on this page, so an event they have just gone and read would otherwise still be
   * announcing itself as new when they come back.
   *
   * `auxclick` as well as `click` because a middle click — how a reader opens something in a background tab without
   * losing their place — fires only the second of the two.
   */
  const opening = (ev: ParsedEvent) => {
    const acknowledge = (event: MouseEvent) => {
      // Left and middle are the two that open the link. Chrome reports a right click as an `auxclick` too, and that
      // opens a menu rather than the event.
      if (event.button > 1 || !isNew(ev)) {
        return;
      }

      store.acknowledge([ev]);
    };

    return { onClick: acknowledge, onAuxClick: acknowledge };
  };

  /**
   * The events the reader is being told are new, which is also what the top bar lists while nothing is searched for:
   * unacknowledged, and among those the ones the cards view admits.
   */
  const newlyVisible = () => newlyVisibleIn(events, prefs, filter);

  /**
   * A link from the Routes page arrives as `#/events?event=<eventID>` and lands by searching for that event's name.
   * Reusing the search box rather than scrolling to the card leaves the term visible, and emptying it is how a reader
   * already knows to get the other cards back. The event is always there to find, the linter rejecting a `<pgr:event>`
   * naming an ID neither `data/events.json` nor the feed carries.
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
    setUnhidden(match.eventType);
    setSearch(match.name);

    // Reveal its status bucket for the same reason: the Routes page keeps linking an event for up to a day after it
    // ends here. The clock rather than `now`, which can lag it, so an event that has just ended is not missed.
    const kind = statusOf(match, new Date()).kind;

    setReveals((was) => ({
      ...was,
      showPast: was.showPast || kind === 'ended',
      showUndated: was.showUndated || kind === 'tbd',
    }));

    // Arriving acknowledges the event, so the new events filter would hide the very card the link was followed to, as
    // the dismissed events filter would one still showing.
    setOnlyNew(false);
    setOnlyDismissed(false);

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
   * Hand the cards view's filters to the store while the page is open, so the top bar counts under the same ones bar
   * the search, and take them back as it closes. A type `applyPending` unhid goes with them, so every other tab counts
   * under what is stored.
   */
  useEffect(() => {
    store.publish(filter);
  }, [reveals, search, now, unhidden]);

  useEffect(() => () => store.publish(null), []);

  /**
   * An import from the top bar's settings has written over storage, which the store has re-read already. What is left
   * is the page's own: a change this wholesale cannot leave a session reveal or an unhidden type widening the page.
   * Skipped on the first render, so opening the page after an import keeps the defaults it opened with rather than
   * resetting them for an import it never saw.
   */
  const restores = useRef(store.restores);

  useEffect(() => {
    if (store.restores !== restores.current) {
      restores.current = store.restores;
      setReveals(NOTHING_REVEALED);
      setUnhidden(undefined);
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

  /** Switch views, saved so the page opens on this one next time. */
  function setView(next: View) {
    prefs.view = next;
    commit('view');
  }

  /**
   * Switch which hidden-type set the chips edit and the views read. Persisted because the sets it chooses between are:
   * a scope falling back to global on reload would leave per-view filtering saved and silently out of force, which is
   * worse than not having offered it.
   */
  function setScope(next: Prefs['filterScope']) {
    prefs.filterScope = next;
    commit('filterScope');
  }

  function toggleType(eventType: string) {
    const stored = hiddenFor(prefs, view);

    // The unhidden type's chip shows as on whatever storage says, so a click on it turns it off. Where storage hides
    // the type already, dropping the un-hide is all that takes.
    if (eventType === unhidden) {
      setUnhidden(undefined);

      if (stored.has(eventType)) {
        return;
      }
    }

    if (!stored.delete(eventType)) {
      stored.add(eventType);
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

  function toggleReveal(name: keyof Reveals) {
    setReveals((was) => ({ ...was, [name]: !was[name] }));
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

  const types = [...labels].sort(([, a], [, b]) => byCodeUnit(a, b));

  /** The types the chips draw as off and the tracks drop a row for: the stored set, less the one a link unhid. */
  const hidden = new Set([...hiddenFor(prefs, view)].filter((eventType) => eventType !== unhidden));

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

  // Counted over the feed rather than the stored set, which keeps the ID of every event ever dismissed: one that has
  // since left the feed is nothing "Hidden" could bring back.
  const dismissedCount = events.filter((ev) => prefs.dismissed.has(ev.eventID)).length;

  /**
   * In force on the cards alone, the only view whose summary carries the count that turns it off, and for the same
   * reason as `filteringNew` only while that count is there to press.
   */
  const filteringDismissed = onlyDismissed && view === 'cards' && dismissedCount > 0;

  useEffect(() => {
    if (dismissedCount === 0) {
      setOnlyDismissed(false);
    }
  }, [dismissedCount]);

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
            {...opening(ev)}
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
           * than on the whole list of routes. The stylesheet puts the Map tab's own glyph in front, so the destination
           * is named the same way twice; the accessible name says it in words instead.
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
   * One event on the calendar: its name, and when on that day it starts or ends. A function rather than a component for
   * the reason `renderCard` is one: declared in here, a component is a fresh type on every render and the whole month
   * is rebuilt rather than diffed.
   *
   * The New mark is a label rather than the card's button, because the row is a link and a button cannot sit inside
   * one; opening the row clears it, as the header's button does.
   */
  function renderRow(ev: ParsedEvent, when: string) {
    return eventBar(
      ev,
      { class: `agenda-row ${statusOf(ev, now).kind}${typeClass(ev.eventType)}`, title: timeRange(ev) },
      <>
        <span class="agenda-name">
          {ev.name}
          {isNew(ev) && <span class="agenda-new">New</span>}
        </span>
        <span class="agenda-when">{when}</span>
      </>,
      opening(ev),
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

    return {
      /**
       * The dismissed count is a toggle narrowing the cards to the dismissed events, `aria-pressed` saying which way it
       * is set.
       */
      count: (
        <>
          {shown ? `${shown} event${shown === 1 ? '' : 's'}` : 'No events to show'}
          {buckets.active.length > 0 && (
            <>
              {' · '}
              {buckets.active.length} happening now
            </>
          )}
          {dismissedCount > 0 && (
            <>
              {' · '}
              <button
                type="button"
                aria-pressed={filteringDismissed}
                title={filteringDismissed ? 'Show every event' : 'Show only these events'}
                onClick={() => setOnlyDismissed(!filteringDismissed)}
              >
                {dismissedCount} dismissed
              </button>
            </>
          )}
        </>
      ),

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

  /**
   * The calendar view: the month as the days events start and end on, with the events covering the whole month folded
   * into one list above them, and in the month holding today, the days before it folded away too.
   */
  function calendar() {
    const month = calMonth ?? new Date(now.getFullYear(), now.getMonth(), 1);
    const year = month.getFullYear();
    const index = month.getMonth();
    const next = new Date(year, index + 1, 1);
    const today = startOfDay(now).getTime();
    const visible = events.filter(isVisible);
    const { allMonth, days } = agendaOf(visible, month, now);
    const inMonth = visible.filter((ev) => overlaps(windowOf(ev), month.getTime(), next.getTime())).length;

    /**
     * How many of the days come before today, which are the first that many since the days run in order. Counted in the
     * month holding today alone: a month already over is nothing but earlier days, and folding the lot would leave only
     * the button.
     */
    const earlier =
      year === now.getFullYear() && index === now.getMonth() ? days.filter(({ day }) => +day < today).length : 0;

    /** A date, with the year where it is not the year of the month on show. */
    const date = (at: Date) => (at.getFullYear() === year ? dayFmt : dayYearFmt).format(at);

    /** When on its day an entry starts or ends, or both for an event that is over within the day. */
    function when({ ev: { start, end }, edge }: AgendaEntry) {
      if (edge === 'end' || start === null) {
        return end === null ? '' : `Ends ${clockFor(end).format(end)}`;
      }

      if (end === null) {
        return `Starts ${clockFor(start).format(start)}`;
      }

      return edge === 'both'
        ? clockFor(start, end).formatRange(start, end)
        : `Starts ${clockFor(start).format(start)}, ends ${date(end)}`;
    }

    /** For an event listed on no day of its own: running all month, or through today. */
    const until = ({ end }: ParsedEvent) => (end === null ? '' : `Ends ${date(end)}`);

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

          <div class="agenda">
            {allMonth.length > 0 && (
              <section class="agenda-all">
                <h2>
                  <button
                    type="button"
                    aria-controls="all-month"
                    aria-expanded={showAllMonth}
                    onClick={() => setShowAllMonth(!showAllMonth)}
                  >
                    All month
                    <span class="agenda-count">{allMonth.length}</span>
                    <span class="swatches" aria-hidden="true">
                      {allMonth.map((ev) => (
                        <span key={ev.eventID} class={`swatch${typeClass(ev.eventType)}`} />
                      ))}
                    </span>
                  </button>
                </h2>
                <div id="all-month" class="agenda-list" hidden={!showAllMonth}>
                  {allMonth.map((ev) => renderRow(ev, until(ev)))}
                </div>
              </section>
            )}

            {earlier > 0 && (
              <button
                type="button"
                class="agenda-earlier"
                aria-expanded={showEarlier}
                onClick={() => setShowEarlier(!showEarlier)}
              >
                {showEarlier ? 'Hide earlier days' : `Show ${earlier} earlier day${earlier === 1 ? '' : 's'}`}
              </button>
            )}

            {(showEarlier ? days : days.slice(earlier)).map(({ day, entries, running }) => {
              const isToday = +day === today;

              return (
                <section
                  key={+day}
                  class={`agenda-day${isToday ? ' today' : +day < today ? ' past' : ''}`}
                  aria-current={isToday ? 'date' : undefined}
                >
                  {/* The label reads the date whole, where the block splits it over lines and leaves out the month. */}
                  <h2 class="agenda-date" aria-label={`${longDayFmt.format(day)}${isToday ? ', today' : ''}`}>
                    <span>{weekdayFmt.format(day)}</span>
                    <span class="dn">{day.getDate()}</span>
                    {isToday && <span class="pill">Today</span>}
                  </h2>
                  <div class="agenda-list">
                    {entries.map((entry) => renderRow(entry.ev, when(entry)))}
                    {running.length > 0 && <h3 class="agenda-sub">On now</h3>}
                    {running.map((ev) => renderRow(ev, until(ev)))}
                    {entries.length + running.length === 0 && <p class="agenda-none">Nothing starts or ends today.</p>}
                  </div>
                </section>
              );
            })}

            {days.length + allMonth.length === 0 && <p class="agenda-none">No events this month.</p>}

            <button type="button" class="navbtn agenda-next" onClick={() => setCalMonth(next)}>
              {monthNameFmt.format(next)} ›
            </button>
          </div>
        </>
      ),
    };
  }

  /** The Tracks view: a Gantt chart, one fixed row per event type. */
  function tracks() {
    const { rangeStart, rangeStartMs, rangeEndMs, span, rows } = layoutTracks(events, TRACKS, {
      now,
      hidden,
      carried: new Set(labels.keys()),
      isVisible,
    });

    const width = span * TRACK_DAY_PX;
    const todayX = ((startOfDay(now).getTime() - rangeStartMs) / DAY_MS) * TRACK_DAY_PX;
    const shown = rows.reduce((sum, row) => sum + row.items.length, 0);

    const drawnRows = rows.flatMap(({ track, items, lanes }) => {
      const height = Math.max(1, lanes) * (TRACK_BAR_H + TRACK_LANE_GAP) + TRACK_LANE_GAP;

      return [
        <div key={`l-${track.type}`} class="track-label" style={{ height: `${height}px` }}>
          {track.label}
        </div>,
        <div key={`r-${track.type}`} class="track-lane" style={{ width: `${width}px`, height: `${height}px` }}>
          {items.map((item) => {
            const bar = trackBar(item, rangeStartMs, rangeEndMs, TRACK_DAY_PX);
            const status = statusOf(item.ev, now).kind;

            return eventBar(
              item.ev,
              {
                class: `bar ${status}${isNew(item.ev) ? ' new' : ''}${typeClass(item.ev.eventType)}`,
                title: `${item.ev.name} — ${timeRange(item.ev)}`,
                style: {
                  left: `${bar.left}px`,
                  width: `${bar.width}px`,
                  top: `${TRACK_LANE_GAP + item.lane * (TRACK_BAR_H + TRACK_LANE_GAP)}px`,
                  height: `${TRACK_BAR_H}px`,
                },
              },
              item.ev.name,
              opening(item.ev),
            );
          })}
        </div>,
      ];
    });

    return {
      count: shown ? `${shown} event${shown === 1 ? '' : 's'}` : 'No events to show',
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
              {drawnRows}
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
        <h1 class="sr">Events</h1>
        {/*
         * The live region, rather than `<main>`: the count is the one line that answers a search, a filter or a load,
         * where the body under it changes on every keystroke and with the relative times on the minute tick.
         */}
        <p class="sub count" aria-live="polite">
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

      {/* Pinned as one, so the chevron opens the filters wherever the reader has scrolled to. */}
      <div class="toolbar">
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
           * both. The chevron points the way a click moves the panel — down to open it, up to close it — and is swapped
           * in the markup rather than turned by a CSS transform so it still points the right way without the
           * stylesheet. Its size is set in attributes for the same reason.
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
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d={filtersOpen ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
              </svg>
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
           * A `group` rather than a labelled `section`, being nested inside one: two regions one wrapping the other is
           * a landmark a reader has to step past to reach the chips.
           *
           * The type chips are painted from the hidden set in force rather than their own appearance, which matters
           * because under a per-view scope that set changes with the view — a row showing the last view's would be a
           * stale legend.
           *
           * The reveals are the same chip, and buttons for the same reason: `aria-pressed` is what carries on or off to
           * a reader who cannot see the dimming. Last in the row and so last in the tab order, the type chips being the
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
                onClick={() => toggleReveal(name)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      </div>

      <main>{failed === null && drawn.body}</main>

      <footer>
        <p>
          Events from{' '}
          <a href="https://leekduck.com/events/" target="_blank" rel="noopener">
            Leek Duck
          </a>{' '}
          via{' '}
          <a href="https://github.com/bigfoott/ScrapedDuck" target="_blank" rel="noopener">
            ScrapedDuck
          </a>
          , updated hourly, plus some of our own. Times are in your timezone.{' '}
          <a href={EVENTS_FEED}>Subscribe in your calendar</a>.
        </p>
      </footer>
    </>
  );
}
