import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { applyBackup, backupName, ownedKeys, parseBackup, rescueName, writeBackup } from './backup.js';
import { KEYS, loadPrefs, persist, type Prefs } from './event-prefs.js';
import { installFakeStorage, type FakeStorage } from './testing/storage.js';

let storage: FakeStorage;

beforeEach(() => {
  storage = installFakeStorage();
});

// The zone sweep below installs one, and a zone left behind would silently follow every later test in the file.
afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * The two halves run together, which is what a restore is. Composed here so most cases read as the one step they are
 * about, and the property the split exists for — that judging a file touches nothing — gets a test of its own rather
 * than being implied by all of them.
 */
const restore = (text: string) => applyBackup(parseBackup(text));

/** A file as this page writes one, its values keyed by their names within the namespace. */
const backupOf = (values: unknown) => JSON.stringify({ version: 2, namespace: 'pogo-utils', values });

/** The names a written file carries, which is what it would write back. */
const namesIn = (text: string) => Object.keys((JSON.parse(text) as { values: object }).values);

/** A reader with every kind of value in play: two sets, the per-view object, the scalar, and a populated `seen`. */
function storePrefs(): Prefs {
  const prefs: Prefs = {
    hiddenTypes: new Set(['community-day', 'raid-hour']),
    hiddenByView: { cards: new Set(['raid-hour']), calendar: new Set() },
    filterScope: 'view',
    dismissed: new Set(['event-a']),
    seen: { through: Date.parse('2026-10-01T00:00:00.000Z'), ids: new Set(['event-b', 'event-c']) },
    collapsed: new Set(['ended']),
  };

  for (const name of Object.keys(KEYS) as (keyof typeof KEYS)[]) {
    persist(prefs, name);
  }

  return prefs;
}

/**
 * The restore this exists for: a browser cleared, then the file read back. Driven through `persist` and `loadPrefs`
 * rather than against the file's text, because what has to survive is the `Prefs` a reader sees and not a spelling.
 */
test('a cleared browser restores to the preferences it was exported from', () => {
  const was = storePrefs();
  const text = writeBackup();

  storage = installFakeStorage();
  expect(loadPrefs().dismissed).toEqual(new Set());

  restore(text);

  expect(loadPrefs()).toEqual(was);
});

/**
 * A file exported before the type sets were keyed by slug carries headings, and can be imported on any day. The load
 * after a restore is what rewrites them, so storage holds slugs from then on and not only what `loadPrefs` answers.
 */
test('a backup holding headings is stored as slugs once loaded', () => {
  restore(
    JSON.stringify({ version: 1, [KEYS.hiddenTypes]: ['Raid Hour'], [KEYS.hiddenByView]: { cards: ['GO Pass'] } }),
  );

  const prefs = loadPrefs();

  expect(prefs.hiddenTypes).toEqual(new Set(['raid-hour']));
  expect(prefs.hiddenByView).toEqual({ cards: new Set(['go-pass']) });
  expect(storage.getItem(KEYS.hiddenTypes)).toBe('["raid-hour"]');
  expect(storage.getItem(KEYS.hiddenByView)).toBe('{"cards":["go-pass"]}');
});

const EMPTY_SEEN = () => ({ through: null, ids: new Set<string>() });
const SOME_SEEN = () => ({ through: 1_000, ids: new Set(['e']) });

/**
 * `seen` null is a first visit and `seen` empty is a reader who has acknowledged nothing, and the two have to stay
 * apart across a round trip — this being the distinction the whole of `event-prefs.ts` is built on, and the one a JSON
 * round trip is most likely to quietly collapse. An absent key and a `null` one both read as a first visit, so the
 * assertion is on what `loadPrefs` answers rather than on which of the two the file carries.
 */
test.for([
  { seen: 'absent', write: () => undefined, reads: null },
  { seen: 'null', write: () => persist({ ...emptyPrefs(), seen: null }, 'seen'), reads: null },
  { seen: 'empty', write: () => persist({ ...emptyPrefs(), seen: EMPTY_SEEN() }, 'seen'), reads: EMPTY_SEEN() },
  { seen: 'populated', write: () => persist({ ...emptyPrefs(), seen: SOME_SEEN() }, 'seen'), reads: SOME_SEEN() },
])('a seen record that is $seen round-trips as itself', ({ write, reads }) => {
  write();

  const text = writeBackup();
  storage = installFakeStorage();
  restore(text);

  expect(loadPrefs().seen).toEqual(reads);
});

