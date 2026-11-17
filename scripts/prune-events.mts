/**
 * Drops the events in `data/events.json` that are over everywhere, and every `<pgr:event>` naming one. The two go
 * together because `scripts/validate-gpx.mts` refuses a `<pgr:event>` whose ID the file no longer has. The entry
 * itself stays, as a place that stands on its own, unless its `<pgr:event>` is `temporary="true"`: then the entry was
 * there only for the event, and goes with it. A file left with no entry is deleted, the validator refusing one.
 *
 * Which events those are is `prunable`'s to say, the answer turning on how the two lists merge: an entry the vended
 * feed also carries is left where it is, that being an override rather than the only copy.
 *
 * References are read through `eventRefs` and cut through `cutElements`, which is why this agrees with the validator
 * about what a reference is — a form the two read differently is an event removed here and then refused there. The
 * Prune workflow re-runs `pnpm lint:xml` over what this wrote before it commits.
 *
 * Unlike the vend this reads the clock, so it is no step of `pnpm build`, which would then depend on when it ran.
 */

import { LOCAL_EVENTS, prunable, VENDED_EVENTS, type StampedEvent } from '../src/event-feed.ts';
import { cutElements, entryElements, eventRefs, gpxSources, parseGpx } from '../src/gpx-source.mts';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const events: StampedEvent[] = JSON.parse(readFileSync(LOCAL_EVENTS, 'utf8'));
const vended: StampedEvent[] = JSON.parse(readFileSync(VENDED_EVENTS, 'utf8'));

const gone = prunable(events, vended, new Date());

if (gone.size === 0) {
  console.log(`${LOCAL_EVENTS}: nothing has ended that removing would remove`);
  process.exit(0);
}

const kept = events.filter((event) => !gone.has(event.eventID));

/**
 * Every GPX edit computed before anything is written, which is what makes the run all-or-nothing. The two writes have
 * to agree — `validate-gpx.mts` refuses a reference whose event is gone — so writing `data/events.json` first and then
 * throwing in here left exactly the tree the build rejects, under a log line that said `removed …` as though it had
 * worked. CI discarded that, the failed step running before the commit; whoever ran `pnpm prune:events` by hand, which
 * the README documents, was left holding it.
 */
const edits = gpxSources().flatMap(({ fileName, contents }) => {
  const doc = parseGpx(contents);
  const refs = eventRefs(doc).filter(({ eventID }) => gone.has(eventID));

  if (refs.length === 0) {
    return [];
  }

  // A `Set`, since an entry naming two ended events would otherwise be cut twice. A reference inside an entry being
  // cut goes with it rather than being cut a second time.
  const entries = new Set(refs.flatMap(({ entry, temporary }) => (temporary && entry ? [entry] : [])));
  const references = refs.filter(({ entry }) => !(entry && entries.has(entry))).map(({ element }) => element);
  const left = entryElements(doc).filter((entry) => !entries.has(entry));

  return [
    {
      fileName,
      entries: entries.size,
      references: references.length,
      pruned: left.length === 0 ? null : cutElements(contents, [...entries, ...references]),
    },
  ];
});

// Written the way `scripts/vend-feed.mts` writes its copy, for the same reason: it is already what `prettier` would.
writeFileSync(LOCAL_EVENTS, `${JSON.stringify(kept, null, 2)}\n`);
console.log(`${LOCAL_EVENTS}: removed ${[...gone].join(', ')}`);

for (const { fileName, entries, references, pruned } of edits) {
  // `git rm` rather than an unlink, `gpxSources` listing the index: a file gone only from the tree is one the
  // workflow's `pnpm lint:xml` still lists, and then fails to read.
  if (pruned === null) {
    execFileSync('git', ['rm', '--quiet', '--', fileName]);
    console.log(`${fileName}: deleted, every entry in it having been there for an event that has ended`);
    continue;
  }

  writeFileSync(fileName, pruned);
  console.log(`${fileName}: removed ${entries} entries and ${references} <pgr:event> for events that have ended`);
}
