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

/**
 * Writes a page's own state into the address bar without navigating. `replaceState` rather than assigning
 * `location.hash`, so typing in a filter does not fill the Back button with every keystroke. It also fires no
 * `hashchange`, which stops the shell reading back a fragment it has just written and re-rendering the page.
 */
export const replaceQuery = (page: Page, query: string) => history.replaceState(null, '', toHash(page, query));
