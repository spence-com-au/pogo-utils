/**
 * Reading the GPX files the viewer and the backup builder both consume, in one place so the two agree on what a file
 * says rather than each parsing it their own way. `entryGpx` is the only writer: a stored file holds a whole country,
 * so handing one entry to the clipboard means writing a file for it.
 */

import { fetchOk } from './fetch-ok.js';
import { GPX_PATHS } from './generated.js';
import { GPX_NS, PGR_NS, type PgrField } from './gpx-dialect.js';

/** What a file of ours names as its writer, which is now also what `entryGpx` writes. */
const CREATOR = 'https://github.com/spence-com-au/pogo-utils';

/** Where an `xmlns:` declaration lives, so `setAttributeNS` writes one the serializer reads as a declaration. */
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

/**
 * The file list, checked to be one. `Array.isArray` narrows no further than `any[]` and nothing at the type level reads
 * the `some`, so the return type is a claim this function's own throw enforces rather than one the checker verified.
 */
export async function loadManifest(): Promise<readonly string[]> {
  const res = await fetchOk(GPX_PATHS);
  const files: unknown = await res.json();

  if (!Array.isArray(files) || files.some((f) => typeof f !== 'string')) {
    throw new Error('is not a list of paths');
  }

  return files;
}

/** The single place either consumer turns bytes into a tree, so both fail the same way on a malformed file. */
export function parseGpxDocument(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');

  if (doc.querySelector('parsererror')) {
    throw new Error('not valid XML');
  }

  return doc;
}

/**
 * The file's drawable `<trk>` elements paired with their `<trkpt>` list, skipping the emptied `<trk>` gpx.studio writes
 * for a cleared route — so the viewer and the backup builder never disagree about which tracks a file holds. A `<trk>`
 * that kept a single point is a different thing, and is left to each caller to reject.
 */
export function* eachTrack(doc: Document): Generator<{ trk: Element; trkpts: HTMLCollectionOf<Element> }> {
  for (const trk of doc.getElementsByTagName('trk')) {
    const trkpts = trk.getElementsByTagName('trkpt');

    if (trkpts.length === 0) {
      continue;
    }

    yield { trk, trkpts };
  }
}

/**
 * The text of a direct child `<tag>`, in namespace `ns` where one is given, or null. Read from the element itself
 * rather than its descendants, so a gpx.studio file's `<metadata><author><name>` is never mistaken for an entry's name.
 */
function childText(el: Element, tag: string, ns?: string): string | null {
  for (const child of el.children) {
    if (
      child.localName === tag &&
      (ns === undefined || child.namespaceURI === ns) &&
      child.textContent &&
      child.textContent.trim()
    ) {
      return child.textContent.trim();
    }
  }

  return null;
}

/**
 * The text of a `<pgr:*>` field in this element's own `<extensions>`, or null. `tag` is typed by `PGR_FIELDS` rather
 * than left a string: a misspelling answered null, which every caller reads as the file not carrying the field.
 * Matching on namespace and local name leaves the prefix a file's own business, and reads only what the validator's
 * `eventRefs` and field walk read: a foreign `<x:event>` is no event of ours.
 *
 * Worth knowing when editing: an editor that does not model foreign extensions drops the whole block on export —
 * gpx.studio is one — so a round trip through such a tool loses these fields.
 */
export function extText(el: Element, tag: PgrField): string | null {
  const ext = [...el.children].find((child) => child.localName === 'extensions');
  return ext ? childText(ext, tag, PGR_NS) : null;
}

/**
 * An entry's name with the locality it sits in — "Kings Park, Perth, Western Australia". The country is left out, that
 * being the sidebar's own grouping, and `entryName` adds it where a favourite needs the whole thing.
 *
 * These readers say what is wrong with the element without naming the file, each caller already knowing which file it
 * is reading.
 */
export function placeName(el: Element): string {
  const name = childText(el, 'name');

  if (!name) {
    throw new Error(`<${el.localName}> has no <name>`);
  }

  const city = extText(el, 'city');
  return city ? `${name}, ${city}` : name;
}

/**
 * The country a `<trk>` or `<wpt>` is in. Required: a countryless entry cannot be grouped, flagged or named, and
 * guessing one from the path is the papering over this file format exists to avoid.
 */
export function entryCountry(el: Element): string {
  const country = extText(el, 'country');

  if (!country) {
    throw new Error(`<${el.localName}> has no <pgr:country>`);
  }

  return country;
}

/**
 * Where a `<trkpt>` or a `<wpt>` says it is, one reader for both tags because they are one format. `coords` is a tuple
 * so destructuring gives two numbers rather than two `number | undefined`; `coordStr` is the file's own text for the
 * pair, so a consumer can hand over exactly what the file said.
 */
export function entryCoords(el: Element): { coords: [number, number]; coordStr: string } {
  const latStr = el.getAttribute('lat'),
    lonStr = el.getAttribute('lon');
  const lat = parseFloat(latStr ?? ''),
    lon = parseFloat(lonStr ?? '');

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error(`<${el.localName}> at ${latStr},${lonStr} has an unparseable coordinate`);
  }

  return { coords: [lat, lon], coordStr: `${latStr},${lonStr}` };
}

/**
 * One `<trk>` or `<wpt>` as a GPX file of its own — what the Copy button hands over. The stored files hold a whole
 * country each, so copying one meant copying all of it under a toast naming the one row that was clicked.
 *
 * Built from the entry's own `ownerDocument` rather than from `document`, and cloned rather than moved, so this
 * neither needs a page nor disturbs the tree the viewer is drawing from. Both namespaces are declared on the `<gpx>`
 * so the serializer finds them in scope and does not repeat them down the subtree.
 */
export function entryGpx(el: Element): string {
  const doc = el.ownerDocument;
  const gpx = doc.createElementNS(GPX_NS, 'gpx');

  gpx.setAttributeNS(XMLNS_NS, 'xmlns:pgr', PGR_NS);
  gpx.setAttribute('version', '1.1');
  gpx.setAttribute('creator', CREATOR);
  gpx.appendChild(doc.createTextNode('\n  '));
  gpx.appendChild(el.cloneNode(true));
  gpx.appendChild(doc.createTextNode('\n'));

  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(gpx)}\n`;
}
