/**
 * A phone for the suite that is a run of screens, the first being the one open: a swipe up shows the next, as a panel
 * scrolling down does, and a swipe down shows the first again. It records each swipe as which way it went and how far,
 * and answers every other shell command with nothing.
 */

import { Device } from '../../core/adb.mts';
import { encodePng, type Image } from '../../core/png.mts';

export function scrolling(screens: readonly Image[]) {
  const swipes: { way: 'up' | 'down'; by: number }[] = [];
  const pngs = screens.map((screen) => encodePng(screen));
  let at = 0;

  const device = new Device({
    state: async () => 'device',
    shell: async ([, kind, ...numbers]) => {
      const [, y1 = 0, , y2 = 0] = numbers.map(Number);

      if (kind === 'swipe') {
        const way = y2 < y1 ? 'up' : 'down';

        swipes.push({ way, by: Math.abs(y2 - y1) });
        at = way === 'up' ? Math.min(at + 1, pngs.length - 1) : 0;
      }

      return new Uint8Array();
    },
    screencap: async () => {
      const png = pngs[at];

      if (png === undefined) {
        throw new Error('the phone has no screens');
      }

      return png;
    },
  });

  return { device, swipes };
}
