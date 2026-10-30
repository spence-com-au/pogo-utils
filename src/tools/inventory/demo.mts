/**
 * The demo phone's side of ADB: a `Transport` over recordings rather than a phone, which the Settings menu holds in
 * `src/inventory/demo.ts` for a reader with no phone to see what the phone tabs do. Here rather than there so a test
 * can drive it under Node, through the same `Device` and walk to storage the pages drive it through.
 *
 * It answers the game's side of that walk rather than a script of it: a tap on a detail screen leaves it for storage,
 * a term typed is a search, and the screenshot after Enter shows its result — after which the next screenshot is a
 * detail screen again, the next in turn, as though the reader had opened another Pokémon. So the Inventory page reads
 * a different Pokémon at every press, and the Search page finds storage from wherever the last read left the phone.
 */

import { DEMO_DETAILS, DEMO_SEARCHED, DEMO_STORAGE } from '../../generated.ts';
import { KEY, type Transport } from './adb.mts';
import { DEFAULTS } from './config.mts';
import { decodePng, encodePng, screenIn } from './png.mts';

/** `read` answers a recording's bytes by its path in the repository, which is where the site publishes it too. */
export function demoTransport(read: (path: string) => Promise<Uint8Array>): Transport {
  const screens = new Map<string, Promise<Uint8Array>>();
  let next = 0;

  /** Which storage screen is showing, or null where a detail screen is. */
  let storage: string | null = null;
  let entered = false;

  /**
   * A recording as the phone would hand it over: one screen, so a detail capture's stitch is cropped to the
   * `Viewport` it carries. Kept once made, and a failure not kept, so the next screenshot tries again.
   */
  const screenOf = (path: string) => {
    let screen = screens.get(path);

    if (screen === undefined) {
      screen = read(path).then((bytes) => encodePng(screenIn(decodePng(bytes))));
      screen.catch(() => screens.delete(path));
      screens.set(path, screen);
    }

    return screen;
  };

  return {
    state: () => Promise.resolve('device'),

    shell: (args) => {
      const [command, action, ...rest] = args;

      if (command === 'dumpsys') {
        return Promise.resolve(new TextEncoder().encode(`mCurrentFocus=Window{0 u0 ${DEFAULTS.package}/.Main}`));
      }

      if (command === 'input') {
        if (action === 'tap' && storage === null) {
          storage = DEMO_STORAGE;
        } else if (action === 'text') {
          storage = DEMO_SEARCHED;
        } else if (action === 'keyevent' && rest.includes(String(KEY.ENTER))) {
          entered = true;
        }
      }

      return Promise.resolve(new Uint8Array());
    },

    screencap: () => {
      const path = storage ?? (DEMO_DETAILS[next++ % DEMO_DETAILS.length] as string);

      if (entered) {
        storage = null;
        entered = false;
      }

      return screenOf(path);
    },
  };
}
