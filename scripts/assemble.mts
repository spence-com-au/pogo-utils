/**
 * Assembles `dist/` into the tree GitHub Pages serves: everything a page fetches that the compiler does not produce.
 * Positions are preserved rather than flattened, a page resolving `src/theme.css` against its own URL and the markup
 * not being rewritten.
 *
 * An allowlist rather than everything-minus-exclusions, because the two fail in opposite directions: a missing
 * exclusion publishes something nobody audited and says nothing, where a missing inclusion is a 404 the check at the
 * end turns into a failed build.
 */

import {
  copyInto,
  expandEntry,
  lfsPointers,
  orphanedStylesheets,
  PUBLISHED,
  scanReferences,
  unservedFiles,
  VENDORED,
} from '../src/artifact.mts';
import { DIST } from '../src/generated.ts';

let copied = 0;

for (const [to, from] of Object.entries(VENDORED)) {
  copyInto(DIST, from, to);
  copied += 1;
}

// At the same position each path occupies in the repository.
for (const path of PUBLISHED.flatMap((entry) => expandEntry(entry))) {
  copyInto(DIST, path, path);
  copied += 1;
}

const unexpected = unservedFiles(DIST);

if (unexpected.length > 0) {
  throw new Error(`In the artifact and not served:\n  ${unexpected.join('\n  ')}`);
}

const pointers = lfsPointers(DIST);

if (pointers.length > 0) {
  throw new Error(`In the artifact as Git LFS pointers, not pulled:\n  ${pointers.join('\n  ')}`);
}

const { pages, manifests, checked, named, missing } = scanReferences(DIST);

/*
 * Either regex matching nothing leaves `missing` empty and passes a build having verified no reference at all, the
 * only trace a `0` in the summary line. So assert each scan found something, as `bundle.mts` does for its own.
 */
if (checked === 0 || manifests.size === 0) {
  throw new Error(
    `${checked} reference(s) and ${manifests.size} manifest link(s) across ${pages.length} page(s): ` +
      'the markup is not the shape the scans expect.',
  );
}

if (missing.length > 0) {
  throw new Error(`Not in the artifact:\n  ${missing.join('\n  ')}`);
}

const orphaned = orphanedStylesheets(DIST, named);

if (orphaned.length > 0) {
  throw new Error(
    `Stylesheet(s) in the artifact that no page links, so nothing ever loads them:\n  ${orphaned.join('\n  ')}\n` +
      'A page reached through `import()` cannot carry its own stylesheet — import it from `src/main.tsx` instead.',
  );
}

console.log(`${copied} path(s) copied into ${DIST}/ beside the compiler's output.`);
console.log(
  `${checked} local reference(s) across ${pages.length} page(s) and ${manifests.size} manifest(s) resolve inside it.`,
);
