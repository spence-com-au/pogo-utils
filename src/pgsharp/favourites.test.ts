import { expect, test } from 'vitest';

import { parseXml } from '../testing/xml.js';
import {
  applyTimezones,
  byName,
  dedupeByName,
  encodePoints,
  encodeRoutes,
  gpxFavourites,
  type Point,
} from './favourites.js';

/**
 * A GPX tree holding whatever the case needs, with the two namespaces a real file carries — the readers match on local
 * name, so the prefix is the file's own business, but a fixture that skipped them would not be the thing under test.
 */
const gpx = (body: string) =>
  parseXml(
    '<gpx xmlns="http://www.topografix.com/GPX/1/1" ' +
      `xmlns:pgr="https://spence.com.au/pogo-utils/gpx/1">${body}</gpx>`,
  );

const MELBOURNE_ZOO =
  '<wpt lat="-37.7841" lon="144.9512"><name>Melbourne Zoo</name>' +
  '<extensions><pgr:city>Melbourne</pgr:city><pgr:country>Australia</pgr:country></extensions></wpt>';

test('a <wpt> becomes a flagged Point and a <trk> a Route of triples', () => {
  // The `Cleared` track is gpx.studio's emptied <trk> for a cleared route, which is a skip rather than a nameless
  // route.
  const { points, routes } = gpxFavourites(
    gpx(
      MELBOURNE_ZOO +
        '<trk><name>Tan Track</name><extensions><pgr:city>Melbourne</pgr:city>' +
        '<pgr:country>Australia</pgr:country><pgr:variant>long</pgr:variant></extensions>' +
        '<trkseg><trkpt lat="-37.8" lon="144.97"/><trkpt lat="-37.81" lon="144.98"/></trkseg></trk>' +
        '<trk><name>Cleared</name><extensions><pgr:country>Australia</pgr:country></extensions></trk>',
    ),
  );

  expect(points).toEqual([{ name: '🇦🇺 Melbourne Zoo, Melbourne, Australia', lat: -37.7841, lng: 144.9512 }]);
  expect(routes).toEqual([
    {
      // The variant is suffixed in brackets, which is what tells one of a short/long pair from the other.
      name: '🇦🇺 Tan Track, Melbourne, Australia (long)',

      points: [
        [-37.8, 144.97, 65536],
        [-37.81, 144.98, 65536],
      ],
    },
  ]);
});

/**
 * England is the one subdivision in COUNTRIES, so it is the only row reaching the tag-sequence branch. Written as code
 * points rather than pasted, because the five tag characters are invisible and a diff over them says nothing: this is
 * U+1F3F4 then `gbeng` in the tag block then U+E007F, which is the sequence Unicode gives England's flag.
 */
test('a subdivision gets a tag sequence rather than a pair of regional indicators', () => {
  const { points } = gpxFavourites(
    gpx(
      '<wpt lat="51.513" lon="-0.136"><name>Soho</name>' +
        '<extensions><pgr:city>London</pgr:city><pgr:country>England</pgr:country></extensions></wpt>',
    ),
  );

  expect(points[0]?.name).toBe('\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F} Soho, London, England');
});

test('a locality is optional where a name and a country are not', () => {
  const { points } = gpxFavourites(
    gpx(
      '<wpt lat="1" lon="2"><name>Lone Place</name>' +
        '<extensions><pgr:country>Australia</pgr:country></extensions></wpt>',
    ),
  );

  expect(points[0]?.name).toBe('🇦🇺 Lone Place, Australia');
});

/**
 * Each of the three ways an entry can be unusable, named by the element at fault and without the file — which the
 * caller adds, since it is the half this does not know. A backup that imported any of them would carry a favourite
 * PGSharp cannot show, so these are refusals rather than fallbacks.
 */
test.for([
  { fault: 'no country', body: '<wpt lat="1" lon="2"><name>Nowhere</name></wpt>', says: '<wpt> has no <pgr:country>' },
  {
    fault: 'a country COUNTRIES does not carry',
    body: '<wpt lat="1" lon="2"><name>Nowhere</name><extensions><pgr:country>Wakanda</pgr:country></extensions></wpt>',
    says: 'no flag for "Wakanda"',
  },
  {
    fault: 'no name',
    body: '<wpt lat="1" lon="2"><extensions><pgr:country>Australia</pgr:country></extensions></wpt>',
    says: '<wpt> has no <name>',
  },
  {
    fault: 'an unparseable coordinate',
    body:
      '<wpt lat="1" lon="east"><name>Nowhere</name>' +
      '<extensions><pgr:country>Australia</pgr:country></extensions></wpt>',
    says: '<wpt> at 1,east has an unparseable coordinate',
  },
])('an entry with $fault is refused', ({ body, says }) => {
  expect(() => gpxFavourites(gpx(body))).toThrow(says);
});

/**
 * "hlfavor" is Gson's spelling of the Points list: no spaces, forward slashes escaped and every non-ASCII character as
 * `\uXXXX`. The fields are pinned by position as well as by value, because what makes this right is that it matches
 * PGSharp's own output byte for byte rather than that it parses back.
 */
