/**
 * A backup of what this app has stored in `localStorage`, read and written as one file. A transport over the
 * `pogo-utils:` namespace and nothing more: it narrows no value, because what a value may be is known to whoever owns
 * the key rather than here — `loadPrefs` already treats storage as a channel that can hand it anything, so a file with
 * a right key name and a wrong value lands in storage and is dropped on the next read, which was handled and tested
 * before this module existed.
 *
 * The namespace is the allowlist. One list decides both what an export carries and what an import writes, rather than
 * two that can come to disagree — and it is what keeps an export off the keys of the other site on this origin,
 * `localStorage` being keyed by origin and not by path. The file names it once, in `namespace`, and keys each value by
 * what follows it, so a value cannot be written outside the namespace however the file is edited. `KEY_PREFIX` comes
 * from `storage-namespace.ts`, which every key is built from, for the same reason: a sweep spelled here could be
 * shortened to one the keys no longer agree with, and a prefix short enough to reach the neighbouring site is exactly
 * the way this goes wrong.
 *
 * Version 1 files are still read. They carry each key whole at the top level, beside `version`, and readers exported
 * them for as long as that was the only layout: a backup exists to be read back long after it was taken, so a page that
 * stopped reading them would strand the very files it asked people to keep. Only the namespace's own keys are taken
 * from one, which keeps the allowlist holding for a layout that has no `namespace` field to check.
 */

import { said } from './errors.js';
import { KEY_PREFIX, NAMESPACE } from './storage-namespace.js';

/**
 * What a file this code writes says it is. `parseBackup` reads this and version 1, and refuses any other rather than
 * read it as best it can: a version is the one signal that a key may have come to mean something different, which is
 * the case a lenient reader gets wrong. Adding a key does not bump it — the version says how to read a file, not what
 * is in it.
 */
const VERSION = 2;

/**
 * A backup's date in its name, so successive exports do not land as `… (1).json` and stop saying which is which.
 *
 * Read off the local calendar, because the only clock a reader checks the name against is their own: a `toISOString`
 * here named the file 9 October for an export taken at 09:00 on the 10th anywhere east of UTC. Spelled out rather than
 * formatted through `Intl`, which answers a locale's shape where a filename wants one that sorts — the page's
 * `dateFmt` and the rest are for prose a reader reads, not for a name they scan a directory of.
 */
const dated = (when: Date) => `${when.getFullYear()}-${twoDigit(when.getMonth() + 1)}-${twoDigit(when.getDate())}`;

const twoDigit = (part: number) => String(part).padStart(2, '0');

/** What an export downloads as. */
export const backupName = (when: Date) => `pogo-utils-backup-${dated(when)}.json`;

/**
 * What the copy taken before an import downloads as. Named apart from a deliberate export, because telling the two
 * apart is the whole of its worth to someone recovering from having imported the wrong file.
 */
export const rescueName = (when: Date) => `pogo-utils-backup-before-import-${dated(when)}.json`;

/**
 * The keys this app owns, in whatever order storage lists them. Enumerated rather than named, so a key some later page
 * persists is carried without this module ever learning what it is called.
 */
export function ownedKeys(): string[] {
  const keys: string[] = [];

  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);

    if (key !== null && key.startsWith(KEY_PREFIX)) {
      keys.push(key);
    }
  }

  return keys;
}

/**
 * This app's stored keys as the text of a backup file, indented so it can be read and repaired in an editor.
 *
 * Values are parsed and re-emitted rather than carried as strings, which is what makes the file JSON rather than JSON
 * holding JSON. A value that will not parse therefore cannot travel and is left out — which loses nothing, `readJSON`
 * already answering null for one, so the key reads as absent either way.
 *
 * Storage that will not answer is not caught here. Every reader in `event-prefs.ts` swallows that on purpose, because
 * a filter chip still works for the rest of the session; an export that quietly produced an empty backup would be the
 * same silence where it does real harm.
 *
 * Values are keyed in alphabetical order rather than the order storage lists them, which follows when each key was
 * first written and differs from one browser to the next. Sorted, two exports of the same preferences are the same
 * file, so a diff between them shows what changed and nothing else, and a reader finds a key where they expect it.
 * Sorted by code unit rather than through `localeCompare`, so the order is one file's and not one locale's.
 */
