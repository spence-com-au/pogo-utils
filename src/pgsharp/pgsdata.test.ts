/**
 * The whole of what the Build button computes, driven from a GPX file's text to the bytes a reader is handed.
 *
 * `favourites.ts` and `java-serialization.ts` are each tested on their own; what this adds is the join — which key
 * gets which encoder, that the timezones are in the bytes rather than filled in after, that the control keys land in
 * PGSharp's own order.
 *
 * The assertions read the stream back rather than hashing it: a digest would be pinned to `filters.ts` and
 * `scan-config.ts`, so a filter added to a list would fail this suite for being a filter added to a list. What is
 * pinned as literal text is the two favourite JSON strings, which depend on this code and the fixture alone.
 */

import { expect, test } from 'vitest';

import { JavaSer } from '../java-serialization.js';
import { parseXml } from '../testing/xml.js';
import { CONTROL_RESETS } from './controls.js';
import { gpxFavourites } from './favourites.js';
import { backupSummary, buildBackup, type RepoFavourites } from './pgsdata.js';

const gpx = (body: string) =>
  parseXml(
    '<gpx xmlns="http://www.topografix.com/GPX/1/1" ' +
      `xmlns:pgr="https://spence.com.au/pogo-utils/gpx/1">${body}</gpx>`,
  );

/** A waypoint at a named place, which is where the timezone in the encoded output comes from. */
const wpt = (name: string, lat: string, lon: string, country = 'Australia') =>
  `<wpt lat="${lat}" lon="${lon}"><name>${name}</name>` +
  `<extensions><pgr:country>${country}</pgr:country></extensions></wpt>`;

const trk = (name: string, country = 'Australia') =>
  `<trk><name>${name}</name><extensions><pgr:country>${country}</pgr:country></extensions>` +
  '<trkseg><trkpt lat="-37.8" lon="144.97"/><trkpt lat="-37.81" lon="144.98"/></trkseg></trk>';

/** The two lists as the page would have them, read out of one file's text. */
const favouritesFrom = (body: string): RepoFavourites => gpxFavourites(gpx(body));

/** The root map the bytes read back as, which is the only reader of a backup this repository has. */
function reread(bytes: Uint8Array) {
  const root = JavaSer.loads(bytes);

  if (!(root instanceof Map)) {
    throw new Error(`expected a HashMap at the root, got ${root === null ? 'null' : typeof root}`);
  }

  return root;
}

const MELBOURNE = wpt('Melbourne Zoo', '-37.7841', '144.9512');

/**
 * The composed path, asserted as the text the two keys carry. Three separate claims meet here: the GPX reader got the
 * name and the flag, `applyTimezones` found the zone from the coordinates, and `encodePoints` escaped the result the
 * way Gson does — and the flag's surrogates being escaped while the route's are not is the one thing that says the two
 * keys do not share an encoder.
 */
test('a file becomes the two favourite strings a backup carries', () => {
  const backup = buildBackup(favouritesFrom(MELBOURNE + trk('Tan Track')), new Set());
  const root = reread(backup.bytes);

  expect(root.get('hlfavor')).toBe(
    '[{"name":"\\ud83c\\udde6\\ud83c\\uddfa Melbourne Zoo, Australia","lat":-37.7841,"lng":144.9512,' +
      '"tz":"Australia\\/Melbourne"}]',
  );
  expect(root.get('hlfavorRoute')).toBe(
    '[{"points":[[-37.8,144.97,65536],[-37.81,144.98,65536]],"mode":2,' +
      '"state":{"direction":1,"nextNodePos":0,"preNodePos":-1,"loopcount":0,"lat":0,"lng":0},' +
      '"name":"🇦🇺 Tan Track, Australia"}]',
  );

  expect(backup).toMatchObject({ points: 1, routes: 1, notes: [] });
});

