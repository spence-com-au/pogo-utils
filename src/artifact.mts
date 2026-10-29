/**
 * What `scripts/assemble.mts` copies into the artifact and the checks it then holds the artifact to, as functions of
 * the directory they read. Here rather than in the script so the suite can import them — the script's own top level
 * writes into `dist/` as soon as it is loaded — and beside `artifact.test.mts`, which holds each decision to an
 * artifact of its own.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, sep } from 'node:path';
import { GAME_MASTER, TESSERACT_VENDOR } from './generated.ts';
import { SERVED_TYPES } from '../scripts/served-types.mts';

/**
 * What the site serves that the compiler does not write, relative to the repository root. An entry ending `*.ext` takes
 * every matching file in that one directory; anything else is copied as it stands, recursively where it is a directory.
 */
export const PUBLISHED = [
  '*.html',
  'favicon.svg',

  // `src/generated.ts`'s five indexes are in here, so none is named separately: `publish` throws rather than copying
  // a path twice, and the directory is what the pages fetch them under.
  'data',

  // The game master the Inventory page reads a screen against: the corpus's own vended copy, at the position it holds
  // here, rather than a second copy that could drift from the one the tests pin — or the 23 MB upstream the vend exists
  // to avoid fetching.
  GAME_MASTER,
];

/**
 * What the Inventory page's OCR runs on, copied out of `node_modules` rather than fetched from tesseract.js's CDN
 * default, so the version the build was tested with is the one served: its worker script, and the three LSTM-only
 * cores the worker picks between by what the browser's WebAssembly supports — relaxed SIMD, SIMD, or neither. Each is
 * some 4 MB with the WebAssembly inlined, and a browser fetches the one it runs. A missing file fails the copy.
 */
const tesseract = createRequire(import.meta.url).resolve('tesseract.js');
const core = dirname(createRequire(tesseract).resolve('tesseract.js-core/package.json'));

export const VENDORED: Record<string, string> = {
  [`${TESSERACT_VENDOR}worker.min.js`]: join(dirname(tesseract), '../dist/worker.min.js'),
  ...Object.fromEntries(
    ['tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'].map(
      (name) => [`${TESSERACT_VENDOR}${name}`, join(core, name)],
    ),
  ),
};

/**
 * Copies `from` into `dist` at `to`. Refusing to land on something already there is what keeps two producers out of one
 * directory: `scripts/bundle.mts` writes into `dist/src/` and this runs afterwards, so a copy would overwrite what the
 * bundler emitted and report a build that succeeded.
 */
export function copyInto(dist: string, from: string, to: string): void {
  const at = join(dist, to);

  if (existsSync(at)) {
    throw new Error(`${from} would overwrite ${at}, which the build already wrote`);
  }

  mkdirSync(dirname(at), { recursive: true });
  cpSync(from, at, { recursive: true });
}

/**
 * The paths one `PUBLISHED` entry names, relative to `root`: a `*.ext` entry every file in its directory ending `.ext`,
 * which are not recursed into, and anything else itself.
 */
export function expandEntry(entry: string, root = '.'): string[] {
  const star = entry.indexOf('*');

  if (star < 0) {
    return [entry];
  }

  const dir = entry.slice(0, star).replace(/\/$/, '') || '.';
  const ext = entry.slice(star + 1);

  return readdirSync(join(root, dir))
    .filter((name) => name.endsWith(ext))
    .map((name) => (dir === '.' ? name : `${dir}/${name}`));
}

/**
 * Every file in `dist` of a kind the site does not serve. Anything there is something nobody meant to publish.
 *
 * The kinds are read off the table that says what each of them is served as, rather than kept here as a second copy of
 * the same list: a kind of file this allows through and the local server has no type for would otherwise be a thing the
 * build calls fine and a reader sees as a download.
 *
 * The other direction, which the allowlist cannot see: it says what is copied in, not what ends up here.
 * `tsBuildInfoFile` defaults to a path derived from `outDir`, which landed the build cache at
 * `dist/tsconfig.tsbuildinfo` and deployed it. Naming that file is the fix, and the default is one `outDir` edit away
 * from coming back.
 */
export function unservedFiles(dist: string, served: readonly string[] = Object.keys(SERVED_TYPES)): string[] {
  return readdirSync(dist, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !served.includes(extname(entry.name)))
    .map((entry) => join(entry.parentPath, entry.name));
}

/**
 * The artifact path `ref` names, read as written in a file at `from`, or `null` where it is not fetched from this
 * origin by path at all: a CDN module, an outbound link, a fragment, an inline data URL.
 *
 * Relative paths resolve against the directory of the file that named them rather than against the artifact root,
 * which is what lets one function serve both a page and a manifest — the two resolve against different bases in the
 * specification and only share one while everything sits at the root.
 *
 * A path that leaves the artifact throws rather than resolving, `join` normalising both such forms into one that does
 * not: a leading `/` would be read as relative, and a climb out of `dist/` stat'd against the repository.
 */
