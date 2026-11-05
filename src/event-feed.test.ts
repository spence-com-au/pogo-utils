/**
 * The values a page and a calendar both read, and the defects that follow from reading them differently: a naive
 * datetime misread as zoned moves a local event by whatever offset the build machine sits at, and a vend carrying a
 * field it was not asked for churns a committed file on every scrape.
 *
 * The cases are written out rather than read from `data/events.json`, which this project cannot open —
 * `resolveJsonModule` is unset here and `node:fs` is what the empty `types` keeps out. The cases that discriminate the
 * pattern are near-misses the real feed cannot produce anyway.
 */

import { expect, test } from 'vitest';

import { ended, HAS_ZONE, prunable, routeSummary, stamp, stampsOf, vendable, webLink } from './event-feed.js';
import { testEveryZone } from './testing/zones.js';

import type { FeedEvent } from './types.js';

/** A naive feed datetime, as `dancing-in-the-moonlight-2026` carries it: 10am wherever the reader is. */
const NAIVE = '2026-09-23T10:00:00.000';

/** The same feed's other shape, as `citysafari-brisbane-2026` carries it: one instant worldwide. */
const ZONED = '2026-05-22T14:00:00.000Z';

test('a naive datetime carries no zone, which is the distinction neither consumer may lose', () => {
  // These are the two shapes the feed actually emits, and the whole of what the page labels "your local time" and the
  // calendar writes as a floating `DATE-TIME` rather than as UTC.
  expect(HAS_ZONE.test(NAIVE)).toBe(false);
  expect(HAS_ZONE.test(ZONED)).toBe(true);
});

test('every spelling of a zone the feed could use is read as one', () => {
  // A false negative here is the cheaper of the two failures but not a cheap one: a GO Battle League rotation written
  // as floating happens at the named wall clock in every timezone rather than at the single instant it has.
  expect(HAS_ZONE.test('2026-05-22T14:00:00.000z')).toBe(true);
  expect(HAS_ZONE.test('2026-05-22T14:00:00.000+10:00')).toBe(true);
  expect(HAS_ZONE.test('2026-05-22T14:00:00.000+1000')).toBe(true);
  expect(HAS_ZONE.test('2026-05-22T14:00:00.000-05:00')).toBe(true);
});

test('a string that is not a datetime at all reads as naive rather than as zoned', () => {
  // `2026-09-21` is the near-miss: it ends in a hyphen and four digits, which is the shape of an offset, and only the
  // digit counts keep it out. A date read as zoned is the expensive direction — the event stops being 10am where the
  // reader is and becomes 10am where the build ran.
  //
  // No case here can show the `$` on the offset alternative: the only `-` in an ISO datetime are the date separators,
  // each followed by exactly two digits, so the pattern cannot match inside the date part anchored or not. The two
  // readings disagree on `…+10:00[Australia/Sydney]` alone, which this feed does not emit.
  expect(HAS_ZONE.test('2026-09-21')).toBe(false);
  expect(HAS_ZONE.test('2026-09-21T06:00')).toBe(false);
  expect(HAS_ZONE.test('')).toBe(false);
});

test('each kind the event has is pluralised, and a kind it has none of is left out', () => {
  expect(routeSummary({ routes: 1, waypoints: 1 })).toBe('1 route · 1 waypoint');
  expect(routeSummary({ routes: 2, waypoints: 3 })).toBe('2 routes · 3 waypoints');

  // A zero written out is a card advertising what the event does not have, and the guard is a truthiness test rather
  // than a comparison, so this is the case that says which of the two it is.
  expect(routeSummary({ routes: 1, waypoints: 0 })).toBe('1 route');
  expect(routeSummary({ routes: 0, waypoints: 1 })).toBe('1 waypoint');
});

test('an event with nothing to count writes nothing rather than an empty separator', () => {
  // The caller puts this line on a card and in a VEVENT description, so what it writes for nothing has to be falsy
  // rather than a lone `·` with a space either side.
  expect(routeSummary({ routes: 0, waypoints: 0 })).toBe('');
});

test('the counts are written routes first, joined by the separator both consumers share', () => {
  // Splitting on the separator pins the order and the separator in the one expression: a middle dot, U+00B7, and not
  // the full stop or hyphen a second spelling of this line would have reached for.
  expect(routeSummary({ routes: 2, waypoints: 1 }).split(' · ')).toEqual(['2 routes', '1 waypoint']);
});

/**
 * One entry in the shape ScrapedDuck sends: the eight fields this repository reads, plus the `extraData` it does not.
 * That member is the whole reason `vendable` projects rather than copies — it carries a Spotlight Hour's bonus and a
 * Community Day's move list, which upstream rewords without any event having moved.
 */
