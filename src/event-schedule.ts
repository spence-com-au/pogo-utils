/**
 * Where an event sits in time: the feed's two sources merged into one list, each entry's dates parsed, and the
 * placement the three views read off it. None of it needs a DOM, which is what lets a test reach these rules without
 * one — `src/pages/events.tsx` is a page component and so unreachable outside a browser.
 */

import { HAS_ZONE, type StampedEvent, webLink } from './event-feed.js';

/**
 * A feed entry with its dates parsed — the only shape the page itself works in. Not `Event`, which would shadow the
 * DOM's own for the whole page module, where the card's acknowledge handler takes a real `MouseEvent`.
 */
export interface ParsedEvent {
  eventID: string;
  name: string;
  heading: string;
  eventType: string;
  image: string;
  start: Date | null;
  end: Date | null;

  /** The event's source page, or undefined where the feed's was not a web URL — see `webLink`. */
  link: string | undefined;

  /** Whether the feed gave `start` a zone, so the label can say "your local time". */
  startHasZone: boolean;

  /** When the event was first vended, or null for one not yet stamped — see `StampedEvent`. */
  added: Date | null;
}

export type StatusKind = 'active' | 'upcoming' | 'tbd' | 'ended';

/**
 * Where an event sits relative to now. A discriminated union rather than one shape with an optional `at`, because the
 * edge a card counts down to is exactly what a dateless event lacks. `tbd` still carries the field as an explicit
 * null, so `status.at` is readable without first ruling that kind out.
 */
export type Status =
  { kind: 'tbd'; at: null } | { kind: 'upcoming' | 'ended'; at: Date } | { kind: 'active'; at: Date | null };

/**
 * The half-open instant interval an event occupies, `[startMs, endMs]`. A tuple rather than a `number[]` so neither
 * end has to answer for a third element, and so `win[0]` stays a `number` — `noUncheckedIndexedAccess` adds
 * `| undefined` to an array's element but not to a tuple index. Not `Window`, for the reason `ParsedEvent` is not
 * `Event`.
 */
export type Span = readonly [number, number];

/** One event placed on a Tracks row. `lane` is written by `packLanes` afterwards: it depends on the whole row. */
export interface TrackItem {
  ev: ParsedEvent;
  startMs: number;
  endMs: number;
  lane: number;
}

export const DAY_MS = 86_400_000;

