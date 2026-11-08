/**
 * What `scripts/build-ics.mts` writes, as functions of what it reads: the iCalendar spelling of a feed event and the
 * selection of which events go in. Here rather than in the script so the suite can import it — the script's own top
 * level reads `data/` and writes `dist/` as soon as it is loaded — and beside `ics.test.mts`, which holds each
 * decision to a case.
 */

import { byCodeUnit, HAS_ZONE, routeSummary, webLink } from './event-feed.ts';
import { DIST, EVENTS_FEED } from './generated.ts';
import RECURRING_TYPES from './recurring-types.ts';
import type { FeedEvent, RouteIndex } from './types.js';
import { join } from 'node:path';

/**
 * Where the pages are served from. A calendar app shows an event's description far away from this site, so the links
 * inside one have to be absolute — this is the only place that spelling is kept.
 */
export const SITE = 'https://spence.com.au/pogo-utils';

// A UID has to be unique across every calendar its reader subscribes to, so the stable `eventID` is qualified by us.
const UID_DOMAIN = 'pogo-utils.spence.com.au';

/**
 * How often a subscriber should come back. Both spellings are given: `REFRESH-INTERVAL` is the standard one (RFC 7986)
 * and `X-PUBLISHED-TTL` is what Outlook reads. Either way it is a hint — Google Calendar polls on its own schedule,
 * which is usually slower.
 */
const REFRESH = 'PT6H';

const RECURRING = new Set(RECURRING_TYPES);

export const FEED = {
  file: join(DIST, EVENTS_FEED),
  name: 'Pokémon GO Events',
  description: 'Current and upcoming Pokémon GO events, without Spotlight Hours, Raid Hours, Max Mondays or seasons.',
};

/**
 * A feed datetime's calendar fields, read off the string so a zoneless one can be written as iCalendar's floating
 * time without a `Date` anchoring it to whichever timezone this happens to run in. `HAS_ZONE` says which it is.
 */
const PARTS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/;

export function icsDate(raw: string | null): string | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const parts = PARTS.exec(raw);

  if (!parts) {
    return null;
  }

  if (!HAS_ZONE.test(raw)) {
    const [, year, month, day, hour, minute, second] = parts;
    return `${year}${month}${day}T${hour}${minute}${second}`;
  }

  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
}

// `DTSTAMP` is a UTC timestamp whatever the event is. A floating time has no instant to convert, so its digits are
// taken as they stand — the value only has to be stable, and this one is.
export const utcStamp = (value: string) => (value.endsWith('Z') ? value : `${value}Z`);

// The characters a TEXT value cannot carry as themselves. A line break is any of the three spellings, a lone CR
// otherwise reaching `fold` and being dropped rather than kept. URI values have no escaping of this kind at all,
// which is why the strip backing this up lives on the line rather than the value.
export const escape = (text: string) => text.replace(/([\\;,])/g, '\\$1').replace(/\r\n|[\r\n]/g, '\\n');

/**
 * A UTF-8 continuation byte, the second and later octet of a multi-byte character. Reading past the end of the buffer
 * gives `undefined`, which is not one — a subscript is `number | undefined` under `noUncheckedIndexedAccess` however
 * carefully the caller bounds it.
 */
const isContinuation = (byte: number | undefined) => byte !== undefined && (byte & 0xc0) === 0x80;

/**
 * Every control character RFC 5545 forbids a content line to carry. A CR or an LF *ends* the line, so text after one
 * in a feed-supplied value is read as a property of its own — a whole `BEGIN:VALARM`, say. `\p{Cc}` is that set.
 */
const CONTROL = /\p{Cc}/gu;

/**
 * RFC 5545 caps a content line at 75 *octets*, continuing it with CRLF and a leading space. Octets, and these names
 * carry é and ·, so the length is measured over the UTF-8 encoding and a split is walked back off any continuation
 * byte.
 *
 * The strip is here rather than beside each property because this is the last function every line passes through, and
 * `escape` covers only the TEXT ones: `UID:` and `URL:` interpolate the feed's own strings as they stand, and the feed
 * is somebody else's file the deploy publishes unread.
 */