test('encodePoints escapes non-ASCII and slashes', () => {
  expect(encodePoints([{ name: 'Praça/São', lat: 1.5, lng: -2.25, tz: 'America/Sao_Paulo' }])).toBe(
    '[{"name":"Pra\\u00e7a\\/S\\u00e3o","lat":1.5,"lng":-2.25,"tz":"America\\/Sao_Paulo"}]',
  );
});

/** A flag is escaped per UTF-16 code unit, which is a surrogate pair each — what PGSharp's hot places carry. */
test('encodePoints escapes a flag as its surrogates', () => {
  expect(encodePoints([{ name: '🇦🇺 Zoo', lat: 0, lng: 0 }])).toBe(
    '[{"name":"\\ud83c\\udde6\\ud83c\\uddfa Zoo","lat":0,"lng":0}]',
  );
});

/** A point with no zone is written without the field rather than with a null one, which PGSharp accepts. */
test('encodePoints omits an absent timezone', () => {
  expect(encodePoints([{ name: 'A', lat: 0, lng: 0 }])).toBe('[{"name":"A","lat":0,"lng":0}]');
});

/**
 * "hlfavorRoute" differs from "hlfavor" in exactly one way — it writes non-ASCII literally — which is why the two keys
 * do not share an encoder. The slash escaping is common to both.
 */
test('encodeRoutes leaves non-ASCII literal and still escapes slashes', () => {
  expect(encodeRoutes([{ name: 'São/Paulo', points: [[1, 2, 65536]] }])).toBe(
    '[{"points":[[1,2,65536]],"mode":2,' +
      '"state":{"direction":1,"nextNodePos":0,"preNodePos":-1,"loopcount":0,"lat":0,"lng":0},' +
      '"name":"São\\/Paulo"}]',
  );
});

test('dedupeByName keeps the first of a repeated name and counts the rest', () => {
  const entries = [
    { name: 'Zoo', lat: 1 },
    { name: 'Park', lat: 2 },
    { name: 'Zoo', lat: 3 },
    { name: 'Zoo', lat: 4 },
  ];

  expect(dedupeByName(entries)).toEqual({
    out: [
      { name: 'Zoo', lat: 1 },
      { name: 'Park', lat: 2 },
    ],
    dropped: 2,
  });
});

/**
 * The accent fold, which only shows in an order where some name's third character falls past the accented one: `ã`
 * decomposes to `a` plus a combining tilde, so folded "São Paulo" sorts under "Sao" and lands before Sapporo, where
 * unfolded the bare `ã` (U+00E3) is above every ASCII letter and would put it after. Sand Dunes is the control — `n`
 * is below both readings, so it leads either way and its place says nothing about the fold.
 */
test('byName folds accents, so São Paulo files under Sao', () => {
  const names = ['Sapporo', 'São Paulo', 'Sand Dunes'].map((name) => ({ name }));
  expect(names.sort(byName).map((e) => e.name)).toEqual(['Sand Dunes', 'São Paulo', 'Sapporo']);
});

/**
 * The leading flag is folded out too. Australia's regional indicators are below Japan's, so sorting by the name as
 * stored would put the zoo first — it is stripping the decoration that gets the list into the order a reader reads.
 */
test('byName sorts past the flag rather than by it', () => {
  const names = ['🇦🇺 Zoo, Melbourne, Australia', '🇯🇵 Akihabara, Tokyo, Japan'].map((name) => ({ name }));

  expect(names.sort(byName).map((e) => e.name)).toEqual(['🇯🇵 Akihabara, Tokyo, Japan', '🇦🇺 Zoo, Melbourne, Australia']);
});

/** Two names the fold cannot tell apart still order deterministically, on the spelling the files gave. */
test('byName breaks a folded tie on the exact spelling', () => {
  const names = ['São Paulo', 'Sao Paulo'].map((name) => ({ name }));

  expect(names.sort(byName).map((e) => e.name)).toEqual(['Sao Paulo', 'São Paulo']);
  expect(byName({ name: 'Sao Paulo' }, { name: 'Sao Paulo' })).toBe(0);
});

/**
 * A zone name is a property of a boundary rather than of an offset, which is the whole reason this comes out of
 * tz-lookup's boundary data: Melbourne and Brisbane are both UTC+10 in July and no formula over a coordinate would tell
 * them apart. A coordinate outside ±90 is counted rather than guessed at, and leaves the field absent.
 */
test('applyTimezones names each zone from its boundary and counts the ones it cannot', () => {
  const points: Point[] = [
    { name: 'Melbourne', lat: -37.8136, lng: 144.9631 },
    { name: 'Brisbane', lat: -27.4698, lng: 153.0251 },
    { name: 'Off the globe', lat: 91, lng: 0 },
  ];

  expect(applyTimezones(points)).toBe(1);
  expect(points.map((p) => p.tz)).toEqual(['Australia/Melbourne', 'Australia/Brisbane', undefined]);
});
