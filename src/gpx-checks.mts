/**
 * The rules `scripts/validate-gpx.mts` holds the repository's GPX files to, as functions of the files and the tables
 * they are checked against. Here rather than in the script so the suite can import them — the script's own top level
 * lists the repository and exits the process as soon as it is loaded — and beside `gpx-checks.test.mts`, which holds
 * each rule to a document it turns down.
 */

import { byCodeUnit } from './event-feed.ts';
import { MIN_TRKPTS, PGR_FIELDS, PGR_NS } from './gpx-dialect.ts';
import { eventRefs, parseGpx } from './gpx-source.mts';
import type { RouteCounts } from './types.js';
import { Node, type Document, type Element } from '@xmldom/xmldom';
import { validateXML } from 'xmllint-wasm';

/** One GPX file, as `gpxSources` reads it. */
export type GpxSource = { fileName: string; contents: string };

/** What the files are checked against: the events a `<pgr:event>` may name, and the countries a file may. */
export type Tables = { eventIds: ReadonlySet<string>; countries: Readonly<Record<string, unknown>> };

/** What the pass over the entries found, beside the problems it reports. */
export type EntryPass = {
  problems: string[];
  entryCount: number;

  /**
   * How many routes and waypoints each event has, by `eventID`. Filled as the entries are walked rather than by a
   * second pass, so what gets written to data/entries-by-event.json cannot describe a file differently from the checks
   * that just validated it.
   */
  eventIndex: Map<string, RouteCounts>;

  // Which countries the files actually name, for the reverse check on COUNTRIES.
  usedCountries: Set<string>;
};

/**
 * Every way `sources` falls short of GPX 1.1 against `schema`, which is `resources/gpx.xsd`: not well-formed, or not
 * the shape the schema allows.
 */
export async function schemaProblems(sources: readonly GpxSource[], schema: string): Promise<string[]> {
  const { valid, errors } = await validateXML({ xml: [...sources], schema: [schema] });

  // A malformed file reports the offending source line with no position to hang it on, so the location is printed only
  // when there is one.
  return valid
    ? []
    : errors.map(({ loc, message }) => (loc ? `${loc.fileName}:${loc.lineNumber}: ${message}` : message));
}

/**
 * A `Set` over the shared tuple rather than a second list beside it. `has` takes a `string`, where the tuple's own
 * `includes` would reject one — the field names being literal types is what types `extText` next door.
 */
const PGR_FIELD_NAMES = new Set<string>(PGR_FIELDS);

const VARIANTS = new Set(['short', 'long']);

// Spelled out of PGR_FIELDS rather than beside it, so adding a field cannot leave the message naming the old set.
const PGR_EXPECTED = [...PGR_FIELDS].join(', ').replace(/, (?=[^,]*$)/, ' or ');

/**
 * The element children of `el`, in document order. `childNodes` carries the whitespace between tags too, so the text
 * nodes are filtered out.
 */
const elementChildren = (el: Element): Element[] =>
  Array.from(el.childNodes).filter((node): node is Element => node.nodeType === Node.ELEMENT_NODE);

/**
 * Every way `sources` falls short of what the viewer reads, which the schema cannot say: the `pgr` extension fields,
 * a country and an event it knows, a name on every entry and points enough on every track.
 */