const emptyPrefs = (): Prefs => ({
  hiddenTypes: new Set(),
  hiddenByView: {},
  filterScope: 'global',
  dismissed: new Set(),
  seen: null,
  collapsed: new Set(),
});

/**
 * `localStorage` is keyed by origin and `spence.com.au` serves every repository published there, so the store
 * an export reads holds another site's keys too. They are not this app's to carry, and the assertion is that the file
 * says so in both directions: not exported, and a file naming another namespace refused rather than written back.
 */
test('a key belonging to another site on this origin is neither carried nor written', () => {
  storage.setItem('other-project:token', '"secret"');
  persist({ ...emptyPrefs(), dismissed: new Set(['event-a']) }, 'dismissed');

  expect(namesIn(writeBackup())).toEqual(['events:dismissed']);

  storage = installFakeStorage();
  storage.setItem('other-project:token', '"mine"');

  expect(() =>
    restore(JSON.stringify({ version: 2, namespace: 'other-project', values: { token: 'theirs' } })),
  ).toThrow(/namespace "other-project"/);
  expect(storage.getItem('other-project:token')).toBe('"mine"');
});

/**
 * Keys the file leaves out are left as they stand. That is what makes a restore faithful only into cleared storage —
 * the browser's own site data — and what stops a file trimmed by hand from clearing what was trimmed.
 */
test('a key the file omits is left as it was', () => {
  storePrefs();

  restore(backupOf({ 'events:dismissed': ['from-file'] }));

  const prefs = loadPrefs();

  expect(prefs.dismissed).toEqual(new Set(['from-file']));
  expect(prefs.hiddenTypes).toEqual(new Set(['community-day', 'raid-hour']));
  expect(prefs.seen?.ids).toEqual(new Set(['event-b', 'event-c']));
});

/**
 * A key inside the namespace that nothing reads yet is written through rather than dropped, so restoring this year's
 * file into next year's page keeps what that page will be able to use. Dropping it would be a silent loss of exactly
 * the thing a backup is for.
 */
test('a key in the namespace with no reader yet is written through', () => {
  restore(backupOf({ 'map:selected': ['a-route'] }));

  expect(storage.getItem('pogo-utils:map:selected')).toBe('["a-route"]');
});

/**
 * Version 1 files carry each key whole at the top level, and readers hold files exported that way. One still restores
 * its keys in the namespace, and only those: with no `namespace` field to refuse, the prefix is what keeps another
 * site's key or a stray field out of storage.
 */
test('a version 1 file restores its keys in the namespace and nothing else', () => {
  storage.setItem('other-project:token', '"mine"');

  const written = restore(
    JSON.stringify({
      'version': 1,
      [KEYS.dismissed]: ['from-file'],
      'pogo-utils:map:selected': ['a-route'],
      'other-project:token': 'theirs',
      'dismissed': ['unprefixed'],
    }),
  );

  expect(written).toEqual([KEYS.dismissed, 'pogo-utils:map:selected']);
  expect(loadPrefs().dismissed).toEqual(new Set(['from-file']));
  expect(storage.getItem('pogo-utils:map:selected')).toBe('["a-route"]');
  expect(storage.getItem('other-project:token')).toBe('"mine"');
  expect(storage.getItem('dismissed')).toBeNull();
});

/** A version 1 file exported on a first visit holds nothing but its version, and reads back as nothing to write. */
test('a version 1 file carrying no keys writes nothing and does not throw', () => {
  storePrefs();

  const before = storage.snapshot();

  expect(restore('{"version":1}')).toEqual([]);
  expect(storage.snapshot()).toEqual(before);
});

/** Enumerated rather than named, which is the same property from the other end: nothing lists the keys to carry. */
test('ownedKeys answers what is in the namespace and nothing else', () => {
  storage.setItem('other-project:token', '"secret"');
  storage.setItem('pogo-utils:map:selected', '[]');
  persist({ ...emptyPrefs(), dismissed: new Set() }, 'dismissed');

  expect(ownedKeys().sort()).toEqual([KEYS.dismissed, 'pogo-utils:map:selected']);
});

/**
 * A stored value that is not JSON cannot be a field of a JSON file, so it is left out. Nothing is lost: `readJSON`
 * answers null for it, so the key reads as absent from either name. The key beside it still travels, which is what
 * says the one value was skipped rather than the export abandoned.
 */
