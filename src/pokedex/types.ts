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
 * The colour a species without known types is drawn in: the page's own teal, as a reference to its token rather than a
 * value, so it follows the theme. Only ever handed to a custom property, which is what lets a `var()` stand here.
 */
export const NO_TYPE = 'var(--go)';

export const colourOf = (type: string | undefined) => (type === undefined ? NO_TYPE : (TYPE_COLOURS[type] ?? NO_TYPE));

/** The round icon `pogo_assets` holds for a type, which is what the battle tool reads a type off the screen by too. */
export const typeIcon = (type: string) => `${POGO_ASSETS}Images/Types/POKEMON_TYPE_${type.toUpperCase()}.png`;
