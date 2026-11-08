import { afterEach, expect, test } from 'vitest';

import { eachTrack, entryCoords, entryCountry, entryGpx, extText, loadManifest, placeName } from './gpx.js';
import { parseXml } from './testing/xml.js';

const gpx = (body: string) =>
  parseXml(
    '<gpx xmlns="http://www.topografix.com/GPX/1/1" ' +
      `xmlns:pgr="https://spence.com.au/pogo-utils/gpx/1">${body}</gpx>`,
  );

/** The first element of a tag, which every case below reads one of. */
const first = (doc: Document, tag: string) => {
  const el = doc.getElementsByTagName(tag)[0];

  if (!el) {
    throw new Error(`the fixture has no <${tag}>`);
  }

  return el;
};

/**
 * The direct-child rule, which is the whole reason these readers do not use `querySelector`. A gpx.studio file carries
 * `<metadata><author><name>` above the entries, and a `<trkpt>` may carry extensions of its own — so a reader walking
 * descendants would hand a track the author's name or a point's variant. Both decoys sit in this one tree, the author's
 * name first in document order so a descendant search would find it before the track's own.
 */
test('a name and an extension field are read from the element itself, not its descendants', () => {
  const doc = gpx(
    '<metadata><author><name>gpx.studio</name></author></metadata>' +
      '<trk><name>Tan Track</name>' +
      '<extensions><pgr:city>Melbourne</pgr:city><pgr:country>Australia</pgr:country></extensions>' +
      '<trkseg>' +
      '<trkpt lat="-37.8" lon="144.97"><extensions><pgr:variant>short</pgr:variant></extensions></trkpt>' +
      '<trkpt lat="-37.81" lon="144.98"/>' +
      '</trkseg></trk>',
  );
  const trk = first(doc, 'trk');

  expect(placeName(trk)).toBe('Tan Track, Melbourne');
  expect(extText(trk, 'variant')).toBeNull();
});

/**
 * The country is the sidebar's own grouping, so `placeName` leaves it out and each caller adds it where it needs it.
 */
test('placeName pairs the name with its locality and stops there', () => {
  const doc = gpx(
    '<wpt lat="1" lon="2"><name>Kings Park</name>' +
      '<extensions><pgr:city>Perth, Western Australia</pgr:city><pgr:country>Australia</pgr:country>' +
      '</extensions></wpt>',
  );

  expect(placeName(first(doc, 'wpt'))).toBe('Kings Park, Perth, Western Australia');
});

test('placeName falls back to the bare name where there is no locality', () => {
  const doc = gpx('<wpt lat="1" lon="2"><name>Lone Place</name></wpt>');
  expect(placeName(first(doc, 'wpt'))).toBe('Lone Place');
});

/**
 * Whitespace-only is absent rather than a name, so an editor writing `<name>\n  </name>` cannot give an entry a name
 * made of a newline for PGSharp to list and delete favourites by.
 *
 * What this cannot single out is the blank test inside `childText`, and nothing can: every reader above it treats `''`
 * and `null` alike — `placeName` and `entryCountry` throw on a falsy value, `extText`'s callers fall back on one — so
 * dropping that test leaves a blank field reaching exactly the same branch by a different route. It earns its place by
 * making the `string | null` return mean absent, not by changing an answer any caller here can see.
 */
test('a blank name is no name', () => {
  const doc = gpx('<wpt lat="1" lon="2"><name>  \n  </name></wpt>');
  expect(() => placeName(first(doc, 'wpt'))).toThrow('<wpt> has no <name>');
});

/** The name is trimmed, so an indented file and a compact one give the same favourite. */
test('a name is trimmed', () => {
  const doc = gpx('<wpt lat="1" lon="2"><name>\n    Kings Park\n  </name></wpt>');
  expect(placeName(first(doc, 'wpt'))).toBe('Kings Park');
});

