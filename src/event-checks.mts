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
 * Dates are held to `icsDate`'s reading, the stricter one, and an `end` to `ended`'s as well, which refuses what
 * `Date.parse` cannot take once it is read as UTC−12.
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

      if (value !== null && icsDate(value) === null) {
        problems.push(
          `${eventID}: ${field} "${value}" is not a datetime — expected one like "2026-12-31T23:59:59.000" or "…Z"`,
        );
      }
    }

    // Whether `ended` can read an `end` does not turn on the clock, so any instant will do. Skipped for one `icsDate`
    // has already refused, which would only say the same thing twice.
    if (event.end !== null && icsDate(event.end) !== null) {
      try {
        ended(event, new Date(0));
      } catch (error) {
        problems.push(`${eventID}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return problems;
}
