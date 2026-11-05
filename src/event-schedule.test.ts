import { describe, expect, test } from 'vitest';

import {
  addDays,
  continuations,
  DAY_MS,
  layoutTracks,
  mergeEvents,
  overlaps,
  packLanes,
  parseDate,
  relativeUnit,
  startOfDay,
  statusOf,
  TRACK_LEAD_DAYS,
  TRACK_MAX_DAYS,
  TRACK_MIN_DAYS,
  trackBar,
  typeClass,
  weekColumns,
  windowOf,
  type ParsedEvent,
  type TrackItem,
} from './event-schedule.js';
import { testEveryZone } from './testing/zones.js';

import type { FeedEvent } from './types.js';

/**
 * A feed entry, defaulting every field the case does not care about. The dates are the point of almost all of these, so
 * they are what each case names.
 */
const feedEvent = (over: Partial<FeedEvent>): FeedEvent => ({
  eventID: 'id',
  name: 'An Event',
  eventType: 'event',
  heading: 'Events',
  link: 'https://example.invalid/',
  image: 'https://example.invalid/i.png',
  start: null,
  end: null,
  ...over,
});

const parsed = (over: Partial<ParsedEvent>): ParsedEvent => ({
  eventID: 'id',
  name: 'An Event',
  eventType: 'event',
  heading: 'Events',
  link: '',
  image: '',
  start: null,
  end: null,
  startHasZone: false,
  added: null,
  ...over,
});

/**
 * Every date below is built from local parts rather than parsed from a string, because `startOfDay` and `addDays` are
 * local-time constructors — so a fixture built the same way is the one that reads the same in every zone. Nothing here
 * asserts an absolute instant for that reason; what it asserts is a length, a boundary or an order.
 */
const at = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute);

test('parseDate answers null for a missing or unusable date', () => {
  expect(parseDate(null)).toBeNull();
  expect(parseDate('')).toBeNull();
  expect(parseDate('not a date')).toBeNull();
  expect(parseDate('2026-09-21T06:00:00.000Z')?.toISOString()).toBe('2026-09-21T06:00:00.000Z');
});

/** `startOfDay` lands on a local midnight whatever time of day it is handed, which is what the grid's cells are. */
test('startOfDay drops the time of day', () => {
  const midnight = startOfDay(at(2026, 9, 21, 23));

  expect([midnight.getHours(), midnight.getMinutes(), midnight.getSeconds()]).toEqual([0, 0, 0]);
  expect(midnight.getDate()).toBe(21);
});

/**
 * `addDays` counts calendar days rather than fixed spans of milliseconds, which is what the week grid needs: a day a
 * clock change makes 23 or 25 hours long is still one column.
 */
test('addDays steps calendar days across a month and year boundary', () => {
  expect(addDays(at(2026, 1, 30), 3).getTime()).toBe(at(2026, 2, 2).getTime());
  expect(addDays(at(2026, 12, 31), 1).getTime()).toBe(at(2027, 1, 1).getTime());
  expect(addDays(at(2026, 3, 1), -1).getTime()).toBe(at(2026, 2, 28).getTime());
});

/**
 * A step is one calendar day and not 86,400,000 milliseconds, which is the whole reason this is a `Date` constructor
 * rather than arithmetic: a day a clock change makes 23 or 25 hours long is still one column of the grid, and adding a
 * fixed span across one lands at 23:00 or 01:00 and drags every later column with it.
 *
 * Walking a whole year is what reaches that, since the two readings agree on every other day — so in a zone with no DST
 * at all they cannot be told apart, and this passes for a reason rather than catching anything. `testEveryZone` is what
 * puts it in a zone that does change its clocks whatever zone the machine is in: the fixed-span reading passes at
 * `Asia/Kathmandu` and at `UTC`, and fails at both `America/New_York` and `Australia/Sydney`.
 */
testEveryZone('addDays keeps the wall clock across every day of a year', () => {
  let day = at(2026, 1, 1);

  for (let i = 0; i < 365; i += 1) {
    day = addDays(day, 1);
    expect(day.getHours()).toBe(0);
  }

  expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([2027, 0, 1]);
});

const NOW = at(2026, 9, 21, 12);

/**
 * The four buckets. `active` covers a running window *and* one that has started with no announced end, which is the
 * case that carries a null `at` — the only kind that does, since `tbd` carries an explicit null and the other two
 * guarantee a `Date`.
 */
