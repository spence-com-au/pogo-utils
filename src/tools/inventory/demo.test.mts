/**
 * The demo phone driven as the pages drive it — through a `Device`, and for a search through the very walk to storage
 * the Search page runs — over the recordings the site publishes for it and under real OCR, so what passes here is what
 * a reader with no phone sees: the one detail screen at every read, and a search that finds storage from it.
 */

import { DEMO_DETAIL, DEMO_STATS } from '../../generated.ts';
import { Device } from '../../core/adb.mts';
import { DEFAULTS, type Config } from './config.mts';
import { demoTransport } from './demo.mts';
import { PGSTATS } from './pgstats.mts';
import { type GameData } from '../../core/game-master.mts';
import { decodePng, screenIn, type Image } from '../../core/png.mts';
import { storage } from './storage.mts';
import { useTestEngine } from '../../core/node/test-engine.mts';
import { readFileSync } from 'node:fs';
import { afterAll, expect, test } from 'vitest';

const ROOT = new URL('../../../', import.meta.url);
const DATA = JSON.parse(readFileSync(new URL('../../../data/game-master.json', import.meta.url), 'utf8')) as GameData;

/** `DEFAULTS` with nothing waited for, there being no animation here to let settle. */
const CONFIG: Config = {
  ...DEFAULTS,
  waits: { launch: 0, tap: 0, swipe: 0, scroll: 0, menu: 0, search: 0 },
};

const read = (path: string) => Promise.resolve(new Uint8Array(readFileSync(new URL(path, ROOT))));

/** A recording as a phone would have drawn it, which for a detail capture is its stitch's first screen. */
const screenAt = (path: string) => screenIn(decodePng(new Uint8Array(readFileSync(new URL(path, ROOT)))));

const same = (a: Image, b: Image) =>
  a.width === b.width && a.height === b.height && Buffer.compare(a.data, b.data) === 0;

afterAll(useTestEngine());

test("a read of PGSharp's export answers the made-up snapshot the Pokédex marks against", async () => {
  const device = new Device(demoTransport(read));

  expect(new TextDecoder().decode(await device.read(PGSTATS))).toBe(readFileSync(new URL(DEMO_STATS, ROOT), 'utf8'));
});

test('every screenshot is the one detail screen, one screen rather than the stitch', async () => {
  const device = new Device(demoTransport(read));
  const first = await device.screenshot();
  const again = await device.screenshot();

  expect(same(first, screenAt(DEMO_DETAIL))).toBe(true);
  expect(same(again, screenAt(DEMO_DETAIL))).toBe(true);
});

test('a search walks from a detail screen to storage, answers its count, and leaves a detail screen', async () => {
  const device = new Device(demoTransport(read));
  const said: string[] = [];
  const { search, matches } = storage(device, CONFIG, DATA, await device.screenshot(), (message) => said.push(message));
  const lines = await search('shiny');

  expect(said).toStrictEqual(['Pokémon GO is already in front']);

  // The counter `storage/searched.png` shows beside the magnifier.
  expect(matches(lines)).toBe(3464);
  expect(same(await device.screenshot(), screenAt(DEMO_DETAIL))).toBe(true);
});

test('asked what it is, it answers as the Pixel 8 Pro its recordings were taken on', async () => {
  expect(await new Device(demoTransport(read)).about()).toStrictEqual({
    maker: 'Google',
    model: 'Pixel 8 Pro',
    android: '17',

    // Its 1344 × 2992 at the display size the recordings were drawn at, read off them: a recording from another phone
    // fails here, which is when the model above wants changing with it.
    screen: [1008, 2244],
    battery: 76,
  });
});