export function entryProblems(sources: readonly GpxSource[], { eventIds, countries }: Tables): EntryPass {
  const problems: string[] = [];
  const eventIndex = new Map<string, RouteCounts>();
  const usedCountries = new Set<string>();
  let entryCount = 0;

  // Report against the file, at the element's own line where there is one, matching the schema pass's `file:line:`
  // form.
  const report = (fileName: string, el: Element | undefined, message: string) =>
    problems.push(el?.lineNumber ? `${fileName}:${el.lineNumber}: ${message}` : `${fileName}: ${message}`);

  for (const { fileName, contents } of sources) {
    let doc: Document;

    try {
      doc = parseGpx(contents);
    } catch {
      // Not well-formed — the schema pass has already said so; there is nothing this pass can add.
      continue;
    }

    /**
     * Every `<pgr:event>` names an event `data/events.json` still has, since a typo or an event renamed out from under
     * it would otherwise sit in the file unnoticed.
     *
     * Read through `eventRefs` rather than the field walk below, because `scripts/prune-events.mts` cuts these elements
     * through the same function — which is what keeps the pruner from leaving behind a reference this check then
     * refuses, failing every Pages deploy until the file is edited by hand. It also reaches a `<pgr:event>` outside a
     * `<trk>` or `<wpt>`, which the walk never visits and the pruner would still cut.
     */
    for (const { element, eventID } of eventRefs(doc)) {
      if (eventID && !eventIds.has(eventID)) {
        report(fileName, element, `<${element.tagName}> is "${eventID}" — not an eventID in data/events.json`);
      }
    }

    const tracks = Array.from(doc.getElementsByTagName('trk')).map((trk) => ({
      trk,
      points: trk.getElementsByTagName('trkpt').length,
    }));

    /**
     * A `<trk>` and a `<wpt>` are the two things the viewer turns into entries, and each must name its country. An
     * emptied `<trk>` (no `<trkpt>`) is what a cleared track looks like on export; `eachTrack` skips it, so its `pgr`
     * fields are not required and nothing is checked for it here.
     */
    const kept = tracks.filter(({ points }) => points > 0);
    const entries = [...kept.map(({ trk }) => trk), ...Array.from(doc.getElementsByTagName('wpt'))];

    /**
     * A `<trk>` that kept a single point is a track there is no line to draw between, and `gpxEntries` throws on it,
     * which rejects the whole file — so one such track takes every route beside it off the map. The schema cannot say
     * so — `trkpt` is `minOccurs="0"` — so without this the file passed every check, went into both generated indexes
     * and broke the Routes page when someone opened it.
     */
    for (const { trk, points } of kept) {
      if (points < MIN_TRKPTS) {
        report(fileName, trk, `<trk> has ${points} <trkpt> — expected at least ${MIN_TRKPTS}`);
      }
    }

    /**
     * A file with neither is the other half of that gap: `gpxEntries` throws rather than drawing an empty map, and the
     * file reaches the viewer because `GPX_PATHS` is every `.gpx` in the repository.
     */
    if (entries.length === 0) {
      report(fileName, undefined, 'has no <trk> or <wpt>');
    }

    for (const entry of entries) {
      entryCount++;
      const ext = elementChildren(entry).find((child) => child.localName === 'extensions');
      const counts: Record<string, number> = {};
      let eventId = null;

      for (const field of ext ? elementChildren(ext) : []) {
        // xmldom types `localName` as nullable on every node rather than narrowing it on `Element`. `''` stands in
        // because it is in no branch below, exactly as `null` would be.
        const name = field.localName ?? '';

        // A `pgr`-namespace element the viewer has no field for is a misspelling. A foreign element from another tool
        // is not ours to judge — the viewer leaves it be, and so does this.
        if (field.namespaceURI === PGR_NS && !PGR_FIELD_NAMES.has(name)) {
          report(fileName, field, `<${field.tagName}> is not a pgr field — expected ${PGR_EXPECTED}`);
          continue;
        }

        if (!PGR_FIELD_NAMES.has(name)) {
          continue;
        }

        counts[name] = (counts[name] || 0) + 1;
        const text = field.textContent?.trim() ?? '';

        if (name === 'event' && text) {
          eventId = text;
        }

        if (name === 'country' && text) {
          usedCountries.add(text);
        }

        if (!text) {
          report(fileName, field, `<${field.tagName}> is empty`);
        } else if (name === 'variant' && !VARIANTS.has(text)) {
          report(fileName, field, `<${field.tagName}> is "${text}" — expected short or long`);
        } else if (name === 'country' && !Object.hasOwn(countries, text)) {
          // The viewer groups by continent and flags each favourite from `src/countries.ts`, so a country missing from
          // it has no continent and no flag and the backup build throws rather than importing it.
          report(fileName, field, `<${field.tagName}> is "${text}" — not a country in COUNTRIES (src/countries.ts)`);
        }
      }

      // Each field is one value rather than a list: a second `<pgr:country>` is a silent contradiction, the viewer
      // keeping only the first.
      for (const name of PGR_FIELDS) {
        const seen = counts[name] ?? 0;

        if (seen > 1) {
          report(fileName, ext, `<${entry.localName}> has ${seen} <pgr:${name}> fields — expected one`);
        }
      }

      if (!counts.country) {
        report(fileName, entry, `<${entry.localName}> has no <pgr:country>`);
      }

      /**
       * The other thing the viewer refuses an entry for, valid GPX 1.1 and so invisible to the schema pass: `placeName`
       * wants a direct-child `<name>` with text in it. The refusal is not a skip — it throws, which rejects the whole
       * file, so one nameless waypoint takes every route beside it off the map.
       */
      if (!elementChildren(entry).some((child) => child.localName === 'name' && child.textContent?.trim())) {
        report(fileName, entry, `<${entry.localName}> has no <name>`);
      }

      // Split by element the way the viewer does: the events page counts routes and waypoints separately, so an index
      // that merged them could not label a card.
      if (eventId) {
        const tally = eventIndex.get(eventId) || { routes: 0, waypoints: 0 };
        tally[entry.localName === 'trk' ? 'routes' : 'waypoints'] += 1;
        eventIndex.set(eventId, tally);
      }
    }
  }

  return { problems, entryCount, eventIndex, usedCountries };
}

/**
 * The other direction of the COUNTRIES check: an entry in that table no file names. Nothing reaches it except through a
 * `<pgr:country>` read out of a file, so such an entry is unreachable — a leftover from a route since removed, or one
 * added for a route that never arrived. Either way the table says it is the countries in use.
 */
export const unusedCountries = (countries: Readonly<Record<string, unknown>>, used: ReadonlySet<string>) =>
  Object.keys(countries).filter((country) => !used.has(country));

/**
 * `eventIndex` as data/entries-by-event.json holds it. Keys are sorted so that two runs over the same repository
 * produce the same bytes.
 */
export function entriesByEvent(eventIndex: ReadonlyMap<string, RouteCounts>): string {
  const sorted = [...eventIndex].sort(([a], [b]) => byCodeUnit(a, b));

  return `${JSON.stringify(Object.fromEntries(sorted), null, 2)}\n`;
}
