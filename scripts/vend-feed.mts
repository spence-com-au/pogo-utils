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

// An override takes the stamp of the feed entry it replaces, for the same reason. Written only when something was
// unstamped, so a run that stamps nothing leaves a hand-kept file exactly as it was.
const unstamped = local.filter((ev) => !ev.added).map((ev) => ev.eventID);

if (unstamped.length > 0) {
  writeFileSync(LOCAL_EVENTS, `${JSON.stringify(stamp(local, stampsOf(events), now), null, 2)}\n`);
  console.log(`${LOCAL_EVENTS}: stamped ${unstamped.join(', ')}`);
}