export function writeBackup(): string {
  const values: Record<string, unknown> = {};

  for (const key of ownedKeys().sort()) {
    const stored = localStorage.getItem(key);

    if (stored === null) {
      continue;
    }

    try {
      values[key.slice(KEY_PREFIX.length)] = JSON.parse(stored);
    } catch {
      /* Not JSON, so it cannot be a field of one; it reads as absent from either name. */
    }
  }

  return JSON.stringify({ version: VERSION, namespace: NAMESPACE, values }, null, 2);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The keys a backup file carries, or a refusal naming which defect it has. Separate from `applyBackup` so that nothing
 * a caller does between the two can be undone by a refusal arriving after it: a file is judged whole before storage is
 * touched at all, which is what lets the page take its own copy in between and not take one for a file it is about to
 * turn away. Separate messages rather than one because they ask different things of a reader: a readable file, a file
 * from this site, or a newer page to read it with.
 *
 * A file carrying no keys is an empty answer rather than a refusal. The version, and in version 2 the namespace, is
 * what says a file is ours, so a reader who exported on a first visit has a legitimately empty backup — refusing that
 * would turn the one export nobody can reconstruct into the one that cannot be read back.
 */
export function parseBackup(text: string): [string, unknown][] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`that file is not readable JSON: ${said(e)}`, { cause: e });
  }

  if (!isObject(parsed)) {
    throw new Error('that file is not a backup: a backup is a JSON object');
  }

  switch (parsed.version) {
    case 1:
      return Object.entries(parsed).filter(([field]) => field.startsWith(KEY_PREFIX));

    case 2: {
      if (parsed.namespace !== NAMESPACE) {
        const found = JSON.stringify(parsed.namespace) ?? 'absent';
        throw new Error(`that backup is of namespace ${found}, and this page reads ${JSON.stringify(NAMESPACE)}`);
      }

      if (!isObject(parsed.values)) {
        throw new Error('that file is not a backup: its values are not a JSON object');
      }

      return Object.entries(parsed.values).map(([name, value]) => [`${KEY_PREFIX}${name}`, value]);
    }

    // Quoted through `JSON.stringify` rather than interpolated bare: this came out of a file, and a version reading `1`
    // and one reading `"1"` are a refusal a reader has to be able to tell apart.
    default: {
      const found = JSON.stringify(parsed.version) ?? 'absent';
      throw new Error(`that backup is version ${found}, and this page reads version 1 or 2`);
    }
  }
}

/**
 * Write what `parseBackup` answered into storage, giving back the keys written so a caller can say how much arrived.
 *
 * Keys the file leaves out are left as they stand rather than cleared, so a restore is faithful into cleared storage —
 * which is the loss this exists for. Clearing the browser's site data is what gets there, nothing in the app reaching
 * the whole namespace this writes through. Leaving an omitted key alone is also what stops a file someone has trimmed
 * by hand from clearing whatever they trimmed.
 *
 * All of it or none of it. A `setItem` that raises partway — a store near the origin's quota is the way to see it —
 * would otherwise leave storage holding some keys from the file and the rest from before it, which is a state neither
 * the reader nor the page can reason about, and the caller is told the restore failed either way. Rolling back makes
 * "a refusal leaves storage alone" hold for a write that fails as well as for a file that is turned away.
 */
export function applyBackup(owned: readonly [string, unknown][]): string[] {
  const before = owned.map(([key]) => [key, localStorage.getItem(key)] as const);

  try {
    for (const [key, value] of owned) {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch (e) {
    putBack(before);
    throw e;
  }

  return owned.map(([key]) => key);
}

/**
 * Put the keys a failed write touched back to what they held, an absent one included — restoring it as empty would
 * invent a value, and for `seen` an empty record is a reader who has acknowledged nothing, every event marked new,
 * rather than one who has not been here.
 *
 * Each key catches for itself. The write that failed is commonly a full store, where putting a shorter value back
 * succeeds for some keys and not others, and the keys that can be recovered are worth recovering even so. Nothing is
 * thrown from here: the caller is about to be handed the failure that started this, which is the one it needs.
 */
function putBack(before: readonly (readonly [string, string | null])[]) {
  for (const [key, stored] of before) {
    try {
      if (stored === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, stored);
      }
    } catch {
      /* Storage has stopped answering altogether; what is left of the rollback is still worth attempting. */
    }
  }
}

/**
 * Read a backup back over whatever is stored now: the orchestration `parseBackup`, `writeBackup` and `applyBackup` are
 * the parts of, kept here rather than in the settings panel so that its order can be tested without a DOM.
 *
 * Nothing in the file is nothing to change, and leaving before the copy and the corrections is what makes the message
 * a caller shows for it true: the copy would put a file in the reader's Downloads for an import that touched nothing,
 * and the corrections are not free — the Events page closes a reveal the reader had opened — so running them anyway
 * would say nothing changed on the one render where *Ended* had just emptied itself. That answers null.
 *
 * Judged before anything is saved and saved before anything is written, so a copy is taken only for a file that is
 * about to be applied. This is the undo: a reader who picks the wrong file has nothing else to go back to, and the keys
 * it replaces are the ones nothing can reconstruct.
 *
 * The skip is not a formality. `settleSeen` writes `seen` as soon as the feed lands, so a loaded page nearly always has
 * something stored — except in the one flow this exists for, a reader who has just cleared their browser and imports
 * before the feed arrives, where a copy of nothing would be the first thing they saw.
 *
 * `download` hands the copy over and `restored` runs the corrections once the keys are written; both are the caller's,
 * since a download needs a document and the corrections need the store that owns them.
 */
export function restoreBackup(
  text: string,
  when: Date,
  download: (text: string, name: string) => void,
  restored: () => void,
): { written: number; rescued: boolean } | null {
  const incoming = parseBackup(text);

  if (incoming.length === 0) {
    return null;
  }

  const rescued = ownedKeys().length > 0;

  if (rescued) {
    download(writeBackup(), rescueName(when));
  }

  const written = applyBackup(incoming).length;

  restored();

  return { written, rescued };
}
