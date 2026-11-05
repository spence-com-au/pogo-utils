/**
 * A vended release, held where every tab can reach it, and the one version this browser has acknowledged. One store per
 * app the site follows: `pgsharp/release-store.ts` and `coin-bag/release-store.ts` each make theirs from this.
 *
 * Two things read a release: the Integrations page names it on its download button, and the top bar's notifications
 * report it when it is newer than what the reader last cleared. One load between them, so a reader opening Integrations
 * fetches the file once rather than once per reader of it.
 *
 * The acknowledged version is stored under the store's own key, and the design turns on the same distinction
 * `event-prefs.ts` draws: absent is not the same as a version. A key never written is a first visit, and the release
 * found then becomes the baseline rather than news — the reasoning `settleSeen` applies to the events. After that, any
 * other version is a notice until it is cleared, whether the app moved forward or (rarely) back.
 *
 * Nothing here is on a timer either. The file is read once per document, and a new release reaches a reader the next
 * time they load the page after the Vend workflow commits it.
 */

import { useEffect, useState } from 'preact/hooks';

import { said } from './errors.js';
import type { Release, VendedRelease } from './release.js';

/**
 * The release a vend script last wrote to `path`, its URL put back through the same `check` the vend did, so whatever
 * links to it links to where that app is served or to nothing read here. A miss of any kind is null rather than a
 * failure: the button falls back to the app's unversioned link, and the notifications report nothing.
 */
export async function fetchVendedRelease(path: string, check: (url: string) => Release): Promise<VendedRelease | null> {
  try {
    const res = await fetch(path, { cache: 'default' });

    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }

    const raw: Partial<VendedRelease> = await res.json();

    if (typeof raw.url !== 'string') {
      throw new Error('no url');
    }

    // Checked here rather than where it is formatted, which would throw on an invalid date mid-render.
    if (typeof raw.firstSeen !== 'string' || Number.isNaN(Date.parse(raw.firstSeen))) {
      throw new Error('no firstSeen');
    }

    return { ...check(raw.url), firstSeen: raw.firstSeen };
  } catch (e) {
    console.error(`${path}: ${said(e)} — no version to show`);
    return null;
  }
}

/**
 * The release, and who to tell when it lands or is acknowledged. A class rather than module state so a test can start
 * from nothing, and so each app gets one of its own.
 */
export class ReleaseStore {
  /** Null until a load lands, and after one that found nothing it could trust. */
  release: VendedRelease | null = null;

  /** How many times the store has emitted, so a reader that subscribes late can tell it missed one. */
  emits = 0;

  /**
   * Under `KEY_PREFIX`, so `src/backup.ts`'s sweep carries it. Stored as a JSON string rather than the bare version,
   * since a backup carries values it can parse and leaves out the rest.
   */
  readonly acknowledgedKey: string;

  readonly #fetchRelease: () => Promise<VendedRelease | null>;
  readonly #listeners = new Set<() => void>();
  #loaded: Promise<void> | null = null;

  constructor(acknowledgedKey: string, fetch: () => Promise<VendedRelease | null>) {
    this.acknowledgedKey = acknowledgedKey;
    this.#fetchRelease = fetch;
  }

  /** The file once per document, whichever reader asks first; the rest are handed the same load. */
  ensureLoaded(): Promise<void> {
    return (this.#loaded ??= this.#load());
  }

  /**
   * The release, while it is one the reader has not acknowledged. Null before it loads, on a first visit (which the
   * load has already settled into the baseline) and once it has been cleared.
   *
   * Null too with no version stored at all, which after a load means storage that would not take the baseline. That
   * reader cannot clear a notice either, so showing one would show it on every visit for good.
   */
  unacknowledged(): VendedRelease | null {
    const release = this.release;
    const acknowledged = this.#readAcknowledged();

    return release !== null && acknowledged !== null && acknowledged !== release.version ? release : null;
  }

  /** Acknowledge the release on offer, which clears its notice until the next version. */
  acknowledge() {
    if (this.release !== null) {
      this.#writeAcknowledged(this.release.version);
      this.emit();
    }
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  emit() {
    this.emits++;

    for (const listener of this.#listeners) {
      listener();
    }
  }

  async #load() {
    const release = await this.#fetchRelease();

    // A first visit: what is current now is the baseline, not news. Settled only from a release that loaded, so a
    // failed fetch cannot leave the key unset in a way that later reads as anything but a first visit.
    if (release !== null && this.#readAcknowledged() === null) {
      this.#writeAcknowledged(release.version);
    }

    this.release = release;
    this.emit();
  }

  /**
   * The stored version, or null where none is stored or storage will not answer. Read through on every call rather
   * than cached, so an import that has just written the key is what the next render sees without being told.
   */
  #readAcknowledged(): string | null {
    try {
      const stored = localStorage.getItem(this.acknowledgedKey);
      const value: unknown = stored === null ? null : JSON.parse(stored);

      return typeof value === 'string' ? value : null;
    } catch {
      return null;
    }
  }

  /**
   * Store the version. A refusal is swallowed, as `event-prefs.ts` swallows one: the notice then comes back on the next
   * load, which is the cost of a store that cannot be written rather than something to fail the page over.
   */
  #writeAcknowledged(version: string) {
    try {
      localStorage.setItem(this.acknowledgedKey, JSON.stringify(version));
    } catch {
      // See above.
    }
  }
}

/** `store`, with the calling component redrawn whenever it changes. */
export function useReleaseStore(store: ReleaseStore) {
  const [, redraw] = useState(0);
  const rendered = store.emits;

  useEffect(() => {
    const update = () => redraw((count) => count + 1);
    const unsubscribe = store.subscribe(update);

    // Preact runs this after paint, so an emit since the render reached no listener here.
    if (store.emits !== rendered) {
      update();
    }

    return unsubscribe;
  }, [store]);

  return store;
}
