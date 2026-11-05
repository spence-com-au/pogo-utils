/**
 * The DOM helpers every page needs: one to build an element, one to find one, one to put text on the clipboard and one
 * to hand a file over. An id matching nothing, or matching a tag it did not used to, is a broken page rather than a
 * case to handle, so `byId` throws where the disagreement is instead of letting a `null` travel until something further
 * along trips over it.
 */

/**
 * Copy text to the clipboard, falling back to `execCommand` for insecure contexts (e.g. served over plain HTTP, where
 * the async Clipboard API is unavailable). Returns a promise that resolves to true on success.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);

      return true;
    }
  } catch {
    /* fall through to legacy path */
  }

  try {
    const ta = document.createElement('textarea');

    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();

    const ok = document.execCommand('copy');

    document.body.removeChild(ta);

    return ok;
  } catch {
    return false;
  }
}

/**
 * Hand text or bytes over as a download, a synthetic click on an `<a download>` being the only way a page can name a
 * file. Bytes must sit over an `ArrayBuffer`, since a view of a `SharedArrayBuffer` is no `BlobPart`.
 */
export function download(part: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([part], { type }));
  const a = document.createElement('a');

  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * An element, optionally with a class and some text. An empty `className` is skipped where an empty `text` is not, so
 * `el('span', null, '')` is a classless empty span rather than one reading `null`.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string | null,
  text?: string | null,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (className) {
    node.className = className;
  }

  if (text != null) {
    node.textContent = text;
  }

  return node;
}

/**
 * The element with this id, as the class asked for — `HTMLElement` where none is. Name a class only where the code
 * depends on one, which is what the argument says.
 *
 * Two overloads rather than one type parameter defaulting to `HTMLElement`, because a type parameter appearing only in
 * the return position is inferred from the caller's own annotation: with the default, `byId('grid')` answers
 * `HTMLInputElement` to anyone who asks for one and the check is worth nothing.
 */
export function byId(id: string): HTMLElement;
export function byId<T extends HTMLElement>(id: string, type: abstract new (...args: never) => T): T;

export function byId(id: string, type: abstract new (...args: never) => HTMLElement = HTMLElement): HTMLElement {
  const node = document.getElementById(id);

  // Read before the check rather than inside it. `type` is erased to `HTMLElement` in this signature, so the checker
  // subtracts the whole of it and types `node` as `never` below — where at run time a `<span>` arrives there whenever a
  // narrower class was asked for. One `instanceof` covers both failures, since `null` is an instance of nothing.
  const found = node === null ? 'nothing' : `<${node.localName}>`;

  if (!(node instanceof type)) {
    throw new Error(`#${id}: expected ${type.name}, found ${found}`);
  }

  return node;
}