export function fold(raw: string): string {
  const line = raw.replace(CONTROL, '');
  const bytes = Buffer.from(line, 'utf8');

  if (bytes.length <= 75) {
    return line;
  }

  const pieces = [];
  let start = 0;

  // The first line may use all 75; a continuation spends one of them on its leading space.
  for (let limit = 75; start < bytes.length; limit = 74) {
    let end = Math.min(start + limit, bytes.length);

    while (end < bytes.length && isContinuation(bytes[end])) {
      end -= 1;
    }

    pieces.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
  }

  return pieces.join('\r\n ');
}

export function vevent(ev: FeedEvent, index: RouteIndex): string[] {
  const start = icsDate(ev.start);
  const end = icsDate(ev.end);

  /*
   * A VEVENT must have a `DTSTART` and the feed can leave either end null, so an event with one becomes a point in
   * time at whichever it has — the reading the Events page gives it too. One with neither is filtered out before it
   * reaches here, so the throw states that caller's obligation rather than writing `DTSTART:null` into the feed.
   */
  const from = start ?? end;

  if (!from) {
    throw new Error(`${ev.eventID}: no date to put on a calendar`);
  }

  const lines = [`UID:${ev.eventID}@${UID_DOMAIN}`, `DTSTAMP:${utcStamp(from)}`, `DTSTART:${from}`];

  if (start && end) {
    lines.push(`DTEND:${end}`);
  }

  lines.push(`SUMMARY:${escape(ev.name)}`);

  const description = [ev.heading];
  const here = index[ev.eventID];
  const link = webLink(ev.link);

  if (here) {
    description.push(`${routeSummary(here)} here: ${SITE}/#/map?event=${encodeURIComponent(ev.eventID)}`);
  }

  if (link) {
    description.push(link);
  }

  lines.push(`DESCRIPTION:${escape(description.filter(Boolean).join('\n'))}`);

  if (link) {
    lines.push(`URL:${link}`);
  }

  if (ev.heading) {
    lines.push(`CATEGORIES:${escape(ev.heading)}`);
  }

  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
}

export function calendar({ name, description }: typeof FEED, events: FeedEvent[], index: RouteIndex): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//spence-com-au//pogo-utils//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escape(name)}`,
    `X-WR-CALDESC:${escape(description)}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${REFRESH}`,
    `X-PUBLISHED-TTL:${REFRESH}`,
    ...events.flatMap((ev) => vevent(ev, index)),
    'END:VCALENDAR',
  ];

  // iCalendar lines end CRLF, including the last one, and nothing between here and a subscriber rewrites them: the
  // feed goes straight into the artifact rather than through a checkout where git could normalise it.
  return lines.map(fold).join('\r\n') + '\r\n';
}

/**
 * The events the calendar carries, in the order it carries them.
 *
 * Keyed by eventID with the local pass last, so a repo entry overrides a feed event of the same ID rather than
 * duplicating it — the merge `mergeEvents` in `src/event-schedule.ts` does for the page, in the same order.
 *
 * An event with no date at all has nothing to put on a calendar. Sorted by start so the file reads in order and a diff
 * between two runs stays local to what moved, over the raw strings rather than through a `Date` — a zoned time and a
 * floating one have no shared instant to sort by. The eventID breaks a tie so the order is total.
 */
export function calendarEvents(feed: readonly FeedEvent[], local: readonly FeedEvent[]): FeedEvent[] {
  const byId = new Map<string, FeedEvent>();

  for (const ev of [...feed, ...local]) {
    byId.set(ev.eventID, ev);
  }

  return [...byId.values()]
    .filter((ev) => icsDate(ev.start) ?? icsDate(ev.end))
    .filter((ev) => !RECURRING.has(ev.eventType))
    .sort((a, b) => byCodeUnit(a.start ?? '', b.start ?? '') || byCodeUnit(a.eventID, b.eventID));
}
