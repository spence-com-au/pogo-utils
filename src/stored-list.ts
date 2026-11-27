/**
 * A list kept in `localStorage` as JSON, read and written by the pages that keep one so the rule for untrusted
 * storage lives in one place.
 */

/**
 * A list as storage holds it. Storage is a channel anything can write to — an import from a backup someone edited by
 * hand among them — so whatever `keep` refuses is dropped rather than trusted, and storage that will not answer reads
 * as an empty list.
 */
export function load<T>(key: string, keep: (value: unknown) => value is T): T[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');

    return Array.isArray(stored) ? stored.filter(keep) : [];
  } catch {
    return [];
  }
}

/**
 * Write a list back, answering whether it was written. Not swallowed as `event-prefs.ts` swallows a refusal: a caller
 * whose choice is gone at the next load, or is read back from storage by something else, has to know it did not land.
 */
export function store(key: string, list: readonly unknown[]): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(list));

    return true;
  } catch {
    return false;
  }
}
