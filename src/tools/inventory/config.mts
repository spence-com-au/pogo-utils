/**
 * Where the phone is tapped and swiped, and how long each animation is given, for everything that drives storage:
 * `pnpm inventory`, which takes a `--config` file over `DEFAULTS`, and the Search page, which has no file to take.
 */

import { launchable } from '../../core/adb.mts';

export type Point = [number, number];

export interface Config {
  package: string;

  /**
   * The Android user whose copy of the game to drive: 0 for the personal profile, 10 for a work profile where there is
   * one. Left out, it is the user of the game in front, or the only one it is installed for; a phone with a copy in
   * each profile and neither in front is refused rather than guessed at, the two being signed in to different trainers.
   */
  user?: number;
  swipes: {
    /** From one Pokémon to the next. */
    next: [Point, Point];
  };

  /** Where to tap, as fractions of the screen's width and height. Used where OCR cannot find the control by name. */
  taps: {
    /** The Poké Ball on the map that opens the main menu. */
    mainMenu: Point;

    /**
     * The Pokémon button in that menu. Tapped blind rather than found by its label, because that label sits above the
     * icon rather than inside it and tapping it dismisses the menu.
     */
    pokemonButton: Point;

    /** The search box at the top of storage. */
    search: Point;

    /** The close button at the foot of the detail screen, which a Pokédex entry and its grid have in the same place. */
    closeDetail: Point;

    /** The Pokédex button in the main menu, tapped blind for the reason the Pokémon button is. */
    pokedexButton: Point;
  };

  /** How long to let each animation settle before the next screenshot, in milliseconds. */
  waits: {
    launch: number;
    tap: number;
    swipe: number;
    scroll: number;
    menu: number;
    search: number;
  };
}

export const DEFAULTS: Config = {
  package: 'com.nianticlabs.pokemongo',
  taps: {
    mainMenu: [0.5, 0.91],
    pokemonButton: [0.25, 0.82],
    search: [0.5, 0.155],
    closeDetail: [0.5, 0.93],
    pokedexButton: [0.25, 0.6],
  },
  swipes: {
    next: [
      [0.85, 0.3],
      [0.15, 0.3],
    ],
  },
  waits: { launch: 30000, tap: 900, swipe: 1100, scroll: 800, menu: 800, search: 1500 },
};

/** Whether `value` names an Android user, which is a whole number: 0, 10, 11 and on. */
const isUser = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

/**
 * `DEFAULTS` with a JSON file laid over it one level deep, so a file can change one tap and restate nothing else. A
 * package that is not a package name is refused here, before the phone is driven, rather than by `launch` partway in.
 */
export function configWith(overrides: Partial<Record<keyof Config, object | string | number>>): Config {
  if (typeof overrides.package === 'string' && !launchable(overrides.package)) {
    throw new Error(`refusing "package" ${JSON.stringify(overrides.package)}: it is not an Android package name`);
  }

  if (overrides.user !== undefined && !isUser(overrides.user)) {
    throw new Error(`refusing "user" ${JSON.stringify(overrides.user)}: an Android user is a whole number`);
  }

  return {
    package: typeof overrides.package === 'string' ? overrides.package : DEFAULTS.package,
    user: isUser(overrides.user) ? overrides.user : DEFAULTS.user,
    taps: { ...DEFAULTS.taps, ...(overrides.taps as Partial<Config['taps']>) },
    swipes: { ...DEFAULTS.swipes, ...(overrides.swipes as Partial<Config['swipes']>) },
    waits: { ...DEFAULTS.waits, ...(overrides.waits as Partial<Config['waits']>) },
  };
}
