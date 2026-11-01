/**
 * PGSharp's overlay — its star, the toolbar the star opens, its timer and whatever else it draws — against what the
 * battle reads and taps. Drawn over the game, it spoils whatever is under it: a pixel a reader samples reads PGSharp's,
 * a word OCR reads goes missing, and a tap goes to PGSharp. Where it lies is found before a run and between its battles,
 * and a run whose overlay covers any reader's `Area` is refused rather than left to fail as though the bot were wrong.
 *
 * PGSharp draws its overlay as views of its own inside the game's window, so `dumpsys window` lists none of it, but
 * `uiautomator dump` lists every one with its bounds: on a Pixel 4 XL, the star as `hl_floating_icon`, each of the open
 * toolbar's dozen icons as `hl_shortcut_menu_item_img` and the timer as `hl_cd`'s icon and text. Everything in the
 * window but the game's own surface is taken for the overlay, so a panel PGSharp adds is found as well as these.
 */

import { type Area, type Box, type Size } from './layout.mts';
import { areas as menuAreas } from './menus.mts';
import { areas as partyAreas } from './party.mts';
import { areas as selectionAreas } from './selection.mts';

/** One view of PGSharp's overlay, named as a refusal names it, and where it is. */
export interface Panel {
  name: string;
  box: Box;
}

/** PGSharp's names for the views it draws, by the end of their resource IDs, with what to do about each. */
const PANELS: readonly { id: string; name: string; clear: string }[] = [
  { id: 'hl_floating_icon', name: 'star', clear: 'drag it clear or hide the overlay' },
  { id: 'hl_shortcut_menu', name: 'toolbar', clear: 'collapse it to its star or hide the overlay' },
  { id: 'hl_cd', name: 'timer', clear: 'drag it clear or hide the overlay' },
];
const PANEL = { name: 'panel', clear: 'close it or hide the overlay' };

/** The game's own view, which everything else in its window is drawn over. */
const GAME = ':id/unitySurfaceView';
const GAME_PACKAGE = 'com.nianticlabs.pokemongo';

/** What `uiautomator dump` writes of the game's window with no overlay over it: the game's surface alone. */
export const GAME_ALONE =
  "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation=\"0\">" +
  '<node index="0" text="" resource-id="com.nianticlabs.pokemongo:id/unitySurfaceView" class="android.view.View" ' +
  'package="com.nianticlabs.pokemongo" content-desc="Game view" bounds="[0,0][1440,2956]" /></hierarchy>' +
  'UI hierchary dumped to: /dev/tty\n';

const attribute = (node: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(node)?.[1] ?? '';

/**
 * PGSharp's views in `dump`, what `uiautomator dump` wrote, on a screen the shape of `screen`: each view of the game's
 * window that holds no other, but for the game's surface. The dump's bounds are the display's pixels, and its root is
 * the display's width but the window's height, short of the navigation bar, so both are taken as fractions of the
 * width and the height worked out from `screen`, which is any picture of the whole display.
 */
export function panelsOf(dump: string, screen: Size): Panel[] {
  if (!dump.includes('<hierarchy')) {
    throw new Error(`PGSharp's overlay could not be looked for: uiautomator dump said ${JSON.stringify(dump.trim())}`);
  }

  const nodes = [...dump.matchAll(/<node [^>]*?(\/?)>/g)];
  const bounds = (node: string) => attribute(node, 'bounds').match(/\d+/g)?.map(Number) ?? [];
  const [, , width = 0] = nodes[0] ? bounds(nodes[0][0]) : [];
  const height = (width * screen.height) / screen.width;

  return nodes.flatMap(([node, leaf]) => {
    const id = attribute(node, 'resource-id');
    const [left = 0, top = 0, right = 0, bottom = 0] = bounds(node);

    if (!leaf || attribute(node, 'package') !== GAME_PACKAGE || id.endsWith(GAME) || right <= left || bottom <= top) {
      return [];
    }

    const { name } = PANELS.find((panel) => id.includes(`:id/${panel.id}`)) ?? PANEL;

    return [{ name, box: [left / width, top / height, right / width, bottom / height] as const }];
  });
}

/** Every reader's areas on a screen the shape of `screen`. */
export const areas = (screen: Size): Area[] => [...menuAreas(screen), ...partyAreas(screen), ...selectionAreas(screen)];

const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * The areas `panels` cover, by the panel covering them: an area is covered where fewer of its boxes are clear of every
 * panel than it needs, and is put down to the panels over its boxes.
 */
export function covered(panels: readonly Panel[], all: readonly Area[]): Map<string, string[]> {
  const by = new Map<string, string[]>();

  for (const area of all) {
    const over = area.boxes.map((box) => panels.filter((panel) => overlaps(panel.box, box)));

    if (over.filter((on) => on.length === 0).length < (area.need ?? area.boxes.length)) {
      for (const name of new Set(over.flat().map((panel) => panel.name))) {
        by.set(name, [...(by.get(name) ?? []), area.name]);
      }
    }
  }

  return by;
}

const list = (names: readonly string[]) =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/** Thrown where PGSharp's overlay covers what a run reads or taps, saying what covers what and how to clear it. */
export class Covered extends Error {
  constructor(by: ReadonlyMap<string, readonly string[]>) {
    super(
      [...by]
        .map(([name, names]) => {
          const { clear } = PANELS.find((panel) => panel.name === name) ?? PANEL;

          return `PGSharp's ${name} covers ${list([...new Set(names)])}: ${clear}.`;
        })
        .join(' '),
    );
  }
}

/**
 * Throws `Covered` where `dump`'s overlay covers any reader's area on a screen the shape of `screen`, and otherwise
 * answers what of PGSharp's it found, `star, timer`, or `none`.
 */
export function checkOverlay(dump: string, screen: Size): string {
  const panels = panelsOf(dump, screen);
  const by = covered(panels, areas(screen));

  if (by.size > 0) {
    throw new Covered(by);
  }

  return [...new Set(panels.map(({ name }) => name))].join(', ') || 'none';
}
