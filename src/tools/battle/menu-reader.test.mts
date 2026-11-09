/**
 * The menus between battles read and acted on, without a battle: off committed screenshots, through a phone that
 * answers each screenshot with one screen and records what is done to it, on a clock that moves only when told to or
 * when the reader waits. Tesseract reads the screens, as for `menus.test.mts`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, test } from 'vitest';
import { type GameData } from '../inventory/game-master.mts';
import { decodePng, type Image } from '../inventory/png.mts';
import { useWasmEngine } from '../inventory/test-engine.mts';
import { type Point } from './layout.mts';
import { MENU_AFTER_MS, MenuReader, type Read } from './menu-reader.mts';
import { type Menu, type Mode } from './menus.mts';
import { cardAt, silhouetteOfIcon } from './party.mts';
import { type Phone } from './phone.mts';
import { type Options } from './run.mts';

afterAll(useWasmEngine());

const DATA = JSON.parse(
  readFileSync(new URL('../inventory/fixtures/game-master.json', import.meta.url), 'utf8'),
) as GameData;

const fixture = (name: string) =>
  decodePng(readFileSync(fileURLToPath(new URL(`fixtures/${name}.png`, import.meta.url))));

/** The icons `party.test.mts` reads the party screens against. */
const ICONS = readdirSync(new URL('fixtures/icons/', import.meta.url)).map((icon) => ({
  species: DATA.forms.find((form) => form.icon === icon)?.species ?? icon,
  silhouette: silhouetteOfIcon(fixture(`icons/${icon.replace(/[.]png$/, '')}`)),
}));

const TRAINING: Mode = { mode: 'training', leader: 'blanche', league: 'ultra' };
const GBL: Mode = { mode: 'gbl', league: 'ultra' };

/**
 * A reader in `mode` of a phone whose every screenshot is `screen`, loading a league's meta by `metaOf`, and what it was
 * told and did: the events it told, each tap and swipe, how many screenshots it took and how often it told of progress.
 * `lost` is what the run answers when asked whether it is lost, and `time` the clock, which moves only as the reader
 * waits or a test moves it.
 */
function readerOf(screen: Image, mode: Mode = TRAINING, metaOf?: Options['metaOf']) {
  const told = {
    events: [] as string[],
    taps: [] as Point[],
    swipes: [] as Point[][],
    screenshots: 0,
    progress: 0,
    lost: false,
    time: 0,
  };
  const phone: Phone = {
    frame: () => screen,
    screenshot: () => {
      told.screenshots++;
      return Promise.resolve(screen);
    },
    tap: (at) => {
      told.taps.push(at);
      return Promise.resolve();
    },
    swipe: (from, to) => {
      told.swipes.push([from, to]);
      return Promise.resolve();
    },
    hold: () => Promise.resolve(screen),
    search: () => Promise.resolve(),
    views: () => Promise.resolve(''),
  };
  const clock = {
    now: () => told.time,
    sleep: (ms: number) => {
      told.time += ms;
      return Promise.resolve();
    },
  };
  const reader = new MenuReader(
    phone,
    clock,
    { mode, data: DATA, icons: ICONS, metaOf },
    (line, _, why) => told.events.push(why ? `${line}: ${why}` : line),
    { progress: () => told.progress++, lost: () => told.lost },
  );

  return { reader, told };
}

/** What `poll` answers once the read it began beside the loop is back. */
async function polled(reader: MenuReader, battling: boolean, battles: number): Promise<Read> {
  for (let tries = 0; tries < 500; tries++) {
    const read = reader.poll(battling, battles);

    if (read) {
      return read;
    }

    await setTimeout(10);
  }

  throw new Error('no read came back');
}

/** `menu` as `act` is handed it, off `screen`, read with no battle before it. */
const reading = (screen: Image, menu: Menu): Read => ({ screenshot: screen, menu, ended: false, outcome: undefined });

test('screenshots a screen only once it has shown no battle for `MENU_AFTER_MS`', async () => {
  const { reader, told } = readerOf(fixture('menu-result'));

  expect(reader.poll(true, 0)).toBe(undefined);
  told.time = MENU_AFTER_MS - 1;
  expect(reader.poll(true, 0)).toBe(undefined);
  expect(told.screenshots).toBe(0);
  expect(reader.screen).toBe('other');

  told.time = MENU_AFTER_MS;

  expect(await polled(reader, true, 0)).toMatchObject({ menu: { screen: 'result' }, ended: true, outcome: 'won' });
  expect(reader.screen).toBe('result');
});

test('drops a read under way once the battle is back, and waits afresh', async () => {
  const { reader, told } = readerOf(fixture('menu-result'));

  reader.poll(true, 0);
  told.time = MENU_AFTER_MS;
  reader.poll(true, 0);
  reader.leave();

  expect(reader.poll(true, 0), 'waiting from when the battle was back').toBe(undefined);

  told.time = 2 * MENU_AFTER_MS;
  await polled(reader, true, 0);

  expect(told.screenshots, 'the read begun before the battle came back never answered').toBe(2);
});