/**
 * The `tz` in the string above is the assertion that `encodePoints` runs after `applyTimezones`. Stated on its own too,
 * because it is the ordering with the quietest failure: a backup whose favourites all lack a timezone is one PGSharp
 * accepts without a word.
 */
test('every point the bytes carry has its own timezone in it, in sorted order', () => {
  const backup = buildBackup(
    favouritesFrom(MELBOURNE + wpt('Opera House', '-33.8568', '151.2153') + wpt('South Bank', '-27.4748', '153.0175')),
    new Set(),
  );
  const points: { name: string; tz?: string }[] = JSON.parse(String(reread(backup.bytes).get('hlfavor')));

  // Paired rather than listed, because the order is the sort's and not the file's — Melbourne Zoo, Opera House, South
  // Bank is already alphabetical here, so the zones alone would read as the file's order and say nothing about either.
  // Three cities in three zones, two of them sharing a UTC offset, is what says each point was asked separately.
  expect(points.map(({ name, tz }) => `${name.slice(5)} → ${tz}`)).toEqual([
    'Melbourne Zoo, Australia → Australia/Melbourne',
    'Opera House, Australia → Australia/Sydney',
    'South Bank, Australia → Australia/Brisbane',
  ]);
  expect(backup.notes).toEqual([]);
});

/**
 * A root holding only the two favourite keys, in that order, when nothing is ticked — which is what makes importing one
 * leave the rest of a profile alone. The order is asserted because the stream is a sequence and `Object.keys` of the
 * map read back is the order it was written in.
 */
test('nothing ticked writes the two favourite keys and no others', () => {
  const root = reread(buildBackup(favouritesFrom(MELBOURNE), new Set()).bytes);
  expect([...root.keys()]).toEqual(['hlfavor', 'hlfavorRoute']);
});

/**
 * The dedupe keeps the first of a repeated name — the one the manifest listed, not the one that happens to come later.
 * The coordinate is how the two are told apart, the names being equal by construction.
 *
 * What this does *not* show is that the dedupe has to run before the sort, and nothing can: `byName` answers 0 for two
 * identical names and `Array#sort` is stable, so a tie cannot be reordered and either order keeps the same entry.
 * Sorting first was measured and moves nothing, which is why the module says the order is free rather than claiming a
 * reason for it.
 */
test('a repeated name keeps the one the file listed first', () => {
  const repo = favouritesFrom(
    wpt('Zoo', '-37.7841', '144.9512') + wpt('Aquarium', '-37.8203', '144.9580') + wpt('Zoo', '-33.8568', '151.2153'),
  );
  const backup = buildBackup(repo, new Set());
  const points: { name: string; lat: number }[] = JSON.parse(String(reread(backup.bytes).get('hlfavor')));

  expect(points.map((point) => point.name)).toEqual(['🇦🇺 Aquarium, Australia', '🇦🇺 Zoo, Australia']);
  expect(points.find((point) => point.name.includes('Zoo'))?.lat).toBe(-37.7841);
  expect(backup.notes).toEqual(['1 duplicate waypoint name(s) skipped']);
});

/**
 * Each kind is deduped and counted within itself, as PGSharp lists them on separate tabs. The two counts differ on
 * purpose: equal ones read the same whichever field they were read from, so a pipeline answering with them swapped
 * would pass every symmetric case there is.
 */
test('the two kinds are deduped separately and reported separately', () => {
  const backup = buildBackup(
    favouritesFrom(
      MELBOURNE +
        MELBOURNE +
        wpt('Opera House', '-33.8568', '151.2153') +
        trk('Tan Track') +
        trk('Tan Track') +
        trk('Tan Track'),
    ),
    new Set(),
  );

  expect(backup).toMatchObject({
    points: 2,
    routes: 1,
    notes: ['1 duplicate waypoint name(s) skipped', '2 duplicate route name(s) skipped'],
  });

  // Read off the bytes as well as off the answer, so the counts are the ones a reader's file actually carries.
  const root = reread(backup.bytes);
  expect(JSON.parse(String(root.get('hlfavor')))).toHaveLength(2);
  expect(JSON.parse(String(root.get('hlfavorRoute')))).toHaveLength(1);
});