test('a stored value that is not JSON is left out, and the rest still travel', () => {
  storage.setItem(KEYS.hiddenTypes, '{oh no');
  persist({ ...emptyPrefs(), dismissed: new Set(['event-a']) }, 'dismissed');

  expect(namesIn(writeBackup())).toEqual(['events:dismissed']);
});

/**
 * A version or namespace refusal is checked by the same file *becoming accepted* once that one field is corrected, the
 * rest of the file left exactly as it was. That is the strong form, and the one worth having here: both are read
 * before any value is, so a refusal that was really about the value beside them would look identical from the outside,
 * and the repaired file's own key coming back is what tells the two apart.
 */
test.for([
  {
    refusing: 'a version this page cannot read',
    bad: { version: 3 },
    matching: /version 3, and this page reads version 1 or 2/,
  },
  { refusing: 'a version as a string', bad: { version: '2' }, matching: /version "2"/ },
  { refusing: 'no version at all', bad: { version: undefined }, matching: /version absent/ },
  { refusing: "another site's namespace", bad: { namespace: 'other-project' }, matching: /namespace "other-project"/ },
  { refusing: 'no namespace at all', bad: { namespace: undefined }, matching: /namespace absent/ },
])('$refusing is refused, where the same file with that field corrected is not', ({ bad, matching }) => {
  const good = { version: 2, namespace: 'pogo-utils', values: { x: 1 } };

  expect(() => restore(JSON.stringify({ ...good, ...bad }))).toThrow(matching);

  expect(restore(JSON.stringify(good))).toEqual(['pogo-utils:x']);
});

/**
 * A file that is not a JSON object at all, or whose values are not one, refused with the message that names which
 * defect it has. The weaker claim of the two, and said rather than dressed up: there is no "same file corrected" for
 * `null` or `'{oh no'` — no version to put right and no key to come back — so what rules out a reader that simply
 * refuses everything is the table above, plus every accepting case in this file. What these add is that each defect is
 * reported as itself.
 */
test.for([
  { refusing: 'text that is not JSON', bad: '{oh no', matching: /not readable JSON/ },
  { refusing: 'a JSON array', bad: '[]', matching: /a JSON object/ },
  { refusing: 'JSON null', bad: 'null', matching: /a JSON object/ },
  { refusing: 'a bare string', bad: '"a backup"', matching: /a JSON object/ },
  { refusing: 'values that are an array', bad: backupOf([]), matching: /values are not a JSON object/ },
  { refusing: 'no values at all', bad: backupOf(undefined), matching: /values are not a JSON object/ },
])('$refusing is refused as what it is', ({ bad, matching }) => {
  expect(() => restore(bad)).toThrow(matching);
});

/**
 * Judging a file touches nothing, which is the whole reason the two halves are separate. The page leans on it: it
 * downloads a copy of the current preferences between the two, and must not take one for a file it then turns away.
 */
test('parsing a file writes nothing, acceptable or not', () => {
  storePrefs();

  const before = storage.snapshot();

  expect(parseBackup(backupOf({ 'events:dismissed': ['from-file'] }))).toEqual([[KEYS.dismissed, ['from-file']]]);
  expect(() => parseBackup('{"version":3}')).toThrow();

  expect(storage.snapshot()).toEqual(before);
});

/** A refusal must not be a partial write: a reader who picks the wrong file keeps what they had. */
test('a refused file leaves storage exactly as it was', () => {
  storePrefs();

  const before = storage.snapshot();

  expect(() => restore(JSON.stringify({ version: 3, namespace: 'pogo-utils', values: { x: ['wrong'] } }))).toThrow();
  expect(() => restore('{oh no')).toThrow();

  expect(storage.snapshot()).toEqual(before);
});

/**
 * A reader who exported on a first visit has a file with no values in it, and reading it back writes nothing rather
 * than being turned away — the namespace is what says a file is ours, so a file of ours naming no key is one with
 * nothing to say rather than one to refuse.
 */
test('a backup carrying no values writes nothing and does not throw', () => {
  storePrefs();

  const before = storage.snapshot();

  expect(restore(backupOf({}))).toEqual([]);
  expect(storage.snapshot()).toEqual(before);
});

