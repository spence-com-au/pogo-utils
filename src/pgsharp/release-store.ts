/**
 * The document's PGSharp release store, which the top bar and the Integrations page share. `../release-store.ts` says
 * how a release becomes a notice; this names where PGSharp's is read from and where its acknowledgement is kept.
 */

import { fetchVendedRelease, ReleaseStore } from '../release-store.js';
import { KEY_PREFIX } from '../storage-namespace.js';
import { releaseFromApk, VENDED_RELEASE } from './release.js';

export const ACKNOWLEDGED_KEY = `${KEY_PREFIX}pgsharp:acknowledged`;

/** Through `releaseFromApk`, so whatever links to it links to `dl.pgsharp.com` or to nothing read here. */
export const releaseStore = new ReleaseStore(ACKNOWLEDGED_KEY, () =>
  fetchVendedRelease(VENDED_RELEASE, releaseFromApk),
);
