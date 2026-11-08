/**
 * Which GPX documents `scripts/validate-gpx.mts` turns down, and why. Most of these rules exist because the viewer
 * throws on a file that breaks them — rejecting every route in it, not just the bad entry — and the schema cannot see
 * any of them: each document below except the first two is valid GPX 1.1.
 *
 * Written out rather than read from `data/`, which holds only files that pass.
 */

import { entriesByEvent, entryProblems, schemaProblems, unusedCountries } from './gpx-checks.mts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const SCHEMA = readFileSync(join(import.meta.dirname, '../resources/gpx.xsd'), 'utf8');

const TABLES = { eventIds: new Set(['an-event']), countries: { Australia: {}, Japan: {} } };

const gpx = (body: string) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx xmlns="http://www.topografix.com/GPX/1/1"',
    '     xmlns:pgr="https://spence.com.au/pogo-utils/gpx/1" version="1.1" creator="test">',
    body,
    '</gpx>',
    '',
  ].join('\n');

const wpt = (inner: string) => `<wpt lat="-37.8" lon="144.9">${inner}</wpt>`;

const trk = (inner: string, points: number) =>
  `<trk>${inner}<trkseg>${'<trkpt lat="-37.8" lon="144.9"/>'.repeat(points)}</trkseg></trk>`;

const ext = (fields: string) => `<extensions>${fields}</extensions>`;

const AUSTRALIA = '<pgr:country>Australia</pgr:country>';

/** The problems `entryProblems` finds in one file, which is named `t.gpx`. */
const problemsIn = (body: string) => entryProblems([{ fileName: 't.gpx', contents: gpx(body) }], TABLES).problems;

test('a well-formed entry with a name and a known country passes', async () => {
  const body = wpt(`<name>Here</name>${ext(AUSTRALIA)}`) + trk(`<name>There</name>${ext(AUSTRALIA)}`, 2);

  expect(problemsIn(body)).toEqual([]);
  expect(await schemaProblems([{ fileName: 't.gpx', contents: gpx(body) }], SCHEMA)).toEqual([]);
});

test('the schema turns down a file that is not GPX 1.1, and the entry pass leaves a malformed one to it', async () => {
  const invalid = { fileName: 'bad.gpx', contents: gpx('<route/>') };
  const malformed = { fileName: 'broken.gpx', contents: gpx('<wpt lat="1" lon="1">') };

  expect(await schemaProblems([invalid], SCHEMA)).toEqual([expect.stringMatching(/^bad\.gpx:\d+: .*route/)]);
  expect(await schemaProblems([malformed], SCHEMA)).not.toEqual([]);
  expect(entryProblems([malformed], TABLES).problems).toEqual([]);
});

test('an entry needs a <name> with text in it, as a direct child', () => {
  expect(problemsIn(wpt(ext(AUSTRALIA)))).toEqual(['t.gpx:4: <wpt> has no <name>']);
  expect(problemsIn(wpt(`<name> </name>${ext(AUSTRALIA)}`))).toEqual(['t.gpx:4: <wpt> has no <name>']);
});

test('an entry needs a <pgr:country>, and one COUNTRIES knows', () => {
  expect(problemsIn(wpt('<name>Here</name>'))).toEqual(['t.gpx:4: <wpt> has no <pgr:country>']);
  expect(problemsIn(wpt(`<name>Here</name>${ext('<pgr:country>Atlantis</pgr:country>')}`))).toEqual([
    't.gpx:4: <pgr:country> is "Atlantis" — not a country in COUNTRIES (src/countries.ts)',
  ]);
});

test('a pgr field may not be empty or repeated', () => {
  expect(problemsIn(wpt(`<name>Here</name>${ext(`${AUSTRALIA}<pgr:city> </pgr:city>`)}`))).toEqual([
    't.gpx:4: <pgr:city> is empty',
  ]);
  expect(problemsIn(wpt(`<name>Here</name>${ext(`${AUSTRALIA}<pgr:country>Japan</pgr:country>`)}`))).toEqual([
    't.gpx:4: <wpt> has 2 <pgr:country> fields — expected one',
  ]);
});

test('a variant is short or long', () => {
  expect(problemsIn(wpt(`<name>Here</name>${ext(`${AUSTRALIA}<pgr:variant>medium</pgr:variant>`)}`))).toEqual([
    't.gpx:4: <pgr:variant> is "medium" — expected short or long',
  ]);
});

