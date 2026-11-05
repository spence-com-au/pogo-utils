/**
 * Reading pokemongo.com's announcements: the parts both scripts here need.
 *
 * Everything this skill reads is server-rendered structured data rather than markup. The cards on the news list and the
 * listings on the in-person index are drawn client-side and never appear in the HTML, but every page embeds schema.org
 * JSON-LD describing what it shows — an `ItemList` of articles, an `Event` per in-person listing, a `NewsArticle` on an
 * article — so a plain HTTP fetch yields more than a rendered page would, and no browser is needed.
 */

export const NEWS_URL = 'https://pokemongo.com/en/news';
export const IN_PERSON_URL = 'https://pokemongo.com/en/featured-in-person-events';

// The site answers a default agent with a different, smaller shell of a page. Both carry the structured data, but
// asking as a browser is what the rest of this parsing was checked against.
const USER_AGENT = 'Mozilla/5.0';

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

// A date as these announcements write one: `September 28, 2026`, `October 3–4, 2026`, `October 31 – November 1, 2026`.
// The middle group swallows a range so that the year is still reached — without it `October 3–4, 2026` matches nothing,
// which is how a nine-stop tour running into January 2027 read as naming no dates at all. It captures the range's end
// month and day, since the end is the date the year belongs to and the one that says whether an event is still running.
const DATE_PATTERN = new RegExp(
  `\\b(${MONTHS.join('|')})\\b\\s*(\\d{1,2})?(?:\\s*[‐-―-]\\s*(?:(\\w+)\\s+)?(\\d{1,2}))?,?\\s*(20\\d{2})`,
  'giu',
);

/** Stops the script with a message rather than a stack trace, for a page whose shape has moved under it. */
export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** A page's HTML, or `undefined` where the server answers 404. Any other failure throws. */
async function tryFetch(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) });

  if (res.status === 404) {
    return undefined;
  }

  if (!res.ok) {
    throw new Error(`${url}: ${res.status} ${res.statusText}`);
  }

  return res.text();
}

export async function fetchText(url: string) {
  return (await tryFetch(url)) ?? fail(`${url}: 404`);
}

/**
 * The last path segment of a URL, which is how an article, a feed entry and a local entry are keyed against each other.
 * Local links are not uniform — some carry `/en/`, some do not, and a City Safari is filed under
 * `/featured-in-person-events/citysafari/<city>` — so the segment is the only part they reliably share.
 */
export function slugOf(url: string) {
  return url.replace(/\/+$/, '').split('/').pop() ?? '';
}

/** Every JSON-LD blob on the page of the given schema.org `@type`. */
export function jsonLd(html: string, ofType: string): Record<string, unknown>[] {
  const blobs = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];

  return blobs.map(([, blob]) => JSON.parse(blob ?? '')).filter((blob) => blob?.['@type'] === ofType);
}

/**
 * An article's HTML, or `undefined` where there is no such article.
 *
 * A missing article answers 404 outright, which is worth knowing: elsewhere on this site an unknown path serves the app
 * shell with status 200 — `/sitemap.xml` and `/robots.txt` both do — so a 200 is no evidence a URL is real. Under
 * `/en/news/` it is, which makes this the way to check a slug someone has quoted at you.
 */
export function articleHtml(slug: string) {
  return tryFetch(`${NEWS_URL}/${slug}`);
}

/**
 * An article's prose, as one line of text.
 *
 * Taken from inside `<main>` because the navigation and the fifteen-language selector sit outside it and otherwise
 * swamp the body. Tags are stripped rather than parsed: nothing here needs the structure, only the words. `<script>`
 * goes first, contents and all, because the `NewsArticle` blob sits inside `<main>` and tag-stripping alone would leave
 * its JSON in the prose.
 */
export function articleText(html: string, url: string) {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1];

  if (main === undefined) {
    fail(`${url}: no <main> element — the page shape has changed`);
  }

  return main
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The furthest-future date the text names, as `YYYY-MM-DD`, or `undefined` if it names none. The string form compares
 * and prints as the date it is, which is all anything here does with one.
 *
 * This is what separates an announcement still worth acting on from one that is only history, and it does it from the
 * announcement's own words rather than from when it was published. A long-running event has to say how long it runs —
 * an airline partnership to August 2027, a stamp rally to September 2029, a mall tour to March 2027 — while a Community
 * Day can only ever name its one weekend. So the furthest date in the prose dates the *event*, where `datePublished`
 * dates only the press release, and the two are routinely months apart in opposite directions.
 *
 * A day is assumed late in the month when the text gives a month and year alone, so that "through March 2027" is not
 * read as expiring on the 1st.
 */
export function latestDateNamed(text: string) {
  let latest: string | undefined;

  for (const [, startMonth = '', startDay = '28', endMonth, endDay, year = ''] of text.matchAll(DATE_PATTERN)) {
    const month = endMonth !== undefined && MONTHS.includes(endMonth.toLowerCase()) ? endMonth : startMonth;
    const found = isoDate(Number(year), MONTHS.indexOf(month.toLowerCase()) + 1, Number(endDay ?? startDay));

    if (found && (!latest || found > latest)) {
      latest = found;
    }
  }

  return latest;
}

/** A calendar date as `YYYY-MM-DD`, or `undefined` for one that does not exist, such as February 30. */
function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : undefined;
}
