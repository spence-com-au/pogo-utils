/**
 * The GPX route map: every track and waypoint in the repository, drawn on Leaflet and listed in a sidebar grouped by
 * continent and country.
 *
 * Leaflet's stylesheet is not imported here, though this is the only module that needs it: a sheet imported from a
 * dynamically imported page lands in that page's own CSS file, which esbuild emits and ships no runtime to fetch — see
 * `src/main.tsx`, which imports them all.
 *
 * The split between state and imperative code follows who owns the object. The sidebar is this component's and is
 * rendered from state; the layers are Leaflet's, which owns their styling, popups and viewport, so they are created
 * once and then told about selection from an effect rather than rebuilt by a render.
 */

import * as L from 'leaflet';

import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import COUNTRIES from '../countries.js';
import { byKey, fmtDist, gpxEntries, routeDistance, type Route, type Waypoint } from '../routes.js';
import { copyText, el } from '../dom.js';
import { LOCAL_EVENTS } from '../event-feed.js';
import { GPX_PATHS } from '../generated.js';
import { loadManifest, parseGpxDocument } from '../gpx.js';
import { said } from '../errors.js';
import { toHash } from '../router.js';

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * A route once the page has it: the layer drawn for it and the distance measured off it.
 *
 * `id` is assigned as the entries are made, a name not being unique — two countries can both have a Central Park — and
 * is what the row and the layer are joined by, neither holding a pointer to the other.
 */
type RouteEntry = Route & { id: string; line: L.Polyline; distance: number };

/** A waypoint once the page has it. No distance: the dot is the entry, so selecting it restyles the one layer. */
type CityEntry = Waypoint & { id: string; marker: L.CircleMarker };

/** Everything read off the files, and the names for the events they were added for. */
interface Loaded {
  routes: readonly RouteEntry[];
  cities: readonly CityEntry[];
  eventNames: ReadonlyMap<string, string>;
}

/** One file that could not be read, and why. */
interface Failure {
  file: string;
  reason: string;
}

/**
 * A file the server would not hand over — a status the fetch rejected on, or a connection that never got there. The
 * banner keeps these apart from the defects gpxEntries throws for: a 503 is a hiccup to reload through, not metadata
 * anyone can go and fix.
 */
class FetchError extends Error {}

/**
 * Read one file: fetch it, parse it, and let `gpxEntries` split it by element. The text is not kept — a file holds a
 * whole country, and each route carries its own GPX for the copy button (see `Route#gpx`).
 */
async function loadGpxFile(file: string): Promise<{ routes: Route[]; waypoints: Waypoint[] }> {
  let res;

  try {
    res = await fetch(encodeURI(file));
  } catch (e) {
    throw new FetchError(said(e));
  }

  if (!res.ok) {
    // HTTP/2 sends no reason phrase, so a bare status is all there is to say — trim rather than print a trailing space.
    throw new FetchError(`${res.status} ${res.statusText}`.trim());
  }

  return gpxEntries(parseGpxDocument(await res.text()));
}

/**
 * The name to show for a `<pgr:event>`, which the files record only by `eventID`. `LOCAL_EVENTS` is where that name lives
 * — the same file `validate-gpx.mts` checks those IDs against.
 *
 * A fetch that fails leaves every entry naming its event by ID, which reads well enough and still links to the right
 * place, so a missing calendar is not worth withholding a page of routes over.
 */
