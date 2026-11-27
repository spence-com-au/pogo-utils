/**
 * A backup of what this app has stored in `localStorage` and IndexedDB, read and written as one file. A transport over
 * the `pogo-utils:` namespace and nothing more: it narrows no value, because what a value may be is known to whoever
 * owns the key rather than here — `loadPrefs` already treats storage as a channel that can hand it anything, so a file
 * with a right key name and a wrong value lands in storage and is dropped on the next read, which was handled and
 * tested before this module existed.
 *
 * The namespace is the allowlist. One list decides both what an export carries and what an import writes, rather than
 * two that can come to disagree — and it is what keeps an export off the keys of the other site on this origin,
 * `localStorage` being keyed by origin and not by path. The file names it once, in `namespace`, and nests each value
 * under what follows it, split at every colon — `pogo-utils:events:seen` is `values.events.seen` — so a value cannot be
 * written outside the namespace however the file is edited. `KEY_PREFIX` comes from `storage-namespace.ts`, which every
 * key is built from, for the same reason: a sweep spelled here could be shortened to one the keys no longer agree with,
 * and a prefix short enough to reach the neighbouring site is exactly the way this goes wrong.
 *
 * The same namespace names the IndexedDB databases a backup carries, under `database`: each by its name within the
 * namespace, holding its stores and theirs their values by key. A database is carried and restored whole, since what
 * belongs together in one is its owner's to know — the inventory's export beside when it was read — and so is how a
 * value is read back, as for a key.
 *
 * Versions 1 to 3 are still read. Version 1 carries each key whole at the top level, beside `version`, version 2 each
 * key's name within the namespace whole under `values`, and version 3 nests them under `values` as version 4 does under
 * `keyValueStore`. Readers exported each for as long as it was the only layout: a backup exists to be read back long
 * after it was taken, so a page that stopped reading them would strand the very files it asked people to keep. Only
 * the namespace's own keys are taken from version 1, which keeps the allowlist holding for a layout that has no
 * `namespace` field to check. None of them carries a database, so reading one back leaves IndexedDB alone.
 */

import { said } from './errors.js';
import { databaseNames, readDatabase, replaceDatabase, type Stores } from './indexed-db.js';
import { KEY_PREFIX, NAMESPACE } from './storage-namespace.js';

/**
 * What a file this code writes says it is. `parseBackup` reads this and versions 1 to 3, and refuses any other rather
 * than read it as best it can: a version is the one signal that a key may have come to mean something different, which
 * is the case a lenient reader gets wrong. Adding a key does not bump it — the version says how to read a file, not
 * what is in it.
 */
const VERSION = 4;

/**
 * Where a group in a version 3 or 4 file keeps the value stored at its own path. A value that is itself an object needs
 * it, since bare it would read as a group of keys — `events:seen` and `events:hidden-by-view` are both stored as
 * objects — and so does a path that holds a value and has keys below it too. Any other value stands bare under its
 * name, which is most of them and the point of nesting: `"acknowledged": "r9"` under `"coin-bag"`.
 *
 * Which makes it a name no key part can have, since it would be read as its group's own value. No key has one, and an
 * export leaves out a key that does, as it leaves out a value that is not JSON.
 */
const MARKER = '$value';

const pathOf = (key: string) => key.slice(KEY_PREFIX.length).split(':');

const keyOf = (path: readonly string[]) => `${KEY_PREFIX}${path.join(':')}`;

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

/** What a backup file holds: the keys to write, and each database to replace by its full name. */
export interface Backup {
  keys: [string, unknown][];
  databases: Map<string, Stores>;
}

/**
 * This app's stored keys and databases as the text of a backup file, indented so it can be read and repaired in an
 * editor.
 *
 * Values are parsed and re-emitted rather than carried as strings, which is what makes the file JSON rather than JSON
 * holding JSON. A value that will not parse therefore cannot travel and is left out — which loses nothing, `readJSON`
 * already answering null for one, so the key reads as absent either way.
 *
 * Storage that will not answer is not caught here, IndexedDB included. Every reader in `event-prefs.ts` swallows that
 * on purpose, because a filter chip still works for the rest of the session; an export that quietly produced an empty
 * backup would be the same silence where it does real harm.
 *
 * Every level is in alphabetical order rather than the order storage lists the keys, which follows when each key was
 * first written and differs from one browser to the next. Sorted, two exports of the same preferences are the same
 * file, so a diff between them shows what changed and nothing else, and a reader finds a key where they expect it.
 * Sorted by code unit rather than through `localeCompare`, so the order is one file's and not one locale's — and a
 * level at a time rather than by whole key, which would put `coin-bag-x` ahead of `coin-bag`, `-` sorting before `:`.
 * A database's stores and keys are sorted the same way. A database's values travel as JSON, as a key's do, which every
 * one this app keeps is.
 */
