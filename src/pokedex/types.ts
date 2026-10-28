/**
 * A species' types, as the Pokédex entry shows them: the colour the game tints the entry with, and the round icon it
 * draws beside each type's name.
 */

import { POGO_ASSETS } from './icons.js';

/**
 * Each species' types by dex number, which `build:sprites` reads off the same form as its picture. A species missing
 * from it — the table not yet arrived, or Basculegion, which the game master holds no form for — simply has none shown.
 */
export type Types = Readonly<Record<string, readonly string[]>>;

/**
 * The game's own type colours, as its type icons and the bands on a Pokémon's detail screen paint them. Keyed by the
 * type's name as the game master spells it.
 */
export const TYPE_COLOURS: Readonly<Record<string, string>> = {
  Normal: '#a0a29f',
  Fire: '#fba54c',
  Water: '#539ddf',
  Grass: '#5fbd58',
  Electric: '#f2d94e',
  Ice: '#75d0c1',
  Fighting: '#d3425f',
  Poison: '#b763cf',
  Ground: '#da7c4d',
  Flying: '#a1bbec',
  Psychic: '#fa8581',
  Bug: '#92bc2c',
  Rock: '#c9bb8a',
  Ghost: '#5f6dbc',
  Dragon: '#0c69c8',
  Dark: '#595761',
  Steel: '#5695a3',
  Fairy: '#ee90e6',
};

/**
 * The colour a species without known types is drawn in: the page's own, as a reference to its token rather than a
 * value, so it follows the theme and the mode — blue, or gold in the shiny dex. Only ever handed to a custom property,
 * which is what lets a `var()` stand here.
 */
export const NO_TYPE = 'var(--go)';

export const colourOf = (type: string | undefined) => (type === undefined ? NO_TYPE : (TYPE_COLOURS[type] ?? NO_TYPE));

/** WCAG's relative luminance of a `#rrggbb` colour. */
function luminance(hex: string) {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;

    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The ink a type's name is written in on its own colour: white or black, whichever stands further from it. Black
 * rather than a softer near-black because Fighting sits mid-way, where white reaches 4.45:1 and even `#111` less.
 */
export const DARK_INK = '#000000';

export function inkOn(type: string) {
  const colour = TYPE_COLOURS[type];

  if (colour === undefined) {
    return '#fff';
  }

  const light = luminance(colour);

  return 1.05 / (light + 0.05) >= (light + 0.05) / (luminance(DARK_INK) + 0.05) ? '#fff' : DARK_INK;
}

/** The round icon `pogo_assets` holds for a type, which is what the battle tool reads a type off the screen by too. */
export const typeIcon = (type: string) => `${POGO_ASSETS}Images/Types/POKEMON_TYPE_${type.toUpperCase()}.png`;
