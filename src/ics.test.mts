/**
 * What `scripts/build-ics.mts` writes for an event, decision by decision. The feed a calendar app subscribes to is
 * fetched by that app on its own schedule and read nowhere near this site, so a wrong `DTEND` or a line a parser
 * rejects is found by whoever's calendar it lands in, not by the build — which succeeds either way.
 *
 * Each event is written out here rather than read from `data/`, because the cases that matter are the ones the data
 * happens not to hold today: a span across a daylight-saving change, a date with no time, a field carrying a newline.
 */

import { calendar, calendarEvents, escape, FEED, fold, icsDate, SITE, vevent } from './ics.mts';
import RECURRING_TYPES from './recurring-types.ts';
import type { FeedEvent } from './types.js';
import { expect, test } from 'vitest';

const event = (overrides: Partial<FeedEvent> = {}): FeedEvent => ({
  eventID: 'an-event',
  name: 'An Event',
  eventType: 'event',
  heading: 'Event',
  link: '',
  image: '',
  start: '2026-05-01T10:00:00.000Z',
  end: '2026-05-01T12:00:00.000Z',
  ...overrides,
});

/** The properties of `ev`'s VEVENT, by name, for the cases that care about one or two of them. */
const props = (ev: FeedEvent, index = {}) =>
  Object.fromEntries(
    vevent(ev, index)
      .slice(1, -1)
      .map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1)]),
  );

test('a zoned span across a daylight-saving change converts each end at its own offset', () => {
  // Sydney leaves daylight saving at 03:00 on 5 April 2026, so the two ends carry different offsets. Converting both
  // at either one would put the end an hour out; written in UTC, the calendar app has nothing left to interpret.
  const { DTSTART, DTEND } = props(event({ start: '2026-04-04T10:00:00+11:00', end: '2026-04-06T10:00:00+10:00' }));

  expect(DTSTART).toBe('20260403T230000Z');
  expect(DTEND).toBe('20260406T000000Z');
});

test('a floating span across a daylight-saving change keeps its wall-clock digits', () => {
  // A zoneless time is "10:00 wherever you are", which is iCalendar's floating time. Anchoring it to a `Date` would
  // anchor it to whatever zone the build ran in — UTC on a runner — and every subscriber would see it shifted.
  const { DTSTART, DTEND } = props(event({ start: '2026-03-08T01:00:00', end: '2026-03-08T04:00:00' }));

  expect(DTSTART).toBe('20260308T010000');
  expect(DTEND).toBe('20260308T040000');
});

test('the DTSTAMP is the start in UTC, with a floating start taken digit for digit', () => {
  // Derived from the event rather than the clock, so a rebuild over unmoved data writes the same bytes.
  expect(props(event({ start: '2026-04-04T10:00:00+11:00' })).DTSTAMP).toBe('20260403T230000Z');
  expect(props(event({ start: '2026-03-08T01:00:00' })).DTSTAMP).toBe('20260308T010000Z');
});

test('a date-only end is not read as a time, leaving a point at the start', () => {
  // `DTEND` has to share `DTSTART`'s value type, so a bare date cannot stand beside a date-time — and guessing the
  // hour it means would be inventing an end the feed did not give. The event stays on the calendar at its start.
  const lines = vevent(event({ start: '2026-05-01T10:00:00Z', end: '2026-05-03' }), {});

  expect(lines).toContain('DTSTART:20260501T100000Z');
  expect(lines.some((line) => line.startsWith('DTEND'))).toBe(false);
});

test('an event with only an end is a point at its end', () => {
  const lines = vevent(event({ start: null }), {});

  expect(lines).toContain('DTSTART:20260501T120000Z');
  expect(lines.some((line) => line.startsWith('DTEND'))).toBe(false);
});

test('an event with no readable date throws rather than writing DTSTART:null', () => {
  expect(() => vevent(event({ start: null, end: '2026-05-03' }), {})).toThrow('an-event: no date');
});

test('icsDate reads only a full date-time', () => {
  expect(icsDate('2026-05-01T10:00:00.000Z')).toBe('20260501T100000Z');
  expect(icsDate('2026-05-01T10:00:00-0700')).toBe('20260501T170000Z');
  expect(icsDate('2026-05-01')).toBeNull();
  expect(icsDate('soon')).toBeNull();
  expect(icsDate(null)).toBeNull();
});

