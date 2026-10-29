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

// The languages the site publishes in, as its own `hreflang` links name them. Read from the page rather than listed
// here because each edition carries announcements the others do not: the Spanish (Mexico) one alone holds Día de
// Muertos, the Japanese one a mall tour and a baseball tie-in a season long. A hand-kept list would be stale the day a
// sixteenth edition became a seventeenth.
export function newsLocales(html: string) {
  const locales = [...html.matchAll(/hreflang="([^"]+)"/g)].map(([, locale = '']) => locale);

  return [...new Set(locales.filter((locale) => locale !== 'x-default'))];
}

export const newsUrl = (locale: string) => `https://pokemongo.com/${locale}/news`;

/** The languages the news archive is published in, read from the English edition's front page. */
export async function siteLocales() {
  const locales = newsLocales(await fetchText(NEWS_URL));

  return locales.includes('en')
    ? locales
    : fail(`${NEWS_URL}: no hreflang links naming English — the page has changed`);
}

/**
 * Every month name an announcement in one of `locales` might write, as Node's ICU spells it, mapped to its number.
 *
 * Both forms ICU gives are taken: the standalone name and the one written beside a day, which differ where a language
 * declines its months — Polish `październik` is `27 października`, Russian `октябрь` is `27 октября`. Languages that
 * write months as numbers (`10月`, `10월`) give names with digits in them and are skipped here, since `datesIn` reads
 * those by pattern instead. English is always included, because an edition falls back to it for what it has not
 * translated.
 */
function monthNames(locales: string[]) {
  const names = new Map<string, number>();

  for (const locale of new Set(['en', ...locales])) {
    for (let month = 0; month < 12; month++) {
      const date = new Date(Date.UTC(2026, month, 15));
      const standalone = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(date);
      const inContext = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' })
        .formatToParts(date)
        .find((part) => part.type === 'month')?.value;

      for (const name of [standalone, inContext]) {
        const key = name?.normalize('NFC').toLowerCase();

        if (key && !/\d/.test(key)) {
          if (names.has(key) && names.get(key) !== month + 1) {
            fail(`${key} names month ${names.get(key)} in one language and ${month + 1} in another`);
          }

          names.set(key, month + 1);
        }
      }
    }
  }

  return names;
}

// A Thai year may be in the Buddhist era, 543 ahead: 2569 is 2026. Only read as a year where it sits in a date, since a
// bare 25xx is as likely an amount of Stardust.
const YEAR = '(20\\d{2}|25\\d{2})(?!\\d)';
const DAY = '(?<!\\d)(3[01]|[12]\\d|0?[1-9])(?!\\d)';
const DASH = '[~～‐-―-]';

// What follows a number that makes it a clock time rather than a day: `18:00`, `10.00`, `10h`, `10 Uhr`. A day-first
// date is routinely followed by its start time, and neither reading of it may take the hour as a day.
const NOT_TIME = '(?![\\d:]|\\.\\d|\\s*(?:h|uhr)(?![\\p{L}]))';

// How far apart, in characters, the two ends of a range may sit for a yearless one to take the other's year: enough for
// `27 de octubre a las 10:00 a.m. hasta el jueves`, too little to reach the next paragraph's schedule.
const RANGE_GAP = 60;

/**
 * The dates the text names, in the order it names them, each `[year, month, day, at]` with year and day possibly
 * missing and `at` where in the text it sits.
 *
 * Three shapes cover the editions. Month first, as English writes it: `September 28, 2026`, and `October 3–4, 2026`,
 * a same-month range read to its last day so that the year is still reached. Day first, as nearly everyone else does:
 * `27 de octubre de 2026`, `27. Oktober 2026`, `27 października 2026 roku`, `1er novembre`. Either may give a month and
 * year alone, with the `de` Spanish and Portuguese put between them: `hasta marzo de 2027`. And numeric, as Japanese,
 * Korean and Chinese do: `2026年10月27日`, `2026년 10월 27일`, `11月1日`. A bare year is reported too, with no month, so
 * that a yearless date beside it can take its year.
 */
