/**
 * The Pokémon picture the Pokédex and the Search page both draw, hotlinked from `pogo_assets`.
 */

import { useState } from 'preact/hooks';

/**
 * A sprite that says nothing when it fails. What a picture sits in — a Pokédex tile's number, a Search card's name —
 * says which Pokémon it is, so a hotlinked picture that does not arrive, offline or blocked, should leave an empty slot
 * rather than the browser's broken-image glyph. `.sprite.missing` is in `chrome.css`, which every page loads.
 *
 * What failed is remembered as the URL rather than as a boolean, because a fresh `src` deserves a fresh chance to load
 * and a flag would deny it one. `key` on the `<img>` cannot do that job: it replaces the child node while this
 * component's own instance — same type, same position — is reused, so a hook on it survives. The icon table landing is
 * exactly that case, changing the `src` of the 113 species it holds a row for after the derived name has 404d; and a
 * 404 that resolves late calls back into a live component whichever way the two race, so only comparing against the
 * `src` in hand can tell a stale failure from this one's.
 */
export function Sprite({ src, size, eager }: { src: string; size: number; eager?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);

  return (
    <img
      class={failed === src ? 'sprite missing' : 'sprite'}
      src={src}
      alt=""
      width={size}
      height={size}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(src)}
    />
  );
}
