/**
 * Print one pokemongo.com news article as the fields a `data/events.json` entry needs, plus its prose.
 *
 * Two things come out of an article. Its `NewsArticle` structured data carries `headline`, `url` and `image` — and that
 * `image` is the very URL existing entries hold, character for character, so it is read from here rather than retyped.
 * Its dates are not there: `datePublished` is when the announcement went up, which is not when the event runs, so the
 * start and end have to be read out of the prose ("Tuesday, October 13, at 10:00 a.m. to Monday, October 19, 2026, at
 * 8:00 p.m. local time"). The body text is printed for exactly that reason.
 */

import { parseArgs } from 'node:util';
import {
  articleHtml,
  articleText,
  fail,
  fetchText,
  jsonLd,
  latestDateNamed,
  NEWS_URL,
  siteLocales,
} from './newsroom.mts';

const USAGE = 'usage: node .claude/skills/find-missing-events/scripts/read-article.mts <slug or pokemongo.com URL>';

const { positionals } = parseArgs({ allowPositionals: true });

if (positionals.length !== 1) {
  fail(USAGE);
}

const [slug = ''] = positionals;
let url: string;
let html: string;

if (slug.startsWith('http')) {
  url = slug;
  html = await fetchText(url);
} else {
  url = `${NEWS_URL}/${slug}`;
  html =
    (await articleHtml(slug)) ??
    fail(`${url}: 404 — no such article. Check the slug against the archive \`compare-sources.mts\` walks.`);
}

// Every news article carries a `NewsArticle` alongside an `Organization`, a `WebSite` and a `BreadcrumbList`. Its
// absence means the URL is not an article — a redirect to the news index, most likely — which is worth failing on
// rather than reporting an event with no image.
const data = jsonLd(html, 'NewsArticle')[0] ?? fail(`${url}: no NewsArticle structured data — is this a news article?`);
const body = articleText(html, url);

console.log(`headline:      ${data.headline}`);
console.log(`link:          ${url}`);
console.log(`image:         ${data.image ?? ''}`);
console.log(`datePublished: ${data.datePublished ?? ''}  (the announcement, not the event)`);
const runsUntil = latestDateNamed(body, await siteLocales()) ?? 'none';

console.log(`runs until:    ${runsUntil}  (furthest date the prose names; read it, do not trust it)`);
console.log(`\n--- body ---\n\n${body}`);
