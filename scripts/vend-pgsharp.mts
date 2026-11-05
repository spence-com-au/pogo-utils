/**
 * Writes the current PGSharp release into `data/pgsharp-release.json`, read off where PGSharp's download link
 * redirects. The Integrations page reads that committed copy to name the version on its download button.
 *
 * Follows the redirects by hand rather than letting `fetch` do it, so the run stops at the APK's URL and never
 * downloads the APK — `api.pgsharp.com/download` goes by way of `www.pgsharp.com/download64` to `dl.pgsharp.com`.
 *
 * The clock is read only for a release not seen before, so an unchanged file after a run still means PGSharp has not
 * released.
 */

import { stampRelease } from '../src/release.ts';
import { DOWNLOAD_URL, releaseFromApk, VENDED_RELEASE } from '../src/pgsharp/release.ts';
import { readFileSync, writeFileSync } from 'node:fs';

let url = DOWNLOAD_URL;

for (let hops = 0; !new URL(url).pathname.endsWith('.apk'); hops++) {
  if (hops === 5) {
    throw new Error(`${DOWNLOAD_URL}: no APK after ${hops} redirects`);
  }

  const res = await fetch(url, { redirect: 'manual' });
  const location = res.headers.get('location');

  if (res.status < 300 || res.status >= 400 || location === null) {
    throw new Error(`${url}: ${res.status} ${res.statusText}, not a redirect`);
  }

  url = new URL(location, url).href;
}

const release = releaseFromApk(url);
const previous = JSON.parse(readFileSync(VENDED_RELEASE, 'utf8'));
const vended = stampRelease(previous, release, () => new Date().toISOString());

// Two-space and newline-terminated for `prettier --check .`, as `vend-feed.mts` explains.
writeFileSync(VENDED_RELEASE, `${JSON.stringify(vended, null, 2)}\n`);
console.log(`${VENDED_RELEASE}: PGSharp ${release.version}`);