test('the description links to the event on the map when there are routes for it', () => {
  const { DESCRIPTION } = props(event({ eventID: 'a b', link: 'https://example.com/e' }), {
    'a b': { routes: 2, waypoints: 0 },
  });

  expect(DESCRIPTION).toContain(`${SITE}/#/map?event=a%20b`);
  expect(DESCRIPTION).toMatch(/\\nhttps:\/\/example\.com\/e$/);
});

test('URL and CATEGORIES are left out when the event has no link or heading', () => {
  const lines = vevent(event({ link: '', heading: '' }), {});

  expect(lines.some((line) => line.startsWith('URL:') || line.startsWith('CATEGORIES:'))).toBe(false);
});

test.for(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>'])(
  'a link %s is published neither as the URL nor in the description',
  (link) => {
    // The calendar leaves this site for whoever subscribed, so a link `webLink` would keep off a page is kept off it too.
    const lines = vevent(event({ link }), {});

    expect(lines.some((line) => line.startsWith('URL:'))).toBe(false);
    expect(props(event({ link })).DESCRIPTION).toBe('Event');
  },
);

test('a TEXT value escapes its separators and every spelling of a line break', () => {
  expect(escape('a\\b;c,d')).toBe('a\\\\b\\;c\\,d');
  expect(escape('a\r\nb\nc\rd')).toBe('a\\nb\\nc\\nd');
});

test('a control character is stripped from the line, so a feed value cannot start a property of its own', () => {
  // `URL:` is not escaped, a URI having no escaping of this kind — so the strip on the line is what stops this.
  expect(fold('URL:https://example.com/\r\nBEGIN:VALARM')).toBe('URL:https://example.com/BEGIN:VALARM');
});

test('a long line folds at 75 octets, never inside a multi-byte character', () => {
  const line = `SUMMARY:${'é'.repeat(80)}`;
  const pieces = fold(line).split('\r\n');

  expect(pieces.length).toBeGreaterThan(1);
  expect(pieces.slice(1).every((piece) => piece.startsWith(' '))).toBe(true);
  expect(pieces.every((piece) => Buffer.byteLength(piece) <= 75)).toBe(true);
  expect(pieces.map((piece, i) => (i === 0 ? piece : piece.slice(1))).join('')).toBe(line);
  expect(fold('SUMMARY:short')).toBe('SUMMARY:short');
});

test('the calendar ends every line CRLF, the last one included', () => {
  const ics = calendar(FEED, [event()], {});

  expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
});

test('the calendar carries the headers a subscriber needs, then each event, then closes', () => {
  const ics = calendar(FEED, [event({ eventID: 'one' }), event({ eventID: 'two' })], {});
  const lines = ics.replace(/\r\n /g, '').split('\r\n');

  expect(lines.slice(0, 9)).toEqual([
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//spence-com-au//pogo-utils//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${FEED.name}`,
    `X-WR-CALDESC:${escape(FEED.description)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ]);
  expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(2);
  expect(lines.filter((line) => line.startsWith('UID:'))).toEqual([
    'UID:one@pogo-utils.spence.com.au',
    'UID:two@pogo-utils.spence.com.au',
  ]);
  expect(lines.slice(-2)).toEqual(['END:VCALENDAR', '']);
});

test('a local event overrides a feed event of the same ID rather than duplicating it', () => {
  const chosen = calendarEvents([event({ name: 'feed' })], [event({ name: 'local' })]);

  expect(chosen.map(({ name }) => name)).toEqual(['local']);
});

test('recurring and undated events are left out', () => {
  const chosen = calendarEvents(
    [
      event({ eventID: 'recurring', eventType: RECURRING_TYPES[0] }),
      event({ eventID: 'undated', start: null, end: null }),
      event({ eventID: 'date-only', start: '2026-05-01', end: '2026-05-02' }),
      event({ eventID: 'kept' }),
    ],
    [],
  );

  expect(chosen.map(({ eventID }) => eventID)).toEqual(['kept']);
});

test('events are ordered by their start as written, then by ID', () => {
  const chosen = calendarEvents(
    [
      event({ eventID: 'b', start: '2026-05-02T00:00:00Z' }),
      event({ eventID: 'c', start: '2026-05-01T00:00:00Z' }),
      event({ eventID: 'a', start: '2026-05-02T00:00:00Z' }),
    ],
    [],
  );

  expect(chosen.map(({ eventID }) => eventID)).toEqual(['c', 'a', 'b']);
});
