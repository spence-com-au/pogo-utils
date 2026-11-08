/**
 * Checks the GPX files in the repository are in order: well-formed and really GPX 1.1 against `resources/gpx.xsd`,
 * with `pgr` extension fields the viewer reads and a country it knows, nothing in `src/countries.ts` the files never
 * name, every entry naming itself and every track carrying points enough to draw. `data/events.json`, which the files
 * are checked against, is held to an `eventID` of its own and dates every reader takes.
 *
 * `--write` adds the two files that tell the pages what the repository holds, each derived from the same pass that
 * just checked the files. Neither is in version control, so the flag is which caller wants them rather than a mode:
 * `pnpm build` is that caller and `pnpm lint:xml` is the checks on their own, which keeps a parallel `pnpm lint` from
 * putting two writers on one file.
 *
 * The schema is vendored rather than fetched, GPX 1.1 not having moved since 2004.
 */

import COUNTRIES from '../src/countries.ts';
import { eventProblems } from '../src/event-checks.mts';
import { LOCAL_EVENTS } from '../src/event-feed.ts';
import { ENTRIES_BY_EVENT, GPX_PATHS } from '../src/generated.ts';
import { gpxSources } from '../src/gpx-source.mts';
import type { FeedEvent } from '../src/types.js';
import { entriesByEvent, entryProblems, schemaProblems, unusedCountries } from '../src/gpx-checks.mts';
import { readFileSync, writeFileSync } from 'node:fs';

// `--write` generates the two indexes beside the checks rather than instead of them: what it writes is what passed.
const writeIndex = process.argv.includes('--write');

const sources = gpxSources();
const files = sources.map(({ fileName }) => fileName);

if (files.length === 0) {
  console.error('No GPX files found. Run this from the repository root.');
  process.exit(1);
}

const problems = await schemaProblems(sources, readFileSync('resources/gpx.xsd', 'utf8'));

if (problems.length === 0) {
  console.log(`${files.length} files validate against GPX 1.1.`);
}

const EVENTS: FeedEvent[] = JSON.parse(readFileSync(LOCAL_EVENTS, 'utf8'));

const events = eventProblems(EVENTS);
problems.push(...events.map((problem) => `${LOCAL_EVENTS}: ${problem}`));

if (events.length === 0) {
  console.log(`${EVENTS.length} events carry an eventID of their own and dates every reader takes.`);
}

/** The events a `<pgr:event>` may point at, by `eventID` (`LOCAL_EVENTS`). */
const eventIds = new Set(EVENTS.map((event) => event.eventID));

const entries = entryProblems(sources, { eventIds, countries: COUNTRIES });
problems.push(...entries.problems);

if (entries.problems.length === 0) {
  console.log(`${entries.entryCount} entries carry the pgr fields the viewer needs.`);
}

const unused = unusedCountries(COUNTRIES, entries.usedCountries);

for (const country of unused) {
  problems.push(`src/countries.ts: "${country}" is in COUNTRIES but no file names it — remove it, or add its route`);
}

if (unused.length === 0) {
  console.log(`src/countries.ts lists exactly the ${Object.keys(COUNTRIES).length} countries in use.`);
}

/**
 * Static hosting cannot list a directory, so the viewer is handed its paths in GPX_PATHS. Derived from the same
 * `git ls-files` this pass walked, which is the whole of why it cannot fall out of step: what the map is told the
 * repository holds and what it was just checked for are one query, where a file kept by hand could drop a route that is
 * perfectly good GPX and leave nothing to say so but its absence from the map.
 *
 * `git ls-files` sorts its own output, so two runs over the same repository produce the same bytes and a deploy that
 * found nothing new serves a file a browser can keep. Unlike ENTRIES_BY_EVENT the content comes from git rather than
 * from inside the files, so nothing above can make it wrong and the write is not gated on the validation passing.
 */
if (writeIndex) {
  writeFileSync(GPX_PATHS, `${JSON.stringify(files, null, 2)}\n`);
  console.log(`Wrote ${GPX_PATHS} — ${files.length} files.`);
}

/**
 * The events page links through to an event's routes, and the only record of which event an entry belongs to is a
 * `<pgr:event>` inside a GPX file. Finding that would cost the page a fetch of every one of them to learn that a
 * handful carry an event at all, so the association is precomputed here into ENTRIES_BY_EVENT — the same bargain
 * GPX_PATHS strikes, out of the tally `entryProblems` kept rather than a reading of its own.
 *
 * `entriesByEvent` sorts the keys so that two runs produce the same bytes, and the file is written only once
 * everything above has passed: an index naming an event that does not exist would be worse than none. The refusal is a
 * problem rather than a silence because nothing downstream would notice the gap — `scripts/assemble.mts` copies `data/`
 * whole, so a file that was never written is simply not in the artifact, and the Events page 404s for it.
 */
if (writeIndex && problems.length) {
  problems.push(`Refusing to write ${ENTRIES_BY_EVENT} from files that do not validate.`);
} else if (writeIndex) {
  writeFileSync(ENTRIES_BY_EVENT, entriesByEvent(entries.eventIndex));
  console.log(`Wrote ${ENTRIES_BY_EVENT} — ${entries.eventIndex.size} event(s) with entries.`);
}

if (problems.length === 0) {
  process.exit(0);
}

for (const problem of problems) {
  console.error(problem);
}

process.exit(1);