export async function writeBackup(): Promise<string> {
  const keyValueStore = groupOf();

  for (const path of ownedKeys().map(pathOf).sort(byLevel)) {
    const stored = localStorage.getItem(keyOf(path));

    if (stored === null || path.includes(MARKER)) {
      continue;
    }

    let value: unknown;

    try {
      value = JSON.parse(stored);
    } catch {
      /* Not JSON, so it cannot be a field of one; it reads as absent from either name. */
      continue;
    }

    place(keyValueStore, path, value);
  }

  const database = groupOf();
  const owned = (await databaseNames()).filter((name) => name.startsWith(KEY_PREFIX)).sort();

  for (const name of owned) {
    const stores = await readDatabase(name);

    // A database holding nothing is left out, as a battle that ended leaves the stay-awake store: restored, it would
    // only empty the same database in the browser it lands in.
    if (Object.values(stores).every((entries) => Object.keys(entries).length === 0)) {
      continue;
    }

    database[name.slice(KEY_PREFIX.length)] = sorted(
      Object.fromEntries(Object.entries(stores).map(([store, entries]) => [store, sorted(entries)])),
    );
  }

  return JSON.stringify({ version: VERSION, namespace: NAMESPACE, keyValueStore, database }, null, 2);
}

/** `record` with its names in code-unit order, the order `JSON.stringify` writes them in. */
const sorted = <T>(record: Record<string, T>): Record<string, T> =>
  Object.assign(groupOf(), Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));

/** Paths a level at a time: a path before any below it, and the names within a group in code-unit order. */
function byLevel(a: readonly string[], b: readonly string[]): number {
  for (const [index, name] of a.entries()) {
    const other = b[index];

    if (other === undefined) {
      return 1;
    }

    if (name !== other) {
      return name < other ? -1 : 1;
    }
  }

  return a.length - b.length;
}

/**
 * Set a value at its path, making the groups above it on the way. Called in `byLevel` order, which places a path
 * before any below it, so a value is already standing where a later path needs a group, and moves under `$value` to
 * make room.
 */
function place(values: Record<string, unknown>, path: readonly string[], value: unknown) {
  let group = values;

  for (const name of path.slice(0, -1)) {
    const standing = group[name];
    const below = isObject(standing) ? standing : groupOf(standing);

    group[name] = below;
    group = below;
  }

  // A key split at its colons has one part at least, the namespace's own key `pogo-utils:` having `""`.
  group[path.at(-1) as string] = isObject(value) ? groupOf(value) : value;
}

/**
 * A group, holding `value` as its own where there is one. Without a prototype, so a key part such as `__proto__` or
 * `constructor` is a name like any other rather than a property every object already answers.
 */
function groupOf(value?: unknown): Record<string, unknown> {
  const group: Record<string, unknown> = Object.create(null);

  if (value !== undefined) {
    group[MARKER] = value;
  }

  return group;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The keys and databases a backup file carries, or a refusal naming which defect it has. Separate from the writes
 * `restoreBackup` makes, so that a file is judged whole before storage is touched at all, and a refusal can never leave
 * storage half-written. Separate messages rather than one because they ask different things of a reader: a readable
 * file, a file from this site, or a newer page to read it with.
 *
 * A file carrying no keys is an empty answer rather than a refusal. The version, and from version 2 the namespace, is
 * what says a file is ours, so a reader who exported on a first visit has a legitimately empty backup — refusing that
 * would turn the one export nobody can reconstruct into the one that cannot be read back.
 */
export function parseBackup(text: string): Backup {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`that file is not readable JSON: ${said(e)}`, { cause: e });
  }

  if (!isObject(parsed)) {
    throw new Error('that file is not a backup: a backup is a JSON object');
  }

  const none = new Map<string, Stores>();

  switch (parsed.version) {
    case 1:
      return { keys: Object.entries(parsed).filter(([field]) => field.startsWith(KEY_PREFIX)), databases: none };

    case 2:
      return {
        keys: Object.entries(groupIn(parsed, 'values')).map(([name, value]) => [`${KEY_PREFIX}${name}`, value]),
        databases: none,
      };

    case 3:
      return { keys: keysIn(groupIn(parsed, 'values')), databases: none };

    case 4:
      return { keys: keysIn(groupIn(parsed, 'keyValueStore')), databases: databasesIn(groupIn(parsed, 'database')) };

    // Quoted through `JSON.stringify` rather than interpolated bare: this came out of a file, and a version reading `1`
    // and one reading `"1"` are a refusal a reader has to be able to tell apart.
    default: {
      const found = JSON.stringify(parsed.version) ?? 'absent';
      throw new Error(`that backup is version ${found}, and this page reads version 1, 2, 3 or 4`);
    }
  }
}

