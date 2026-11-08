/**
 * The two favourite lists a PGSharp backup carries, and how a GPX tree turns into them — everything `pgsdata.ts` does
 * to a file between parsing it and handing the result to the serializer, ported from pgsedit.
 *
 * None of it touches the DOM beyond the `Document` it is handed, which is what lets a test drive the real encoders
 * over a real tree rather than the page having to be opened to reach them.
 */

import tzlookup from 'tz-lookup';

import COUNTRIES from '../countries.js';
import { eachTrack, entryCoords, entryCountry, extText, placeName } from '../gpx.js';

/** The two favourite keys in PGSData.dat: one coordinate each, and whole paths. */
export const POINTS_KEY = 'hlfavor';
export const ROUTES_KEY = 'hlfavorRoute';

/**
 * Third element of every stored route point, and the neutral playback state of a route that has not been walked — both
 * copied from PGSharp's own output.
 */
const ROUTE_POINT_FLAG = 65536;
const ROUTE_MODE = 2;
const newRouteState = () => ({
  direction: 1,
  nextNodePos: 0,
  preNodePos: -1,
  loopcount: 0,
  lat: 0,
  lng: 0,
});

/**
 * The two favourite schemas, one per key. Here rather than in `src/types.d.ts` because these have an owner: nothing
 * outside the PGSharp page reads or writes either.
 *
 * `tz` is optional because `applyTimezones` writes it after the fact. A Route holds only what the GPX says: the `mode`
 * and `state` PGSharp wants beside every route are the same for all of them, so `encodeRoutes` writes them. A route
 * point is a fixed triple rather than a list of numbers, which is what `encodeRoutes` re-emits positionally.
 */
type RoutePoint = [number, number, number];
export type Point = { name: string; lat: number; lng: number; tz?: string };
export type Route = { name: string; points: RoutePoint[] };

/**
 * Gson's JSON spelling: no spaces, forward slashes escaped. Points escape non-ASCII as \uXXXX (what "hlfavor"
 * contains); Routes write it literally ("São Paulo") — the two keys differ, so they don't share an encoder. A flag is
 * escaped per UTF-16 code unit either way, matching hot places for Points and leaving the Route stream to write the
 * surrogates as Java's modified UTF-8 does.
 */

