/**
 * What a GPX file says to the Routes page, and how far a track goes. `src/pages/map.tsx` holds the Leaflet map and so
 * cannot be reached outside a browser, where nothing here wants more than an XML tree.
 *
 * The shapes are the viewer's rather than the format's — a `<trk>` becomes something with a `latlngs` Leaflet will
 * draw, where the backup builder's `gpxFavourites` turns the same element into a list of triples PGSharp stores —
 * which is why the two readers are separate and both sit on the primitives in `gpx.ts`.
 */

import { MIN_TRKPTS } from './gpx-dialect.js';
import { eachTrack, entryCoords, entryCountry, entryGpx, entryName, extText, placeName } from './gpx.js';

/**
 * A drawable track as the file gives it. `latlngs` is a list of *pairs* rather than a list of lists, because that is
 * what Leaflet means by a `LatLngExpression`: an unannotated `[lat, lon]` literal infers `number[]`, which `L.polyline`
 * rejects, where a `[number, number]` tuple is accepted.
 *
 * `gpx` is this one track written back out as a file of its own, for the Copy button to hand over. It is carried here
 * rather than taken off the page's own copy of the fetched text because a stored file holds a whole country: what was
 * read is every route in it, and what was asked for is this one.
 *
 * `fullName` is the whole name `entryName` gives, country and variant included, which is what hiding the route
 * remembers it by and so what the backup leaves it out by.
 */
export interface Route {
  latlngs: [number, number][];
  name: string;
  fullName: string;
  country: string;
  variant: string;
  event: string;
  gpx: string;
}

/**
 * One place to stand. `coordStr` is the file's own lat/lon text rather than the parsed pair restringified, so what the
 * copy button hands over is exactly what the file said. `fullName` is a route's.
 */
export interface Waypoint {
  name: string;
  fullName: string;
  country: string;
  event: string;
  coords: [number, number];
  coordStr: string;
}

/** Metres between two coordinates over a spherical earth, which is what a walking route wants. */
export function haversine(a: readonly [number, number], b: readonly [number, number]): number {
  const R = 6371000,
    toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]),
    dLon = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * The walked length of a track, summed over consecutive pairs. The previous point is carried rather than read back out
 * of the list by `i - 1`: an index and the length test above it are two questions nothing joins, where holding the
 * point the loop has just had is one.
 *
 * The pairs are `readonly` as well as the list, matching `haversine` beside it: this only reads them, and a mutable
 * element type rejected a caller holding an `as const` pair for no reason it could act on. `Route#latlngs` is mutable
 * because Leaflet wants it so, and a mutable tuple is assignable here.
 */
export function routeDistance(latlngs: readonly (readonly [number, number])[]): number {
  let d = 0;
  let previous;

  for (const at of latlngs) {
    if (previous) {
      d += haversine(previous, at);
    }

    previous = at;
  }

  return d;
}

/** Metres as a reader reads them: two decimals of a kilometre past a kilometre, whole metres below it. */
export function fmtDist(m: number): string {
  return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
}

/**
 * Two keyed pairs in the order `Array#sort` with no comparator would have put their keys in. Both levels of the sidebar
 * were sorted that way before each key started travelling beside its value, and this is that comparison written out
 * rather than a different one — `<` over two distinct strings is exactly what the default does.
 */
export function byKey(a: readonly [string, unknown], b: readonly [string, unknown]): number {
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

/**
 * One file's routes and waypoints, split by element: a `<trk>` is a path to walk, a `<wpt>` one place to stand, and a
 * file may hold either or both.
 *
 * Everything comes from the file's own metadata, and an entry missing what it needs is rejected rather than guessed at,
 * so the gap shows up in the banner instead of quietly reading back the path. Variant and event stay optional.
 *
 * A route carries itself back out as GPX where a waypoint does not, the one handing the clipboard a file and the other
 * a coordinate pair. It takes the parsed tree rather than the file's text for the reason `gpxFavourites` does.
 */
export function gpxEntries(doc: Document): { routes: Route[]; waypoints: Waypoint[] } {
  const routes: Route[] = [];

  for (const { trk, trkpts } of eachTrack(doc)) {
    const latlngs = [...trkpts].map((p) => entryCoords(p).coords);

    if (latlngs.length < MIN_TRKPTS) {
      throw new Error('<trk> has fewer than two usable <trkpt>');
    }

    routes.push({
      latlngs,
      name: placeName(trk),
      fullName: entryName(trk),
      country: entryCountry(trk),
      variant: extText(trk, 'variant') || '',
      event: extText(trk, 'event') || '',
      gpx: entryGpx(trk),
    });
  }

  const waypoints: Waypoint[] = [];

  for (const w of doc.getElementsByTagName('wpt')) {
    waypoints.push({
      country: entryCountry(w),
      name: placeName(w),
      fullName: entryName(w),
      ...entryCoords(w),
      event: extText(w, 'event') || '',
    });
  }

  // A listed file holding neither is a defect too: something is in data/gpx-paths.json that has nothing to show.
  if (routes.length === 0 && waypoints.length === 0) {
    throw new Error('has no <trk> or <wpt>');
  }

  return { routes, waypoints };
}
