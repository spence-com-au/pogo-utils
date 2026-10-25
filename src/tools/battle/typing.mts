/**
 * Each side's types, out of the icons the game draws above its panel in a battle: one round icon for each type, ours
 * from the left edge and the opponent's from the right. What the HUD names is only the species, and these are what tell
 * its forms apart — a Galarian Moltres's Dark and Flying beside a Kantonian one's Fire and Flying.
 *
 * An icon is the game's own icon for the type, a disc in the type's colour with a white emblem on it, drawn small: 14
 * pixels across a 360-wide frame. So each is told by the colour of its disc, the emblem aside, against the colour of
 * each type's icon, and told from the sky behind an empty place by the emblem, which the sky has none of.
 *
 * Measured on the 36 committed frames that read as a battle, off a Pixel 4 XL and a Pixel 8 Pro, by day and at night:
 * every icon's disc within 28 of its type's colour, Electric's being the furthest, and at least 15 nearer it than the
 * next type's, Water's 24 against Flying's 39 being the closest. Its emblem was 6% to 23% of the disc.
 */

import { rgb, type Image } from '../inventory/png.mts';
import { type Colour } from './minigame.mts';
import { down, TOP } from './layout.mts';

/**
 * Where each icon's centre sits across the screen: ours at 0.042 and 0.094, a single type at the first; the opponent's
 * at 0.902 and 0.958, a single type at the last. Each at 0.098 widths below the top, with a radius of 0.019.
 */
const PLACES = { own: [0.042, 0.094], opponent: [0.902, 0.958] } as const;
const ICON = { y: 0.098, radius: 0.019 } as const;

/** A pixel this light in every channel is the emblem's rather than the disc's. */
const WHITE = 200;

/**
 * How much of a disc its emblem covers: 6% to 23% of every icon measured. An empty place showed under 2% of open sky,
 * or over 85% of cloud.
 */
const EMBLEM = { least: 0.04, most: 0.5 } as const;

/**
 * How far a disc's colour may be from its type's, summed as a distance over the channels, and how far from every type
 * an empty place's has to be. Between the two is neither, and leaves the side unread rather than guessed: an icon
 * half hidden by a type it is not would otherwise read as the other's typing. Sky with something in it to pass for an
 * emblem was 52 from the nearest type, Flying, on the committed frames.
 */
const NEAR = 35;
const FAR = 50;

/**
 * The colour of a type's disc out of the game's icon for it, the emblem aside: each channel's median, the disc being a
 * gradient that its commonest colour, which `typeColour` takes, sits at the dark end of. Psychic's commonest is
 * 247/111/117 and its median 251/136/134, where the HUD draws it at 252/148/144.
 */
export function iconColour(icon: Image): Colour {
  const channels: [number[], number[], number[]] = [[], [], []];

  for (let i = 0; i < icon.data.length; i += 4) {
    const colour = [icon.data[i] ?? 0, icon.data[i + 1] ?? 0, icon.data[i + 2] ?? 0];

    if ((icon.data[i + 3] ?? 0) >= 250 && Math.min(...colour) <= WHITE) {
      colour.forEach((level, c) => channels[c]?.push(level));
    }
  }

  return channels.map((levels) => levels.sort((a, b) => a - b)[levels.length >> 1] ?? 0) as unknown as Colour;
}

const distance = (a: Colour, b: Colour) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The type an icon at `x` shows, null where the place is empty, or undefined where it is neither clearly. */
function iconAt(image: Image, x: number, colours: Readonly<Record<string, Colour>>): string | null | undefined {
  const [cx, cy, r] = [x * image.width, down(ICON.y, TOP, image) * image.height, ICON.radius * image.width];
  const channels: [number[], number[], number[]] = [[], [], []];
  let [emblem, n] = [0, 0];

  for (let y = Math.round(cy - r); y <= cy + r; y++) {
    for (let px = Math.round(cx - r); px <= cx + r; px++) {
      if ((px - cx) ** 2 + (y - cy) ** 2 > r * r) {
        continue;
      }

      const colour = rgb(image, px, y);
      n++;

      if (Math.min(...colour) > WHITE) {
        emblem++;
      } else {
        colour.forEach((level, c) => channels[c]?.push(level));
      }
    }
  }

  const share = emblem / Math.max(n, 1);
  const disc = channels.map((levels) => levels.sort((a, b) => a - b)[levels.length >> 1] ?? 0) as unknown as Colour;
  const [nearest] = Object.entries(colours)
    .map(([type, colour]) => ({ type, by: distance(disc, colour) }))
    .sort((a, b) => a.by - b.by);

  if (!nearest || share < EMBLEM.least || share > EMBLEM.most || nearest.by > FAR) {
    return null;
  }

  return nearest.by <= NEAR ? nearest.type : undefined;
}

/**
 * Each side's types, in the order the icons are drawn, or null for a side not read: where the place a single type
 * takes is empty, as wherever the HUD is not up, or either place is neither clearly an icon nor clearly empty.
 * `colours` is each type's `iconColour`, by name.
 */
export function readTypes(
  image: Image,
  colours: Readonly<Record<string, Colour>>,
): { own: string[] | null; opponent: string[] | null } {
  const side = (places: readonly number[], single: number) => {
    const icons = places.map((x) => iconAt(image, x, colours));

    if (icons.includes(undefined) || icons[single] === null) {
      return null;
    }

    return icons.filter((type) => typeof type === 'string');
  };

  return { own: side(PLACES.own, 0), opponent: side(PLACES.opponent, 1) };
}
