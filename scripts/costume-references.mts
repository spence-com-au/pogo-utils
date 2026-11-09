/**
 * Writes `src/tools/inventory/costume-references.mts`, the labelled captures `costumeOf` compares a Pikachu against,
 * from a directory of detail screens and a `costumes.json` in it naming the costume each one wears:
 *
 * ```json
 * { "00137-detail.png": "Gofest 2026 Cap Red", "00066-detail.png": "" }
 * ```
 *
 * A costume is named as a scan names it, blank for none, and every name has to be one of Pikachu's in the game master
 * or the artwork: a misspelt one would be a reference no icon can check.
 *
 * Kept as numbers rather than as the captures, which hold trainer names and are some 2 MB each: three bytes per block
 * of each, and how far behind the icons' best each costume came on its own captures at worst — the allowance the icons'
 * veto is measured against, which only the captures and the icons together can say.
 *
 * Run again when a costume arrives that nothing has labelled, with captures of it added to the directory: until then
 * the icons alone answer it.
 *
 * ```sh
 * node scripts/costume-references.mts DIR
 * ```
 */

import { CACHE, cachedIcon, loadGameData } from '../src/core/node/download.mts';
import { designFiles, measure, wardrobeFor, type References } from '../src/tools/inventory/costume.mts';
import { tesseractCli } from '../src/core/node/ocr-cli.mts';
import { useEngine } from '../src/core/ocr.mts';
import { findOverlay } from '../src/tools/inventory/overlay.mts';
import { decodePng } from '../src/core/png.mts';
import { artworkFrom } from '../src/tools/inventory/report.mts';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import prettier from 'prettier';

const OUT = 'src/tools/inventory/costume-references.mts';
const [dir] = process.argv.slice(2);

if (!dir) {
  throw new Error('usage: node scripts/costume-references.mts DIR, where DIR holds the captures and costumes.json');
}

useEngine(tesseractCli);

const data = await loadGameData(CACHE);
const names = new Set(designFiles(data).map((d) => d.costume));
const labelled = JSON.parse(readFileSync(join(dir, 'costumes.json'), 'utf8')) as Record<string, string>;

const wardrobe = await wardrobeFor(data, cachedIcon(CACHE));

// Every icon, since an allowance measured with a costume left out is measured against fewer rivals than a scan has.
if (!wardrobe || wardrobe.drawn.length < designFiles(data).reduce((n, d) => n + d.files.length, 0)) {
  throw new Error("some of Pikachu's icons could not be had, so the allowances would not be the scan's");
}

const references: References = { captures: [], behind: {} };

for (const [file, name] of Object.entries(labelled)) {
  const path = join(dir, file);

  if (!names.has(name)) {
    throw new Error(`${path}: Pikachu has no costume called "${name}"`);
  }

  const image = decodePng(readFileSync(path));
  const box = (await findOverlay(image))?.box ?? null;
  const measured = measure(image, artworkFrom(box), wardrobe);

  if (!measured) {
    throw new Error(`${path}: no Pikachu found on it`);
  }

  const best = Math.min(...measured.scores.values());
  const own = measured.scores.get(name);

  references.captures.push({
    costume: name,
    blocks: Buffer.from(measured.blocks).toString('base64'),
    front: Buffer.from(measured.front).toString('base64'),
  });

  if (own !== undefined) {
    references.behind[name] = Math.max(references.behind[name] ?? 0, Number((own - best).toFixed(4)));
  }

  console.error(
    `${path}: ${name || '(none)'}, ${(own === undefined ? 0 : own - best).toFixed(4)} behind the icons' best`,
  );
}

const source =
  `/** Written by \`scripts/costume-references.mts\`, which says where it comes from. */\n\n` +
  `import { type References } from './costume.mts';\n\n` +
  `export const REFERENCES: References = ${JSON.stringify(references)};\n`;
const options = await prettier.resolveConfig(OUT);

writeFileSync(OUT, await prettier.format(source, { ...options, filepath: OUT }));
console.error(`${OUT}: ${references.captures.length} captures of ${Object.keys(references.behind).length} costumes`);
