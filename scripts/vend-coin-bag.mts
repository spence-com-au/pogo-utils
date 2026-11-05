/**
 * Writes the current Pokémon GO Coin Bag release into `data/coin-bag-release.json`, read off where GitHub's latest
 * release link redirects. The Integrations page reads that committed copy to name the version on its download buttons.
 *
 * The redirect rather than the releases API, which allows a runner's shared address sixty unauthenticated requests an
 * hour and would want a token to be dependable. One hop, `…/releases/latest` to `…/releases/tag/r9`, followed by hand
 * so the run reads the `Location` and fetches nothing else.
 *
 * The clock is read only for a release not seen before, so an unchanged file after a run still means nothing was
 * released.
 */

import { stampRelease } from '../src/release.ts';
import { LATEST_URL, releaseFromTagPage, VENDED_RELEASE } from '../src/coin-bag/release.ts';
import { readFileSync, writeFileSync } from 'node:fs';

const res = await fetch(LATEST_URL, { redirect: 'manual' });
const location = res.headers.get('location');

if (res.status < 300 || res.status >= 400 || location === null) {
  throw new Error(`${LATEST_URL}: ${res.status} ${res.statusText}, not a redirect`);
}

const release = releaseFromTagPage(new URL(location, LATEST_URL).href);
const previous = JSON.parse(readFileSync(VENDED_RELEASE, 'utf8'));
const vended = stampRelease(previous, release, () => new Date().toISOString());

// Two-space and newline-terminated for `prettier --check .`, as `vend-feed.mts` explains.
writeFileSync(VENDED_RELEASE, `${JSON.stringify(vended, null, 2)}\n`);
console.log(`${VENDED_RELEASE}: Coin Bag ${release.version}`);
