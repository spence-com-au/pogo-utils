/**
 * Line up everything pokemongo.com has announced against the two sources the Events page merges, and report what
 * nothing here accounts for and has not yet finished.
 *
 * Two announcement surfaces are read. The news archive is paginated by `?nr=<offset>`, thirty articles a page, and
 * walking it to exhaustion reaches every article back to mid-2025 in nine fetches. It is walked in every language the
 * site publishes in, because each edition lists announcements the English one never does — a regional event is often
 * written only for its own country, as Día de Muertos in Mexico was in Spanish alone, and the Japanese edition alone
 * carried some fifty such articles. The in-person index carries one schema.org `Event` per listing with its dates
 * stated outright, and is scoped to exactly the kind of event this skill hunts.
 *
 * Reaching the whole archive rather than the front page is the difference between finding a long-running event and
 * missing it, because the long ones are announced months ahead and are off the front page while still running: an
 * airline partnership running to August 2027, a mall tour to March 2027, a nine-stop tour to January 2027 and a
 * national-trust season extended to December 2026 were all live and all invisible to a front-page-only audit. Beware
 * the near-miss `?no=<offset>`, which the page accepts and ignores, answering with the newest thirty however large it
 * is — so a walk that looks like it paginated can silently re-read page one nine times.
 *
 * Two hundred-odd articles is too many to triage by hand, so each unmatched one is filtered by the furthest-future date
 * its own prose names: see `latestDateNamed`. That cuts roughly two hundred unmatched articles to around twenty worth a
 * human decision, and it cuts them on what the announcement says rather than on a keyword list that would miss whatever
 * Niantic partners with next.
 *
 * That filter has one blind spot, and it is reported separately rather than patched: an article that *changes* an event
 * gives no new date — "rescheduled to a later date" — so it names no future date by construction. An undated article
 * whose headline names an event a source already holds is therefore surfaced too, since it cannot be discovered by date
 * and is worse than a gap when real: a gap omits an event, an update makes one already in the published `events.ics`
 * wrong.
 *
 * Matching is deliberately split in two. An exact slug hit is reported as a match because Leek Duck derives its own
 * slugs from these same announcements, so a news slug equal to a ScrapedDuck `eventID` is the same event with near
 * certainty. Everything else is reported *with candidates* rather than guessed at: the remaining pairs need judgement
 * this script has no business making, because one article can announce eleven events, describe an event that has
 * already ended, or not be an event at all.
 *
 * The feed's URL and the local list's path are the ones `src/event-feed.ts` gives the rest of the repository, so an
 * audit cannot go on reading a mirror the site has stopped using.
 */

import { existsSync, readFileSync } from 'node:fs';
import { LOCAL_EVENTS, UPSTREAM_URL } from '../../../../src/event-feed.ts';
import type { FeedEvent } from '../../../../src/types.js';
import {
  articleHtml,
  articleText,
  fail,
  fetchText,
  IN_PERSON_URL,
  jsonLd,
  latestDateNamed,
  newsUrl,
  siteLocales,
  slugOf,
} from './newsroom.mts';

// Articles per page, fixed by the site: a page answers with thirty however the offset is phrased.
const PAGE_SIZE = 30;

// A guard on the walk, not a horizon. The archive ran to eight pages when this was written, so tripping this means the
// stop condition has stopped working rather than that the archive is deep.
const MAX_PAGES = 20;

// Words too common across Pokémon GO event names to carry any matching signal: every second name contains "Pokémon GO"
// or "event", so counting them inflates every score equally and separates nothing.
const STOPWORDS = new Set(['a', 'and', 'during', 'for', 'go', 'in', 'of', 'pokemon', 'the', 'to', 'with']);

// How much of a candidate's name has to appear in the headline before it is worth putting in front of a reader. Set by
// what the real data does: a true pair usually scores 1.0 and the weakest genuine one seen (a Wild Area ticketing
// update against the Wild Area itself) scores 0.86, while unrelated events sharing only "City" or "Safari" sit at 0.6.
const CANDIDATE_FLOOR = 0.5;

// How many articles are fetched at once when dating the unmatched ones.
const CONCURRENCY = 8;

interface Article {
  slug: string;
  headline: string;
  published: string;

