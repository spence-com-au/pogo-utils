/**
 * The event feed, shared by the six parts that read it: `scripts/vend-feed.mts` copies upstream into `VENDED_EVENTS`,
 * `src/event-store.ts` and `scripts/build-ics.mts` each merge that copy with this repository's own list,
 * `scripts/prune-events.mts` drops the entries `prunable` says are over, `src/pages/map.tsx` reads that list for the
 * names of the events its routes belong to, and the `find-missing-events` skill audits upstream and that list against
 * pokemongo.com's announcements.
 */

import type { FeedEvent, RouteCounts } from './types.js';

/**
 * ScrapedDuck's JSON mirror of Leek Duck. `scripts/vend-feed.mts` fetches it, and so does the `find-missing-events`
 * skill, which audits the live mirror rather than the hourly copy; no browser reaches it.
 */
export const UPSTREAM_URL = 'https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.json';

/**
 * The committed copy of the upstream list. Committed rather than fetched per visit so the page and the calendar cannot
 * disagree, and because `git log -p` over it is the history ScrapedDuck does not keep — its `data` branch is a single
 * force-pushed commit.
 */
export const VENDED_EVENTS = 'data/events-feed.json';

/** This repository's own events, in the feed's shape, overriding a feed entry of the same `eventID`. */
export const LOCAL_EVENTS = 'data/events.json';

/**
 * Whether a feed datetime carries a zone. A naive datetime ("2026-09-21T06:00:00.000") is 6am on every wall clock
 * worldwide; one that carries a zone ("…T20:00:00.000Z") is a single instant.
 *
 * Tested against the string rather than through a `Date`, which anchors a naive datetime to the machine's timezone — a
 * calendar built on a CI runner would move every local event by the offset between there and here.
 */
export const HAS_ZONE = /[zZ]|[+-]\d{2}:?\d{2}$/;

/** An absolute `http:` or `https:` URL, matched case-insensitively as a browser parses a scheme. */
const WEB_URL = /^https?:\/\//i;

/**
 * The feed's `link` if it is a web URL, otherwise undefined. It becomes an `href` on this site — the card's overlay and
 * both views' bars — and a `URL:` in the published calendar, which a subscriber's client draws as a link where nothing
 * here can withdraw it. The feed is refetched from a third party without review, so a `javascript:` or `data:` URL, by
 * misconfiguration or compromise, is dropped rather than published: the event goes out without a link. The reasoning
 * `releaseFromApk` gives for its APK URL, and checked the same way, on the string as given, since that is what a
 * browser or a calendar will follow. Matched on the string rather than through a `URL` for the same reason too: this
 * project declares neither the browser's globals nor Node's.
 */
export function webLink(link: unknown): string | undefined {
  return typeof link === 'string' && WEB_URL.test(link) ? link : undefined;
}

/**
 * Whether an event is over everywhere by `now`. A naive end has passed everywhere only once it has passed at UTC−12,
 * the last zone to reach it, which is what reading it *as* `-12:00` says. An event with no announced end has not ended.
 */
export function ended({ end }: Pick<FeedEvent, 'end'>, now: Date) {
  if (!end) {
    return false;
  }

  const over = Date.parse(HAS_ZONE.test(end) ? end : `${end}-12:00`);

  /*
   * Refused rather than read as "not over", which is what `NaN` compares as and would keep the entry for good. A
   * date-only `end` reaches this: `2026-12-31-12:00` is not a datetime `Date.parse` will take.
   */
  if (Number.isNaN(over)) {
    throw new Error(`end "${end}" is not a datetime — expected one like "2026-12-31T23:59:59.000" or "…Z"`);
  }

  return over < now.getTime();
}

/**
 * Which of `local`'s `eventID`s are over everywhere by `now` *and* that removing would actually remove.
 *
 * The second half is what a reading of `ended` alone gets wrong: `local` *overrides* a feed entry of the same ID rather
 * than being the only source of one, so dropping an entry `vended` also carries uncovers upstream's copy — usually an
 * undated card with no route count, ScrapedDuck having joined the dates in from a feed that drops them first.
 */