export function localTarget(from: string, ref: string): string | null {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) {
    return null;
  }

  // The origin's root, where Pages serves this site from a directory beneath it (`/pogo-utils/`).
  if (ref.startsWith('/')) {
    throw new Error(`${from} names ${ref}, which leaves the Pages subdirectory`);
  }

  // As written in an `href`, so percent-encoded: `Melbourne%20Zoo.gpx` names a file with a space in it.
  const path = decodeURIComponent(ref.split(/[?#]/)[0] ?? '');
  const at = join(dirname(from), path);

  if (at === '..' || at.startsWith(`..${sep}`)) {
    throw new Error(`${from} names ${ref}, which leaves the artifact`);
  }

  return at;
}

/**
 * Every string under a `src`, `url` or `start_url` member of a manifest, at whatever depth. A walk rather than the
 * three members this manifest happens to use, the specification carrying more of them, so one nobody thought to name
 * here would go unchecked. It errs towards asking about a member that is not a path, which fails a build.
 */
export function* refsOf(value: unknown): Generator<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* refsOf(item);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const [member, held] of Object.entries(value)) {
      if (typeof held !== 'string') {
        yield* refsOf(held);
      } else if (member === 'src' || member === 'url' || member === 'start_url') {
        yield held;
      }
    }
  }
}

/** Every `src` and `href` in `markup`, as written. */
export const markupRefs = (markup: string): string[] =>
  Array.from(markup.matchAll(/(?:src|href)="([^"]+)"/g), ([, ref]) => ref).filter((ref) => ref !== undefined);

/**
 * The `href` of every `<link rel="manifest">` in `markup`.
 *
 * Read from the markup rather than a constant, for the reason the paths are: renaming the manifest moves this check
 * with it, where a name written here would quietly stop reading anything. Matching the whole tag and then asking it for
 * its `href` keeps the two attributes in either order.
 */
export const manifestLinks = (markup: string): string[] =>
  Array.from(markup.matchAll(/<link[^>]*\brel="manifest"[^>]*>/g), ([tag]) => /\bhref="([^"]+)"/.exec(tag)?.[1]).filter(
    (href) => href !== undefined,
  );

/** What a scan of an artifact's references found. */
export type References = {
  pages: string[];
  checked: number;
  missing: string[];

  /**
   * Deduplicated, because every page links the same manifest and its icons want reporting once rather than six
   * times.
   */
  manifests: Set<string>;

  /** Every path in the artifact something named, which is the half the stylesheet check reads. */
  named: Set<string>;
};

/**
 * Every local path the markup and the manifests in `dist` name, and which of them are not there. That check is what
 * makes `PUBLISHED` safe to maintain by hand: the pages are the authority on what the site needs. Reading the copies
 * rather than the originals also checks the copying itself.
 */
export function scanReferences(dist: string): References {
  const found: References = { pages: [], manifests: new Set(), checked: 0, named: new Set(), missing: [] };

  // Records `ref` unless it names a file in the artifact.
  const mustResolve = (from: string, ref: string) => {
    const at = localTarget(from, ref);

    if (at === null) {
      return;
    }

    found.checked += 1;
    found.named.add(at);

    if (!existsSync(join(dist, at))) {
      found.missing.push(`${from} names ${ref}`);
    }
  };

  found.pages = readdirSync(dist).filter((name) => name.endsWith('.html'));

  for (const page of found.pages) {
    const markup = readFileSync(join(dist, page), 'utf8');

    for (const ref of markupRefs(markup)) {
      mustResolve(page, ref);
    }

    for (const href of manifestLinks(markup)) {
      found.manifests.add(href);
    }
  }

  /*
   * The icons and shortcut targets, which no page names and the scan above cannot see. Left unchecked they fail where
   * nothing is watching: a launcher that cannot fetch an icon draws a letter tile, and a shortcut to a page that moved
   * opens a 404 from someone's home screen.
   */
  for (const manifest of found.manifests) {
    const parsed: unknown = JSON.parse(readFileSync(join(dist, manifest), 'utf8'));

    for (const ref of refsOf(parsed)) {
      /*
       * A manifest's members resolve against its own URL rather than the page's, so a bare fragment names the manifest
       * itself: `#/events` installs an app that opens `manifest.json#/events` and shows the JSON as text. `localTarget`
       * passes fragments as in-page links, which is right for markup and wrong here.
       */
      if (ref.startsWith('#')) {
        found.missing.push(`${manifest} names ${ref}, which resolves to the manifest itself`);
      }

      mustResolve(manifest, ref);
    }
  }

  return found;
}

/**
 * The other direction for stylesheets: every one under `dist/src/` that nothing in `named` links, relative to `dist`.
 *
 * The reference scan answers "is everything the markup names here", which a stylesheet nothing names passes without
 * being read. That is not hypothetical. esbuild emits a CSS file per chunk, so a stylesheet imported by a page the
 * shell reaches through `import()` lands beside that page's chunk — and esbuild ships no runtime to fetch it, so the
 * five page sheets were written into the artifact and no document ever loaded one. Every page rendered unstyled, and
 * nothing in the build said so: the module graph was complete, the markup resolved, the byte counts looked plausible.
 *
 * `src/main.tsx` importing all seven is the fix. This is what stops the next page-local `import './x.css'` from quietly
 * reintroducing it.
 */
export function orphanedStylesheets(dist: string, named: ReadonlySet<string>): string[] {
  return readdirSync(join(dist, 'src'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name) === '.css')
    .map((entry) => relative(dist, join(entry.parentPath, entry.name)))
    .filter((path) => !named.has(path));
}