  // The editions that list it, English first where it is one: the first is where it is read from.
  locales: string[];
}

interface Listing {
  slug: string;
  name: string;
  start: string;
  end: string;
}

interface Candidate {
  source: 'feed' | 'local';
  eventID: string;
  name: string;
}

interface Scored extends Candidate {
  score: number;
}

/**
 * The comparable words of a name, slug or headline.
 *
 * Accents are folded because the feed writes `Pokémon` where a slug writes `pokemon`; `_` and `-` are separators so
 * `2026_ana_green` and `city-safari-brisbane` tokenise like prose; and a trailing `s` is dropped from longer words so
 * that "City Safaris in Europe" still reaches "City Safari: Marseille", which is the difference between a candidate a
 * reader can act on and silence.
 */
function tokens(text: string) {
  const folded = text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
  const words = folded.match(/[a-z0-9]+/g) ?? [];

  return new Set(
    words
      .map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word))
      .filter((word) => !STOPWORDS.has(word)),
  );
}

/**
 * How much of `name` the `headline` already says, from 0 to 1.
 *
 * Containment rather than similarity, because the two sides are not trying to say the same thing: Niantic writes
 * "Rescue Shadow Zekrom during Harvest Festival: Taken Over!" where Leek Duck writes "Harvest Festival: Taken Over", so
 * the feed name sits *inside* the headline surrounded by marketing. A symmetric ratio punishes exactly the verbosity
 * that makes the pair obvious, and would rank the wrong Harvest Festival first.
 */
function containment(name: string, headline: string) {
  const wanted = tokens(name);
  const said = tokens(headline);

  return wanted.size ? [...wanted].filter((word) => said.has(word)).length / wanted.size : 0;
}

/**
 * One page of the archive.
 *
 * The `ItemList` gives identity and the `<pg-date-format>` timestamps give dates, and the two are joined by position
 * because neither carries the other's key. A count mismatch means the page's shape has moved, so it fails here rather
 * than silently pairing a headline with somebody else's date.
 */
function parseNewsPage(html: string, url: string, locale: string): Article[] {
  const lists = jsonLd(html, 'ItemList');

  if (lists.length !== 1) {
    fail(`${url}: expected one schema.org ItemList, found ${lists.length}`);
  }

  const items = lists[0]?.itemListElement as { url: string; name: string; position: number }[];
  const stamps = [...html.matchAll(/<pg-date-format[^>]*timestamp="(\d+)"/g)].map(([, stamp]) => Number(stamp));

  if (items.length !== stamps.length) {
    fail(`${url}: ${items.length} listed articles but ${stamps.length} dates — the page layout has changed`);
  }

  return items
    .toSorted((a, b) => a.position - b.position)
    .map((item, i) => ({
      slug: slugOf(item.url),
      headline: item.name,
      published: new Date(stamps[i] ?? NaN).toISOString().slice(0, 10),
      locales: [locale],
    }));
}

/**
 * One edition's whole news archive, newest first.
 *
 * Stops when a page contributes nothing new rather than on a page count or an empty page, because the last page
 * overlaps the one before it — the final fetch returned nineteen already-seen articles, not zero.
 */