/** The element names itself in every message, so a caller only has to add the file. */
test('entryCountry refuses an entry it cannot group, flag or name', () => {
  const doc = gpx('<trk><name>Nowhere</name><extensions><pgr:city>Perth</pgr:city></extensions></trk>');
  expect(() => entryCountry(first(doc, 'trk'))).toThrow('<trk> has no <pgr:country>');
});

/** An entry with no `<extensions>` at all is the same absence as one whose extensions lack the field. */
test('extText answers null for an element with no extensions block', () => {
  const doc = gpx('<wpt lat="1" lon="2"><name>Bare</name></wpt>');
  expect(extText(first(doc, 'wpt'), 'country')).toBeNull();
});

/**
 * Matched as the validator matches, on namespace and local name: a foreign tool's field of the same name, first in
 * document order so a reader going by name alone would find it, is not one the validator checked.
 */
test('extText reads the pgr namespace under any prefix, and nothing else', () => {
  const doc = gpx(
    '<wpt lat="1" lon="2"><name>Here</name><extensions>' +
      '<x:country xmlns:x="urn:other">Atlantis</x:country>' +
      '<p:country xmlns:p="https://spence.com.au/pogo-utils/gpx/1">Australia</p:country>' +
      '<x:event xmlns:x="urn:other">gone</x:event>' +
      '</extensions></wpt>',
  );
  const wpt = first(doc, 'wpt');

  expect(extText(wpt, 'country')).toBe('Australia');
  expect(extText(wpt, 'event')).toBeNull();
});

/**
 * `coordStr` is the file's own text rather than the parsed pair printed back, which is what lets the copy button hand
 * over exactly what the file said — trailing zeroes and all, where `${lat},${lng}` would have dropped them.
 */
test('entryCoords keeps the file’s own spelling beside the parsed pair', () => {
  const doc = gpx('<wpt lat="-37.78410" lon="144.95120"><name>Zoo</name></wpt>');

  expect(entryCoords(first(doc, 'wpt'))).toEqual({
    coords: [-37.7841, 144.9512],
    coordStr: '-37.78410,144.95120',
  });
});

/**
 * `parseFloat` would read "east" as `NaN` and "1e" as `1`, and either would place a point in the sea rather than fail.
 * A missing attribute reads the same way as an unparseable one, since `getAttribute` answers null and `?? ''` parses to
 * `NaN` — so there is one message for both.
 */
test.for([
  { fault: 'an unparseable longitude', attrs: 'lat="1" lon="east"', says: '<wpt> at 1,east' },
  { fault: 'a missing latitude', attrs: 'lon="2"', says: '<wpt> at null,2' },
  { fault: 'an infinite coordinate', attrs: 'lat="1" lon="Infinity"', says: '<wpt> at 1,Infinity' },
])('entryCoords refuses $fault', ({ attrs, says }) => {
  const doc = gpx(`<wpt ${attrs}><name>Nowhere</name></wpt>`);
  expect(() => entryCoords(first(doc, 'wpt'))).toThrow(`${says} has an unparseable coordinate`);
});

/**
 * The emptied `<trk>` gpx.studio writes for a cleared route is skipped here so that both consumers skip it alike. A
 * `<trk>` that kept a single point is a different thing and is yielded — it is a track that cannot be *drawn*, which is
 * the viewer's rule rather than the format's, so `loadGpxFile` is what rejects it.
 */
test('eachTrack skips an emptied track and yields a single-point one', () => {
  const doc = gpx(
    '<trk><name>Cleared</name></trk>' +
      '<trk><name>One Point</name><trkseg><trkpt lat="1" lon="2"/></trkseg></trk>' +
      '<trk><name>Drawable</name><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk>',
  );
  const tracks = [...eachTrack(doc)];

  expect(tracks.map(({ trk }) => placeName(trk))).toEqual(['One Point', 'Drawable']);
  expect(tracks.map(({ trkpts }) => trkpts.length)).toEqual([1, 2]);
});

