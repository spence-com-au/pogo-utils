/**
 * Which lists of events `scripts/validate-gpx.mts` turns down, and why. `data/events.json` is written by hand, and each
 * slip below is one its readers take differently: the prune throws, the calendar drops the entry and the page keeps it,
 * or one of two entries disappears.
 *
 * Written out rather than read from `data/`, which holds only a list that passes.
 */

import { eventProblems } from './event-checks.mts';
import type { FeedEvent } from './types.js';
import { expect, test } from 'vitest';

const event = (overrides: Partial<FeedEvent> = {}): FeedEvent => ({
  eventID: 'an-event',
  name: 'An Event',
  eventType: 'regional-event',
  heading: 'Regional Event',
  link: 'https://pokemongo.com/en/news/an-event',
  image: 'https://example.com/an-event.jpg',
  start: '2026-07-18T00:00:00.000',
  end: '2026-12-31T23:59:59.000',
  ...overrides,
});

test('a list of events with their own IDs and datetimes passes', () => {
  const zoned = event({ eventID: 'another', start: '2026-09-18T05:00:00.000Z', end: null });

  expect(eventProblems([event(), zoned])).toEqual([]);
});

test('an event announced before it is scheduled passes, null being how the feed says so', () => {
  expect(eventProblems([event({ start: null, end: null })])).toEqual([]);
});

test('an end that is a date with no time is named, the prune being unable to read it', () => {
  expect(eventProblems([event({ end: '2026-12-31' })])).toEqual([
    'an-event: end "2026-12-31" is not a datetime — expected one like "2026-12-31T23:59:59.000" or "…Z"',
  ]);
});

test('a start that is a date with no time is named, the calendar being unable to place it', () => {
  expect(eventProblems([event({ start: '2026-07-18' })])).toEqual([
    'an-event: start "2026-07-18" is not a datetime — expected one like "2026-12-31T23:59:59.000" or "…Z"',
  ]);
});

test('a date that is missing altogether is named rather than read as a null', () => {
  expect(eventProblems([event({ end: undefined as unknown as null })])).toEqual([
    'an-event: end "undefined" is not a datetime — expected one like "2026-12-31T23:59:59.000" or "…Z"',
  ]);
});

test('a datetime the calendar cannot read is named although the prune could', () => {
  // Valid to `Date.parse`, so `ended` takes it, but with no seconds: the calendar writes nothing for it, and an event
  // with no other date goes missing from it while the page keeps showing it.
  expect(eventProblems([event({ start: null, end: '2026-12-31T23:59Z' })])).toEqual([
    'an-event: end "2026-12-31T23:59Z" is not a datetime — expected one like "2026-12-31T23:59:59.000" or "…Z"',
  ]);
});

test('a datetime the calendar reads but the prune cannot is named once', () => {
  // The calendar takes a naive datetime on the strength of its first nineteen characters, and the prune hands all of it
  // to `Date.parse`.
  const problems = eventProblems([event({ end: '2026-12-31T23:59:59.000Q' })]);

  expect(problems).toHaveLength(1);
  expect(problems[0]).toMatch(/^an-event: end "2026-12-31T23:59:59.000Q" is not a datetime/);
});

test('an eventID an earlier entry has is named, the later entry overriding it in both merges', () => {
  expect(eventProblems([event(), event({ name: 'The Same Event Again' })])).toEqual([
    'an-event: an earlier entry has this eventID, which this one would silently override',
  ]);
});

test('an entry with no eventID is refused, there being nothing for a merge to key on', () => {
  expect(eventProblems([event({ eventID: '' })])).toEqual([expect.stringMatching(/^an event without an eventID: /)]);
  expect(eventProblems([event({ eventID: undefined as unknown as string })])).toEqual([
    expect.stringMatching(/^an event without an eventID: /),
  ]);
});

test('every entry is checked, so one fix does not reveal the next', () => {
  expect(
    eventProblems([event({ eventID: 'a', end: '2026-12-31' }), event({ eventID: 'b', start: '2026-07-18' })]),
  ).toHaveLength(2);
});
