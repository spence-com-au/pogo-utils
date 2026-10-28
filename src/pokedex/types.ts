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
 * The game's own type colours, as its type icons and the bands on a Pokémon's detail screen paint them, each beside the
 * ink its name is written in on it: white or black, whichever stands further from the colour. Black rather than a
 * softer near-black, because Fighting sits mid-way, where white reaches 4.45:1 and even `#111` less. Written out
 * rather than worked out in the page, since both halves are constants; `types.test.ts` holds the arithmetic that
 * checks every ink clears 4.5:1. Keyed by the type's name as the game master spells it.
 */
export const TYPE_PAINT: Readonly<Record<string, { colour: string; ink: '#ffffff' | '#000000' }>> = {
  Normal: { colour: '#a0a29f', ink: '#000000' },
  Fire: { colour: '#fba54c', ink: '#000000' },
  Water: { colour: '#539ddf', ink: '#000000' },
  Grass: { colour: '#5fbd58', ink: '#000000' },
  Electric: { colour: '#f2d94e', ink: '#000000' },
  Ice: { colour: '#75d0c1', ink: '#000000' },
  Fighting: { colour: '#d3425f', ink: '#000000' },
  Poison: { colour: '#b763cf', ink: '#000000' },
  Ground: { colour: '#da7c4d', ink: '#000000' },
  Flying: { colour: '#a1bbec', ink: '#000000' },
  Psychic: { colour: '#fa8581', ink: '#000000' },
  Bug: { colour: '#92bc2c', ink: '#000000' },
  Rock: { colour: '#c9bb8a', ink: '#000000' },
  Ghost: { colour: '#5f6dbc', ink: '#ffffff' },
  Dragon: { colour: '#0c69c8', ink: '#ffffff' },
  Dark: { colour: '#595761', ink: '#ffffff' },
  Steel: { colour: '#5695a3', ink: '#000000' },
  Fairy: { colour: '#ee90e6', ink: '#000000' },
};

/**
 * The colour a species without known types is drawn in: the page's own, as a reference to its token rather than a
 * value, so it follows the theme and the mode — blue, or gold in the shiny dex. Only ever handed to a custom property,
 * which is what lets a `var()` stand here.
 */
export const NO_TYPE = 'var(--go)';

export const colourOf = (type: string | undefined) =>
  type === undefined ? NO_TYPE : (TYPE_PAINT[type]?.colour ?? NO_TYPE);

/** The ink a type's name is written in on its own colour, and white for a type the table does not hold. */
export const inkOn = (type: string) => TYPE_PAINT[type]?.ink ?? '#ffffff';

/** The round icon `pogo_assets` holds for a type, which is what the battle tool reads a type off the screen by too. */
export const typeIcon = (type: string) => `${POGO_ASSETS}Images/Types/POKEMON_TYPE_${type.toUpperCase()}.png`;