/** A file's `field`, once its namespace has said the file is this page's. */
function groupIn(file: Record<string, unknown>, field: string): Record<string, unknown> {
  if (file.namespace !== NAMESPACE) {
    const found = JSON.stringify(file.namespace) ?? 'absent';
    throw new Error(`that backup is of namespace ${found}, and this page reads ${JSON.stringify(NAMESPACE)}`);
  }

  const group = file[field];

  if (!isObject(group)) {
    throw new Error(`that file is not a backup: its ${JSON.stringify(field)} is not a JSON object`);
  }

  return group;
}

/**
 * The databases a version 4 file carries, each by its full name, the namespace put back in front of the name the file
 * gives it — so a file cannot name one outside the namespace however it is edited, as it cannot a key.
 */
function databasesIn(group: Record<string, unknown>): Map<string, Stores> {
  return new Map(
    Object.entries(group).map(([name, stores]) => {
      if (!isObject(stores) || !Object.values(stores).every(isObject)) {
        throw new Error(`that file is not a backup: its database ${JSON.stringify(name)} is not stores of values`);
      }

      return [`${KEY_PREFIX}${name}`, stores as Stores];
    }),
  );
}

/**
 * The keys a version 3 or 4 file nests, each path joined back at the colons an export split it at.
 *
 * A name holding a colon, and `$value` standing directly in `values`, are refused rather than read: an export writes
 * neither, so a file holding one has been edited into something with two readings. A version 2 file relabelled 3 is
 * the likely one, whose `events:seen` would otherwise read as a group and write the record's fields as keys of their
 * own. `$value` there would be the namespace's own value, the key `pogo-utils:` — which an export writes as `""`.
 */
function keysIn(group: Record<string, unknown>, path: readonly string[] = []): [string, unknown][] {
  return Object.entries(group).flatMap(([name, node]): [string, unknown][] => {
    if (name === MARKER) {
      if (path.length === 0) {
        throw new Error(`that file is not a backup: its values hold ${JSON.stringify(MARKER)} outside any group`);
      }

      return [[keyOf(path), node]];
    }

    if (name.includes(':')) {
      throw new Error(`that file is not a backup: its name ${JSON.stringify(name)} holds a colon`);
    }

    return isObject(node) ? keysIn(node, [...path, name]) : [[keyOf([...path, name]), node]];
  });
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
 * Replace each database `databases` names, answering what each held before — null for one that did not exist — for
 * putting back. A replacement that fails puts back the ones already replaced and throws, so a refusal leaves IndexedDB
 * as it was, as `applyBackup` leaves `localStorage`. None named is none touched, so a file without databases restores
 * in a browser that has no IndexedDB to give.
 */
async function applyDatabases(databases: Map<string, Stores>): Promise<Map<string, Stores | null>> {
  const before = new Map<string, Stores | null>();

  if (databases.size === 0) {
    return before;
  }

  const present = new Set(await databaseNames());

  for (const name of databases.keys()) {
    before.set(name, present.has(name) ? await readDatabase(name) : null);
  }

  try {
    for (const [name, stores] of databases) {
      await replaceDatabase(name, stores);
    }
  } catch (e) {
    await putDatabasesBack(before);
    throw e;
  }

  return before;
}

/** Each database back to what it held, each trying for itself, as `putBack` does for keys. */
async function putDatabasesBack(before: Map<string, Stores | null>) {
  for (const [name, stores] of before) {
    try {
      await replaceDatabase(name, stores);
    } catch {
      /* What is left of the rollback is still worth attempting. */
    }
  }
}

/**
 * Read a backup back over whatever is stored now: the orchestration `parseBackup`, `applyDatabases` and `applyBackup`
 * are the parts of, kept here rather than in the settings panel so that its order can be tested without a DOM. The
 * databases go first, being the writes that can be put back whole, and are put back if the keys then fail.
 *
 * Nothing in the file is nothing to change, and leaving before the corrections is what makes the message a caller
 * shows for it true: the corrections are not free — the Events page closes a reveal the reader had opened — so running
 * them anyway would say nothing changed on the one render where *Ended* had just emptied itself. That answers null.
 *
 * `restored` runs the corrections once the keys are written. It is the caller's, since the corrections need the store
 * that owns them.
 */
export async function restoreBackup(text: string, restored: () => void): Promise<number | null> {
  const { keys, databases } = parseBackup(text);

  if (keys.length === 0 && databases.size === 0) {
    return null;
  }

  const before = await applyDatabases(databases);

  try {
    applyBackup(keys);
  } catch (e) {
    await putDatabasesBack(before);
    throw e;
  }

  restored();

  return keys.length + databases.size;
}