async function walkEdition(locale: string) {
  const articles: Article[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${newsUrl(locale)}?nr=${page * PAGE_SIZE}`;
    const fresh = parseNewsPage(await fetchText(url), url, locale).filter((article) => !seen.has(article.slug));

    // An empty first page passes both of `parseNewsPage`'s shape checks, and would otherwise read as an archive with
    // nothing in it to miss.
    if (fresh.length === 0 && page === 0) {
      fail(`${url}: no articles listed on the first page — the page layout has changed`);
    }

    if (fresh.length === 0) {
      return articles;
    }

    for (const article of fresh) {
      seen.add(article.slug);
    }

    articles.push(...fresh);
  }

  fail(
    `${newsUrl(locale)}: still finding new articles after ${MAX_PAGES} pages — the stop condition has stopped working`,
  );
}

/**
 * Every edition's archive as one, newest first, an article listed in several editions counted once.
 *
 * Keyed on the slug, which every edition shares for the same announcement. The English headline is kept where there is
 * one, since it is what the candidates are scored against; an article no English edition lists keeps the headline of
 * the first edition that does, and is read from there.
 */
async function walkNews(locales: string[]) {
  const editions = await Promise.all(['en', ...locales.filter((locale) => locale !== 'en')].map(walkEdition));
  const articles = new Map<string, Article>();

  for (const article of editions.flat()) {
    const known = articles.get(article.slug);

    if (known) {
      known.locales.push(...article.locales);
    } else {
      articles.set(article.slug, article);
    }
  }

  return [...articles.values()].toSorted((a, b) => compare(b.published, a.published));
}

/**
 * Every listing on the in-person events index, `end` falling back to `start`.
 *
 * Worth reading despite the news archive covering the same announcements, because it is scoped to exactly what this
 * skill hunts — in person, in one place — and states its dates in the markup instead of burying them in prose, which is
 * the step most likely to be got wrong. Its weakness is that it is curated and short, carrying City Safari, GO Fest and
 * the championships and nothing else, so it confirms coverage rather than replacing the archive. Its `eventStatus` is
 * not to be trusted either: it still read `EventScheduled` for a City Safari the news had already postponed.
 */
function parseInPerson(html: string): Listing[] {
  const events = jsonLd(html, 'Event') as { url: string; name: string; startDate: string; endDate?: string }[];

  if (events.length === 0) {
    fail(`${IN_PERSON_URL}: no schema.org Event found — the page shape has changed`);
  }

  const day = (date: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? date
      : fail(`${IN_PERSON_URL}: ${date} is not a date — the page shape has changed`);

  return events.map((event) => ({
    slug: slugOf(event.url),
    name: event.name,
    start: day(event.startDate),
    end: day(event.endDate ?? event.startDate),
  }));
}

/** Ascending by code unit rather than by locale, so that the order does not depend on the machine running this. */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Descending by score, ties broken the same way on the source, ID and name, so that a run reads the same twice. */
function byScore(a: Scored, b: Scored) {
  return b.score - a.score || compare(b.source, a.source) || compare(b.eventID, a.eventID) || compare(b.name, a.name);
}

/** The few events a headline most plausibly refers to, best first, or nothing if none is close enough. */
function candidatesFor(headline: string, candidates: Candidate[]) {
  return candidates
    .map((candidate) => ({ ...candidate, score: containment(candidate.name, headline) }))
    .toSorted(byScore)
    .slice(0, 3)
    .filter((candidate) => candidate.score >= CANDIDATE_FLOOR);
}

/** The furthest-future date an unmatched article's prose names, or `undefined` if it names none. */
async function runsUntil({ slug, locales: [locale = 'en'] }: Article, locales: string[]) {
  const html = await articleHtml(slug, locale);

  return html === undefined ? undefined : latestDateNamed(articleText(html, `${newsUrl(locale)}/${slug}`), locales);
}

/** Where an article is listed, for one that the English edition does not list; nothing for one that it does. */
const editionsOf = ({ locales }: Article) => (locales.includes('en') ? '' : ` [${locales.join(', ')}]`);

/** `fn` over every item, at most `limit` at a time, in the items' order. */
async function mapPooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = [];
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const i = next++;

      results[i] = await fn(items[i] as T);
    }
  };

  await Promise.all(Array.from({ length: limit }, worker));

  return results;
}

const print = (line = '') => console.log(line);

if (!existsSync(LOCAL_EVENTS)) {
  fail(`${LOCAL_EVENTS}: not found — run this from the root of the pogo-utils checkout`);
}

const today = new Date().toISOString().slice(0, 10);
const local: FeedEvent[] = JSON.parse(readFileSync(LOCAL_EVENTS, 'utf8'));
const feed: FeedEvent[] = JSON.parse(await fetchText(UPSTREAM_URL));
const locales = await siteLocales();
const news = await walkNews(locales);
const inPerson = parseInPerson(await fetchText(IN_PERSON_URL));

// An article is accounted for when its slug is one a source already names. Local entries are keyed both ways because an
// `eventID` here is hand-written and need not equal the slug of the link it carries.
const known = new Set([
  ...feed.map((entry) => entry.eventID),
  ...local.map((entry) => slugOf(entry.link)),
  ...local.map((entry) => entry.eventID),
]);

const candidates: Candidate[] = [
  ...feed.map(({ eventID, name }) => ({ source: 'feed' as const, eventID, name })),
  ...local.map(({ eventID, name }) => ({ source: 'local' as const, eventID, name })),
];

const unmatched = news.filter((article) => !known.has(article.slug));
const dates = await mapPooled(unmatched, CONCURRENCY, (article) => runsUntil(article, locales));
const until = new Map(unmatched.map((article, i) => [article.slug, dates[i]]));
const runsTo = (article: Article) => until.get(article.slug);

const undated = unmatched.filter((article) => runsTo(article) === undefined);
const dated = unmatched.filter((article) => runsTo(article) !== undefined);
const live = dated.filter((article) => (runsTo(article) as string) >= today);
const ended = dated.length - live.length;

// An undated article naming an event a source already holds is the one thing the date filter cannot see, and the most
// urgent thing in the archive: an update says "rescheduled to a later date" and gives no date, so it names no future
// date by construction and would be counted away with the feature notes. That is the wrong way round, because it does
// not merely omit an event — it makes one we already publish wrong, and the generated `events.ics` has already gone
// out. City Safari Boston was postponed for a storm two days before the date `data/events.json` still advertised, and
// its article names no date at all. Matching what we hold is the signal that finds it.
const updates = undated
  .map((article) => ({ article, found: candidatesFor(article.headline, candidates) }))
  .filter(({ found }) => found.length > 0);

print(
  `${news.length} articles archived across ${locales.length} editions of ${newsUrl('<locale>')} ` +
    `(${news.at(-1)?.published} to ${news[0]?.published}), ${news.filter((article) => editionsOf(article)).length} ` +
    `of them missing from the English one; ` +
    `${inPerson.length} on the in-person index; ${feed.length} feed events, ${local.length} in ${LOCAL_EVENTS}`,
);
print(
  `${news.length - unmatched.length} accounted for by slug. Of the ${unmatched.length} left, ${ended} name only past ` +
    `dates and ${undated.length} name none at all, leaving ${live.length} to decide.\n`,
);

print(`## Announced, unaccounted for, and not yet over (${live.length}) — decide each one\n`);

for (const article of live.toSorted((a, b) => compare(runsTo(b) ?? '', runsTo(a) ?? ''))) {
  print(
    `  ${article.slug}${editionsOf(article)}  (published ${article.published}, prose runs to ${runsTo(article)})\n` +
      `    ${article.headline}`,
  );

  for (const { score, source, eventID, name } of candidatesFor(article.headline, candidates)) {
    print(`    ?  ${score.toFixed(2)} ${source}: ${eventID} | ${name}`);
  }

  print();
}

print(`## Undated, but naming something we hold (${updates.length}) — has it been changed?\n`);

for (const { article, found } of updates.toSorted((a, b) => compare(b.article.published, a.article.published))) {
  print(
    `  ${article.slug}${editionsOf(article)}  (published ${article.published}, names no date)\n    ${article.headline}`,
  );

  for (const { score, source, eventID, name } of found) {
    print(`    !  ${score.toFixed(2)} ${source}: ${eventID} | ${name}`);
  }

  print();
}

if (updates.length === 0) {
  print('  Nothing — no undated article names an event a source carries.\n');
}

const listings = inPerson.filter((listing) => listing.end >= today && !known.has(listing.slug));

print(`## In-person index, not yet over, unaccounted for (${listings.length})\n`);

for (const { slug, name, start, end } of listings.toSorted((a, b) => compare(a.start, b.start))) {
  print(`  ${slug}  (${start} to ${end})\n    ${name}\n`);
}

if (listings.length === 0) {
  print(
    '  Nothing — every current listing is already named by a source. This section being empty is the\n' +
      '  expected state, not a failure.\n',
  );
}

print(
  `Filtered out: ${ended} unmatched articles whose prose names only past dates, and ` +
    `${undated.length - updates.length} naming neither a date nor an event we hold. An event announcement ` +
    `always gives its dates, so the second group is features and mechanics — but a date this script failed to ` +
    `parse would also land there, so look in it before concluding a suspected event is absent.`,
);
