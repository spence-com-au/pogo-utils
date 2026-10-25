/**
 * Each side's types read off every committed frame that shows a battle, against what each side is: the species the
 * frame's HUD names, or for ours, often nicknamed, the one its moves and the icons themselves show. Among them are the
 * empty places that set the thresholds: open sky, cloud, a night sky as blue as Ghost, and sky light enough to pass
 * for an emblem.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { type GameData } from '../inventory/game-master.mts';
import { decodePng } from '../inventory/png.mts';
import { iconColour, readTypes } from './typing.mts';

const DATA = JSON.parse(
  readFileSync(new URL('../inventory/fixtures/game-master.json', import.meta.url), 'utf8'),
) as GameData;

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
  ['battle-minigame-kyogre-great', KYOGRE, ENTEI],
  ['battle-minigame-kyogre-excellent', KYOGRE, ENTEI],
  ['battle-shield-blocked', KYOGRE, ENTEI],
  ['battle-deoxys', MEWTWO, ['Dark', 'Ice']],
  ['battle-minigame-mewtwo', MEWTWO, ENTEI],
  ['battle-minigame-mewtwo-over', MEWTWO, ENTEI],
  ['battle-night', MEWTWO, ENTEI],
  ['battle-crunch-entei', TYRANITAR, ENTEI],
  ['battle-crunch-salamence', TYRANITAR, SALAMENCE],
  ['battle-minigame-ready', TYRANITAR, ENTEI],
  ['battle-minigame-tyranitar', TYRANITAR, ENTEI],
  ['charged-avalanche', MAMOSWINE, EMPOLEON],
  ['battle-banner', MAMOSWINE, EMPOLEON],
  ['battle-shield-going-up', MAMOSWINE, EMPOLEON],
  ['battle-minigame-mamoswine', MAMOSWINE, GLACEON],
  ['charged-shadow-sneak', GIRATINA, MAMOSWINE],
  ['battle-minigame-giratina', GIRATINA, EMPOLEON],
  ['battle-latias', LATIAS, GLACEON],
  ['battle-countdown', LATIAS, GLACEON],
  ['battle-minigame-swampert', ['Water', 'Ground'], QUAQUAVAL],
  ['battle-banner-swampert', ['Water', 'Ground'], QUAQUAVAL],
  ['battle-banner-quaquaval', CHARIZARD, QUAQUAVAL],
  ['battle-one-shield', CHARIZARD, QUAQUAVAL],
  ['battle-shields-spent', CHARIZARD, QUAQUAVAL],
  ['battle-charizard-magmar', CHARIZARD, ['Fire']],

  // An Alolan Golem, Rock and Electric, where a Kantonian one is Rock and Ground.
  ['battle-gengar-label-short', ['Ghost', 'Poison'], ['Rock', 'Electric']],

  // A Galarian Moltres of ours, and a Typhlosion that is not Hisuian, the night sky where its Ghost would be.
  ['battle-pixel8-moltres-body', GALARIAN_MOLTRES, ['Fire']],
  ['battle-pixel8-moltres-wing', GALARIAN_MOLTRES, ['Fire']],
  ['battle-banner-pixel8-groudon', GALARIAN_MOLTRES, ['Ground']],
  ['battle-pixel8', ['Normal'], COMBUSKEN],
  ['charged-pixel8', ['Normal'], COMBUSKEN],
  ['battle-minigame-pixel8-dark', ['Normal'], COMBUSKEN],
])('%s: %j against %j', (name, own, opponent) => {
  expect(readTypes(png(name), COLOURS)).toEqual({ own, opponent });
});

test('a screen without the HUD reads neither side', () => {
  for (const name of ['shield-glaceon', 'shield-sneasel', 'other-win', 'other-vs-fade', 'menu-main']) {
    expect(readTypes(png(name), COLOURS), name).toEqual({ own: null, opponent: null });
  }
});
