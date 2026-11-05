/**
 * A chunk reached through `import()`, fetched from the build this document was loaded from.
 *
 * Every chunk is named for a hash of its contents, and GitHub Pages serves only the latest build, so a deploy takes the
 * old names away from a tab already open on them: the next `import()` that tab makes asks for a file that is no longer
 * there. Nothing short of a reload runs the `main.js` that names the new ones, so a failed import reloads the page
 * rather than tell a reader that a feature they did not touch is broken. The browsers word that failure three different
 * ways and Chrome alone names the file, so it is not told apart from any other: what stops a chunk that fails in the
 * new build too from reloading the page on every try is that the document the reload brings reports it instead.
 */

import { KEY_PREFIX } from './storage-namespace.js';

/** Set across the reload, for the document it brings to know it is that reload. */
const RELOADED = `${KEY_PREFIX}chunks:reloaded`;

/**
 * Whether this document is a reload a failed import asked for. Read once as it starts and cleared, so that the document
 * after it, reloaded by the reader or opened in a new tab, gets another try. This one reports every failure for as long
 * as it stays open, a later deploy's included. Where storage is blocked `sessionStorage` throws rather than answer, and
 * a reload that could not be marked is never made.
 */
const reloaded = (() => {
  try {
    const was = sessionStorage.getItem(RELOADED) !== null;

    sessionStorage.removeItem(RELOADED);

    return was;
  } catch {
    return true;
  }
})();

export async function loadChunk<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (e) {
    // Offline, a reload would trade the page for the browser's own error, and fetch nothing newer for it.
    if (reloaded || !navigator.onLine) {
      throw e;
    }

    try {
      sessionStorage.setItem(RELOADED, '1');
    } catch {
      throw e;
    }

    // A plain reload revalidates only the document, and the entries it names are not named for their contents: Pages
    // serves them with `max-age=600`, so for ten minutes after this tab fetched them the reload would run the same
    // `main.js` again, asking for the same chunks. Fetched past the cache first, the reload finds the new ones there.
    const entries = [
      ...[...document.querySelectorAll<HTMLScriptElement>('script[src]')].map((script) => script.src),
      ...[...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((link) => link.href),
    ];

    await Promise.allSettled(entries.map((url) => fetch(url, { cache: 'reload' })));
    location.reload();

    // Never settled: the page is going, and a caller told of a failure would only say so to nobody.
    return new Promise(() => {});
  }
}
