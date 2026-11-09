/**
 * Each side's types read off every committed frame that shows a battle, against what each side is: the species the
 * frame's HUD names, or for ours, often nicknamed, the one its moves and the icons themselves show. Among them are the
 * empty places that set the thresholds: open sky, cloud, a night sky as blue as Ghost, and sky light enough to pass
 * for an emblem.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { type GameData } from '../../core/game-master.mts';
import { decodePng, type Image } from '../../core/png.mts';
import { down, TOP } from './layout.mts';
import { type Colour } from './minigame.mts';
import { iconColour, readTypes } from './typing.mts';

const DATA = JSON.parse(readFileSync(new URL('../../../data/game-master.json', import.meta.url), 'utf8')) as GameData;

const png = (name: string) => decodePng(readFileSync(new URL(`fixtures/${name}.png`, import.meta.url)));

const COLOURS = Object.fromEntries(
  DATA.types.map((type) => [type, iconColour(png(`types/POKEMON_TYPE_${type.toUpperCase()}`))]),
);

const KYOGRE = ['Water'];
const ENTEI = ['Fire'];
const TYRANITAR = ['Rock', 'Dark'];
const MAMOSWINE = ['Ice', 'Ground'];
const EMPOLEON = ['Water', 'Steel'];
const GIRATINA = ['Ghost', 'Dragon'];
const LATIAS = ['Dragon', 'Psychic'];
const MEWTWO = ['Psychic'];
const GALARIAN_MOLTRES = ['Dark', 'Flying'];
const CHARIZARD = ['Fire', 'Flying'];
const SALAMENCE = ['Dragon', 'Flying'];
const QUAQUAVAL = ['Water', 'Fighting'];
const COMBUSKEN = ['Fire', 'Fighting'];
const GLACEON = ['Ice'];

test.each([
  ['battle-two-unlit', KYOGRE, SALAMENCE],
  ['charged-two-both', KYOGRE, ENTEI],
  ['charged-two-right', KYOGRE, ENTEI],
  ['charged-deep-sky', KYOGRE, ENTEI],
  ['playing-minigame-kyogre-great', KYOGRE, ENTEI],
  ['playing-minigame-kyogre-excellent', KYOGRE, ENTEI],
  ['playing-shield-blocked', KYOGRE, ENTEI],
  ['battle-deoxys', MEWTWO, ['Dark', 'Ice']],
  ['playing-minigame-mewtwo', MEWTWO, ENTEI],
  ['playing-minigame-mewtwo-over', MEWTWO, ENTEI],
  ['battle-night', MEWTWO, ENTEI],
  ['battle-crunch-entei', TYRANITAR, ENTEI],
  ['battle-crunch-salamence', TYRANITAR, SALAMENCE],
  ['playing-minigame-ready', TYRANITAR, ENTEI],
  ['playing-minigame-tyranitar', TYRANITAR, ENTEI],
  ['charged-avalanche', MAMOSWINE, EMPOLEON],
  ['playing-banner', MAMOSWINE, EMPOLEON],
  ['playing-shield-going-up', MAMOSWINE, EMPOLEON],
  ['playing-minigame-mamoswine', MAMOSWINE, GLACEON],
  ['charged-shadow-sneak', GIRATINA, MAMOSWINE],
  ['playing-minigame-giratina', GIRATINA, EMPOLEON],
  ['battle-latias', LATIAS, GLACEON],
  ['battle-countdown', LATIAS, GLACEON],
  ['playing-minigame-swampert', ['Water', 'Ground'], QUAQUAVAL],
  ['playing-banner-swampert', ['Water', 'Ground'], QUAQUAVAL],
  ['playing-banner-quaquaval', CHARIZARD, QUAQUAVAL],
  ['battle-one-shield', CHARIZARD, QUAQUAVAL],
  ['playing-shields-spent', CHARIZARD, QUAQUAVAL],
  ['battle-charizard-magmar', CHARIZARD, ['Fire']],

  // An Alolan Golem, Rock and Electric, where a Kantonian one is Rock and Ground.
  ['battle-gengar-label-short', ['Ghost', 'Poison'], ['Rock', 'Electric']],

  // A Galarian Moltres of ours, and a Typhlosion that is not Hisuian, the night sky where its Ghost would be.
  ['battle-pixel8-moltres-body', GALARIAN_MOLTRES, ['Fire']],
  ['battle-pixel8-moltres-wing', GALARIAN_MOLTRES, ['Fire']],
  ['playing-banner-pixel8-groudon', GALARIAN_MOLTRES, ['Ground']],
  ['battle-pixel8', ['Normal'], COMBUSKEN],
  ['charged-pixel8', ['Normal'], COMBUSKEN],
  ['playing-minigame-pixel8-dark', ['Normal'], COMBUSKEN],
])('%s: %j against %j', (name, own, opponent) => {
  expect(readTypes(png(name), COLOURS)).toEqual({ own, opponent });
});

test('a screen without the HUD reads neither side', () => {
  for (const name of ['shield-glaceon', 'shield-sneasel', 'other-win', 'other-vs-fade', 'menu-main']) {
    expect(readTypes(png(name), COLOURS), name).toEqual({ own: null, opponent: null });
  }
});

/**
 * `frame` with the icon at `x` across redrawn as a disc of `colour` under a white emblem covering a seventh of it, at
 * the height and radius `typing.mts` reads.
 */
function redraw(frame: Image, x: number, colour: Colour): Image {
  const data = frame.data.slice();
  const [cx, cy, r] = [x * frame.width, down(0.098, TOP, frame) * frame.height, 0.019 * frame.width];

  for (let y = Math.floor(cy - r) - 1; y <= cy + r + 1; y++) {
    for (let px = Math.floor(cx - r) - 1; px <= cx + r + 1; px++) {
      const from = Math.hypot(px - cx, y - cy);

      if (from <= r + 1) {
        data.set(from <= r * Math.sqrt(1 / 7) ? [255, 255, 255, 255] : [...colour, 255], (y * frame.width + px) * 4);
      }
    }
  }

  return { ...frame, data };
}

test('an icon neither clearly a type nor clearly absent leaves its whole side unread', () => {
  const frame = png('battle-crunch-entei');
  const dark = iconColour(png('types/POKEMON_TYPE_DARK'));
  const nearest = ([r, g, b]: Colour) =>
    Math.min(...Object.values(COLOURS).map((type) => Math.hypot(type[0] - r, type[1] - g, type[2] - b)));

  // Dark, shifted a little over `NEAR` from itself, and so from every other type too: between `NEAR` and `FAR` of all.
  const between = [
    [42, 0, 0],
    [-42, 0, 0],
    [0, 42, 0],
    [0, -42, 0],
    [0, 0, 42],
    [0, 0, -42],
  ]
    .map(([r = 0, g = 0, b = 0]): Colour => [dark[0] + r, dark[1] + g, dark[2] + b])
    .find((colour) => nearest(colour) > 38 && nearest(colour) < 47);

  expect(between).toBeDefined();
  expect(readTypes(redraw(frame, 0.094, dark), COLOURS).own).toEqual(TYRANITAR);

  // Far from every type is an empty place, which a two-type side leaves out; in between is a guess that it does not
  // make.
  expect(readTypes(redraw(frame, 0.094, [0, 0, 0]), COLOURS).own).toEqual(['Rock']);
  expect(readTypes(redraw(frame, 0.094, between ?? dark), COLOURS)).toEqual({ own: null, opponent: ENTEI });
});