/** Every `<trkpt>` the track holds, across however many `<trkseg>` the file split them into. */
test('eachTrack pairs a track with its points from every segment', () => {
  const doc = gpx(
    '<trk><name>Split</name>' +
      '<trkseg><trkpt lat="1" lon="2"/></trkseg>' +
      '<trkseg><trkpt lat="3" lon="4"/><trkpt lat="5" lon="6"/></trkseg></trk>',
  );
  const [track] = [...eachTrack(doc)];

  expect([...(track?.trkpts ?? [])].map((p) => entryCoords(p).coords)).toEqual([
    [1, 2],
    [3, 4],
    [5, 6],
  ]);
});

/**
 * `loadManifest` is the one reader here that needs a global rather than a tree, so the tree-based cases above cannot
 * reach it. The stub is `fetch` itself because that is what the function names: a parameter would be a seam the page
 * does not have, and what the guard is about is a response this repository's own build wrote going wrong.
 *
 * `parseGpxDocument` is the one reader no test here reaches, and deliberately: it tells a malformed file apart by
 * `querySelector('parsererror')`, a browser convention `@xmldom/xmldom` does not implement at all — it throws from
 * `parseFromString` instead. So a test over xmldom would be checking a different contract, and the browser suite is
 * what covers it.
 */
const respondWith = (body: unknown, init?: { ok?: boolean; status?: number; statusText?: string }) => {
  globalThis.fetch = () =>
    Promise.resolve({
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      statusText: init?.statusText ?? 'OK',
      json: () => Promise.resolve(body),
    } as Response);
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'fetch');
});

test('loadManifest answers the list of paths the build wrote', async () => {
  respondWith(['Australia/Melbourne Zoo.gpx', 'England/West End, London.gpx']);

  await expect(loadManifest()).resolves.toEqual(['Australia/Melbourne Zoo.gpx', 'England/West End, London.gpx']);
});

/** An empty manifest is a repository with no files rather than a failure, and the pages say so themselves. */
test('loadManifest answers an empty list as an empty list', async () => {
  respondWith([]);
  await expect(loadManifest()).resolves.toEqual([]);
});

/** A status the server refused on names itself, so a 404 from a missing build reads differently from a 503. */
test('loadManifest refuses a response the server would not give', async () => {
  respondWith(null, { ok: false, status: 404, statusText: 'Not Found' });
  await expect(loadManifest()).rejects.toThrow('404 Not Found');
});

/**
 * `Response#json` answers `any`, so this guard is the whole of what says the result is a list of strings — nothing at
 * the type level reads the `some`. Each shape is something a half-written or wrong file would actually be.
 */
test.for([
  { body: 'a bare string', value: 'Melbourne Zoo.gpx' },
  { body: 'an object', value: { files: [] } },
  { body: 'null', value: null },
  { body: 'a list with a number in it', value: ['a.gpx', 42] },
  { body: 'a list of nulls', value: [null] },
])('loadManifest refuses $body', async ({ value }) => {
  respondWith(value);
  await expect(loadManifest()).rejects.toThrow('is not a list of paths');
});

/**
 * `entryGpx` is the inverse of everything above, and what the Copy button hands over. A stored file holds a whole
 * country, so these cases are about the two halves of lifting one entry out of it: that nothing of the entry is lost,
 * and that nothing of its neighbours comes along.
 *
 * The assertions are over the parsed result rather than the exact bytes wherever they can be, because attribute order
 * in a serializer's output is its own business — xmldom writes the `xmlns` it adds last where a browser writes it
 * first, and a test pinning the string would be pinning the stand-in rather than the contract.
 */
