/**
 * Prints every path `scripts/assemble.mts` publishes, comma-separated, for the Pages workflow to pull out of Git LFS
 * before it builds: read off `PUBLISHED` rather than listed in the workflow, so a capture the site starts publishing is
 * one the deploy pulls. Paths not in LFS are named too and pull nothing.
 */

import { expandEntry, PUBLISHED } from '../src/artifact.mts';

console.log(PUBLISHED.flatMap((entry) => expandEntry(entry)).join(','));
