/**
 * Writes `src/tools/inventory/costume-references.mts`, the labelled captures `costumeOf` compares a Pikachu against,
 * from a directory of detail screens and a `costumes.csv` in it naming the costume each one wears:
 *
 * ```csv
 * file,costume
 * 00137-detail.png,Gofest 2026 Cap Red
 * 00066-detail.png,
 * ```
 *
 * A costume is named as the `costume` column names it, blank for none, and every name has to be one of Pikachu's in
 * the game master or the artwork: a misspelt one would be a reference no icon can check.
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

import { CACHE, loadGameData, wardrobeFor } from '../src/tools/inventory/download.mts';
import { ARTWORK_FROM } from '../src/tools/inventory/artwork.mts';
import { designFiles, measure, type References } from '../src/tools/inventory/costume.mts';
import { tesseractCli } from '../src/tools/inventory/ocr-cli.mts';
import { useEngine } from '../src/tools/inventory/ocr.mts';
import { findOverlay } from '../src/tools/inventory/overlay.mts';
import { decodePng } from '../src/tools/inventory/png.mts';
import { parseCsv } from '../src/tools/inventory/scan.mts';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import prettier from 'prettier';

const OUT = 'src/tools/inventory/costume-references.mts';
const [dir] = process.argv.slice(2);

if (!dir) {
  throw new Error('usage: node scripts/costume-references.mts DIR, where DIR holds the captures and costumes.csv');
}

useEngine(tesseractCli);

const data = await loadGameData(CACHE);
const names = new Set(designFiles(data).map((d) => d.costume));
const [header = [], ...rows] = parseCsv(readFileSync(join(dir, 'costumes.csv'), 'utf8'));
const [file, costume] = ['file', 'costume'].map((name) => header.indexOf(name));

if (file === undefined || costume === undefined || file < 0 || costume < 0) {
  throw new Error('costumes.csv needs a file column and a costume column');
}

const wardrobe = await wardrobeFor(CACHE, data);
const references: References = { captures: [], behind: {} };

for (const row of rows) {
  const name = row[costume] ?? '';
  const path = join(dir, row[file] ?? '');

  if (!names.has(name)) {
    throw new Error(`${path}: Pikachu has no costume called "${name}"`);
  }

  // The same floor `readScreen` reads the artwork from.
  const image = decodePng(readFileSync(path));
  const box = (await findOverlay(image))?.box;
  const measured = measure(image, box ? box.y + box.height : ARTWORK_FROM, wardrobe);

  if (!measured) {
    throw new Error(`${path}: no Pikachu found on it`);
  }

  const best = Math.min(...measured.scores.values());
  const own = measured.scores.get(name);

  references.captures.push({ costume: name, blocks: Buffer.from(measured.blocks).toString('base64') });

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
