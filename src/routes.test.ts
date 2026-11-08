import { expect, test } from 'vitest';

import { byKey, fmtDist, gpxEntries, haversine, routeDistance } from './routes.js';
import { parseXml } from './testing/xml.js';

const gpx = (body: string) =>
  parseXml(
    '<gpx xmlns="http://www.topografix.com/GPX/1/1" ' +
      `xmlns:pgr="https://spence.com.au/pogo-utils/gpx/1">${body}</gpx>`,
  );

/**
 * The sphere's own radius is 6,371,000 m, so a degree of a great circle is `R × π / 180` and half a circumference is `π
 * × R` — both exact and derivable without running anything, which is what makes them the anchors rather than a figure
 * read back out of the function. A degree of latitude and a degree of longitude *at the equator* are the same distance,
 * which is the other half of what says the formula weighs longitude by the cosine of the latitude.
 */
const DEGREE = (6371000 * Math.PI) / 180;

test('haversine measures a great circle', () => {
  expect(haversine([0, 0], [1, 0])).toBeCloseTo(DEGREE, 6);
  expect(haversine([0, 0], [0, 1])).toBeCloseTo(DEGREE, 6);
  expect(haversine([90, 0], [-90, 0])).toBeCloseTo(Math.PI * 6371000, 6);
  expect(haversine([0, 0], [0, 0])).toBe(0);
});

/**
 * A degree of longitude shrinks towards the poles, which is the cosine term and the reason this is not Pythagoras. The
 * parallel at 60°N is `DEGREE × cos 60°` long, and the great circle between its ends is *shorter* than that — it cuts
 * inside the parallel, which is not a circle of the sphere. So the assertion is both facts and neither is approximate:
 * under half a kilometre of the parallel's 55.6 km, and below it rather than equal to it.
 */
test('haversine weighs a degree of longitude by its latitude, and cuts inside the parallel', () => {
  const parallel = DEGREE * Math.cos((60 * Math.PI) / 180);
  const greatCircle = haversine([60, 0], [60, 1]);

  expect(parallel - greatCircle).toBeGreaterThan(0);
  expect(parallel - greatCircle).toBeLessThan(1);
  expect(greatCircle).toBeLessThan(haversine([0, 0], [0, 1]) / 1.9);
});

/** Symmetric, since a distance is not a direction. */
test('haversine is symmetric', () => {
  const melbourne = [-37.8136, 144.9631] as const;
  const sydney = [-33.8688, 151.2093] as const;

  expect(haversine(melbourne, sydney)).toBe(haversine(sydney, melbourne));
});

/**
 * Melbourne to Sydney against a figure worked out by a different formula rather than read off this function: the angle
 * between the two points' unit vectors, `atan2(|a × b|, a · b)`, times the radius, which is 713,427.48 m to the
 * centimetre. The assertion is held to that centimetre and no finer, since any digits past it would be this function's
 * own.
 */
test('haversine agrees with an independently computed distance', () => {
  expect(haversine([-37.8136, 144.9631], [-33.8688, 151.2093])).toBeCloseTo(713427.48, 2);
});

/**
 * The walked length over every consecutive pair, so a route doubling back counts both legs — it is how far you walk and
 * not how far you end up from the start. Fewer than two points is no distance rather than an error; `gpxEntries` is
 * what refuses a `<trk>` that cannot be drawn.
 */
test('routeDistance sums every leg', () => {
  const melbourne = [-37.8136, 144.9631] as const;
  const sydney = [-33.8688, 151.2093] as const;
  const brisbane = [-27.4698, 153.0251] as const;

  expect(routeDistance([melbourne, sydney, brisbane])).toBeCloseTo(
    haversine(melbourne, sydney) + haversine(sydney, brisbane),
    6,
  );
  expect(routeDistance([melbourne, sydney, brisbane])).toBeGreaterThan(haversine(melbourne, brisbane));
});