test.for([
  { when: 'no dates at all', ev: {}, kind: 'tbd', at: null },
  { when: 'a start in the future', ev: { start: at(2026, 9, 22) }, kind: 'upcoming', at: at(2026, 9, 22) },
  {
    when: 'an end in the past',
    ev: { start: at(2026, 9, 1), end: at(2026, 9, 10) },
    kind: 'ended',
    at: at(2026, 9, 10),
  },
  {
    when: 'a window around now',
    ev: { start: at(2026, 9, 20), end: at(2026, 9, 22) },
    kind: 'active',
    at: at(2026, 9, 22),
  },
  { when: 'a start in the past and no end', ev: { start: at(2026, 9, 1) }, kind: 'active', at: null },
  { when: 'an end in the future and no start', ev: { end: at(2026, 9, 30) }, kind: 'active', at: at(2026, 9, 30) },
])('an event with $when is $kind', ({ ev, kind, at: edge }) => {
  expect(statusOf(parsed(ev), NOW)).toEqual({ kind, at: edge });
});

/** The edges are inclusive of the window, so an event is active on the instant it starts and on the instant it ends. */
test('an event is active at both of its own edges', () => {
  const ev = parsed({ start: at(2026, 9, 20), end: at(2026, 9, 22) });

  expect(statusOf(ev, at(2026, 9, 20)).kind).toBe('active');
  expect(statusOf(ev, at(2026, 9, 22)).kind).toBe('active');
});

test('a dated event occupies exactly its own window', () => {
  const start = at(2026, 9, 20, 6);
  const end = at(2026, 9, 22, 18);

  expect(windowOf(parsed({ start, end }))).toEqual([start.getTime(), end.getTime()]);
});

/**
 * A one-ended event is a single-day marker rather than an open-ended band, which is what stops a season with no
 * announced end painting every following day of the grid. The day is the local one its date falls on, so the assertion
 * is the length and the boundary rather than an instant.
 */
test.for([
  { kind: 'a start with no end', ev: { start: at(2026, 9, 20, 18) } },
  { kind: 'an end with no start', ev: { end: at(2026, 9, 20, 18) } },
])('$kind occupies the one day it names', ({ ev }) => {
  const win = windowOf(parsed(ev));

  if (win === null) {
    throw new Error('expected a window');
  }

  expect(win[1]).toBe(addDays(new Date(win[0]), 1).getTime());
  expect(new Date(win[0]).getHours()).toBe(0);
  expect(new Date(win[0]).getDate()).toBe(20);
  expect(win[0]).toBeLessThanOrEqual(at(2026, 9, 20, 18).getTime());
});

/** A dateless event has no window, so it can never land on the calendar or the timeline at all. */
test('a dateless event has no window', () => {
  expect(windowOf(parsed({}))).toBeNull();
  expect(weekColumns(null, at(2026, 9, 20))).toBeNull();
  expect(overlaps(null, 0, Number.MAX_SAFE_INTEGER)).toBe(false);
});

/**
 * The overlap is half-open at both ends, so two windows that merely touch do not overlap — which is what keeps an event
 * ending at midnight off the next day's cell.
 */
test('overlaps is half-open, so touching windows do not overlap', () => {
  const win = [1000, 2000] as const;

  expect(overlaps(win, 1500, 2500)).toBe(true);
  expect(overlaps(win, 0, 1500)).toBe(true);
  expect(overlaps(win, 0, 3000)).toBe(true);
  expect(overlaps(win, 1200, 1800)).toBe(true);
  expect(overlaps(win, 2000, 3000)).toBe(false);
  expect(overlaps(win, 0, 1000)).toBe(false);
});

/**
 * 2026-01-04 is a Sunday, which is the column the grid starts each row on. A window is one contiguous interval, so the
 * columns it covers are contiguous and the inclusive pair describes them completely.
 */
const WEEK_START = at(2026, 1, 4);

test.for([
  { span: 'Tuesday to Thursday', from: at(2026, 1, 6), to: at(2026, 1, 8, 12), columns: [2, 4] },
  { span: 'the whole week', from: at(2026, 1, 4), to: at(2026, 1, 10, 23), columns: [0, 6] },
  { span: 'one day', from: at(2026, 1, 7, 9), to: at(2026, 1, 7, 10), columns: [3, 3] },
  { span: 'from before the week into it', from: at(2025, 12, 30), to: at(2026, 1, 5, 12), columns: [0, 1] },
  { span: 'from inside the week past it', from: at(2026, 1, 9), to: at(2026, 2, 1), columns: [5, 6] },
])('a window spanning $span covers columns $columns', ({ from, to, columns }) => {
  expect(weekColumns([from.getTime(), to.getTime()], WEEK_START)).toEqual(columns);
});