/** A coordinate tz-lookup will not name is counted rather than guessed at, and the point is kept without the field. */
test('a point with no timezone is counted and kept', () => {
  const backup = buildBackup(
    { points: [{ name: 'Off the globe', lat: 91, lng: 0 }], routes: [], hidden: 0 },
    new Set(),
  );
  const points: { name: string; tz?: string }[] = JSON.parse(String(reread(backup.bytes).get('hlfavor')));

  expect(points).toEqual([{ name: 'Off the globe', lat: 91, lng: 0 }]);
  expect(backup.notes).toEqual(['1 waypoint(s) without a timezone']);
});

/**
 * A ticked control contributes its own keys, a number as a Java Float and a string as itself. `resetIcon` is the case
 * that says so: both its values are coordinates, so they come back as boxes rather than as text — which `box('F', …)`
 * failing to be reached would turn into four zero bytes of a string nobody can read.
 */
test('a ticked control writes its keys, numbers boxed as Java Floats', () => {
  const root = reread(buildBackup(favouritesFrom(MELBOURNE), new Set(['resetIcon'])).bytes);

  expect([...root.keys()]).toEqual(['hlfavor', 'hlfavorRoute', 'iconX', 'iconY']);
  expect(root.get('iconX')).toEqual(JavaSer.box('F', CONTROL_RESETS.resetIcon.iconX));
  expect(root.get('iconY')).toEqual(JavaSer.box('F', CONTROL_RESETS.resetIcon.iconY));
});

/** The feed list is a string and stays one, which is the other half of what the Float branch is chosen against. */
test('a control whose value is a filter string writes it as text', () => {
  const root = reread(buildBackup(favouritesFrom(MELBOURNE), new Set(['resetFeeds'])).bytes);
  expect(root.get('hlfeeds')).toBe(CONTROL_RESETS.resetFeeds.hlfeeds);
});

/**
 * The key order is `CONTROL_RESETS`' own, not the order the reader clicked in — which is what iterating that table
 * rather than the ticked set buys. The bytes are compared whole, since a stream is a sequence and an order is the one
 * thing a `toEqual` over a Map would not have caught.
 */
test('the control keys land in PGSharp’s order whatever order they were ticked in', () => {
  const ids = Object.keys(CONTROL_RESETS);
  const repo = () => favouritesFrom(MELBOURNE);

  expect(buildBackup(repo(), new Set(ids)).bytes).toEqual(buildBackup(repo(), new Set([...ids].reverse())).bytes);

  const root = reread(buildBackup(repo(), new Set(ids)).bytes);
  const expected = ['hlfavor', 'hlfavorRoute', ...ids.flatMap((id) => Object.keys(CONTROL_RESETS[id as never]))];

  expect([...root.keys()]).toEqual(expected);
});

/** Every control is reachable, so a table entry nothing can tick would be caught here rather than never noticed. */
test('each control on its own writes exactly its own keys', () => {
  for (const [id, keys] of Object.entries(CONTROL_RESETS)) {
    const root = reread(buildBackup(favouritesFrom(MELBOURNE), new Set([id])).bytes);
    expect([...root.keys()]).toEqual(['hlfavor', 'hlfavorRoute', ...Object.keys(keys)]);
  }
});

test('all of them ticked is counted as one note', () => {
  const ids = Object.keys(CONTROL_RESETS);
  const backup = buildBackup(favouritesFrom(MELBOURNE), new Set(ids));

  expect(backup.notes).toEqual([`${ids.length} control(s)`]);
});

/** An id no control answers to is ignored rather than written, there being no keys for it to contribute. */
test('an unknown control id contributes nothing', () => {
  const backup = buildBackup(favouritesFrom(MELBOURNE), new Set(['resetNothing']));

  expect([...reread(backup.bytes).keys()]).toEqual(['hlfavor', 'hlfavorRoute']);
  expect(backup.notes).toEqual([]);
});

