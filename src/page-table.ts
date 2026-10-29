/**
 * Every page the site has and the fragment that opens one: the half of `src/router.ts` that touches neither the DOM nor
 * Node, so that the build can read it as well as the browser. `scripts/build-manifest.mts` writes the web app
 * manifest's `start_url` and launcher shortcuts out of this table, where they used to be a second copy of it in
 * `manifest.json` that nothing checked — renaming a page turned its shortcut into a silent redirect to `HOME`.
 */

/**
 * Every page, with what the tab bar calls it and what the document is titled while it is open, in tab order.
 *
 * `satisfies` rather than an annotation so `PAGES[n].name` stays the union of the seven literals rather than widening to
 * `string`: that union is `Page`, and it is what makes a misspelt page a type error at every use below.
 */
export const PAGES = [
  { name: 'events', label: 'Events', icon: '📅', title: 'Pokémon GO Events' },
  { name: 'map', label: 'Map', icon: '🗺️', title: 'Pokémon GO Routes' },
  { name: 'search', label: 'Search', icon: '🔎', title: 'Pokémon GO Search Strings' },
  { name: 'pokedex', label: 'Pokédex', icon: '📖', title: 'Pokémon GO Pokédex' },
  { name: 'integrations', label: 'Integrations', icon: '🔌', title: 'Pokémon GO Integrations' },
  { name: 'inventory', label: 'Inventory', icon: '🎒', title: 'Pokémon GO Inventory' },
  { name: 'battle', label: 'Battle', icon: '⚔️', title: 'Pokémon GO Battle' },
] as const satisfies readonly { name: string; label: string; icon: string; title: string }[];

export type Page = (typeof PAGES)[number]['name'];

/** Where a reader with no fragment lands, and where one naming a page that does not exist is sent. */
export const HOME: Page = 'events';

/**
 * The fragment for a route, which is what every link and every `replaceState` in the app is built from — and the
 * manifest's shortcuts. A page with no state of its own gets no `?`, so a tab arrived at by clicking reads `#/map`
 * rather than `#/map?`.
 */
export const toHash = (page: Page, query = '') => (query ? `#/${page}?${query}` : `#/${page}`);
