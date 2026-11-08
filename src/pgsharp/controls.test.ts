/**
 * The on-screen control positions, written back into a synthesized backup. Two things here are contracts rather than
 * values: the bottom row's controls share a Y, which is what naming `CONTROL_ROW_Y` once is for, since a backup
 * restoring them a pixel apart is a row that looks wrong and reports nothing; and the key order decides the order the
 * entries land in the backup, this table being what `pgsdata.ts` walks with `Object.entries`.
 *
 * `hlscan` and `hlfeeds` are JSON strings rather than objects, so they are checked by parsing them back. That is the
 * one place `scan-config.js` reaches the device, which makes this where its contract is held too.
 */

import { expect, test } from 'vitest';

import FEED_FILTERS from './filters.js';
import SCAN_CONFIG from './scan-config.js';
import { CONTROL_RESETS } from './controls.js';

test('the controls along the bottom of the screen share one Y, which is what naming it once is for', () => {
  const { resetIcon, resetSnipe1, resetSnipe2, resetCdpos, resetScan } = CONTROL_RESETS;

  // The floating control and both fast-snipe buttons sit in one row, and the radar button sits on snipe 2. Spelling the
  // Y four times is how they end up a pixel apart; the literal is from the known-good backup this module was read out
  // of, so it is asserted rather than compared against one of the four — which would pass with all four moved.
  expect([resetIcon.iconY, resetSnipe1.hlfastsnipey, resetSnipe2.hlfastsnipe2y, resetScan.hlscany]).toEqual([
    785.09375, 785.09375, 785.09375, 785.09375,
  ]);

  // The radar shares snipe 2's position outright rather than only its row, so the x travels with it as well.
  expect(resetScan.hlscanx).toBe(resetSnipe2.hlfastsnipe2x);
  expect([resetSnipe1.hlfastsnipex, resetSnipe2.hlfastsnipe2x]).toEqual([816.33203125, 916.2529296875]);

  // The copy-destination control is not in that row and keeps a Y of its own, which is what makes the shared Y a
  // decision rather than every control in the table happening to sit at the bottom of the screen.
  expect([resetCdpos.hlcdposx, resetCdpos.hlcdposy]).toEqual([0.0, 306.25]);
});

test('the entries stay in the order PGSharp wrote them, the backup being written by walking this table', () => {
  // Non-integer string keys, so insertion order is iteration order — this list is the order the keys land in.
  expect(Object.keys(CONTROL_RESETS)).toEqual([
    'resetIcon',
    'resetSnipe1',
    'resetSnipe2',
    'resetCdpos',
    'resetScan',
    'resetFeeds',
  ]);

  // Every one of them contributes at least one key, since a checkbox that writes nothing is a tick with no effect —
  // which on the page is indistinguishable from one that worked.
  expect(Object.values(CONTROL_RESETS).filter((entry) => Object.keys(entry).length === 0)).toEqual([]);
});

test('the radar filter reaches the device as one string whose field order is as much of it as the values', () => {
  const scan = JSON.parse(CONTROL_RESETS.resetScan.hlscan) as Record<string, unknown>;

  // Parsed back rather than compared as an object, because the string is what PGSharp stores and `JSON.stringify`
  // writes keys in insertion order: rearranging `scan-config.js` hands the device a string it did not write while
  // leaving every field equal to what it was. This list is therefore what holds the order that module's header says is
  // part of the value.
  expect(Object.keys(scan)).toEqual([
    'shiny',
    'minlv',
    'maxlv',
    'miniv',
    'maxiv',
    'checkAll',
    'onlyShiny',
    'name',
    'birds',
    'attrMode',
    'minatk',
    'maxatk',
    'mindef',
    'maxdef',
    'minsta',
    'maxsta',
    'showShinyOnly',
    'loadShiny',
    'notify',
    'stop',
    'pgp',
  ]);

  // The values survive the round trip, so what the device reads is the table rather than something shaped like it. The
  // bounds are the radar's own rather than a feed's: it watches every level to 36 at any IV, and reports shinies alone.
  expect(scan).toEqual(SCAN_CONFIG);
  expect([scan['name'], scan['minlv'], scan['maxlv'], scan['onlyShiny']]).toEqual(['Nearby Radar', 1, 36, true]);
});

test('the feed list ticks on its own, having no on-screen position to ride along with', () => {
  const feeds = JSON.parse(CONTROL_RESETS.resetFeeds.hlfeeds) as { name: string }[];

  // `hlfeeds` and nothing else — no x or y — which is why it is a checkbox apart from the radar button that carries
  // `hlscan`: ticking it replaces whatever filters the profile already has, and that is a choice to make on its own.
  expect(Object.keys(CONTROL_RESETS.resetFeeds)).toEqual(['hlfeeds']);

  // Every filter reaches the device, in the order `filters.js` lists them, since this is the one string that carries
  // them. A filter dropped on the way out is a feed that never alerts, which looks exactly like a feed that is waiting.
  // Which filters there are is `filters.js`'s to decide — one whose hunt list has emptied is left out there — so this
  // reads the names off it rather than restating them.
  expect(feeds.map((filter) => filter.name)).toEqual(FEED_FILTERS.map((filter) => filter.name));
});
