/**
 * Where a species' picture comes from, and the name of the icon each species asks for. Everything that resolves,
 * downloads or fetches an icon reads the directory from here, so none of them can disagree about where icons live.
 */

/**
 * Where `pogo_assets` keeps the form icons. The 256×256 renders rather than the smaller ones beside them, because
 * `Images/Pokemon/Addressable Assets` stopped being filled — last commit 2025-10-05 against 2026-09-25 — and the 270
 * files it is missing include every form of Mimikyu, Cramorant and Squawkabilly. Nothing distinguishes a stale listing
 * from a current one, both answering `truncated: false`, so those forms simply went unnarrowed. A signature is a hue
 * histogram normalised by its own pixel count, so the larger render scores the same.
 */
export const ICON_DIR = 'Images/Pokemon - 256x256/Addressable Assets';

/** `pogo_assets` itself, which the form icons and the type icons the battle tool reads are both under. */
export const POGO_ASSETS = 'https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/';

export const ICON_BASE = `${POGO_ASSETS}${encodeURI(ICON_DIR)}/`;

/** The file `pogo_assets` holds a type's round icon in, which the battle tool caches under the same name. */
export const typeIconFile = (type: string) => `POKEMON_TYPE_${type.toUpperCase()}.png`;

/** Where a type's round icon is fetched from: by the Pokédex's type badges, and by the battle tool reading the HUD. */
export const typeIcon = (type: string) => `${POGO_ASSETS}Images/Types/${typeIconFile(type)}`;

/** PokeAPI's pixel sprites, which cover the national dex by number with a shiny beside each. */
const PIXEL_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';

/**
 * The species whose icon the dex number cannot derive, keyed by dex number as a string because JSON has no other kind
 * of key. A name is the icon to ask for instead of the derived one; `null` is a species the game has no artwork for.
 */
export type Icons = Readonly<Record<string, string | null>>;

/** The icon name the dex number alone derives, which is the right one for most of the dex. */
export const ordinaryIcon = (dex: number) => `pm${dex}.icon.png`;

/** The shiny beside a plain icon: the same name with `.s` ahead of the suffix, as the game's own assets are named. */
export const shinyIcon = (icon: string) => icon.replace(/[.]icon[.]png$/, '.s.icon.png');

/**
 * The picture to show for a species: the game's own render where there is one, and PokeAPI's pixel sprite where there
 * is not. `icons` is empty until the vended file arrives, which leaves the derived name — right for most of the dex,
 * and a species it is wrong for keeps its number until the file lands.
 */
export function spriteOf(dex: number, shiny: boolean, icons: Icons): string {
  const icon = dex in icons ? icons[dex] : ordinaryIcon(dex);

  if (icon === null || icon === undefined) {
    return `${PIXEL_BASE}${shiny ? 'shiny/' : ''}${dex}.png`;
  }

  return ICON_BASE + (shiny ? shinyIcon(icon) : icon);
}
