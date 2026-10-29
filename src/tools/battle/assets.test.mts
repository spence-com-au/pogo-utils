/**
 * The vended silhouettes against the icons they were outlined from, and against the vended game master whose forms
 * they are for; and the type icons read through a `Download`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { GAME_MASTER, SILHOUETTES } from '../../generated.ts';
import { type GameData } from '../inventory/game-master.mts';
import { decodePng } from '../inventory/png.mts';
import { decodeSilhouettes, formIcons, typeIcons, type Download, type Silhouettes } from './assets.mts';
import { silhouetteOfIcon } from './party.mts';

const root = new URL('../../../', import.meta.url);
const DATA = JSON.parse(readFileSync(new URL(GAME_MASTER, root), 'utf8')) as GameData;
const ASSET = JSON.parse(readFileSync(new URL(SILHOUETTES, root), 'utf8')) as Silhouettes;
const DECODED = decodeSilhouettes(ASSET);

/** The form icons committed beside the party screens, which are some of the game's own as the vend fetched them. */
const ICONS = readdirSync(new URL('fixtures/icons/', import.meta.url));

test.each(ICONS)('%s is vended as `silhouetteOfIcon` outlines it', (icon) => {
  const outline = silhouetteOfIcon(decodePng(readFileSync(new URL(`fixtures/icons/${icon}`, import.meta.url))));

  expect(DECODED.get(icon)?.silhouette).toStrictEqual(outline);
});

// The other way to drift: a re-vend of the game master that adds a form, or renames a species, without the silhouettes
// following it, which leaves that form's card unread in a page and nowhere else.
test('the silhouettes are for every form icon of the vended game master, by its species', () => {
  expect(new Map([...DECODED].map(([icon, { species }]) => [icon, species]))).toStrictEqual(formIcons(DATA));
});

test('a silhouette packed for another grid is refused rather than laid over the wrong cells', () => {
  expect(() => decodeSilhouettes({ 'pm1.icon.png': ['Bulbasaur', btoa('short')] })).toThrow(
    'pm1.icon.png packs into 5 bytes, not 288',
  );
});

test('each type is read off its icon, and one whose icon cannot be had is left out', async () => {
  const download: Download = async (file, url, decode) => {
    if (file.includes('FAIRY')) {
      throw new Error(`${url}: 404 Not Found`);
    }

    return decode(readFileSync(new URL(`fixtures/types/${file}`, import.meta.url)));
  };

  const icons = await typeIcons(DATA, download);

  expect(Object.keys(icons).sort()).toStrictEqual(DATA.types.filter((type) => type !== 'Fairy').sort());
  expect(icons.Water?.width).toBeGreaterThan(0);
});