test('routeDistance counts a leg walked back', () => {
  const there = [0, 0] as const;
  const back = [1, 0] as const;

  expect(routeDistance([there, back, there])).toBeCloseTo(2 * DEGREE, 6);
});

test.for([
  { points: 'no', latlngs: [] as const },
  { points: 'one', latlngs: [[0, 0]] as const },
])('a route of $points points is no distance', ({ latlngs }) => {
  expect(routeDistance(latlngs)).toBe(0);
});

/**
 * Kilometres to two decimals from a kilometre up, whole metres below it. Two boundaries are worth having written down
 * rather than reasoned about:
 *
 * 999.6 m reads as "1000 m" and not "1.00 km", because the switch is on the unrounded value while the metres are
 * rounded — so a four-digit figure of metres is reachable, for the 0.5 m below a kilometre.
 *
 * 1005 m reads as "1.00 km" and not "1.01 km", because `1005 / 1000` is 1.0049999999999998934 in binary floating point
 * and `toFixed` rounds the value it is given rather than the decimal it was written as. 1006 m is the first to read as
 * 1.01. Neither is worth a fix at a label quoted to ten metres, but a reader comparing two routes a metre apart should
 * know it is there.
 */
test.for([
  { metres: 0, reads: '0 m' },
  { metres: 1.4, reads: '1 m' },
  { metres: 1.5, reads: '2 m' },
  { metres: 999, reads: '999 m' },
  { metres: 999.6, reads: '1000 m' },
  { metres: 1000, reads: '1.00 km' },
  { metres: 1005, reads: '1.00 km' },
  { metres: 1006, reads: '1.01 km' },
  { metres: 1234.5, reads: '1.23 km' },
  { metres: 713427.48, reads: '713.43 km' },
])('$metres m reads as $reads', ({ metres, reads }) => {
  expect(fmtDist(metres)).toBe(reads);
});

/**
 * The comparison `Array#sort` would have made over the keys alone, which is what the sidebar's two levels were sorted
 * by before each key started travelling beside its value. `<` over two strings compares UTF-16 code units, so an
 * uppercase letter sorts above every lowercase one — the sidebar's keys are country and continent names, all
 * capitalised.
 */
test('byKey orders two keyed pairs by their keys', () => {
  expect(byKey(['Australia', 1], ['Brazil', 2])).toBe(-1);
  expect(byKey(['Brazil', 1], ['Australia', 2])).toBe(1);
  expect(byKey(['Japan', 1], ['Japan', 2])).toBe(0);

  const rows: [string, number][] = [
    ['Oceania', 1],
    ['Asia', 2],
    ['Europe', 3],
  ];

  expect(rows.sort(byKey).map(([key]) => key)).toEqual(['Asia', 'Europe', 'Oceania']);
});

/**
 * A `<trk>` is a path and a `<wpt>` is one place, and a file may hold either or both — split by element rather than by
 * which file it came out of. Variant and event are empty where the file names neither: a route with no short/long
 * counterpart and a place that stands on its own.
 *
 * Whole objects rather than field by field, so a field added to either shape and left unfilled fails here. `gpx` is the
 * one matched loosely: what `entryGpx` writes is its own test's business (src/gpx.test.ts), and the attribute order a
 * serializer chooses is nobody's contract.
 */
test('gpxEntries splits a file into routes and waypoints', () => {
  const { routes, waypoints } = gpxEntries(
    gpx(
      '<trk><name>Tan Track</name><extensions><pgr:city>Melbourne</pgr:city>' +
        '<pgr:country>Australia</pgr:country><pgr:variant>long</pgr:variant>' +
        '<pgr:event>Community Day</pgr:event></extensions>' +
        '<trkseg><trkpt lat="-37.8" lon="144.97"/><trkpt lat="-37.81" lon="144.98"/></trkseg></trk>' +
        '<wpt lat="-37.7841" lon="144.95120"><name>Melbourne Zoo</name>' +
        '<extensions><pgr:country>Australia</pgr:country></extensions></wpt>',
    ),
  );

  expect(routes).toEqual([
    {
      latlngs: [
        [-37.8, 144.97],
        [-37.81, 144.98],
      ],
      name: 'Tan Track, Melbourne',
      country: 'Australia',
      variant: 'long',
      event: 'Community Day',
      gpx: expect.stringContaining('<name>Tan Track</name>'),
    },
  ]);

  expect(waypoints).toEqual([
    {
      name: 'Melbourne Zoo',
      country: 'Australia',
      event: '',
      coords: [-37.7841, 144.9512],
      coordStr: '-37.7841,144.95120',
    },
  ]);
});