const escSlashes = (s: string) => s.replace(/\//g, '\\/');

const asciiEscape = (s: string) =>
  s.replace(/[\u0080-\uFFFF]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

export function encodePoints(entries: readonly Point[]) {
  const arr = entries.map((e) => {
    const o: Point = { name: e.name, lat: e.lat, lng: e.lng };

    if (e.tz) {
      o.tz = e.tz;
    }

    return o;
  });
  return escSlashes(asciiEscape(JSON.stringify(arr)));
}

export function encodeRoutes(entries: readonly Route[]) {
  const arr = entries.map((e) => ({
    points: e.points,
    mode: ROUTE_MODE,
    state: newRouteState(),
    name: e.name,
  }));
  return escSlashes(JSON.stringify(arr));
}

/**
 * A favourite's whole name — "Kings Park, Perth, Western Australia, Australia (long)". PGSharp lists and deletes
 * favourites by name, so this is the only identity one has, which is why every part comes from the file rather than
 * the path. Mirrors pgsedit's `entry_name`.
 */
function entryName(el: Element) {
  const label = `${placeName(el)}, ${entryCountry(el)}`;
  const variant = extText(el, 'variant');
  return variant ? `${label} (${variant})` : label;
}

/**
 * A subdivision flag is a black flag, the region and subdivision letters as tag characters (ASCII shifted into the tag
 * block), then the cancel tag.
 */
const REGIONAL_INDICATOR_A = 0x1f1e6,
  TAG_BLOCK = 0xe0000,
  CANCEL_TAG = 0xe007f;
const BLACK_FLAG = '\u{1F3F4}';

/**
 * The emoji flag for a country, derived from its alpha-2 code in `COUNTRIES`. PGSharp's own hot places carry one at
 * the front of the name — "🇺🇸 Pier 39, California, USA" — the format having no icon field, and both favourite kinds
 * follow that convention. A country with no entry in `COUNTRIES` errors rather than importing without a flag.
 */
function countryFlag(country: string) {
  const code = COUNTRIES[country]?.code;

  if (!code) {
    throw new Error(`no flag for "${country}" — add it to COUNTRIES`);
  }

  if (code.includes('-')) {
    const tags = [...code.replace('-', '').toLowerCase()].map((c) => String.fromCodePoint(TAG_BLOCK + c.charCodeAt(0)));
    return BLACK_FLAG + tags.join('') + String.fromCodePoint(CANCEL_TAG);
  }

  return [...code].map((c) => String.fromCodePoint(REGIONAL_INDICATOR_A + c.charCodeAt(0) - 65)).join('');
}

/**
 * A favourite's name with its country's flag in front.
 */
function flaggedName(el: Element) {
  return `${countryFlag(entryCountry(el))} ${entryName(el)}`;
}

/**
 * Split one GPX tree into Points and Routes by element, not by filename: a <wpt> is one coordinate (a Point), a <trk>
 * is a path (a Route keeping all of its <trkpt>). A file may hold either or both. Mirrors pgsedit's parse_gpx — an
 * empty <trk> is skipped (gpx.studio writes one for a cleared track) rather than treated as a route. Both kinds are
 * flagged, so the two lists read alike in the app even though PGSharp shows them on separate tabs.
 *
 * It takes the parsed tree rather than the file's text, so the one call a browser is needed for stays at the caller.
 */
export function gpxFavourites(doc: Document) {
  const points: Point[] = [];

  const routes: Route[] = [];

  for (const wpt of doc.getElementsByTagName('wpt')) {
    const [lat, lng] = entryCoords(wpt).coords;
    points.push({ name: flaggedName(wpt), lat, lng });
  }

  for (const { trk, trkpts } of eachTrack(doc)) {
    const pts: RoutePoint[] = [];

    for (const p of trkpts) {
      const [lat, lng] = entryCoords(p).coords;
      pts.push([lat, lng, ROUTE_POINT_FLAG]);
    }

    routes.push({ name: flaggedName(trk), points: pts });
  }

  return { points, routes };
}

/**
 * A coordinate's IANA zone, or `null` where tz-lookup will not name one. It throws a `RangeError` outside ±90/±180 and
 * answers a zone for every coordinate inside them, so the `catch` is the whole of the failure case — nothing guards the
 * call itself, the library being in this module's own bundle rather than a `<script>` that may not have run yet.
 */
function zoneOf(lat: number, lng: number) {
  try {
    return tzlookup(lat, lng);
  } catch {
    return null;
  }
}

/**
 * Fill in each Point's IANA timezone from its coordinates, mirroring pgsedit's `apply_timezones`. The name is a
 * property of a boundary polygon rather than anything a formula derives from a coordinate — Melbourne and Sydney share
 * a UTC offset but not a zone name — so it comes from the boundary data tz-lookup carries. Routes have no `tz` field.
 * A point whose zone cannot be found is left without one, PGSharp accepting that; the count is returned so the caller
 * can say so once.
 */
export function applyTimezones(points: Point[]) {
  let unknown = 0;

  for (const p of points) {
    const tz = zoneOf(p.lat, p.lng);

    if (tz) {
      p.tz = tz;
    } else {
      unknown++;
    }
  }

  return unknown;
}

/**
 * Names must be unique within a kind (PGSharp lists and deletes by name), so drop any repeated name, keeping the first.
 * It is generic over the two kinds rather than taking a `{name: string}`, because the caller sorts and timezones what
 * it hands back: a parameter naming only the field this reads would answer with only that field.
 */
export function dedupeByName<T extends { name: string }>(entries: readonly T[]) {
  const seen = new Set();

  const out: T[] = [];
  let dropped = 0;

  for (const e of entries) {
    if (seen.has(e.name)) {
      dropped++;
      continue;
    }

    seen.add(e.name);
    out.push(e);
  }

  return { out, dropped };
}

/**
 * Order favourites the way pgsedit's `reorder` does: fold accents (decompose with NFKD, then drop the combining marks)
 * and case, so "São Paulo" files under S rather than after every ASCII name. A tie on the folded key falls back to the
 * exact spelling, so names differing only by accent still order deterministically. Each kind is sorted within itself,
 * as PGSharp lists them separately. A favourite's leading flag is decoration rather than part of how the list reads, so
 * it is folded out too — otherwise every place would sort by its country's regional-indicator code instead of by name.
 */
const sortKey = (name: string) =>
  (name || '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

export function byName(a: { name: string }, b: { name: string }) {
  const ka = sortKey(a.name),
    kb = sortKey(b.name);

  if (ka !== kb) {
    return ka < kb ? -1 : 1;
  }

  if (a.name !== b.name) {
    return a.name < b.name ? -1 : 1;
  }

  return 0;
}
