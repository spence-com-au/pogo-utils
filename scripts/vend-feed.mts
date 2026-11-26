/**
 * Copies Leek Duck's event list into `data/events-feed.json`, from ScrapedDuck's JSON mirror of it. The Events page
 * and `scripts/build-ics.mts` both read that committed copy, so the page and the calendar are always the same fetch —
 * and it is the feed's only history, ScrapedDuck's `data` branch being force-pushed on every scrape.
 *
 * The one script that touches the network, which is why it is no step of `pnpm build`: `pnpm lint:types` *is*
 * `pnpm build`, so folding it in would put somebody else's server in front of every lint.
 *
 * The clock is read only for an event this repository has never vended, so an unchanged file after a run still means
 * the feed has not moved. `vendable` is what makes that true of a list re-scraped every ten minutes, and `stamp`
 * carrying each `added` forward is what keeps it true of the stamps.
 *
 * It stamps `data/events.json` too, whose entries are written by hand and land without one. That is the vend's job
 * rather than the author's for the reason `stamp` gives, and why the Vend workflow runs on a push to that file.
 *
 * And it adopts into `data/events.json` any feed event a GPX entry still names when the feed drops it, for the reason
 * `adopted` gives.
 */

import {
  LOCAL_EVENTS,
  stamp,
  stampsOf,
  UPSTREAM_URL,
  vendable,
  VENDED_EVENTS,
  type StampedEvent,
} from '../src/event-feed.ts';
import { eventRefs, gpxSources, parseGpx } from '../src/gpx-source.mts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const readEvents = (path: string): StampedEvent[] => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : []);

const previous = readEvents(VENDED_EVENTS);
const local = readEvents(LOCAL_EVENTS);
const now = new Date();

const res = await fetch(UPSTREAM_URL);

if (!res.ok) {
  throw new Error(`${UPSTREAM_URL}: ${res.status} ${res.statusText}`);
}

// The previous copy's stamp wins, with a local entry's standing in for an ID that upstream has only now picked up: the
// event was on the page already, so arriving in the feed does not make it new. A later entry in the `Map` wins, hence
// the previous copy is spread last.
const events = stamp(vendable(await res.json()), new Map([...stampsOf(local), ...stampsOf(previous)]), now);

// Two-space and newline-terminated because `prettier --check .` reads this file like any other, `data/` being no part
// of `.prettierignore`. Written by hand rather than left to a formatter run so that the workflow commits what it
// generated.
writeFileSync(VENDED_EVENTS, `${JSON.stringify(events, null, 2)}\n`);
console.log(`${VENDED_EVENTS}: ${events.length} events`);

/**
 * The feed events a GPX entry names that the feed has just dropped, or just dropped the end of, as the previous copy
 * had them. The feed drops an event once it is over, and sometimes before, as a rename does, and `validate-gpx.mts`
 * refuses a reference to an event neither list has, so leaving one behind would fail every deploy until the file was
 * edited by hand. Adopted into `data/events.json` instead, the event is the prune's like any other: gone once it is
 * over, and its references with it, a temporary entry whole.
 *
 * Adopted at the lost end too, because ScrapedDuck nulls an event's dates before it drops the event, and the prune
 * keeps an event with no end for good. Taken then, the copy still has the dates, and it overrides the feed's undated
 * one until the feed drops it.
 */
const vendedNow = new Map(events.map((event) => [event.eventID, event]));
const localIds = new Set(local.map(({ eventID }) => eventID));
const referenced = new Set(
  gpxSources().flatMap(({ contents }) => eventRefs(parseGpx(contents)).map((ref) => ref.eventID)),
);
const adopted = previous.filter(({ eventID, end }) => {
  const current = vendedNow.get(eventID);

  return referenced.has(eventID) && !localIds.has(eventID) && (!current || (end && !current.end));
});

// An override takes the stamp of the feed entry it replaces, for the same reason. Written only when something was
// unstamped or adopted, so a run that does neither leaves a hand-kept file exactly as it was.
const unstamped = local.filter((ev) => !ev.added).map((ev) => ev.eventID);

if (unstamped.length > 0 || adopted.length > 0) {
  writeFileSync(LOCAL_EVENTS, `${JSON.stringify([...stamp(local, stampsOf(events), now), ...adopted], null, 2)}\n`);
}

if (unstamped.length > 0) {
  console.log(`${LOCAL_EVENTS}: stamped ${unstamped.join(', ')}`);
}

if (adopted.length > 0) {
  console.log(`${LOCAL_EVENTS}: adopted ${adopted.map(({ eventID }) => eventID).join(', ')} from the previous feed`);
}