const upstream = (eventID: string, over: Record<string, unknown> = {}) => ({
  eventID,
  name: 'Charmander Community Day',
  eventType: 'community-day',
  heading: 'Community Day',
  link: `https://leekduck.com/events/${eventID}/`,
  image: 'https://cdn.leekduck.com/assets/img/events/cday.jpg',
  start: '2026-09-23T10:00:00.000',
  end: '2026-09-23T13:00:00.000',
  extraData: { communityday: { spawns: [{ name: 'Charmander' }] } },
  ...over,
});

/** The fields a vended event carries, held to `FeedEvent`'s own keys so a typo here is a compile error. */
const FIELDS: (keyof FeedEvent)[] = ['eventID', 'name', 'eventType', 'heading', 'link', 'image', 'start', 'end'];

test('a vended event carries the fields the pages read and nothing else', () => {
  // Asserted over the keys rather than the values, because the absence is the point: `extraData` reaching the file
  // would make a committed copy churn on scrapes where nothing about any event changed.
  expect(vendable([upstream('charmander-community-day-2026')]).map((ev) => Object.keys(ev))).toEqual([FIELDS]);
});

test('each field is carried across by value, a null date included', () => {
  // `start` and `end` are the two the feed nulls, for an event announced before it is scheduled. A projection that
  // coalesced them to a string would make an undated event a dated one, which `build-ics.mts` then puts on a calendar.
  expect(vendable([upstream('announced-2026', { start: null, end: null })])).toEqual([
    {
      eventID: 'announced-2026',
      name: 'Charmander Community Day',
      eventType: 'community-day',
      heading: 'Community Day',
      link: 'https://leekduck.com/events/announced-2026/',
      image: 'https://cdn.leekduck.com/assets/img/events/cday.jpg',
      start: null,
      end: null,
    },
  ]);
});

test('the list comes out ordered by eventID, whatever order upstream sent it in', () => {
  // Upstream's own order is its own affair and it does change; sorting is what keeps a reorder there from being a diff
  // here. Reversed input rather than shuffled, so the assertion cannot pass on a function that does nothing.
  const ids = ['charmander-cday-2026', 'go-fest-2026', 'raid-day-2026'];

  expect(vendable([...ids].reverse().map((id) => upstream(id))).map((ev) => ev.eventID)).toEqual(ids);
});

test('the order is by code unit, which is where localeCompare would have differed', () => {
  /*
   * A case difference is the one thing the two orderings disagree on among the characters an eventID can hold:
   * `'B' < 'a'` by code unit, where `'B'.localeCompare('a')` is 1. A near-miss the real feed cannot produce, and the
   * only case that fails if the comparison is swapped for one whose answer moves with the ICU build.
   */
  expect(vendable([upstream('apple'), upstream('Banana')]).map((ev) => ev.eventID)).toEqual(['Banana', 'apple']);
});

test('an empty or unlisted feed is refused rather than written', () => {
  // An empty list is what a broken scrape looks like, and the copy is committed: writing it would take every Leek Duck
  // event off the page and out of the calendar until the next good run, where throwing leaves the previous copy.
  expect(() => vendable([])).toThrow(/non-empty/);
  expect(() => vendable({})).toThrow(/non-empty/);
  expect(() => vendable(null)).toThrow(/non-empty/);
});

test('an event with no eventID is refused, that being what both merges key on', () => {
  // Both consumers key a Map by it to let `data/events.json` override a feed entry, so an entry without one would
  // silently collide with every other entry without one and leave whichever came last.
  expect(() => vendable([upstream('ok-2026'), upstream('', {})])).toThrow(/eventID/);
  expect(() => vendable([upstream('ok-2026'), upstream('x', { eventID: undefined })])).toThrow(/eventID/);
});

test('a zoned end has passed once its instant has', () => {
  const end = '2026-09-27T08:00:00.000Z';

  expect(ended({ end }, new Date('2026-09-27T07:59:59.999Z'))).toBe(false);
  expect(ended({ end }, new Date('2026-09-27T08:00:00.001Z'))).toBe(true);
});

testEveryZone('a naive end has passed only once it has passed at UTC−12, the last zone to reach it', () => {
  /*
   * Built inside the body, as a swept test must. Read as UTC this end would drop a local event while the Americas were
   * still playing it, and the sweep reaches the other misreading: `Date.parse(end)` on a naive datetime answers the
   * *machine's* zone, so `Date.parse(end) + 12h` is this assertion in UTC and nothing like it elsewhere. In
   * `Australia/Sydney` that reading calls the event over a day early, where CI runs in UTC and never would have said
   * so.
   */
  const end = '2026-10-02T20:00:00.000';

  expect(ended({ end }, new Date('2026-10-03T07:59:59.999Z'))).toBe(false);
  expect(ended({ end }, new Date('2026-10-03T08:00:00.001Z'))).toBe(true);
});