/**
 * A route with no short/long counterpart and no event gets the empty string for each rather than a null travelling into
 * the sidebar, where `${entry.variant}` would read as "null". The same default on the waypoint side is asserted above.
 */
test('a route names an absent variant and event as empty', () => {
  const { routes } = gpxEntries(
    gpx(
      '<trk><name>Plain</name><extensions><pgr:country>Australia</pgr:country></extensions>' +
        '<trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk>',
    ),
  );

  expect(routes[0]?.variant).toBe('');
  expect(routes[0]?.event).toBe('');
});

/** A file holding only waypoints is as valid as one holding only tracks, which is why neither list is required. */
test.for([
  {
    holds: 'only a track',
    body:
      '<trk><name>A</name><extensions><pgr:country>Australia</pgr:country></extensions>' +
      '<trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk>',
    routes: 1,
    waypoints: 0,
  },
  {
    holds: 'only a waypoint',
    body: '<wpt lat="1" lon="2"><name>A</name><extensions><pgr:country>Australia</pgr:country></extensions></wpt>',
    routes: 0,
    waypoints: 1,
  },
])('a file holding $holds is read', ({ body, routes, waypoints }) => {
  const read = gpxEntries(gpx(body));

  expect(read.routes).toHaveLength(routes);
  expect(read.waypoints).toHaveLength(waypoints);
});

/**
 * A `<trk>` that kept a single point is a track that cannot be *drawn*, which is the viewer's rule rather than the
 * format's — `eachTrack` yields it and this is what refuses it. The emptied one gpx.studio writes for a cleared route
 * is a different thing and is skipped a level down, so a file holding only that reads as having nothing to show at all.
 */
test('a track of one point is refused rather than drawn', () => {
  const body =
    '<trk><name>A</name><extensions><pgr:country>Australia</pgr:country></extensions>' +
    '<trkseg><trkpt lat="1" lon="2"/></trkseg></trk>';

  expect(() => gpxEntries(gpx(body))).toThrow('<trk> has fewer than two usable <trkpt>');
});

test.for([
  { holds: 'nothing at all', body: '' },
  { holds: 'only an emptied track', body: '<trk><name>Cleared</name></trk>' },
  { holds: 'only metadata', body: '<metadata><author><name>gpx.studio</name></author></metadata>' },
])('a file holding $holds has nothing to show', ({ body }) => {
  expect(() => gpxEntries(gpx(body))).toThrow('has no <trk> or <wpt>');
});

/** An entry missing what it needs is refused rather than guessed at, so the gap reaches the banner. */
test.for([
  {
    fault: 'a track with no country',
    body: '<trk><name>A</name><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk>',
    says: '<trk> has no <pgr:country>',
  },
  {
    fault: 'a waypoint with no name',
    body: '<wpt lat="1" lon="2"><extensions><pgr:country>Australia</pgr:country></extensions></wpt>',
    says: '<wpt> has no <name>',
  },
  {
    fault: 'a track point that will not parse',
    body:
      '<trk><name>A</name><extensions><pgr:country>Australia</pgr:country></extensions>' +
      '<trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="west"/></trkseg></trk>',
    says: '<trkpt> at 3,west has an unparseable coordinate',
  },
])('$fault is refused', ({ body, says }) => {
  expect(() => gpxEntries(gpx(body))).toThrow(says);
});
