/**
 * What an event's notice says under its title. The start is matched by pattern rather than spelled out, `dayFmt`
 * following the reader's locale; the relative time is the `Date` the panel words when it draws, so these hold which
 * instant it is rather than the words Intl gives it.
 */

import { expect, test } from 'vitest';

import { eventNotice } from './notices.js';

import type { ParsedEvent } from './event-schedule.js';

const event = (over: Partial<ParsedEvent>): ParsedEvent => ({
  eventID: 'community-day',
  name: 'Community Day',
  heading: 'Community Day',
  eventType: 'community-day',
  image: 'https://example.invalid/i.png',
  start: new Date('2026-11-15T14:00:00Z'),
  end: null,
  link: undefined,
  startHasZone: false,
  added: null,
  ...over,
});

test('an event says when the site first vended it, after when it starts', () => {
  const added = new Date('2026-11-09T04:18:09.675Z');

  expect(eventNotice(event({ added })).detail).toEqual([
    expect.stringMatching(/^Community Day · from \S/),
    ' · seen ',
    added,
  ]);
});

test('an event not yet stamped says nothing of when it was seen', () => {
  expect(eventNotice(event({})).detail).toEqual([expect.stringMatching(/^Community Day · from \S/)]);
});

test('an event with no start says so, and still says when it was seen', () => {
  const added = new Date('2026-11-09T04:18:09.675Z');

  expect(eventNotice(event({ start: null, added })).detail).toEqual([
    'Community Day · date unknown',
    ' · seen ',
    added,
  ]);
});
