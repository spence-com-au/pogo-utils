/**
 * What the top bar's menus share: a click anywhere outside one, focus moving out of it, or Escape closes it, the
 * way any menu closes. One hook rather than a copy in each, so the notifications list, the settings panel and the
 * phone panel cannot come to close differently.
 *
 * Focus as well as the pointer, because the panels hang from the same corner of the bar. A pointer opening one
 * presses down outside the other first, which closes it; a keyboard press on a button fires its click with no
 * `pointerdown` at all, so without this, tabbing from the open bell to the gear and pressing Enter stacked both.
 */

import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';

/** Close the menu under `root` on a pointer down or focus outside it, or on Escape, for as long as it is open. */
export function useDismiss(open: boolean, close: () => void, root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const away = (event: Event) => {
      if (!(event.target instanceof Node && root.current?.contains(event.target))) {
        close();
      }
    };

    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };

    document.addEventListener('pointerdown', away);
    document.addEventListener('focusin', away);
    document.addEventListener('keydown', escape);

    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('focusin', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
}
