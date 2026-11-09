/**
 * Bundles the module graph the markup names into the files it already points at, and the battle's Worker into the one
 * `BATTLE_WORKER` names.
 *
 * `outbase` reproduces the source tree's shape under `outdir`, so `src/main.tsx` lands at `dist/src/main.js` — the path
 * `index.html` already points at — and the pages' entry points are read off those tags rather than listed here, so the
 * two cannot drift. The Worker's, which no markup names, is added from `BATTLE_WORKER`, which the page that starts it
 * reads too. `scripts/assemble.mts` runs after this and checks every local `src=` resolves inside the artifact.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import ts from 'typescript';
import { BATTLE_WORKER, DIST } from '../src/generated.ts';

const OUT = join(DIST, 'src');

/**
 * The entry points: the pages', taken from the markup rather than transcribed, a `<script type="module">` being what
 * makes a module one, and the Worker's from `BATTLE_WORKER`. The tag names the `.js` the browser fetches, so both
 * source extensions are tried: a page component is `.tsx` and a module with no markup in it is `.ts`, which is not
 * something the markup can say.
 */
const entryPoints: string[] = [];

/** The source of the `.js` that `by` names, which is either kind. */
function sourceOf(module: string, by: string): string {
  const source = [`${module}.tsx`, `${module}.ts`].find((path) => existsSync(path));

  if (source === undefined) {
    throw new Error(`${by} names ${module}.js, which is neither ${module}.tsx nor ${module}.ts`);
  }

  return source;
}

for (const page of readdirSync('.').filter((name) => name.endsWith('.html'))) {
  for (const [, module] of readFileSync(page, 'utf8').matchAll(/<script type="module" src="(src\/[^"]+)\.js">/g)) {
    if (module !== undefined) {
      entryPoints.push(sourceOf(module, page));
    }
  }
}

// A pattern matching nothing would bundle nothing and exit 0, leaving `assemble.mts` to report the page's missing
// module as if the markup were at fault.
if (entryPoints.length === 0) {
  throw new Error('No page names a module: the `<script type="module">` tags are not the shape this expects.');
}

// A module Worker, which a page starts by its path rather than its markup naming it, and which imports the chunks it
// shares with the pages as they do.
entryPoints.push(sourceOf(BATTLE_WORKER.replace(/\.js$/, ''), 'src/generated.ts'));

// esbuild takes no `target` from `tsconfig.json`, and `tsc` emits declarations only, so its own `target` reaches
// nothing but the default lib set. The bundle is built for the same one, read from there rather than named a second
// time and lower-cased because esbuild spells a target that way where `tsc` does not. The JSX pair needs no such step,
// since esbuild reads it from that file itself.
const target: unknown = ts.readConfigFile('tsconfig.json', ts.sys.readFile).config?.compilerOptions?.target;

if (typeof target !== 'string') {
  throw new Error('`tsconfig.json` is unreadable or names no `compilerOptions.target`, which the bundle needs.');
}

const result = await build({
  entryPoints,
  outdir: OUT,
  outbase: 'src',
  bundle: true,
  format: 'esm',

  /*
   * One chunk per `import()` in `src/shell.tsx`, plus a shared chunk for what more than one page reaches, so Leaflet
   * and the Java serialization codec stay out of the bundle every reader fetches. It also deduplicates what the pages
   * share, which the per-page builds could not: `pokemon/pokedex.ts` and the filter tables were in four bundles at
   * once, 100,286 bytes of the 455,917 the five came to. The battle's Worker shares chunks with the pages as they do
   * with each other, Tango's among them, which a module Worker imports as a page does. Only legal with `format: 'esm'`.
   */
  splitting: true,

  target: target.toLowerCase(),

  platform: 'browser',

  /*
   * Leaflet's `main` is its *unminified* build, 450,229 bytes for a script the CDN tag served as 147,552, so minifying
   * is what keeps importing the package by name from costing the map chunk more than the requests it saves.
   */
  minify: true,

  // Otherwise every non-ASCII character in a string literal becomes a six-character `\u` escape — identical JavaScript
  // for 315 measured bytes more. The pages are UTF-8 and say so.
  charset: 'utf8',

  /*
   * An imported stylesheet's own `url()`s have to go somewhere, and copying is the only answer that keeps a PNG a PNG —
   * `dataurl` would inline 3KB of base64 for images this page never requests. The hash is what makes them safe to
   * serve flattened into `dist/src/`, where two files called `layers.png` would otherwise collide silently.
   *
   * One `.png` entry covers a stylesheet carrying four `url()`s because the fourth needs no loader at all:
   * `url(#default#VML)` is a fragment rather than a file, which esbuild passes through instead of failing to resolve.
   */
  loader: { '.png': 'file' },
  assetNames: '[name]-[hash]',

  metafile: true,
});

const { outputs } = result.metafile;

/*
 * The Battle page's own thread reads nothing off the screen, the battle's Worker doing that, so nothing loaded with the
 * page may bring tesseract.js: CommonJS with no `sideEffects` field, it comes whole with any module that imports it,
 * however little of that module the page wants. What loads with the page is its chunk and every chunk reached from it
 * by a static import, rather than what it imports later.
 */
const BATTLE_PAGE = 'src/pages/battle.tsx';
const battle = Object.keys(outputs).find((path) => outputs[path]?.entryPoint === BATTLE_PAGE);

if (battle === undefined) {
  throw new Error(`No chunk was built for ${BATTLE_PAGE}, so what it loads cannot be checked.`);
}

const withBattle = new Set([battle]);

for (const chunk of withBattle) {
  for (const { path, kind } of outputs[chunk]?.imports ?? []) {
    if (kind === 'import-statement' && path in outputs) {
      withBattle.add(path);
    }
  }
}

const tesseract = [...withBattle].flatMap((chunk) =>
  Object.keys(outputs[chunk]?.inputs ?? {}).filter((input) => input.includes('node_modules/tesseract.js/')),
);

if (tesseract.length > 0) {
  const inputs = tesseract.join('\n  ');

  throw new Error(
    `${BATTLE_PAGE} loads tesseract.js with the page, which only the battle's Worker reads with:\n  ${inputs}`,
  );
}

const modules = new Set(Object.values(outputs).flatMap((output) => Object.keys(output.inputs)));

console.log(`${entryPoints.length} entry point(s) bundled into ${OUT}/ from ${modules.size} module(s).`);