// The demo clip's frame of its result with the ✓ drawn and the verdict not yet: passed over once, then counted unread.
test('passes over a result whose verdict is fading in, once', async () => {
  const { reader, told } = readerOf(fixture('menu-result-fading'));

  reader.poll(true, 0);
  told.time = MENU_AFTER_MS;

  expect((await polled(reader, true, 0)).menu).toEqual({ screen: 'unknown' });
  expect(await polled(reader, true, 0)).toMatchObject({ menu: { screen: 'result' }, ended: true, outcome: undefined });
});

test("leaves GO Battle League's map alone once a battle has been played", async () => {
  const map = readerOf(fixture('menu-map'), GBL);

  map.reader.poll(false, 0);
  map.told.time = MENU_AFTER_MS;
  expect((await polled(map.reader, false, 0)).menu.screen).toBe('map');

  const after = readerOf(fixture('menu-map'), GBL);

  after.reader.poll(false, 1);
  after.told.time = MENU_AFTER_MS;
  expect((await polled(after.reader, false, 1)).menu).toEqual({ screen: 'unknown' });
});

test('taps a menu as progress, and waits for the next screen to settle', async () => {
  const { reader, told } = readerOf(fixture('menu-main'));

  expect(await reader.act(reading(fixture('menu-main'), { screen: 'main', tap: [0.5, 0.5] }))).toBe('acted');
  expect(told).toMatchObject({ taps: [[0.5, 0.5]], progress: 1, time: 1_500, events: ['main: tap'] });
});

test('scrolls the Battle tab without counting it as progress, unless the run is lost', async () => {
  const { reader, told } = readerOf(fixture('menu-battle-league'));
  const swipe: [Point, Point] = [
    [0.5, 0.75],
    [0.5, 0.35],
  ];
  const scroll = reading(fixture('menu-battle-league'), { screen: 'battle-tab', swipe });

  expect(await reader.act(scroll)).toBe('acted');
  expect(told).toMatchObject({ swipes: [swipe], progress: 0 });

  told.lost = true;
  expect(await reader.act(scroll)).toBe('lost');
  expect(told.swipes).toHaveLength(1);
});

test("stops for GO Battle League's reward only once BATTLE reads greyed out twice in a row", async () => {
  const { reader, told } = readerOf(fixture('menu-gbl-collect'), GBL);
  const collect = reading(fixture('menu-gbl-collect'), { screen: 'no-battle' });
  const matchmaking = reading(fixture('menu-gbl-matchmaking'), { screen: 'matchmaking' });

  expect(await reader.act(collect)).toBe('acted');
  expect(await reader.act(matchmaking), 'matchmaking is progress').toBe('acted');
  expect(told.progress).toBe(1);
  expect(await reader.act(collect), 'not twice in a row').toBe('acted');
  expect(await reader.act(collect)).toBe('stop');
  expect(told.events).toEqual(['no-battle: a reward to collect']);
});

// No selection screen opens on this phone, so the first card goes unread and the party screen is read again; that
// card, and the two after it that the reading never reached, are not tried a second time.
test("tries a party's cards on the selection screen once, and taps USE THIS PARTY the next time round", async () => {
  const party = fixture('menu-party');
  const { reader, told } = readerOf(party);
  const menu = reading(party, { screen: 'party', tap: [0.5, 0.87], cps: [2490, 2470, 2450] });

  expect(await reader.act(menu)).toBe(undefined);
  expect(told.taps).toEqual([cardAt(0, party)]);
  expect(told.events.at(-1)).toBe('card 1 unread: the selection screen did not open');

  expect(await reader.act(menu)).toBe('acted');
  expect(told.taps).toEqual([cardAt(0, party), [0.5, 0.87]]);
  expect(reader.party.map(({ cp }) => cp)).toEqual([2490, 2470, 2450]);
});

// The cap is the meta's until GO Battle League's party screen states its own. The same card tapped again is not loaded
// again, and a league PvPoke ranks no meta for leaves none in force.
test('takes up the meta of the league card tapped, once for each title', async () => {
  const loaded: string[] = [];
  const ultra = { cup: 'all', cap: 2500, movesets: new Map() };

  const metaOf = (title: string) => {
    loaded.push(title);
    return Promise.resolve(title === 'ultra league' ? ultra : null);
  };

  const { reader, told } = readerOf(fixture('menu-gbl-league'), GBL, metaOf);
  const league = (title: string) => reading(fixture('menu-gbl-league'), { screen: 'league', tap: [0.5, 0.5], title });

  expect(await reader.act(league('ultra league'))).toBe('acted');
  expect(await reader.act(league('ultra league'))).toBe('acted');
  expect(reader.meta).toBe(ultra);
  expect(reader.cap).toBe(2500);

  expect(await reader.act(league('master league: mega'))).toBe('acted');
  expect(reader.meta).toBe(null);
  expect(reader.cap).toBe(undefined);
  expect(loaded).toEqual(['ultra league', 'master league: mega']);
  expect(told.events.filter((line) => line.startsWith("opponents' moves"))).toEqual([
    "opponents' moves as PvPoke ranks all at 2500 CP: 0 species",
  ]);
});
