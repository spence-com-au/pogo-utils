/**
 * The demo phone driven as the pages drive it — through a `Device`, and for a search through the very walk to storage
 * the Search page runs — over the recordings the site publishes for it and under real OCR, so what passes here is what
 * a reader with no phone sees: a different Pokémon at every read, and a search that finds storage from one of them.
 */

import { DEMO_DETAILS } from '../../generated.ts';
import { Device } from './adb.mts';
import { DEFAULTS, type Config } from './config.mts';
import { demoTransport } from './demo.mts';
import { type GameData } from './game-master.mts';
import { decodePng, screenIn, type Image } from './png.mts';
import { storage } from './storage.mts';
import { useTestEngine } from './test-engine.mts';
import { readFileSync } from 'node:fs';
import { afterAll, expect, test } from 'vitest';

const ROOT = new URL('../../../', import.meta.url);
const DATA = JSON.parse(readFileSync(new URL('fixtures/game-master.json', import.meta.url), 'utf8')) as GameData;

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

test('each screenshot is the next detail screen, one screen rather than the stitch, and round again', async () => {
  const device = new Device(demoTransport(read));
  const shown: Image[] = [];

  for (let at = 0; at <= DEMO_DETAILS.length; at++) {
    shown.push(await device.screenshot());
  }

  expect(shown.map((image, at) => same(image, screenAt(DEMO_DETAILS[at % DEMO_DETAILS.length] as string)))).toEqual(
    shown.map(() => true),
  );
});

test('a search walks from a detail screen to storage, answers its count, and leaves a detail screen', async () => {
  const device = new Device(demoTransport(read));
  const said: string[] = [];
  const { search, matches } = storage(device, CONFIG, DATA, await device.screenshot(), (message) => said.push(message));
  const lines = await search('shiny');

  expect(said).toStrictEqual(['Pokémon GO is already in front']);

  // The counter `storage/searched.png` shows beside the magnifier.
  expect(matches(lines)).toBe(3464);
  expect(same(await device.screenshot(), screenAt(DEMO_DETAILS[2] as string))).toBe(true);
});
