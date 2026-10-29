/**
 * The battle modules a page will run, bundled for a browser as `scripts/bundle.mts` bundles a page, so that one reaching
 * Node fails here rather than in the build of the page that first imports it. They are written as `.mts` for Node and
 * run there under `pnpm battle`, which is what makes it easy for a `node:` import to arrive unnoticed: nothing about
 * running them under Node or Vitest would say a browser cannot.
 *
 * Node's built-ins are left external rather than left to fail, since a failed build has no metafile to say how the
 * entry reached them, and the chain is what says which import to move. Anything else a browser cannot resolve still
 * fails the build, with esbuild's own message naming the file.
 */

import { builtinModules, isBuiltin } from 'node:module';
import { join } from 'node:path';
import { build, type Metafile } from 'esbuild';
import { expect, test } from 'vitest';

const ROOT = join(import.meta.dirname, '../../..');

/**
 * What a Worker driving the phone over WebUSB imports: the loop, the touchscreen, a picture cut out of `screenrecord`'s
 * H.264 for WebCodecs, what `screenrecord` is asked for, the screen kept current out of one recording after another,
 * the shell held open, and the `Device` built on the same `Transport` the touchscreen takes. Then the Worker itself,
 * which reaches all but the loop, and the page's half of it, each as `scripts/bundle.mts` builds it. And what a page
 * loads before a run: PvPoke's meta in `meta.mts` and the type icons in `assets.mts`, each fetched through the
 * `Download` it is handed rather than through `cachedAs`, the decoding of the vended `data/silhouettes.json` beside
 * them, and `src/battle/load.ts`, which fetches that file and hands the others `fetch`.
 */
const ENTRIES = [
  'src/tools/battle/run.mts',
  'src/tools/battle/pictures.mts',
  'src/tools/battle/record-command.mts',
  'src/tools/battle/screen.mts',
  'src/tools/inventory/held-shell.mts',
  'src/tools/battle/meta.mts',
  'src/tools/battle/assets.mts',
  'src/battle/load.ts',
  'src/tools/inventory/touchscreen.mts',
  'src/tools/inventory/adb.mts',
  'src/battle/worker.ts',
  'src/battle/client.ts',
];

/**
 * Each way `entry` reaches one of Node's modules, as the modules it passes through. The metafile marks external every
 * import the bundle left out, an erased type-only import as well as one of Node's, so being external is not enough on
 * its own. Nor can it tell an erased import of Node's from a kept one, so `import { type Readable } from 'node:stream'`
 * fails too, which is as well: a module typed against Node's streams is written for Node whatever esbuild makes of it.
 */
function chains({ inputs }: Metafile, entry: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const walk = (path: string, via: string[]) => {
    if (seen.has(path)) {
      return;
    }

    seen.add(path);

    for (const { path: imported, external } of inputs[path]?.imports ?? []) {
      if (external && isBuiltin(imported)) {
        found.push([...via, path, imported].join(' → '));
      } else {
        walk(imported, [...via, path]);
      }
    }
  };

  walk(entry, []);

  return found;
}

test.each(ENTRIES)('%s bundles for a browser without reaching Node', async (entry) => {
  const { metafile } = await build({
    absWorkingDir: ROOT,
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'browser',
    external: ['node:*', ...builtinModules],
    metafile: true,
    logLevel: 'silent',
  });

  expect(chains(metafile, entry)).toEqual([]);
});
