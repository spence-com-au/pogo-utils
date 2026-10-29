/**
 * The one document's shell: the tab bar, and whichever page the fragment names below it.
 *
 * Each page is reached through `import()` rather than imported outright, which is what keeps the seven off each other's
 * download — Leaflet is 164KB and the Java serialization codec another 152KB, and imported statically both would land
 * in the bundle every reader fetches to look at the events calendar. A dynamic import is a split point to esbuild.
 */

import type { FunctionComponent } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { said } from './errors.js';
import { Nav } from './nav.js';
import { fromHash, pageOf, type Page, type Route } from './router.js';

/** What every page exports: a component handed the query string it is to read its own state out of. */
export type PageComponent = FunctionComponent<{ query: string }>;

/**
 * Where each page's chunk comes from. A table of thunks rather than one `import(\`./pages/${name}.js\`)`, because a
 * template literal gives esbuild nothing to resolve at build time: it would bundle every file matching the pattern, or
 * fail, and either way the seven names would no longer be checked against anything.
 */
const PAGES: Record<Page, () => Promise<{ default: PageComponent }>> = {
  events: () => import('./pages/events.js'),
  map: () => import('./pages/map.js'),
  search: () => import('./pages/search.js'),
  pokedex: () => import('./pages/pokedex.js'),
  integrations: () => import('./pages/integrations.js'),
  inventory: () => import('./pages/inventory.js'),
  battle: () => import('./pages/battle.js'),
};

/**
 * The route the address bar currently describes.
 *
 * `hashchange` is the only thing that moves it. The pages write their own state back with `replaceState`, which fires
 * no such event — deliberately, since a page re-reading a fragment it had just written would be told to adopt the state
 * it is already in, once per keystroke. What is left to this is arrival: a link followed in, a tab clicked, and the
 * Back button, which are the three ways a reader changes page.
 */
function useRoute(): Route {
  const [route, setRoute] = useState(() => fromHash(location.hash));

  useEffect(() => {
    const reread = () => setRoute(fromHash(location.hash));

    addEventListener('hashchange', reread);

    return () => removeEventListener('hashchange', reread);
  }, []);

  return route;
}

/**
 * The component for a page, once its chunk has arrived.
 *
 * `null` while it is in flight, which is a frame or two from cache and a round trip on a first visit. The load is
 * guarded by the page it was started for: switching tabs twice quickly resolves the two imports in whichever order the
 * network gives them, and without the check the first to arrive would paint over the page the reader is actually on.
 */
function usePageComponent(page: Page) {
  const [loaded, setLoaded] = useState<{ page: Page; Component: PageComponent } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let current = true;

    setFailed(null);

    PAGES[page]()
      .then((module) => {
        if (current) {
          setLoaded({ page, Component: module.default });
        }
      })
      .catch((error: unknown) => {
        if (current) {
          setFailed(said(error));
        }
      });

    return () => {
      current = false;
    };
  }, [page]);

  return { Component: loaded?.page === page ? loaded.Component : null, failed };
}

/**
 * Names the open page on the document, for the two things that are the document's rather than a page's.
 *
 * The title is what a bookmark and a tab strip read. The `data-page` attribute is what the stylesheets are scoped by:
 * the Map page's sheet lays out a full viewport that does not scroll, and the five sheets between them define `.grid`,
 * `.card` and `.chip` differently, all of which was free while each page was its own document and none of which is now.
 */
function useDocument(page: Page) {
  useEffect(() => {
    document.title = pageOf(page).title;
    document.body.dataset['page'] = page;
  }, [page]);
}

export function Shell() {
  const { page, query } = useRoute();
  const { Component, failed } = usePageComponent(page);

  useDocument(page);

  return (
    <>
      <Nav current={page} />

      {/*
       * `Component` is keyed by page, so switching tabs builds a new component rather than handing the next page the
       * mounted state of the last one. Two pages that both open on a `<dialog>` or hold a Leaflet map are not
       * interchangeable, however alike their trees look to the reconciler.
       */}
      {failed === null ? (
        Component && <Component key={page} query={query} />
      ) : (
        <p class="status err" role="alert">
          Could not load the {pageOf(page).label} page: {failed}
        </p>
      )}
    </>
  );
}