/**
 * A cell is one calendar day from midnight to midnight, not 86,400,000ms from midnight. Each case sits at an edge a
 * fixed span gets wrong on a day a clock change makes 25 hours long, which ends a span early so a late event lands on
 * no column, or 23 hours long, which runs a span into the next day so an early event and a one-day marker cover two.
 *
 * Walking a year through `testEveryZone` is what reaches those days, as with `addDays`: in January, or in a zone that
 * never changes its clocks, the two readings cannot be told apart.
 */
testEveryZone('every day of a year is one column, at either edge of the day', () => {
  const origin = at(2026, 1, 4);

  for (let i = 0; i < 364; i += 1) {
    const weekStart = addDays(origin, i - (i % 7));
    const day = addDays(origin, i);
    const [y, m, d] = [day.getFullYear(), day.getMonth() + 1, day.getDate()];
    const col = i % 7;

    expect(weekColumns([at(y, m, d, 23, 15).getTime(), at(y, m, d, 23, 45).getTime()], weekStart)).toEqual([col, col]);
    expect(weekColumns([at(y, m, d, 0, 15).getTime(), at(y, m, d, 0, 45).getTime()], weekStart)).toEqual([col, col]);
    expect(weekColumns(windowOf(parsed({ start: at(y, m, d, 18) })), weekStart)).toEqual([col, col]);
  }
});

test('a window that misses the week entirely covers no columns', () => {
  const next = addDays(WEEK_START, 7);
  expect(weekColumns([next.getTime(), addDays(next, 2).getTime()], WEEK_START)).toBeNull();
});

/**
 * Greedy interval partitioning: the first lane whose previous bar has already ended is reused, otherwise a new one
 * opens. Three overlapping events need three lanes; a fourth starting after the first ended goes back into lane 0.
 */
test('packLanes stacks overlapping events and reuses a freed lane', () => {
  const item = (startMs: number, endMs: number): TrackItem => ({ ev: parsed({}), startMs, endMs, lane: 0 });
  const items = [item(0, 30), item(10, 40), item(20, 50), item(30, 60)];

  expect(packLanes(items)).toBe(3);
  expect(items.map((it) => it.lane)).toEqual([0, 1, 2, 0]);
});

/** A lane is free on the instant its previous bar ends, since a window is half-open at that end. */
test('packLanes reuses a lane for an event starting as the last one ends', () => {
  const item = (startMs: number, endMs: number): TrackItem => ({ ev: parsed({}), startMs, endMs, lane: 0 });
  const items = [item(0, 10), item(10, 20)];

  expect(packLanes(items)).toBe(1);
  expect(items.map((it) => it.lane)).toEqual([0, 0]);
});

test('packLanes needs no lanes for no events', () => {
  expect(packLanes([])).toBe(0);
});

/**
 * A segment continues past its week row only where the row's own edge stopped it: touching column 0 having begun
 * earlier, or column 6 having ended later. One that starts or ends inside the row continues nowhere, even at the edge
 * column.
 */
test.for<{ name: string; from: Date; to: Date; cols: readonly [number, number]; left: boolean; right: boolean }>([
  { name: 'inside the week', from: at(2026, 1, 6), to: at(2026, 1, 8), cols: [2, 3], left: false, right: false },
  { name: 'in from the row above', from: at(2025, 12, 30), to: at(2026, 1, 6), cols: [0, 1], left: true, right: false },
  { name: 'on past the row', from: at(2026, 1, 8), to: at(2026, 1, 20), cols: [4, 6], left: false, right: true },
  { name: 'across the whole row', from: at(2025, 12, 30), to: at(2026, 1, 20), cols: [0, 6], left: true, right: true },
  { name: 'from the first column', from: at(2026, 1, 4), to: at(2026, 1, 7), cols: [0, 2], left: false, right: false },
  { name: 'to the last column', from: at(2026, 1, 8), to: at(2026, 1, 11), cols: [4, 6], left: false, right: false },
])('a segment $name continues left $left and right $right', ({ from, to, cols, left, right }) => {
  const win = [from.getTime(), to.getTime()] as const;

  expect(weekColumns(win, WEEK_START)).toEqual(cols);
  expect(continuations(win, cols, WEEK_START)).toEqual({ contLeft: left, contRight: right });
});

