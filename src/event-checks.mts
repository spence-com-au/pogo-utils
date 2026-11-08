/**
 * The rules `scripts/validate-gpx.mts` holds `data/events.json` to. Here rather than in the script for the reason
 * `src/gpx-checks.mts` is: the script's own top level reads the repository and exits the process as soon as it is
 * loaded.
 */

import { ended } from './event-feed.ts';
import { icsDate } from './ics.mts';
import type { FeedEvent } from './types.js';

/**
 * Every way `events` falls short of what its readers need. The file is written by hand and nothing else reads its shape
 * before it merges, so a slip surfaces somewhere else, later:
 *
 * - A date-only `end` such as `"2026-12-31"` makes `ended` throw, and `prunable` maps it over every entry — so the
 *   unattended daily prune fails for all of them until someone fixes the one.
 * - The same entry is dropped from the calendar, `icsDate` having read it as null, while the page still shows it:
 *   `parseDate` takes a bare date as UTC midnight.
 * - A repeated `eventID` is overridden by the later entry in both merges, the earlier one vanishing without a word.
 *
 * Dates are held to the calendar's reading and the page's both, since neither is the stricter: `icsDate` refuses a
 * datetime with no seconds, which the page takes, and copies a zoneless one's digits out without checking their range,
 * so `"2026-07-18T25:00:00"` goes into the calendar while the page reads no date at all. An `end` is held to `ended`'s
 * reading as well, which refuses what `Date.parse` cannot take once it is read as UTC−12.
 */
export function eventProblems(events: readonly FeedEvent[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    const { eventID } = event;

    if (typeof eventID !== 'string' || !eventID) {
      problems.push(`an event without an eventID: ${JSON.stringify(event)}`);
      continue;
    }

    if (seen.has(eventID)) {
      problems.push(`${eventID}: an earlier entry has this eventID, which this one would silently override`);
    }

    seen.add(eventID);

    for (const field of ['start', 'end'] as const) {
      const value = event[field];

      if (value !== null && !readable(value)) {
        problems.push(
          `${eventID}: ${field} "${value}" is not a datetime — expected one like "2026-12-31T23:59:59.000" or "…Z"`,
        );
      }
    }

    // Whether `ended` can read an `end` does not turn on the clock, so any instant will do. Skipped for one already
    // refused above, which would only say the same thing twice.
    if (event.end !== null && readable(event.end)) {
      try {
        ended(event, new Date(0));
      } catch (error) {
        problems.push(`${eventID}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return problems;
}

/**
 * Whether both the calendar and the page can read `value`. The page's reader is `parseDate` in
 * `src/event-schedule.ts`, a `new Date` that is the same parse as `Date.parse`; it is not imported because that module
 * names its own imports by `.js`, which Node does not resolve to the `.ts` beside it.
 */
function readable(value: string) {
  return icsDate(value) !== null && !Number.isNaN(Date.parse(value));
}