const TWO_TRACKS =
  '<trk><name>Tan Track</name>' +
  '<extensions><pgr:city>Melbourne, Victoria</pgr:city><pgr:country>Australia</pgr:country>' +
  '<pgr:variant>short</pgr:variant></extensions>' +
  '<trkseg><trkpt lat="-37.8" lon="144.97"/><trkpt lat="-37.81" lon="144.98"/></trkseg></trk>' +
  '<trk><name>Albert Park Lake</name>' +
  '<extensions><pgr:country>Australia</pgr:country></extensions>' +
  '<trkseg><trkpt lat="-37.85" lon="144.97"/><trkpt lat="-37.84" lon="144.98"/></trkseg></trk>';

/**
 * The property that matters: what the clipboard gets reads back as the entry it was copied from. Driven through the
 * readers above rather than compared to a literal, so the two directions are checked against each other.
 */
test('entryGpx writes an entry that reads back as itself', () => {
  const trk = first(gpx(TWO_TRACKS), 'trk');
  const copied = first(parseXml(entryGpx(trk)), 'trk');

  expect(placeName(copied)).toBe('Tan Track, Melbourne, Victoria');
  expect(entryCountry(copied)).toBe('Australia');
  expect(extText(copied, 'variant')).toBe('short');
  expect([...copied.getElementsByTagName('trkpt')].map((p) => entryCoords(p).coords)).toEqual([
    [-37.8, 144.97],
    [-37.81, 144.98],
  ]);
});

/**
 * The whole reason this function exists. Before the files were merged per country the Copy button handed over the text
 * it had fetched, which for `data/Australia.gpx` is every route in the country under a toast naming one of them.
 */
test('entryGpx writes the one entry asked for and none of its neighbours', () => {
  const doc = gpx(TWO_TRACKS);
  const copied = parseXml(entryGpx(first(doc, 'trk')));

  expect(copied.getElementsByTagName('trk')).toHaveLength(1);
  expect(entryGpx(first(doc, 'trk'))).not.toContain('Albert Park Lake');
});

/** A `<wpt>` is the other thing a file holds, and is lifted out the same way — one function, not one per tag. */
test('entryGpx writes a waypoint as readily as a track', () => {
  const doc = gpx(
    '<wpt lat="-27.46958" lon="153.025357"><name>Brisbane</name>' +
      '<extensions><pgr:country>Australia</pgr:country></extensions></wpt>',
  );
  const copied = first(parseXml(entryGpx(first(doc, 'wpt'))), 'wpt');

  expect(placeName(copied)).toBe('Brisbane');
  expect(entryCoords(copied).coordStr).toBe('-27.46958,153.025357');
});

/**
 * The tree the viewer is drawing from is the same tree this reads, so moving the element rather than cloning it would
 * take a route off the map the first time its Copy button was pressed.
 */
test('entryGpx leaves the document it copied from alone', () => {
  const doc = gpx(TWO_TRACKS);
  const trk = first(doc, 'trk');

  entryGpx(trk);

  expect(doc.getElementsByTagName('trk')).toHaveLength(2);
  expect(trk.parentNode).toBe(doc.documentElement);
});

/**
 * A real GPX 1.1 file, not a fragment: the prologue, the version and creator every file in `data/` carries, and both
 * namespaces declared once on the root rather than repeated down the subtree — which is what putting them in scope
 * before the serializer walks the entry buys.
 */
test('entryGpx writes a whole GPX 1.1 file', () => {
  const out = entryGpx(first(gpx(TWO_TRACKS), 'trk'));
  const root = parseXml(out).documentElement;

  expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<gpx ')).toBe(true);
  expect(out.endsWith('</gpx>\n')).toBe(true);
  expect(root.namespaceURI).toBe('http://www.topografix.com/GPX/1/1');
  expect(root.getAttribute('version')).toBe('1.1');
  expect(root.getAttribute('creator')).toBe('https://github.com/spence-com-au/pogo-utils');
  expect(out.match(/xmlns:pgr=/g)).toHaveLength(1);
  expect(out).toContain('<trk>');
});