test('an event with no announced end has not ended', () => {
  // `Date.parse(null)` is NaN and `new Date(null)` the epoch, so a careless reading would call it over since 1970.
  expect(ended({ end: null }, new Date('2099-01-01T00:00:00.000Z'))).toBe(false);
});

test('an end that is a date with no time is refused rather than read as not over', () => {
  /*
   * The case that separates "no end announced" from "an end this cannot read", which a `NaN` would have merged: both
   * compare as not over, and `data/events.json` is hand-written, so `"end": "2026-12-31"` would have sat in the list
   * permanently with nothing to say why the daily prune never touched it.
   */
  expect(() => ended({ end: '2026-12-31' }, new Date('2099-01-01T00:00:00.000Z'))).toThrow(/not a datetime/);

  // Not a blanket refusal of anything short: a full naive datetime is the feed's own shape and still reads.
  expect(ended({ end: '2026-12-31T23:59:59.000' }, new Date('2099-01-01T00:00:00.000Z'))).toBe(true);
});

/** Long after every `end` below, so what each case turns on is the lists rather than the clock. */
const AFTER = new Date('2099-01-01T00:00:00.000Z');

test('an ended entry the feed does not carry is prunable, and an unended one is not', () => {
  const over = { eventID: 'over-2026', end: '2026-09-27T08:00:00.000Z' };
  const running = { eventID: 'running-2026', end: '2099-09-27T08:00:00.000Z' };

  expect(prunable([over, running], [], AFTER)).toEqual(new Set(['over-2026']));
});

test('an ended entry the feed also carries is kept, removing it being no removal', () => {
  /*
   * `patterns-of-the-wild-2026` was this case on 2026-10-06: dated locally, `start: null, end: null` upstream. Both
   * merges key a Map by `eventID` with the local list last, so dropping the local entry uncovers upstream's dateless
   * copy rather than dropping the event. Asserted empty, so a `prunable` returning everything could not pass it.
   */
  const over = { eventID: 'patterns-of-the-wild-2026', end: '2026-10-02T20:00:00.000' };

  expect(prunable([over], [{ eventID: 'patterns-of-the-wild-2026' }], AFTER)).toEqual(new Set());
});

test('a feed entry that is not in the local list is nothing to prune', () => {
  // Only `data/events.json` is written, so an upstream event is never a candidate however long over it is — the vend
  // overwrites that file wholesale on the next scrape and would put it straight back.
  expect(prunable([], [{ eventID: 'upstream-2026' }], AFTER)).toEqual(new Set());
});

/**
 * A stamp is carried forward rather than re-read off the clock, which is what keeps an unchanged feed an unchanged file
 * — and what keeps an event's place among the stamps a browser has folded. Only an ID nothing has stamped reads `now`.
 */
test('stamp keeps an event its stamp, carries one it knows, and gives the rest the run', () => {
  const now = new Date('2026-10-12T06:00:00.000Z');
  const events = [{ eventID: 'own', added: '2026-01-01T00:00:00.000Z' }, { eventID: 'known' }, { eventID: 'fresh' }];

  const stamped = stamp(
    events,
    new Map([
      ['known', '2026-02-01T00:00:00.000Z'],
      ['own', 'ignored'],
    ]),
    now,
  );

  expect(stamped.map((ev) => ev.added)).toEqual([
    '2026-01-01T00:00:00.000Z',
    '2026-02-01T00:00:00.000Z',
    '2026-10-12T06:00:00.000Z',
  ]);
  expect(stampsOf(stamped)).toEqual(new Map(stamped.map((ev) => [ev.eventID, ev.added])));
});

/** An unstamped entry has nothing to carry, so `stampsOf` leaves it out rather than mapping its ID to nothing. */
test('stampsOf leaves out an entry with no stamp', () => {
  expect(stampsOf([{ eventID: 'a' }, { eventID: 'b', added: '2026-01-01T00:00:00.000Z' }])).toEqual(
    new Map([['b', '2026-01-01T00:00:00.000Z']]),
  );
});

/**
 * The feed's `link` becomes an `href`, so only a web URL survives. The rest are what a strayed feed might carry: a
 * scheme that runs or embeds something, a relative path that would resolve against this site, and a value that is not
 * a string at all.
 */
test.for(['https://leekduck.com/events/a/', 'http://leekduck.com/events/a/', 'HTTPS://leekduck.com/events/a/'])(
  'a web link %s is kept',
  (link) => {
    expect(webLink(link)).toBe(link);
  },
);

test.for([
  'javascript:alert(1)',
  ' javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'https:leekduck.com',
  '//leekduck.com/events/a/',
  '/events/a/',
  '',
  null,
  undefined,
  42,
])('a link %s is dropped', (link) => {
  expect(webLink(link)).toBeUndefined();
});