/**
 * An empty repository is a valid backup of nothing rather than a failure: the two keys are there, holding empty lists.
 */
test('a repository with no files still builds', () => {
  const backup = buildBackup({ points: [], routes: [], hidden: 0 }, new Set());
  const root = reread(backup.bytes);

  expect(root.get('hlfavor')).toBe('[]');
  expect(root.get('hlfavorRoute')).toBe('[]');
  expect(backup).toMatchObject({ points: 0, routes: 0, notes: [] });
});

/**
 * The bytes are a stream this codec can read back, which `buildBackup` checks before returning them. Asserted here as
 * well as relied on above, because the check is what turns a codec defect into a failed build rather than a file a
 * reader imports and PGSharp rejects — and the throw it wraps is unreachable from any repository, so the assertion that
 * it did *not* fire is the only side of it a test can see.
 */
test('the bytes open as a Java stream', () => {
  const bytes = buildBackup(favouritesFrom(MELBOURNE + trk('Tan Track')), new Set(['resetIcon'])).bytes;

  expect([...bytes.subarray(0, 4)]).toEqual([0xac, 0xed, 0x00, 0x05]);
  expect(() => JavaSer.loads(bytes)).not.toThrow();
});

/** The caveats are bracketed only when there are any, so a clean build is a sentence and not one trailing `()`. */
test.for([
  {
    when: 'there are no caveats',
    backup: { points: 74, routes: 12, notes: [] },
    reads: 'Built a partial backup — 74 waypoint(s) and 12 route(s). Import it into PGSharp.',
  },
  {
    when: 'there is one',
    backup: { points: 1, routes: 0, notes: ['2 control(s)'] },
    reads: 'Built a partial backup — 1 waypoint(s) and 0 route(s) (2 control(s)). Import it into PGSharp.',
  },
  {
    when: 'there are several',
    backup: { points: 1, routes: 1, notes: ['1 duplicate waypoint name(s) skipped', '2 control(s)'] },
    reads:
      'Built a partial backup — 1 waypoint(s) and 1 route(s) ' +
      '(1 duplicate waypoint name(s) skipped; 2 control(s)). Import it into PGSharp.',
  },
])('the summary reads right when $when', ({ backup, reads }) => {
  expect(backupSummary(backup)).toBe(reads);
});

/** The summary is over a real build, so the counts it quotes are the ones the bytes carry. */
test('the summary quotes the counts the build answered', () => {
  const backup = buildBackup(favouritesFrom(MELBOURNE + MELBOURNE + trk('Tan Track')), new Set());

  expect(backupSummary(backup)).toBe(
    'Built a partial backup — 1 waypoint(s) and 1 route(s) (1 duplicate waypoint name(s) skipped). ' +
      'Import it into PGSharp.',
  );
});

/**
 * What the reader hid on the Map page is missing from the bytes PGSharp imports, not only from the counts, and the
 * summary says how many went, so a backup holding fewer than the site lists does not read as entries lost.
 */
test('an entry hidden on the Map page is left out of the bytes and said so', () => {
  const repo = gpxFavourites(gpx(MELBOURNE + trk('Tan Track') + trk('Botanic Loop')), {
    routes: new Set(['Tan Track, Australia']),
    waypoints: new Set(),
  });
  const backup = buildBackup(repo, new Set());
  const routes: { name: string }[] = JSON.parse(String(reread(backup.bytes).get('hlfavorRoute')));

  expect(routes.map((route) => route.name)).toEqual(['🇦🇺 Botanic Loop, Australia']);
  expect(backupSummary(backup)).toBe(
    'Built a partial backup — 1 waypoint(s) and 1 route(s) (1 hidden on the Map page left out). ' +
      'Import it into PGSharp.',
  );
});
