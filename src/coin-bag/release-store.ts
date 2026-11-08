/**
 * The document's Coin Bag release store, which the top bar and the Integrations page share. `../release-store.ts` says
 * how a release becomes a notice; this names where the Coin Bag's is read from and where its acknowledgement is kept.
 */

import { fetchVendedRelease, ReleaseStore } from '../release-store.js';
import { KEY_PREFIX } from '../storage-namespace.js';
import { releaseFromTagPage, VENDED_RELEASE } from './release.js';

const ACKNOWLEDGED_KEY = `${KEY_PREFIX}coin-bag:acknowledged`;

/** Through `releaseFromTagPage`, so whatever links to it links to this repository's releases or to nothing here. */
export const coinBagReleaseStore = new ReleaseStore(ACKNOWLEDGED_KEY, () =>
  fetchVendedRelease(VENDED_RELEASE, releaseFromTagPage),
);
