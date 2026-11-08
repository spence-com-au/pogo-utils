/**
 * Writes the web app manifest into `dist/`: `manifest.json` as it stands, plus the two members that name pages —
 * `start_url` and the launcher `shortcuts` — written out of `src/page-table.ts` rather than kept beside it.
 *
 * They used to be kept, a second copy of the router's table that nothing compared against the first. The fragment is
 * the one part of a manifest URL `scripts/assemble.mts` cannot resolve against the artifact, and `fromHash` sends a
 * name it does not know to `HOME`, so renaming a page would have turned its shortcut into a silent redirect to Events.
 * Generated, a renamed page renames its shortcut, and a new one gets one, with nothing to remember.
 *
 * `scripts/assemble.mts` copies nothing over this — it fails rather than overwrite a path the build already wrote —
 * and still checks every path the written manifest names, this file's included.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIST } from '../src/generated.ts';
import { HOME, PAGES, toHash } from '../src/page-table.ts';

/** Everything in the manifest that is not a page, which is also what `scripts/build-icons.mts` renders from. */
const SOURCE = 'manifest.json';

/**
 * The members written here. One in the source as well would be a hand copy again, so it is refused rather than merged.
 */
const GENERATED = ['start_url', 'shortcuts'];

const source = JSON.parse(readFileSync(SOURCE, 'utf8')) as Record<string, unknown>;
const written = GENERATED.filter((member) => member in source);

if (written.length > 0) {
  throw new Error(
    `${SOURCE}: ${written.map((member) => `\`${member}\``).join(' and ')} is written from src/page-table.ts ` +
      'by scripts/build-manifest.mts, and must not be kept here as well',
  );
}

/*
 * Relative and prefixed `./`, because a manifest's members resolve against the manifest's own URL rather than the
 * page's: a bare `#/events` would open `manifest.json#/events`, and a leading `/` would leave the Pages subdirectory.
 */
const manifest = {
  ...source,
  start_url: `./${toHash(HOME)}`,
  shortcuts: PAGES.map((page) => ({ name: page.label, url: `./${toHash(page.name)}` })),
};

writeFileSync(join(DIST, SOURCE), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${join(DIST, SOURCE)}: ${SOURCE} with start_url and ${PAGES.length} shortcut(s) from src/page-table.ts`);
