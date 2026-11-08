/**
 * What every store the document shares is built on: who to tell when it changes, and the hook a component reads it
 * through. `ReleaseStore`, `EventStore`, `PhoneStore` and the Battle tab's `Session` each extend `Store`, so a fix to
 * how a reader is redrawn is made once for all of them.
 */

import { useEffect, useState } from 'preact/hooks';

export class Store {
  /** How many times the store has emitted, so a reader that subscribes late can tell it missed one. */
  emits = 0;

  readonly #listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Tell everyone reading the store that it has changed. */
  emit(): void {
    this.emits++;

    for (const listener of this.#listeners) {
      listener();
    }
  }
}

/** `store`, with the calling component redrawn whenever it changes, or with `perFrame` once a frame at most. */
export function useStore<S extends Store>(store: S, { perFrame = false } = {}): S {
  const [, redraw] = useState(0);
  const rendered = store.emits;

  useEffect(() => {
    let pending: number | undefined;

    const update = perFrame
      ? () => {
          pending ??= requestAnimationFrame(() => {
            pending = undefined;
            redraw((count) => count + 1);
          });
        }
      : () => redraw((count) => count + 1);

    const unsubscribe = store.subscribe(update);

    // Preact runs this after paint, so an emit since the render reached no listener here.
    if (store.emits !== rendered) {
      update();
    }

    return () => {
      unsubscribe();

      if (pending !== undefined) {
        cancelAnimationFrame(pending);
      }
    };
  }, [store, perFrame]);

  return store;
}
