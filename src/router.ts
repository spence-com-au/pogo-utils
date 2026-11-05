/**
 * Which page the fragment names, and the query string that page reads its own state out of. One document is served, so
 * the fragment carries both halves of where a reader is: `#/pokedex?q=pika&n=25`. Splitting it here is what lets each
 * page keep the state module it already had, taking a query string with no opinion about which page it is on.
 *
 * The fragment rather than a path because GitHub Pages has no rewrites: a path would need every deep link served by
 * `404.html`, which answers HTTP 404 while rendering the page — fine in a browser, a dead link to a crawler.
 */

import { HOME, PAGES, toHash, type Page } from './page-table.js';

/**
 * Re-exported so the pages keep one module to import routing from. The table lives apart because the build reads it
 * too, and this file reaches `history`.
 */
export { HOME, PAGES, toHash, type Page };

/** A page and the state it was left in, which together are the whole of what a link to this site carries. */
export interface Route {
  page: Page;
  query: string;
}

/**
 * Whether this names one of the seven. A reader's URL is the input, so the names are checked against the table rather
 * than trusted — the same reading every `fromFragment` in `src/` gives the parts of a fragment it does not recognise.
 */
export const isPage = (value: string): value is Page => PAGES.some((page) => page.name === value);

export const pageOf = (name: Page) => PAGES.find((page) => page.name === name) ?? PAGES[0];

/**
 * The route a fragment describes. An unrecognised page name drops the query with it rather than handing the home page
 * a state written for somewhere else — `q` means something on the Pokédex it does not mean on the Events page.
 */
export function fromHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const cut = path.indexOf('?');
  const name = cut < 0 ? path : path.slice(0, cut);

  if (!isPage(name)) {
    return { page: HOME, query: '' };
  }

  return { page: name, query: cut < 0 ? '' : path.slice(cut + 1) };
}

/** A route as the shell hands it down, and how many times it has been arrived at again since the page was built. */
export interface Arrival extends Route {
  visit: number;
}

/**
 * The arrival a `hashchange` to `hash` makes, after `last`.
 *
 * A fragment that parses to the route the page was already handed is still a new arrival: the page has written its
 * state over the address since with `replaceQuery`, or the hash could not have changed, so the page holds something
 * other than what the reader just asked for. Handed the same `query` again, its effects keyed on it would not run, and
 * a tab clicked back to its bare fragment would keep the filter typed into it. Counting the visit gives the shell
 * something to rebuild the page on.
 */
export function arrive(last: Arrival, hash: string): Arrival {
  const next = fromHash(hash);
  const again = next.page === last.page && next.query === last.query;

  return { ...next, visit: again ? last.visit + 1 : last.visit };
}

/**
 * Writes a page's own state into the address bar without navigating. `replaceState` rather than assigning
 * `location.hash`, so typing in a filter does not fill the Back button with every keystroke. It also fires no
 * `hashchange`, which stops the shell reading back a fragment it has just written and re-rendering the page.
 */
export const replaceQuery = (page: Page, query: string) => history.replaceState(null, '', toHash(page, query));