describe('layoutTracks', () => {
  const NOW = at(2026, 1, 10, 12);

  const TRACKS = [
    { type: 'event', label: 'Events' },
    { type: 'research', label: 'Research' },
  ];

  const layout = (
    events: ParsedEvent[],
    over: Partial<{ hidden: Set<string>; carried: Set<string>; isVisible: (ev: ParsedEvent) => boolean }> = {},
  ) =>
    layoutTracks(events, TRACKS, {
      now: NOW,
      hidden: new Set(),
      carried: new Set(['event', 'research', 'go-battle-league']),
      isVisible: () => true,
      ...over,
    });

  /**
   * An event placed by whole days from the range's start. The range is `DAY_MS` multiples long however many hours the
   * local days in it have, so calendar arithmetic (`addDays`) would put a boundary an hour off in a zone that changes
   * its clocks within it.
   */
  const RANGE_START_MS = addDays(startOfDay(NOW), -TRACK_LEAD_DAYS).getTime();

  const days = (id: string, from: number, to: number, eventType = 'event') =>
    parsed({
      eventID: id,
      eventType,
      start: new Date(RANGE_START_MS + from * DAY_MS),
      end: new Date(RANGE_START_MS + to * DAY_MS),
    });

  test('the range starts a couple of days before today and spans at least a month', () => {
    const { rangeStart, span, rangeEndMs } = layout([]);

    expect(rangeStart.getTime()).toBe(addDays(startOfDay(NOW), -TRACK_LEAD_DAYS).getTime());
    expect(span).toBe(TRACK_MIN_DAYS);
    expect(rangeEndMs - rangeStart.getTime()).toBe(TRACK_MIN_DAYS * DAY_MS);
  });

  test('the range grows to the latest end, up to the maximum', () => {
    expect(layout([days('a', 0, 50)]).span).toBe(50);
    expect(layout([days('a', 0, 500)]).span).toBe(TRACK_MAX_DAYS);
  });

  test('an event ending before the range, a dateless one or one of a type without a track is skipped', () => {
    const { rows } = layout([
      days('over', -20, -10),
      parsed({ eventID: 'undated' }),
      days('league', 0, 1, 'go-battle-league'),
      days('kept', 0, 1),
    ]);

    expect(rows.map((row) => row.items.map((item) => item.ev.eventID))).toEqual([['kept'], []]);
  });

  /** The span is clamped where `latestEnd` is not, so this one starts past the right edge of the lane. */
  test('an event starting past the range is dropped before it can claim a lane', () => {
    const { rows } = layout([days('far', 0, 500), days('beyond', TRACK_MAX_DAYS + 5, TRACK_MAX_DAYS + 9)]);

    expect(rows[0]?.items.map((item) => item.ev.eventID)).toEqual(['far']);
    expect(rows[0]?.lanes).toBe(1);
  });

  test('an event starting on the last instant of the range is dropped, one before it kept', () => {
    const edge = TRACK_MAX_DAYS;
    const { rows } = layout([days('far', 0, 500), days('on', edge, edge + 1), days('before', edge - 1, edge)]);

    expect(rows[0]?.items.map((item) => item.ev.eventID)).toEqual(['far', 'before']);
  });

  test('a row whose type is filtered off drops out, but one merely emptied by visibility keeps its row', () => {
    const events = [days('a', 0, 1), days('b', 0, 1, 'research')];
    const notEvent = (ev: ParsedEvent) => ev.eventType !== 'event';

    expect(layout(events, { hidden: new Set(['event']), isVisible: notEvent }).rows).toMatchObject([
      { track: { type: 'research' }, items: [{ ev: { eventID: 'b' } }] },
    ]);

    expect(layout(events, { isVisible: notEvent }).rows).toMatchObject([
      { track: { type: 'event' }, items: [], lanes: 0 },
      { track: { type: 'research' }, items: [{ ev: { eventID: 'b' } }] },
    ]);
  });

  test('a track the feed carries no event of drops out', () => {
    const { rows } = layout([days('a', 0, 1)], { carried: new Set(['event']) });

    expect(rows.map((row) => row.track.type)).toEqual(['event']);
  });

  test('overlapping events in a row are packed into lanes in order of start', () => {
    const { rows } = layout([days('b', 1, 4), days('a', 0, 3)]);

    expect(rows[0]?.items.map((item) => [item.ev.eventID, item.lane])).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
    expect(rows[0]?.lanes).toBe(2);
  });
});