export function prunable(
  local: readonly Pick<FeedEvent, 'end' | 'eventID'>[],
  vended: readonly Pick<FeedEvent, 'eventID'>[],
  now: Date,
) {
  const carried = new Set(vended.map((event) => event.eventID));

  return new Set(
    local.filter((event) => ended(event, now) && !carried.has(event.eventID)).map((event) => event.eventID),
  );
}

/**
 * Orders by code unit rather than through `localeCompare`, whose collation varies with the ICU build — a runner on a
 * different Node would reorder a committed file having changed nothing in it.
 */
export const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The feed as this repository keeps it: every event cut down to the fields it reads, ordered by `eventID`.
 *
 * Both keep the committed copy quiet. ScrapedDuck re-scrapes every ten minutes, so a reworded `extraData` blurb or a
 * rehosted image would be a diff saying nothing.
 *
 * Throwing beats writing what it was given, on either count. An empty list is what a broken scrape looks like, and
 * writing one would empty the page and the calendar until the next good run; an event with no `eventID` has nothing
 * for either merge to key on, both `mergeEvents` and `build-ics.mts` keying a `Map` on it. The previous copy is
 * committed, so a refusal here leaves the pages serving what they already held.
 */
export function vendable(raw: unknown): FeedEvent[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('not a non-empty list of events');
  }

  const events = raw.map((ev: FeedEvent): FeedEvent => {
    if (typeof ev?.eventID !== 'string' || !ev.eventID) {
      throw new Error(`an event without an eventID: ${JSON.stringify(ev)}`);
    }

    /*
     * Written out key by key rather than picked through a list of names, so the return annotation is what requires all
     * eight: a field added to `FeedEvent` fails to compile here until it is carried.
     */
    return {
      eventID: ev.eventID,
      name: ev.name,
      eventType: ev.eventType,
      heading: ev.heading,
      link: ev.link,
      image: ev.image,
      start: ev.start,
      end: ev.end,
    };
  });

  return events.sort((a, b) => byCodeUnit(a.eventID, b.eventID));
}

/**
 * A feed entry as this repository keeps it: the eight upstream fields, and the instant it was first vended.
 *
 * `added` is what lets a browser record "seen everything up to here" as one instant rather than as one ID per event —
 * the feed carries no published date of its own. Optional because `data/events.json` is written by hand and an entry
 * arrives there without one, until the Vend workflow's next run stamps it; a reader treats an unstamped event the way
 * it treated every event before there were stamps, by its ID.
 */
export type StampedEvent = FeedEvent & { added?: string };

/** The `added` each stamped entry carries, by `eventID`. */
export function stampsOf(events: readonly Pick<StampedEvent, 'eventID' | 'added'>[]) {
  return new Map(events.flatMap((ev) => (ev.added ? [[ev.eventID, ev.added] as const] : [])));
}

/**
 * Each event with its `added`: the one it already carries, else the one `known` holds for its ID, else `now`.
 *
 * Carrying forward is what keeps a committed file quiet — only an ID this repository has never vended reads the clock,
 * so an unchanged feed is still an unchanged file. And `now` is the run's rather than the author's, which is why a
 * hand-written entry is left for the vend to stamp: a stamp written when a change was drafted can predate one already
 * deployed by the time that change lands, and a browser that has seen up to the later instant would never mark it.
 */
export function stamp<T extends Pick<StampedEvent, 'eventID' | 'added'>>(
  events: readonly T[],
  known: ReadonlyMap<string, string>,
  now: Date,
) {
  const at = now.toISOString();

  return events.map((ev): T & { added: string } => ({ ...ev, added: ev.added ?? known.get(ev.eventID) ?? at }));
}

/** "2 routes · 1 waypoint" — each kind the event has, pluralised, a kind it has none of left out rather than zeroed. */
export function routeSummary({ routes, waypoints }: RouteCounts) {
  const parts = [];

  if (routes) {
    parts.push(`${routes} route${routes === 1 ? '' : 's'}`);
  }

  if (waypoints) {
    parts.push(`${waypoints} waypoint${waypoints === 1 ? '' : 's'}`);
  }

  return parts.join(' · ');
}