/**
 * Storage that will not answer is reported rather than swallowed. `persist` swallows it on purpose — a filter chip
 * still works for the rest of the session — but the same silence here would hand a reader an empty backup, or tell
 * them a restore had happened when nothing was written.
 */
test('storage that will not answer is reported rather than silently empty', () => {
  storage.throws = true;

  expect(() => writeBackup()).toThrow();
  expect(() => restore(backupOf({ 'events:dismissed': [] }))).toThrow();
});

/**
 * The file is indented, because a lossless backup whose point is to be repairable has to be readable in an editor —
 * and `scripts/prune-events.mts` already writes `data/events.json` the same way.
 */
test('the file is indented JSON a reader can open', () => {
  persist({ ...emptyPrefs(), dismissed: new Set(['event-a']) }, 'dismissed');

  expect(writeBackup()).toBe(`{
  "version": 2,
  "namespace": "pogo-utils",
  "values": {
    "events:dismissed": [
      "event-a"
    ]
  }
}`);
});

/**
 * Values are keyed alphabetically whatever order storage lists them in, so two exports of the same preferences are the
 * same file. Written out of order on purpose, since the fake lists keys in the order they were first set and an order
 * that happened to be sorted already would pass without the sort.
 */
test('values are keyed in alphabetical order, not the order they were stored', () => {
  storage.setItem('pogo-utils:map:selected', '[]');
  storage.setItem(KEYS.seen, 'null');
  storage.setItem(KEYS.dismissed, '[]');
  storage.setItem('pogo-utils:a-later-page', '1');

  expect(namesIn(writeBackup())).toEqual(['a-later-page', 'events:dismissed', 'events:seen', 'map:selected']);
});

/**
 * Dated, because a fixed name makes the browser number successive exports and they stop saying which is which — and
 * the rescue copy is named apart, telling the two apart being the whole of its worth to someone recovering.
 */
test('the two names are dated, and differ from each other', () => {
  const when = new Date('2026-10-09T12:00:00Z');

  expect(backupName(when)).toBe('pogo-utils-backup-2026-10-09.json');
  expect(rescueName(when)).toBe('pogo-utils-backup-before-import-2026-10-09.json');
});

/**
 * The day named is the reader's own, which is a sweep rather than one case because the suite's machine has a zone too:
 * each row's UTC date differs from the day it is dated, so a name read off `toISOString` fails here — where a single
 * instant would only have failed on a machine that happened to sit east or west of the file's author.
 *
 * Both directions are covered on purpose. East of UTC the local day runs ahead of the UTC one, west of it behind, and
 * a `getDate` that had been written as a `getUTCDate` is wrong in opposite directions in the two.
 */
test.for([
  { at: '2026-10-09T22:30:00Z', zone: 'Australia/Sydney', dated: '2026-10-10' },
  { at: '2026-10-09T02:30:00Z', zone: 'America/New_York', dated: '2026-10-08' },
  { at: '2026-10-09T12:00:00Z', zone: 'UTC', dated: '2026-10-09' },
])('an export at $at is dated $dated for a reader in $zone', ({ at, zone, dated }) => {
  vi.stubEnv('TZ', zone);

  expect(backupName(new Date(at))).toBe(`pogo-utils-backup-${dated}.json`);
});

/**
 * A write that fails partway puts back what it found, so the half-written store is a state this cannot reach. The
 * reader near their quota is the one who meets it: `hiddenTypes` from the file and `dismissed` from before it would
 * leave the page drawing from neither, and the status line says the restore failed in either case — so the failure
 * has to be the whole of what happened.
 *
 * The refused key is the *second* of the two written, which is what makes this a rollback rather than a write that
 * never started: the first key has already been set when the throw arrives and has to be walked back. Its earlier
 * value and an absent one are both checked, an absent key put back as empty being a value the file never carried —
 * and for `seen` the difference between the two is a first visit against a reader who has acknowledged nothing.
 */
test('a write that fails partway puts back what it found', () => {
  persist({ ...emptyPrefs(), hiddenTypes: new Set(['community-day']) }, 'hiddenTypes');

  const before = storage.snapshot();

  expect(before[KEYS.seen]).toBeUndefined();

  storage.refusesWritesTo.add(KEYS.seen);

  expect(() => restore(backupOf({ 'events:hidden-types': ['raid-hour'], 'events:seen': ['event-a'] }))).toThrow(
    /quota/,
  );

  expect(storage.snapshot()).toEqual(before);
});
