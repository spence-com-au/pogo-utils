/**
 * The files this repository generates for something outside it to read, by name. Static hosting cannot list a
 * directory, so the first two hand a page what it could otherwise only learn by fetching every GPX file, and
 * `EVENTS_FEED` is the iCalendar feed a calendar app subscribes to.
 *
 * Named here because eight places read them. Renaming the pair once already broke the calendar generator, which
 * spelled the old name in a script `pnpm lint` does not run: the build was dead for a commit and nothing said so.
 *
 * One relative path serves both kinds of consumer — a page resolves one against its own URL, and the pages sit at the
 * repository root, which is also where a script is run from.
 */

export const GPX_PATHS = 'data/gpx-paths.json';
export const ENTRIES_BY_EVENT = 'data/entries-by-event.json';
export const POKEMON_ICONS = 'data/pokemon-icons.json';
export const POKEMON_TYPES = 'data/pokemon-types.json';
export const EVENTS_FEED = 'events.ics';

/**
 * The Inventory page's two fetches, which the build has to publish where the page asks for them: the game master that
 * `scripts/vend-game-master.mts` writes and `scripts/build-sprites.mts` also reads, and the directory
 * `scripts/assemble.mts` copies Tesseract.js's worker and cores into. The page's copy was only ever a `fetch` string,
 * which no build or lint step reads, so a path moved under it was a 404 at runtime behind a green build.
 *
 * `TESSERACT_VENDOR` ends in a slash because Tesseract.js takes it as a `corePath` it appends a file name to.
 */
export const GAME_MASTER = 'src/tools/inventory/fixtures/game-master.json';
export const TESSERACT_VENDOR = 'vendor/tesseract/';

/**
 * What the demo phone in `src/tools/inventory/demo.mts` shows: detail screens from the reader's corpus, one per
 * screenshot in turn, and storage before and after a search. The corpus's own captures rather than copies of them, so
 * covering a trainer name on one covers it on the site too.
 */
export const DEMO_DETAILS = [
  'pikachu-ash-hat',
  'charizard-gigantamax',
  'eevee-background',
  'ho-oh',
  'deoxys-attack',
].map((name) => `src/tools/inventory/fixtures/${name}.png`);
export const DEMO_STORAGE = 'src/tools/inventory/fixtures/storage/grid.png';
export const DEMO_SEARCHED = 'src/tools/inventory/fixtures/storage/searched.png';

/**
 * Where the battle's Worker is published, which `scripts/bundle.mts` builds it to and a page starts it from: no markup
 * names it, so the markup cannot be where the bundler learns of it as it learns of a page's module.
 */
export const BATTLE_WORKER = 'src/battle/worker.js';

/**
 * Every form's outline, which `scripts/vend-silhouettes.mts` writes out of the game master above and its icons, for the
 * battle tool in a page to read a party card against without fetching 40 MB of icons. Under `data/`, which the build
 * publishes whole.
 */
export const SILHOUETTES = 'data/silhouettes.json';

/**
 * The artifact each step of `pnpm build` writes its part of the site into, and the one tree `pnpm serve` serves.
 * `package.json`'s scripts and the ignore lists in `.gitignore`, `.prettierignore` and `eslint.config.mjs` spell it as
 * well, being configuration rather than modules.
 */
export const DIST = 'dist';