async function loadEventNames(): Promise<ReadonlyMap<string, string>> {
  const names = new Map<string, string>();

  try {
    const res = await fetch(LOCAL_EVENTS);

    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`.trim());
    }

    for (const event of await res.json()) {
      names.set(event.eventID, event.name);
    }
  } catch (e) {
    console.error(`${LOCAL_EVENTS}: ${said(e)} — entries will name their event by ID`);
  }

  return names;
}

/**
 * How an unselected line and dot are drawn. Both the layer's creation and the deselect that returns it here read these,
 * so the two cannot disagree about what "not selected" looks like — which matters because the colour is a decision
 * rather than a constant: an entry added for an event is drawn in `--event`, and the sidebar row mirrors it.
 */
function routeStyle(route: Route): L.PolylineOptions {
  return { color: cssVar(route.event ? '--event' : '--track'), weight: 2, opacity: 0.55 };
}

function cityStyle(place: Waypoint): L.CircleMarkerOptions {
  return { radius: 5, color: '#fff', weight: 2, fillColor: cssVar(place.event ? '--event' : '--city'), fillOpacity: 1 };
}

/**
 * A map popup: a bold title, a detail line, and a copy button.
 *
 * Built with the DOM rather than rendered, and the one place in this file that is. A popup belongs to Leaflet, which
 * decides when the element is attached, moved and thrown away, so handing it a node it owns outright is less machinery
 * than keeping a second Preact root alive inside someone else's lifecycle.
 */
function buildPopup(name: string, detail: string, copyLabel: string, text: string, onCopied: (ok: boolean) => void) {
  const popup = el('div');
  const button = el('button', 'popup-copy', copyLabel);

  button.type = 'button';

  button.addEventListener('click', () => {
    void copyText(text).then((ok) => {
      // Read back off the element rather than captured, so a second click inside the window restores the label rather
      // than the "Copied" the first one left.
      const restore = button.dataset['label'] ?? button.textContent;

      button.dataset['label'] = restore ?? '';
      button.textContent = ok ? 'Copied' : 'Failed';
      button.classList.add('done');

      setTimeout(() => {
        button.textContent = restore;
        button.classList.remove('done');
        delete button.dataset['label'];
      }, 1400);

      onCopied(ok);
    });
  });

  popup.append(el('b', null, name), el('div', null, detail), button);

  return popup;
}

/**
 * A copy button that says how it went. Its own component so the flash is state belonging to the one button rather than
 * a timer and a captured label in a WeakMap keyed by element, which is what it took to do this to a node.
 */
function CopyButton({ text, title, onCopied }: { text: string; title: string; onCopied: (ok: boolean) => void }) {
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (flash === null) {
      return;
    }

    const restore = setTimeout(() => setFlash(null), 1400);

    return () => clearTimeout(restore);
  }, [flash]);

  return (
    <button
      type="button"
      class={flash === null ? 'copy' : 'copy done'}
      title={title}
      onClick={(event) => {
        // The row behind it would select the entry otherwise, which a reader reaching for Copy did not ask for.
        event.stopPropagation();

        void copyText(text).then((ok) => {
          setFlash(ok ? 'Copied' : 'Failed');
          onCopied(ok);
        });
      }}
    >
      {flash ?? 'Copy'}
    </button>
  );
}

/** One row in the sidebar, before it knows which group will hold it. */
interface Row {
  id: string;
  name: string;
  country: string;
  dist: number;
  event: string;
  hit: boolean;
  gpx: string | null;
  coordStr: string | null;
}

export default function MapPage({ query: fragment }: { query: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  /**
   * The same entries, reachable from a closure made before they arrived: a Leaflet layer's `click` handler is attached
   * as the layer is created, inside the load effect, whose closure captured the render where `loaded` was still null.
   * Reading the ref is what lets one `select` serve those callers and the sidebar's rows alike.
   */
  const loadedRef = useRef<Loaded | null>(null);

  /**
   * The page could not even read the manifest, so there is nothing to draw and the message says what to do about it.
   */
  const [fatal, setFatal] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState<readonly Failure[]>([]);
  const [rejected, setRejected] = useState<readonly Failure[]>([]);

  const [filter, setFilter] = useState('');

  /**
   * What is selected, as a list rather than one of each: a link from the Events page names an event rather than an
   * entry, and an event can have been given several routes and waypoints, all selected together.
   */
  const [selected, setSelected] = useState<readonly string[]>([]);

  /** Which groups are open. Everything starts closed, and the filter reopens whatever still has rows in it. */
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const [toast, setToast] = useState<string | null>(null);

  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  /** The start and end dots, which exist only while a route is selected, by the route they belong to. */
  const markers = useRef(new Map<string, L.CircleMarker[]>());

  /** Each row's element, for scrolling the first of a selection into view. Keyed by entry id. */
  const rows = useRef(new Map<string, HTMLElement>());

  /**
   * An `?event=` the fragment named that has not been applied yet, because the files it names entries in had not
   * arrived. Spent once, so a hashchange lands it and nothing else re-applies it.
   */
  const pending = useRef<string | null>(null);

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  /** The first of a selection, scrolled to once the groups above it are open — which is the render this runs after. */
  useEffect(() => {
    const first = selected[0];

    if (first !== undefined) {
      rows.current.get(first)?.scrollIntoView({ block: 'nearest' });
    }
  }, [selected]);

  useEffect(() => {
    if (toast === null) {
      return;
    }

    const clear = setTimeout(() => setToast(null), 1800);

    return () => clearTimeout(clear);
  }, [toast]);

  /**
   * The map itself, made once. `zoomSnap: 0` lets fitBounds land on a fractional zoom; snapping to whole levels rounds
   * down, which can leave the fitted layers filling as little as half the map — a lot of dead space on a narrow phone
   * viewport.
   */
  useEffect(() => {
    const node = mapNode.current;

    if (node === null) {
      return;
    }

    const map = L.map(node, { worldCopyJump: true, zoomSnap: 0 }).setView([20, 0], 2);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    mapRef.current = map;

    // Leaflet keeps listeners on the window and a resize observer of its own, so leaving the page has to take them with
    // it — which the imperative page never had to say, the map living as long as the document did.
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /** Read every file, draw what each holds, and report the ones that could not be read. */
  useEffect(() => {
    const map = mapRef.current;

    if (map === null) {
      return;
    }

    let live = true;

    void (async () => {
      /**
       * Nothing can be drawn without the list, and reading it is the page's first fetch — so this is also where opening
       * the page from disk lands.
       */
      let files;

      try {
        files = await loadManifest();
      } catch (e) {
        if (live) {
          setFatal(said(e));
        }

        return;
      }

      // Started alongside the GPX files rather than ahead of them: the names are only labels, so every file fetch would
      // otherwise queue behind this one.
      const names = loadEventNames();

      /*
       * One bad file does not hide the others, but it is still reported. Each outcome is caught inside its own callback
       * rather than read out of `Promise.allSettled` by index, so the file and what went wrong travel together.
       */
      const results = await Promise.all(
        files.map(async (file) => {
          try {
            return { file, read: await loadGpxFile(file), failure: null as unknown };
          } catch (e) {
            return { file, read: null, failure: e };
          }
        }),
      );

      // Leaving the page while the files were in flight has removed the map, and a layer added to it then throws. The
      // loop below has no `await` for the page to be left during, so this one check covers it.
      if (!live) {
        return;
      }

      const routes: RouteEntry[] = [];
      const cities: CityEntry[] = [];
      const missing: Failure[] = [];
      const bad: Failure[] = [];

      for (const { file, read, failure } of results) {
        if (read === null) {
          (failure instanceof FetchError ? missing : bad).push({ file, reason: said(failure) });
          continue;
        }

        for (const route of read.routes) {
          const line = L.polyline(route.latlngs, routeStyle(route)).addTo(map);
          const entry: RouteEntry = { ...route, id: `r${routes.length}`, line, distance: routeDistance(route.latlngs) };

          line.on('click', () => select([entry.id], { pan: false }));
          routes.push(entry);
        }

        for (const place of read.waypoints) {
          const marker = L.circleMarker(place.coords, cityStyle(place)).addTo(map);
          const entry: CityEntry = { ...place, id: `w${cities.length}`, marker };

          // An element rather than the string: Leaflet assigns string content with innerHTML, and the name is read out
          // of a GPX file.
          marker.bindTooltip(el('span', null, place.name));
          marker.on('click', () => select([entry.id], { pan: false }));
          cities.push(entry);
        }
      }

      const eventNames = await names;

      if (!live) {
        return;
      }

      const read: Loaded = { routes, cities, eventNames };

      loadedRef.current = read;
      setUnreachable(missing);
      setRejected(bad);
      setLoaded(read);

      // Every file listed failed; the banner already names each one, and there is no layer to fit the map to.
      if (routes.length === 0 && cities.length === 0) {
        return;
      }

      /*
       * One fit or the other, never both. Leaflet animates a zoom of less than `zoomAnimationThreshold` levels as a CSS
       * transition and defers the move to its end, so fitting the world first and the event second left the transition
       * to finish afterwards and restore the world. Ordering cannot fix it.
       */
      if (!focusEvent(read)) {
        const all = L.featureGroup([...routes.map((r) => r.line), ...cities.map((c) => c.marker)]);

        map.fitBounds(all.getBounds(), { padding: [16, 16] });
      }
    })();

    return () => {
      live = false;
    };
  }, []);

  /**
   * Tell the layers what is selected. An effect rather than part of the click, selection being state several entries
   * can hold at once: every layer is either in the set or returned to its resting style, which is also what deselects
   * whatever the last selection held without anything having to remember it.
   */
  useEffect(() => {
    const map = mapRef.current;

    if (map === null || loaded === null) {
      return;
    }

    const chosen = new Set(selected);

    for (const route of loaded.routes) {
      const dots = markers.current.get(route.id);

      if (dots) {
        dots.forEach((dot) => map.removeLayer(dot));
        markers.current.delete(route.id);
      }

      if (!chosen.has(route.id)) {
        route.line.setStyle(routeStyle(route));
        route.line.bringToBack();
        continue;
      }

      route.line.setStyle({ color: cssVar('--accent'), weight: 4, opacity: 1 });
      route.line.bringToFront();

      /*
       * Read as slots rather than assumed: `loadGpxFile` rejects a `<trk>` with fewer than two usable `<trkpt>`, but
       * nothing carries that length from there to here.
       */
      const a = route.latlngs[0];
      const b = route.latlngs[route.latlngs.length - 1];

      if (!a || !b) {
        throw new Error(`“${route.name}” has no points to mark`);
      }

      const dot = (at: [number, number], color: string, label: string) =>
        L.circleMarker(at, { radius: 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).bindTooltip(
          label,
        );

      markers.current.set(route.id, [
        dot(a, cssVar('--start'), 'Start').addTo(map),
        dot(b, cssVar('--end'), 'End').addTo(map),
      ]);

      bindRoutePopup(route);
    }

    for (const city of loaded.cities) {
      if (!chosen.has(city.id)) {
        city.marker.setStyle(cityStyle(city));
        continue;
      }

      city.marker.setStyle({ radius: 8, fillColor: cssVar('--accent') });
      city.marker.bringToFront();
      bindCityPopup(city);
    }
  }, [selected, loaded]);

  /**
   * An entry's popup, bound by the effect above for every selected entry and by `select` before it opens one: that
   * effect runs only after the render the selection causes, so a popup opened ahead of it would have nothing bound yet.
   */
  function bindRoutePopup(route: RouteEntry) {
    const detail = `${route.country} · ${route.latlngs.length} points · ${fmtDist(route.distance)}`;

    route.line.bindPopup(
      buildPopup(route.name, detail, 'Copy GPX', route.gpx, (ok) =>
        setToast(ok ? `Copied “${route.name}” GPX to clipboard` : 'Copy failed'),
      ),
    );
  }

  function bindCityPopup(city: CityEntry) {
    city.marker.bindPopup(
      buildPopup(city.name, `${city.country} · ${city.coordStr}`, 'Copy coordinates', city.coordStr, (ok) =>
        setToast(ok ? `Copied ${city.name} coordinates to clipboard` : 'Copy failed'),
      ),
    );
  }

  /**
   * Select a set of entries, opening the groups above their rows and scrolling the first into view. Only one place can
   * be scrolled to, so the first stands for the rest — which the groups being open is what makes reachable.
   */
  function select(ids: readonly string[], { pan = true }: { pan?: boolean } = {}) {
    setSelected(ids);
    setOpen((was) => {
      const next = new Set(was);

      for (const id of ids) {
        for (const key of groupKeys(id)) {
          next.add(key);
        }
      }

      return next;
    });

    const map = mapRef.current;
    const held = loadedRef.current;
    const first = ids[0];

    if (!pan || map === null || held === null || first === undefined || ids.length !== 1) {
      return;
    }

    const route = held.routes.find((candidate) => candidate.id === first);

    if (route) {
      map.fitBounds(route.line.getBounds(), { padding: [24, 24], maxZoom: 17 });
      bindRoutePopup(route);
      route.line.openPopup();
      return;
    }

    const city = held.cities.find((candidate) => candidate.id === first);

    if (city) {
      map.setView(city.coords, Math.max(map.getZoom(), 12));
      bindCityPopup(city);
      city.marker.openPopup();
    }
  }

  /** The continent and country group keys an entry's row sits under, so selecting it can open both. */
  function groupKeys(id: string): readonly string[] {
    const held = loadedRef.current;
    const country = [...(held?.routes ?? []), ...(held?.cities ?? [])].find((entry) => entry.id === id)?.country;

    if (country === undefined) {
      return [];
    }

    const continent = COUNTRIES[country]?.continent ?? 'Other';

    return [continent, `${continent}/${country}`];
  }

  /**
   * A link from the Events page arrives as `#/map?event=<eventID>` and lands on every route and waypoint added for
   * that event, not one of them: all highlighted, their rows marked, the groups opened and the map fitted to the set.
   *
   * Nothing is hidden. Filtering the sidebar down would read as the search box having been used, leaving the reader to
   * work out how to get the other rows back, where selecting answers "which ones are they" and leaves the page in a
   * state they already know how to leave.
   *
   * Returns whether it moved the map, which is what lets the initial fit happen only when no event claimed the view.
   */
  function focusEvent(against: Loaded): boolean {
    const id = pending.current;

    if (id === null) {
      return false;
    }

    const routes = against.routes.filter((route) => route.event === id);
    const places = against.cities.filter((city) => city.event === id);
    const name = against.eventNames.get(id) ?? id;

    pending.current = null;

    // Said out loud rather than silently ignored: the link came from somewhere, so landing nowhere needs explaining.
    if (routes.length === 0 && places.length === 0) {
      setToast(`Nothing here was added for “${name}”`);

      return false;
    }

    const ids = [...routes.map((route) => route.id), ...places.map((city) => city.id)];

    // A lone entry is selected exactly as clicking its row would, tight fit and popup included. Only a set needs what
    // follows, where no one of them can own the view or be the one the popup names.
    if (ids.length === 1) {
      select(ids);

      return true;
    }

    select(ids, { pan: false });

    /*
     * One fit, not two, for the reason the load effect gives: selecting an entry with its own pan and then widening to
     * the set landed the wide view and had it silently undone a moment later.
     */
    const layers = [...routes.map((route) => route.line), ...places.map((city) => city.marker)];

    mapRef.current?.fitBounds(L.featureGroup(layers).getBounds(), { padding: [24, 24], maxZoom: 16 });

    // No popup: one would name a single entry and so contradict the point of selecting all of them. The count says it.
    setToast(`Selected all ${layers.length} entries added for “${name}”`);

    return true;
  }

  // The fragment's `?event=`, read on arrival and whenever a link changes it. The files may not have arrived yet, in
  // which case the load above spends it once they have. Keyed on the fragment alone: keyed on `loaded` too, the render
  // the load's own `setLoaded` causes would read it back into `pending` and apply it a second time.
  useEffect(() => {
    pending.current = new URLSearchParams(fragment).get('event');

    const held = loadedRef.current;

    if (held !== null) {
      focusEvent(held);
    }
  }, [fragment]);

  /**
   * The rows, grouped the way the sidebar draws them, with the filter already applied. Matched against the entries
   * rather than attributes written onto their rows, the store already holding both strings.
   */
  const term = filter.trim().toLowerCase();

  const all: Row[] = [
    ...(loaded?.routes ?? []).map((route) => ({
      id: route.id,
      name: route.name,
      country: route.country,
      dist: route.distance,
      event: route.event,
      hit: !term || route.name.toLowerCase().includes(term) || route.country.toLowerCase().includes(term),
      gpx: route.gpx,
      coordStr: null,
    })),
    ...(loaded?.cities ?? []).map((city) => ({
      id: city.id,
      name: city.name,
      country: city.country,
      dist: 0,
      event: city.event,
      hit: !term || city.name.toLowerCase().includes(term) || city.country.toLowerCase().includes(term),
      gpx: null,
      coordStr: city.coordStr,
    })),
  ];

  const byCountry = new Map<string, Row[]>();

  for (const row of all) {
    const held = byCountry.get(row.country);

    if (held === undefined) {
      byCountry.set(row.country, [row]);
    } else {
      held.push(row);
    }
  }

  const byContinent = new Map<string, [string, Row[]][]>();

  for (const [country, held] of byCountry) {
    const continent = COUNTRIES[country]?.continent ?? 'Other';
    const group = byContinent.get(continent);

    // Within each country, tracks and waypoints are interleaved and sorted alphabetically by name.
    held.sort((a, b) => a.name.localeCompare(b.name) || a.dist - b.dist);

    if (group === undefined) {
      byContinent.set(continent, [[country, held]]);
    } else {
      group.push([country, held]);
    }
  }

  const continents = [...byContinent].sort(byKey);

  /**
   * Every group reopened for the rows the filter leaves, and everything closed again when the box is emptied, so a
   * reader's own collapsing lasts until the next keystroke. Keyed on the term, so it is the filter changing that
   * resets them rather than any of the other reasons this component renders.
   */
  useEffect(() => {
    if (term === '') {
      setOpen(new Set());

      return;
    }

    const next = new Set<string>();

    for (const [continent, countries] of byContinent) {
      for (const [country, held] of countries) {
        if (held.some((row) => row.hit)) {
          next.add(continent);
          next.add(`${continent}/${country}`);
        }
      }
    }

    setOpen(next);
  }, [term]);

  const toggle = (key: string) =>
    setOpen((was) => {
      const next = new Set(was);

      if (!next.delete(key)) {
        next.add(key);
      }

      return next;
    });

  const chosen = new Set(selected);
  const routeCount = loaded?.routes.length ?? 0;
  const cityCount = loaded?.cities.length ?? 0;

  const count =
    loaded === null
      ? 'Loading routes…'
      : cityCount > 0
        ? `${routeCount} tracks · ${cityCount} waypoints`
        : `${routeCount} tracks across ${new Set(loaded.routes.map((route) => route.country)).size} countries`;

  return (
    <div class="app">
      <aside id="sidebar">
        <header>
          <h1 class="sr">Routes</h1>
          <div class="sub">{count}</div>
        </header>

        <div class="search">
          <input
            type="search"
            placeholder="Filter tracks &amp; waypoints…"
            autocomplete="off"
            value={filter}
            onInput={(event) => setFilter(event.currentTarget.value)}
          />
        </div>

        <div id="list">
          {continents.map(([continent, countries]) => {
            const shownHere = countries.reduce((sum, [, held]) => sum + held.filter((row) => row.hit).length, 0);
            const classes = ['continent-group'];

            if (!open.has(continent)) {
              classes.push('collapsed');
            }

            if (shownHere === 0) {
              classes.push('hidden');
            }

            return (
              <div key={continent} class={classes.join(' ')}>
                <div class="continent" onClick={() => toggle(continent)}>
                  <span class="chev">▾</span>
                  <span>{continent}</span>
                  <span class="gcount">{shownHere}</span>
                </div>

                <div class="continent-items">
                  {countries.sort(byKey).map(([country, held]) => {
                    const key = `${continent}/${country}`;
                    const shown = held.filter((row) => row.hit).length;
                    const inner = ['country-group'];

                    if (!open.has(key)) {
                      inner.push('collapsed');
                    }

                    if (shown === 0) {
                      inner.push('hidden');
                    }

                    return (
                      <div key={country} class={inner.join(' ')}>
                        <div class="country" data-country={country} onClick={() => toggle(key)}>
                          <span class="chev">▾</span>
                          <span>{country}</span>
                          <span class="gcount">{shown}</span>
                        </div>

                        <div class="country-items">
                          {held.map((row) => {
                            const classes = ['route'];

                            // A waypoint carries coordinates where a track carries GPX, which is also what the
                            // stylesheet tells the two apart by — so the one field decides the class, the glyph and
                            // what Copy copies.
                            const place = row.coordStr !== null;

                            if (place) {
                              classes.push('city');
                            }

                            if (!row.hit) {
                              classes.push('hidden');
                            }

                            if (chosen.has(row.id)) {
                              classes.push('active');
                            }

                            return (
                              <div
                                key={row.id}
                                class={classes.join(' ')}
                                ref={(node) => {
                                  if (node === null) {
                                    rows.current.delete(row.id);
                                  } else {
                                    rows.current.set(row.id, node);
                                  }
                                }}
                                onClick={() => select([row.id])}
                              >
                                <span class="name">{row.name}</span>
                                <span class="end">
                                  {!place && <span class="meta">{fmtDist(row.dist)}</span>}
                                  <CopyButton
                                    text={row.coordStr ?? row.gpx ?? ''}
                                    title={place ? 'Copy coordinates to clipboard' : 'Copy this route as a GPX file'}
                                    onCopied={(ok) =>
                                      setToast(
                                        ok
                                          ? place
                                            ? `Copied ${row.name} coordinates to clipboard`
                                            : `Copied “${row.name}” GPX to clipboard`
                                          : 'Copy failed',
                                      )
                                    }
                                  />
                                </span>

                                {/*
                                 * A link through to the event on the Events page. The click is stopped short of the
                                 * row, which would otherwise select the entry as the page changes under it.
                                 *
                                 * The span has to be absent rather than empty: three stylesheet rules key off
                                 * `:has(.eventline)`, and an empty one would still recolour the marker and wrap the
                                 * row.
                                 */}
                                {row.event && (
                                  <span class="eventline">
                                    <a
                                      class="event"
                                      href={toHash('events', `event=${encodeURIComponent(row.event)}`)}
                                      title="Show this event on the Events page"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      {loaded?.eventNames.get(row.event) ?? row.event}
                                    </a>
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <footer>
          Map data ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">
            OpenStreetMap
          </a>{' '}
          contributors. Click a track or waypoint to zoom.
        </footer>
      </aside>

      <div class="map-wrap">
        <div id="banner" hidden={fatal === null && unreachable.length === 0 && rejected.length === 0}>
          {fatal !== null && (
            <>
              <b>
                Could not read <code>{GPX_PATHS}</code> — {fatal}.
              </b>
              <br />
              This page reads the route list and the <code>.gpx</code> files over HTTP from a build of the site. To run
              it locally, try:
              <br />
              <code>pnpm build &amp;&amp; pnpm serve</code> then open the address it prints — or view it via GitHub
              Pages.
            </>
          )}

          {/*
           * Name every file that could not be read, and why, under a heading saying what kind of failure it was: the
           * two want opposite things from the reader, so a server that is down must not read as metadata to correct.
           *
           * The `<Fragment>` is keyed because this is a list, even though a two-row one whose order never changes: an
           * anonymous fragment is matched by position, so the pair would be told apart by where they sit rather than by
           * which they are.
           */}
          {(
            [
              ['unreachable', `${unreachable.length} file(s) could not be fetched — try reloading:`, unreachable],
              ['rejected', `${rejected.length} file(s) rejected — fix the GPX metadata:`, rejected],
            ] as const
          ).map(
            ([kind, heading, failures]) =>
              failures.length > 0 && (
                <Fragment key={kind}>
                  <b>{heading}</b>
                  <ul>
                    {failures.map(({ file, reason }) => (
                      <li key={file}>
                        <code>{file}</code> — {reason}
                      </li>
                    ))}
                  </ul>
                </Fragment>
              ),
          )}
        </div>

        <div id="toast" class={toast === null ? undefined : 'show'}>
          {toast}
        </div>
        <div id="map" ref={mapNode} />
      </div>
    </div>
  );
}