test('an unknown pgr element is a misspelling, where a foreign one is left alone', () => {
  const misspelt = `${AUSTRALIA}<pgr:contry>Australia</pgr:contry>`;
  const foreign = `${AUSTRALIA}<x:speed xmlns:x="urn:other">fast</x:speed>`;

  expect(problemsIn(wpt(`<name>Here</name>${ext(misspelt)}`))).toEqual([
    't.gpx:4: <pgr:contry> is not a pgr field — expected country, city, variant or event',
  ]);
  expect(problemsIn(wpt(`<name>Here</name>${ext(foreign)}`))).toEqual([]);
});

/**
 * A prefix bound to `http://` for `https://` reads as `pgr:` and is not. `eventRefs` cannot see such an event, so the
 * field walk must not index it either, or an event nobody checked reaches data/entries-by-event.json.
 */
test('a field in another namespace is not a pgr field, even under the pgr: prefix', () => {
  const lookalike = (name: string, text: string) =>
    `<pgr:${name} xmlns:pgr="http://spence.com.au/pogo-utils/gpx/1">${text}</pgr:${name}>`;
  const body = wpt(`<name>Here</name>${ext(lookalike('country', 'Australia') + lookalike('event', 'gone'))}`);
  const { problems, eventIndex, usedCountries } = entryProblems([{ fileName: 't.gpx', contents: gpx(body) }], TABLES);

  expect(problems).toEqual(['t.gpx:4: <wpt> has no <pgr:country>']);
  expect(eventIndex.size).toBe(0);
  expect(usedCountries.size).toBe(0);
});

test('a <pgr:event> names an event data/events.json has, wherever in the file it is', () => {
  // Outside any entry too: the pruner cuts a reference wherever it is, so the validator has to refuse one anywhere.
  expect(
    problemsIn(
      `<metadata>${ext('<pgr:event>gone</pgr:event>')}</metadata>${wpt('<name>Here</name>' + ext(AUSTRALIA))}`,
    ),
  ).toEqual(['t.gpx:4: <pgr:event> is "gone" — not an eventID in data/events.json']);
});

test('a track needs two points to draw, and an emptied one is skipped rather than checked', () => {
  // Reported once: a track of one point is turned down for its points, not a second time as an entry.
  expect(problemsIn(trk(`<name>There</name>${ext(AUSTRALIA)}`, 1))).toEqual([
    't.gpx:4: <trk> has 1 <trkpt> — expected at least 2',
  ]);

  // A cleared track is what an export leaves, and the viewer skips it — so it needs no name or country. A file of
  // nothing else, though, has no entry at all.
  const emptied = trk('', 0);

  expect(problemsIn(emptied + wpt(`<name>Here</name>${ext(AUSTRALIA)}`))).toEqual([]);
  expect(problemsIn(emptied)).toEqual(['t.gpx: has no <trk> or <wpt>']);
});

test('the event index counts routes and waypoints apart, in sorted order', () => {
  const tagged = (name: string) => ext(`${AUSTRALIA}<pgr:event>${name}</pgr:event>`);
  const body =
    trk(`<name>A</name>${tagged('an-event')}`, 2) +
    wpt(`<name>B</name>${tagged('an-event')}`) +
    wpt(`<name>C</name>${tagged('an-event')}`);
  const { eventIndex, entryCount } = entryProblems([{ fileName: 't.gpx', contents: gpx(body) }], TABLES);

  expect(entryCount).toBe(3);
  expect(eventIndex.get('an-event')).toEqual({ routes: 1, waypoints: 2 });

  const index = new Map([
    ['b', { routes: 1, waypoints: 0 }],
    ['a', { routes: 0, waypoints: 1 }],
  ]);

  expect(Object.keys(JSON.parse(entriesByEvent(index)))).toEqual(['a', 'b']);
});

test('a country no file names is unused', () => {
  const { usedCountries } = entryProblems(
    [{ fileName: 't.gpx', contents: gpx(wpt(`<name>Here</name>${ext(AUSTRALIA)}`)) }],
    TABLES,
  );

  expect(unusedCountries(TABLES.countries, usedCountries)).toEqual(['Japan']);
});