function* datesIn(text: string, months: Map<string, number>) {
  const month = `(?<![\\p{L}\\p{M}])(${[...months.keys()]
    .toSorted((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})(?![\\p{L}\\p{M}])`;
  const monthFirst = `${month}\\s*(?:${DAY}${NOT_TIME}(?:\\s*${DASH}\\s*(\\d{1,2})(?!\\d))?)?(?:,?\\s*(?:del?\\s+)?${YEAR})?`;

  // A month name with a day straight after it is month first, so a number before it is not its day: `Tier 1 October 3,
  // 2026` is October 3, not October 1. A time straight after it is not a day, so `31 de octubre 18:00` stays day first.
  const dayFirst = `${DAY}(?:\\.|er|ᵉʳ|º|ª|°|\\.º)?\\s*(?:de\\s+)?${month}(?!\\s*\\d{1,2}${NOT_TIME})(?:\\s+del?)?(?:,?\\s*${YEAR})?`;
  const numeric = `(?:(20\\d{2})\\s*[年년]\\s*)?${DAY}\\s*[月월](?:\\s*(\\d{1,2})\\s*[日일])?`;
  const bareYear = `(?<!\\d)(20\\d{2})(?!\\d)`;
  const pattern = new RegExp(`${monthFirst}|${dayFirst}|${numeric}|${bareYear}`, 'giu');
  const number = (digits?: string) => (digits === undefined ? undefined : Number(digits));
  const era = (year?: number) => (year !== undefined && year >= 2500 ? year - 543 : year);

  for (const groups of text.normalize('NFC').matchAll(pattern)) {
    const [whole, m1, d1, e1, y1, d2, m2, y2, y3, m3, d3, y4] = groups;
    const at = { start: groups.index, end: groups.index + whole.length };

    if (m1 !== undefined) {
      yield [era(number(y1)), months.get(m1.toLowerCase()), number(e1 ?? d1), at] as const;
    } else if (m2 !== undefined) {
      yield [era(number(y2)), months.get(m2.toLowerCase()), number(d2), at] as const;
    } else if (m3 !== undefined) {
      yield [number(y3), number(m3), number(d3), at] as const;
    } else {
      yield [number(y4), undefined, undefined, at] as const;
    }
  }
}

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
 * `/<locale>/news/` it is, which makes this the way to check a slug someone has quoted at you. English is asked for by
 * default, and an article with no English version answers there in the language it was written in.
 */
export function articleHtml(slug: string, locale = 'en') {
  return tryFetch(`${newsUrl(locale)}/${slug}`);
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
 * and prints as the date it is, which is all anything here does with one. `locales` are the languages to read month
 * names in, which `siteLocales` gives.
 *
 * This is what separates an announcement still worth acting on from one that is only history, and it does it from the
 * announcement's own words rather than from when it was published. A long-running event has to say how long it runs —
 * an airline partnership to August 2027, a stamp rally to September 2029, a mall tour to March 2027 — while a Community
 * Day can only ever name its one weekend. So the furthest date in the prose dates the *event*, where `datePublished`
 * dates only the press release, and the two are routinely months apart in opposite directions.
 *
 * It has to read every language the site publishes in, because an announcement for one country is often written only
 * in that country's: Día de Muertos in Mexico was in Spanish alone, and read as naming no date at all when only
 * English month names were known.
 *
 * A day is assumed late in the month when the text gives a month and year alone, so that "through March 2027" is not
 * read as expiring on the 1st. A date with no year takes one from close beside it, as `yearNear` explains, since one
 * end of a range is routinely written without it. A month with neither day nor year is not a date — English "may" is
 * mostly a verb.
 */
export function latestDateNamed(text: string, locales: string[]) {
  const named = [...datesIn(text, monthNamesFor(locales))];
  const stated = named.filter(([year]) => year !== undefined);
  let latest: string | undefined;

  for (const [given, month, day, at] of named) {
    if (month === undefined || (given === undefined && day === undefined)) {
      continue;
    }

    const year = given ?? yearNear(at, month, stated);
    const found = year === undefined ? undefined : isoDate(year, month, day ?? 28);

    if (found && (!latest || found > latest)) {
      latest = found;
    }
  }

  return latest;
}

type Named = ReturnType<typeof datesIn> extends Iterable<infer T> ? T : never;

/**
 * The year a yearless date belongs to, from the nearest stated date or year after it, else before it, within a range's
 * length of it, or `undefined` where none is that close.
 *
 * The one after it is asked first, because English and most other editions write the year on a range's end — `Tuesday,
 * December 2, at 10:00 a.m. to Tuesday, January 6, 2026` — and a December before a January is the year before. The one
 * before it is asked next, for the editions that write it on the start: `2026年10月19日から11月1日まで`, or
 * `gamescom 2026 … vom 26. bis 30. August`, and there a November after an October is the same year while a January
 * after a December is the next. Nothing further is reached for: a year a paragraph away is as likely another event's.
 */
function yearNear(at: Named[3], month: number, stated: Named[]) {
  const after = stated.find(([, , , other]) => other.start >= at.end && other.start - at.end <= RANGE_GAP);

  if (after) {
    const [year = 0, otherMonth] = after;

    return otherMonth !== undefined && month > otherMonth ? year - 1 : year;
  }

  const before = stated.findLast(([, , , other]) => other.end <= at.start && at.start - other.end <= RANGE_GAP);

  if (before) {
    const [year = 0, otherMonth] = before;

    return otherMonth !== undefined && month < otherMonth ? year + 1 : year;
  }

  return undefined;
}

const monthsCache = new Map<string, Map<string, number>>();

function monthNamesFor(locales: string[]) {
  const key = locales.join(' ');
  const cached = monthsCache.get(key) ?? monthNames(locales);

  monthsCache.set(key, cached);

  return cached;
}

/** A calendar date as `YYYY-MM-DD`, or `undefined` for one that does not exist, such as February 30. */
function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : undefined;
}