export function parseDate(s: string | null): Date | null {
  if (!s) {
    return null;
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/**
 * The largest unit that keeps a relative label's number readable, and that number — whether "in 90 minutes" reads as
 * hours. The wording is Intl's: `relative()` hands this to a `RelativeTimeFormat`.
 */
export function relativeUnit(target: Date, now: Date) {
  const mins = Math.round((target.getTime() - now.getTime()) / 60_000);
  const abs = Math.abs(mins);

  if (abs < 60) {
    return { value: mins, unit: 'minute' as const };
  }

  if (abs < 60 * 24) {
    return { value: Math.round(mins / 60), unit: 'hour' as const };
  }

  return { value: Math.round(mins / (60 * 24)), unit: 'day' as const };
}

const relFmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** `target` worded against `now` — "in 3 days", "yesterday" — for the Events page's cards and the notifications alike. */
export function relative(target: Date, now: Date) {
  const { value, unit } = relativeUnit(target, now);

  return relFmt.format(value, unit);
}

/**
 * Where an event sits relative to now. `active` covers both a running window and one started with no end.
 *
 * `tbd` is rarely the announced-but-unscheduled event it sounds like. ScrapedDuck reads an event's identity off Leek
 * Duck's list but joins its dates in from a feed that drops them days earlier, so everything under the list's
 * "Recently ended" divider reaches us dateless — on 2026-09-24 the feed's five dateless events were exactly that
 * divider's five. So `tbd` mostly means an event already over, which is why `renderCards` keeps the bucket behind a
 * toggle.
 */
export function statusOf(ev: ParsedEvent, now: Date): Status {
  if (!ev.start && !ev.end) {
    return { kind: 'tbd', at: null };
  }

  if (ev.start && now < ev.start) {
    return { kind: 'upcoming', at: ev.start };
  }

  if (ev.end && now > ev.end) {
    return { kind: 'ended', at: ev.end };
  }

  return { kind: 'active', at: ev.end };
}

/**
 * The instant window an event occupies for the calendar's overlap tests. A start with no end is a single-day marker
 * rather than an open-ended band that would paint every following day; an end with no start is a day at its end date.
 * `start ?? end` is null exactly when both are, so the dateless case needs no guard of its own.
 */
export function windowOf(ev: ParsedEvent): Span | null {
  if (ev.start && ev.end) {
    return [ev.start.getTime(), ev.end.getTime()];
  }

  const day = ev.start ?? ev.end;

  if (day === null) {
    return null;
  }

  return [startOfDay(day).getTime(), addDays(day, 1).getTime()];
}

export function overlaps(win: Span | null, from: number, to: number) {
  return win !== null && win[0] < to && win[1] > from;
}

/**
 * The columns of one week row an event's window touches, as `[first, last]` inclusive, or null for a week it misses. A
 * window is one contiguous interval, so the columns it covers are contiguous and the pair describes them completely.
 */
export function weekColumns(win: Span | null, weekStart: Date): readonly [number, number] | null {
  let first = -1;
  let last = -1;

  for (let col = 0; col < 7; col += 1) {
    if (overlaps(win, addDays(weekStart, col).getTime(), addDays(weekStart, col + 1).getTime())) {
      first = first === -1 ? col : first;
      last = col;
    }
  }

  return first === -1 ? null : [first, last];
}

/**
 * The class marking an event's type, so CSS can give each its own colour (the `.type-*` rules in `events.css`). Takes
 * the stable `eventType` slug rather than the human `heading`, and is worn by the card, both bars and the filter chip
 * alike, which is what keeps one type reading the same colour in all four.
 */
export function typeClass(eventType: string) {
  return eventType ? ` type-${eventType}` : '';
}

/**
 * Assign each item a `lane` — a sub-row within its track — by greedy interval partitioning: reuse the first lane whose
 * previous bar has ended, otherwise open a new one. Items must arrive sorted by start. Returns the lane count, which
 * sets the track's height so overlapping events stack instead of drawing over each other.
 */
export function packLanes(items: readonly TrackItem[]) {
  const laneEnds: number[] = [];

  for (const it of items) {
    const free = laneEnds.findIndex((end) => end <= it.startMs);
    const lane = free === -1 ? laneEnds.length : free;

    laneEnds[lane] = it.endMs;
    it.lane = lane;
  }

  return laneEnds.length;
}

/**
 * Whether a week row's segment of an event carries on past the row, as the page draws it. A segment continues past the
 * week only where the week's own edge is what stopped it: reaching column 0 while having begun earlier means it ran in
 * from the row above, and anything starting later than column 0 began inside this week, because it misses the column
 * before. The same holds at the right edge against the end of column 6.
 */
export function continuations(win: Span, [first, last]: readonly [number, number], weekStart: Date) {
  return {
    contLeft: first === 0 && win[0] < weekStart.getTime(),
    contRight: last === 6 && win[1] > addDays(weekStart, 7).getTime(),
  };
}

/**
 * The Tracks timeline runs from `TRACK_LEAD_DAYS` before today to the latest event end, clamped to between
 * `TRACK_MIN_DAYS` and `TRACK_MAX_DAYS` long.
 */
export const TRACK_LEAD_DAYS = 2;
export const TRACK_MIN_DAYS = 30;
export const TRACK_MAX_DAYS = 120;

export interface TrackRow<R extends { type: string }> {
  track: R;
  items: TrackItem[];
  lanes: number;
}

/**
 * What the Tracks view draws: its span, and one row per track that survives the filters, each with its events packed
 * into lanes.
 *
 * A type with no track (GO Battle League, GO Pass) has no row, so it is dropped; an event ending before the window's
 * left edge is skipped. A track whose type is in `hidden` drops out entirely: a row is one `eventType`, which is what
 * the chips switch, so there is no still-visible part of it to keep. So does a track `carried` does not name, so a row
 * exists only where a chip can switch it off. A track emptied by dismissals or a search term (`isVisible`) keeps its
 * row.
 *
 * The right edge needs a guard of its own, mirroring the `win[1] <= rangeStartMs` one: `span` is clamped to
 * `TRACK_MAX_DAYS` where `latestEnd` is not, so an event starting past `rangeEndMs` would clip to a negative width and
 * draw at the minimum width past the lane's right edge, counted in the tally. It is dropped before `packLanes` so it
 * cannot claim a lane and raise the row's height for a bar nobody can see.
 */
export function layoutTracks<R extends { type: string }>(
  events: readonly ParsedEvent[],
  tracks: readonly R[],
  {
    now,
    hidden,
    carried,
    isVisible,
  }: {
    now: Date;
    hidden: ReadonlySet<string>;
    carried: ReadonlySet<string>;
    isVisible: (ev: ParsedEvent) => boolean;
  },
) {
  const rangeStart = addDays(startOfDay(now), -TRACK_LEAD_DAYS);
  const rangeStartMs = rangeStart.getTime();
  const byType = new Map(tracks.map((track) => [track.type, { track, items: [] as TrackItem[] }]));
  const filteredTypes = new Set<string>();
  let latestEnd = rangeStartMs + TRACK_MIN_DAYS * DAY_MS;

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

  const rows = [...byType.values()].flatMap(({ track, items }): TrackRow<R>[] => {
    if (filteredTypes.has(track.type) || !carried.has(track.type)) {
      return [];
    }

    const inRange = items.filter((item) => item.startMs < rangeEndMs).sort((a, b) => a.startMs - b.startMs);

    return [{ track, items: inRange, lanes: packLanes(inRange) }];
  });

  return { rangeStart, rangeStartMs, rangeEndMs, span, rows };
}

/** A bar's left edge and width in pixels, clipped to the range and never narrower than half a day's column. */
export function trackBar(item: TrackItem, rangeStartMs: number, rangeEndMs: number, dayPx: number) {
  const left = Math.max(item.startMs, rangeStartMs);
  const right = Math.min(item.endMs, rangeEndMs);

  return {
    left: ((left - rangeStartMs) / DAY_MS) * dayPx,
    width: Math.max(dayPx / 2, ((right - left) / DAY_MS) * dayPx),
  };
}

function normalise(raw: readonly StampedEvent[]): ParsedEvent[] {
  return raw.map((e) => ({
    eventID: e.eventID,
    name: e.name,
    heading: e.heading,
    eventType: e.eventType,
    link: webLink(e.link),
    image: e.image,
    start: parseDate(e.start),
    end: parseDate(e.end),
    startHasZone: typeof e.start === 'string' && HAS_ZONE.test(e.start),
    added: parseDate(e.added ?? null),
  }));
}

/**
 * The two feeds as one list, sorted by start, with this repository's own entries last so one overrides a feed event of
 * the same `eventID` rather than duplicating it. Either side may be empty, which is what lets the page tolerate a dead
 * feed or a missing local file. A dateless event sorts to the end on `Infinity`, where the cards view wants it.
 *
 * The Map is annotated because a bare `new Map()` is a `Map<any, any>` that `set` does not refine, so `normalise`
 * would check nothing at all about what it was handed.
 */
export function mergeEvents(feed: readonly StampedEvent[], local: readonly StampedEvent[]): ParsedEvent[] {
  const byEventId = new Map<string, StampedEvent>();

  // An override the vend has yet to stamp keeps the stamp of the feed entry it replaces, the event being no newer for
  // having been corrected here.
  for (const e of [...feed, ...local]) {
    byEventId.set(e.eventID, { ...e, added: e.added ?? byEventId.get(e.eventID)?.added });
  }

  return normalise([...byEventId.values()]).sort(
    (a, b) => (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity),
  );
}
