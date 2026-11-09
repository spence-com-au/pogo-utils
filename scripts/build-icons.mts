/**
 * Renders the installed-app icons from `favicon.svg` into the `dist/` the rest of `pnpm build` is assembling, so none
 * of them is a file anyone has to ignore and the `rm -rf dist` a build opens with clears one a renamed manifest entry
 * left behind.
 *
 * `manifest.json` is the authority on what to draw rather than a list of sizes here, so a size changed there cannot
 * disagree with the file published under it. `scripts/assemble.mts` copies nothing into `dist/icons/`, leaving this
 * the one producer, and checks every path the manifest names resolves — which catches an icon this failed to write.
 *
 * Nothing honours `prefers-color-scheme`, and that is the point: a launcher paints an icon once rather than per theme,
 * and a renderer with no concept of a theme takes `favicon.svg`'s default rim, which is the one an icon wants.
 */

import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DIST } from '../src/generated.ts';
import { decodePng, encodePng, pad, type Image } from '../src/tools/inventory/png.mts';

/** The one icon this repository keeps. Everything written below is a rendering of it. */
const SOURCE = 'favicon.svg';

/** Read for what to render, and published beside the pages that link it. */
const MANIFEST = 'manifest.json';

/**
 * How much of a maskable canvas the ball fills. A launcher crops an icon to its own shape and only promises to keep the
 * central circle of 40% radius, while the ball's rim reaches the very edge of `favicon.svg` — so it has to be inset. At
 * two thirds the rim lands at a third of the width, inside the 40% that survives, and the margin left over is the plate
 * the crop eats into. Two thirds also divides a size evenly where a tighter fraction would not: 768 insets 512 by 128.
 */
const BALL = 2 / 3;

/** Only the members read below. A manifest carries far more, and none of the rest decides what an icon looks like. */
interface Manifest {
  background_color: string;
  icons: { src: string; sizes: string; purpose?: string }[];
}

/** `#rrggbb` as the three bytes `pad` takes. */
function plate(hex: string): [number, number, number] {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);

  if (!match) {
    throw new Error(`${MANIFEST}: cannot read \`background_color\` "${hex}" as a #rrggbb colour`);
  }

  return [parseInt(match[1] ?? '', 16), parseInt(match[2] ?? '', 16), parseInt(match[3] ?? '', 16)];
}

/**
 * The one square size an icon declares. The `sizes` member may name several, and an icon rendered from a vector could
 * honour that, but a file holding two sizes at once is not something this writes — so it is refused rather than
 * guessed.
 */
function square(icon: string, sizes: string): number {
  const match = /^(\d+)x\1$/.exec(sizes);

  if (!match) {
    throw new Error(`${MANIFEST}: cannot render ${icon} at "${sizes}", which is not one square size`);
  }

  return Number(match[1]);
}

const source = readFileSync(SOURCE, 'utf8');

/**
 * `favicon.svg` at a size, as pixels. Back through `decodePng` rather than kept as the renderer's own buffer so that
 * what reaches `pad` and what gets written are both this repository's own codec, and so a render that came back at the
 * wrong size is caught here rather than published and rejected by a phone.
 */
function render(size: number): Image {
  const rendered = new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
  const image = decodePng(Buffer.from(rendered));

  if (image.width !== size || image.height !== size) {
    throw new Error(`${SOURCE} rendered ${image.width}x${image.height} rather than ${size}x${size}`);
  }

  return image;
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
const colour = plate(manifest.background_color);

for (const icon of manifest.icons) {
  const to = join(DIST, icon.src);
  const size = square(icon.src, icon.sizes);
  const maskable = (icon.purpose ?? '').split(' ').includes('maskable');

  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, encodePng(maskable ? pad(render(size * BALL), size, colour) : render(size)));
  console.log(`${to}: ${SOURCE} at ${size}x${size}${maskable ? `, inset to ${size * BALL} on its plate` : ''}`);
}