describe('trackBar', () => {
  const DAY_PX = 40;
  const item = (startMs: number, endMs: number) => ({ ev: parsed({}), startMs, endMs, lane: 0 });

  test('a bar sits at its start and runs for its length', () => {
    expect(trackBar(item(2 * DAY_MS, 5 * DAY_MS), 0, 30 * DAY_MS, DAY_PX)).toEqual({ left: 80, width: 120 });
  });

  test('a bar is clipped to the range at either end', () => {
    expect(trackBar(item(-3 * DAY_MS, 5 * DAY_MS), 0, 30 * DAY_MS, DAY_PX)).toEqual({ left: 0, width: 200 });
    expect(trackBar(item(28 * DAY_MS, 40 * DAY_MS), 0, 30 * DAY_MS, DAY_PX)).toEqual({ left: 1120, width: 80 });
  });

  test('a bar is never narrower than half a day', () => {
    expect(trackBar(item(DAY_MS, DAY_MS + 1000), 0, 30 * DAY_MS, DAY_PX).width).toBe(20);
  });
});

/**
 * The relative label picks the largest unit that keeps the number readable, and the sign says which side of now it
 * falls on. The boundaries are the interesting part: 59 minutes is still minutes and 60 is an hour, 23 hours is still
 * hours and 24 is a day.
 *
 * The two 90-minute rows are not a typo. `Math.round` breaks a tie towards positive infinity rather than away from
 * zero, so `-1.5` rounds to `-1` where `1.5` rounds to `2` — which is why an event 90 minutes off reads as "in 2 hours"
 * ahead of now and "1 hour ago" behind it. The asymmetry is only ever half an hour wide at a label that is coarse by
 * design, so it is recorded here rather than papered over.
 */
test.for([
  { away: 'in 30 minutes', mins: 30, value: 30, unit: 'minute' },
  { away: '30 minutes ago', mins: -30, value: -30, unit: 'minute' },
  { away: 'in 59 minutes', mins: 59, value: 59, unit: 'minute' },
  { away: 'in 60 minutes', mins: 60, value: 1, unit: 'hour' },
  { away: 'in 90 minutes', mins: 90, value: 2, unit: 'hour' },
  { away: '90 minutes ago', mins: -90, value: -1, unit: 'hour' },
  { away: '91 minutes ago', mins: -91, value: -2, unit: 'hour' },
  { away: 'in 23 hours', mins: 23 * 60, value: 23, unit: 'hour' },
  { away: 'in 24 hours', mins: 24 * 60, value: 1, unit: 'day' },
  { away: 'in 10 days', mins: 10 * 24 * 60, value: 10, unit: 'day' },
  { away: 'right now', mins: 0, value: 0, unit: 'minute' },
])('an event $away reads as $value $unit', ({ mins, value, unit }) => {
  const target = new Date(NOW.getTime() + mins * 60_000);
  expect(relativeUnit(target, NOW)).toEqual({ value, unit });
});

/**
 * An event the feed gave no type keeps the default colour rather than wearing a `type-` class with nothing after it.
 */
test('typeClass is empty for an event with no type', () => {
  expect(typeClass('community-day')).toBe(' type-community-day');
  expect(typeClass('')).toBe('');
});

/**
 * This repository's own entries are merged over the feed's by `eventID`, which is what lets `data/events.json` correct
 * an upstream entry rather than duplicate it. The name is the evidence: one list, and it reads as the local spelling.
 */
test('a local entry overrides a feed entry of the same eventID', () => {
  const merged = mergeEvents(
    [feedEvent({ eventID: 'a', name: 'As upstream has it', start: '2026-09-21T06:00:00.000Z' })],
    [feedEvent({ eventID: 'a', name: 'As we have it', start: '2026-09-21T06:00:00.000Z' })],
  );

  expect(merged.map((ev) => ev.name)).toEqual(['As we have it']);
});

/**
 * The stamp is the one thing an override does not take wholesale: an entry `data/events.json` has yet to have stamped
 * keeps the feed entry's, the event being no newer for having been corrected here, and one it has stamped keeps its own.
 */
test.for([
  { local: undefined, added: '2026-09-01T00:00:00.000Z' },
  { local: '2026-10-01T00:00:00.000Z', added: '2026-10-01T00:00:00.000Z' },
])('an override stamped $local is first vended at $added', ({ local, added }) => {
  const [ev] = mergeEvents(
    [{ ...feedEvent({ eventID: 'a' }), added: '2026-09-01T00:00:00.000Z' }],
    [{ ...feedEvent({ eventID: 'a' }), added: local }],
  );

  expect(ev?.added?.toISOString()).toBe(added);
});

test('an event with no stamp, or one that will not parse, has none', () => {
  const merged = mergeEvents([feedEvent({ eventID: 'a' }), { ...feedEvent({ eventID: 'b' }), added: 'whenever' }], []);

  expect(merged.map((ev) => ev.added)).toEqual([null, null]);
});

test('an entry the feed does not carry is added rather than dropped', () => {
  const merged = mergeEvents([feedEvent({ eventID: 'a' })], [feedEvent({ eventID: 'b' })]);
  expect(merged.map((ev) => ev.eventID).sort()).toEqual(['a', 'b']);
});

/**
 * Either side may be empty, which is what lets the page tolerate a dead feed or a missing local file and draw the
 * other.
 */
test.for([
  { missing: 'the feed', feed: [], local: [feedEvent({ eventID: 'local' })], ids: ['local'] },
  { missing: 'the local list', feed: [feedEvent({ eventID: 'feed' })], local: [], ids: ['feed'] },
  { missing: 'both', feed: [], local: [], ids: [] },
])('a merge with $missing missing still answers', ({ feed, local, ids }) => {
  expect(mergeEvents(feed, local).map((ev) => ev.eventID)).toEqual(ids);
});

/**
 * Sorted by start, with a dateless event last rather than first — `Infinity` for a missing start, so the comparison is
 * between two numbers however many of them are missing. Every date here carries a zone, so the order is the same in
 * every timezone.
 */
test('a merge sorts by start and puts the dateless events last', () => {
  const merged = mergeEvents(
    [
      feedEvent({ eventID: 'late', start: '2026-09-23T00:00:00.000Z' }),
      feedEvent({ eventID: 'undated', start: null }),
      feedEvent({ eventID: 'early', start: '2026-09-21T00:00:00.000Z' }),
      feedEvent({ eventID: 'ends-only', start: null, end: '2026-09-22T00:00:00.000Z' }),
    ],
    [],
  );

  expect(merged.map((ev) => ev.eventID)).toEqual(['early', 'late', 'undated', 'ends-only']);
});

/**
 * Whether the start carried a zone is read off the feed's own string rather than through a `Date`, because a `Date`
 * built from a naive datetime is anchored to whichever zone the machine is in. A local event is 6am wherever you are;
 * one with a zone is a single instant worldwide.
 */
test.for([
  { given: '2026-09-21T06:00:00.000', zoned: false },
  { given: '2026-09-21T06:00:00.000Z', zoned: true },
  { given: '2026-09-21T06:00:00.000z', zoned: true },
  { given: '2026-09-21T06:00:00.000+10:00', zoned: true },
  { given: '2026-09-21T06:00:00.000-0500', zoned: true },
  { given: null, zoned: false },
])('a start of $given carries a zone: $zoned', ({ given, zoned }) => {
  const [ev] = mergeEvents([feedEvent({ start: given })], []);
  expect(ev?.startHasZone).toBe(zoned);
});

/** An unusable date is a dateless event rather than an Invalid Date travelling into the renderers. */
test('a merge drops a date it cannot parse', () => {
  const [ev] = mergeEvents([feedEvent({ start: 'soon', end: 'later' })], []);

  expect(ev?.start).toBeNull();
  expect(ev?.end).toBeNull();
  expect(statusOf(parsed({ ...ev }), NOW).kind).toBe('tbd');
});

test('a merge drops a link that is not a web URL and keeps the event', () => {
  const merged = mergeEvents(
    [feedEvent({ eventID: 'bad', link: 'javascript:alert(1)' }), feedEvent({ eventID: 'good' })],
    [],
  );

  expect(Object.fromEntries(merged.map((ev) => [ev.eventID, ev.link]))).toEqual({
    bad: undefined,
    good: 'https://example.invalid/',
  });
});
