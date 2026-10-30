/**
 * The menu reader against each screen between two recorded Team Leader battles, at the recording's 720×1520 — a live run
 * reads full-size screenshots, which OCR reads at least as well. Tesseract has to be installed, as for the inventory
 * readers. The Battle tab's QR code is painted over in its fixture, being tied to the account it was recorded on.
 */

import { decodePng } from '../inventory/png.mts';
import { fold, ocr } from '../inventory/ocr.mts';
import { useWasmEngine } from '../inventory/test-engine.mts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, test, vi } from 'vitest';
import { carousel, isParty, readMenu, readOutcome, searchParty, type Menu } from './menus.mts';

afterAll(useWasmEngine());

const fixture = (name: string) =>
  decodePng(readFileSync(fileURLToPath(new URL(`fixtures/${name}.png`, import.meta.url))));

const near = (menu: Menu, x: number, y: number) =>
  'tap' in menu && Math.abs(menu.tap[0] - x) < 0.04 && Math.abs(menu.tap[1] - y) < 0.03;

// `menu-training-full` is a full-size screenshot, the kind a run reads, off which OCR read none of the leaders' names.
test.each([
  ['menu-training', 'blanche', 0.26],
  ['menu-training', 'candela', 0.5],
  ['menu-training', 'spark', 0.74],
  ['menu-training-full', 'blanche', 0.26],
  ['menu-training-full', 'candela', 0.5],
  ['menu-training-full', 'spark', 0.74],
] as const)("taps %s's %s portrait on the Battle tab, without reading the screen", async (name, leader, x) => {
  const read = vi.fn();
  const menu = await readMenu(fixture(name), { mode: 'training', leader, league: 'ultra', result: false }, read);

  expect(menu.screen).toBe('training');
  expect(near(menu, x, 0.8)).toBe(true);
  expect(read).not.toHaveBeenCalled();
});

// Blanche's off a recording, over daylight; Spark's a full-size screenshot over a lit city, which shows through the ✗.
test.each(['menu-intro', 'menu-intro-spark'])('taps BATTLE on %s without reading the screen', async (name) => {
  const read = vi.fn();
  const menu = await readMenu(
    fixture(name),
    { mode: 'training', leader: 'spark', league: 'ultra', result: false },
    read,
  );

  expect(menu).toEqual({ screen: 'intro', tap: [0.5, expect.closeTo(0.733, 3)] });
  expect(read).not.toHaveBeenCalled();
});

test.each([
  ['great', 0.43],
  ['ultra', 0.58],
  ['master', 0.74],
] as const)('taps %s league', async (league, y) => {
  const menu = await readMenu(fixture('menu-league'), { mode: 'training', leader: 'blanche', league, result: false });

  expect(menu.screen).toBe('league');
  expect(near(menu, 0.55, y)).toBe(true);
});

// The recording's button and the full-size screenshot's differ by 28 in red, which one colour to within 20 missed. The
// Pixel 8 Pro's are the party's card drawn darker after the card read's search in storage, a screenshot and a frame,
// with the button lower down its taller screen, pinned as it is to the panel that stretches with it.
test.each([
  ['menu-party', 0.87],
  ['menu-party-full', 0.87],
  ['menu-pixel8-party-dimmed', 0.872],
  ['menu-pixel8-party-dimmed-frame', 0.872],
])('taps USE THIS PARTY on %s without reading the screen', async (name, y) => {
  const read = vi.fn();
  const menu = await readMenu(
    fixture(name),
    { mode: 'training', leader: 'blanche', league: 'ultra', result: false },
    read,
  );

  expect(menu).toEqual({ screen: 'party', tap: [0.5, expect.closeTo(y, 3)] });
  expect(read).not.toHaveBeenCalled();
});

test('taps the ✓ on the result once a battle has ended', async () => {
  expect(
    await readMenu(fixture('menu-result'), { mode: 'training', leader: 'blanche', league: 'ultra', result: true }),
  ).toEqual({
    screen: 'result',
    tap: [0.5, expect.closeTo(0.935, 3)],
  });
});

test('taps the ✓ on a result left over from before the run, off its verdict', async () => {
  expect(
    await readMenu(fixture('menu-result'), { mode: 'training', leader: 'blanche', league: 'ultra', result: false }),
  ).toEqual({
    screen: 'result',
    tap: [0.5, expect.closeTo(0.935, 3)],
  });
});

// GO Battle League never looks for the leader's speech, so its ✗ comes down to the result's test: with no battle ended
// and no verdict on it, the ✗ is no ✓.
test('leaves the ✗ under the leader’s speech alone when no result is due', async () => {
  expect(await readMenu(fixture('menu-intro'), { mode: 'gbl', league: 'ultra', result: false })).toEqual({
    screen: 'unknown',
  });
});

test('still finds the leader with a result due', async () => {
  const menu = await readMenu(fixture('menu-training'), {
    mode: 'training',
    leader: 'blanche',
    league: 'ultra',
    result: true,
  });

  expect(menu.screen).toBe('training');
});

/**
 * The way in from the map, off full-size screenshots: the Poké Ball, then BATTLE on the main menu under its label, then
 * the Battle tab, which opens on GO Battle League and is scrolled down to the Training card. The map's grass and GO
 * Battle League's BATTLE both pass the green buttons' colour test, and a tap on the latter enters a GO Battle League
 * match; neither is ever read as either button, with a result due or not. The map's friend-gift banner is painted over.
 */
test.each([
  ['menu-map', { screen: 'map', tap: [0.5, expect.closeTo(0.932, 3)] }],
  [
    'menu-battle-league',
    {
      screen: 'battle-tab',
      swipe: [
        [0.5, 0.75],
        [0.5, 0.35],
      ],
    },
  ],
] as const)('finds the way in on %s', async (name, expected) => {
  for (const result of [false, true]) {
    expect(await readMenu(fixture(name), { mode: 'training', leader: 'candela', league: 'master', result })).toEqual(
      expected,
    );
  }
});

test('taps BATTLE on the main menu, under its label', async () => {
  const menu = await readMenu(fixture('menu-main'), {
    mode: 'training',
    leader: 'candela',
    league: 'master',
    result: false,
  });

  expect(menu.screen).toBe('main');
  expect(near(menu, 0.777, 0.5975)).toBe(true);
});

test.each(['menu-unknown-medal', 'menu-unknown-loss'])('waits on %s, before the ✓ has appeared', async (name) => {
  expect(await readMenu(fixture(name), { mode: 'training', leader: 'blanche', league: 'ultra', result: true })).toEqual(
    {
      screen: 'unknown',
    },
  );
});

/**
 * Off a Pixel 8 Pro, two screens whose OCR missed the word they were told by: the main menu's ITEMS, with PGSharp's
 * toolbar open down its left edge, and the Battle tab's PARTY, grey on its teal header. The tab's QR code is painted
 * over, and its Training card is under the ✗, so it is the header alone that says what it is.
 */
test('taps BATTLE on a main menu whose ITEMS went unread', async () => {
  const menu = await readMenu(fixture('menu-pixel8-main'), {
    mode: 'training',
    leader: 'candela',
    league: 'great',
    result: false,
  });

  expect(menu.screen).toBe('main');
  expect(near(menu, 0.777, 0.62)).toBe(true);
});

test('scrolls a Battle tab whose PARTY went unread', async () => {
  expect(
    await readMenu(fixture('menu-pixel8-battle-tab'), {
      mode: 'training',
      leader: 'candela',
      league: 'great',
      result: false,
    }),
  ).toEqual({
    screen: 'battle-tab',
    swipe: [
      [0.5, 0.75],
      [0.5, 0.35],
    ],
  });
});

/**
 * The rest of the way round off that Pixel 8 Pro, at 1008×2244, where a piece pinned to the wrong edge lands 0.005 to
 * 0.02 of the height from where it is drawn: so its taps are held to 0.01 of where each was measured on the screenshot.
 * One scroll down its Battle tab leaves the Training card under the ✗. The QR code and the trainer's name are painted
 * over.
 */
const pixel8 = (name: string) => fixture(`menu-pixel8-${name}`);

const at = (menu: Menu, x: number, y: number) =>
  'tap' in menu && Math.abs(menu.tap[0] - x) < 0.01 && Math.abs(menu.tap[1] - y) < 0.01;

test.each([
  ['map', 'map', 0.5, 0.936],
  ['training', 'training', 0.5, 0.809],
  ['intro', 'intro', 0.5, 0.7215],
  ['league', 'league', 0.545, 0.431],
  ['party', 'party', 0.5, 0.871],
] as const)('taps the %s on a Pixel 8 Pro', async (name, screen, x, y) => {
  const menu = await readMenu(pixel8(name), { mode: 'training', leader: 'candela', league: 'great', result: false });

  expect(menu.screen).toBe(screen);
  expect(at(menu, x, y)).toBe(true);
});

test('scrolls a Training card found under the ✗ rather than tap it', async () => {
  expect(
    await readMenu(pixel8('training-low'), { mode: 'training', leader: 'candela', league: 'great', result: false }),
  ).toEqual({
    screen: 'battle-tab',
    swipe: [
      [0.5, 0.75],
      [0.5, 0.35],
    ],
  });
});

test('taps the ✓ on a Pixel 8 Pro’s result', async () => {
  const menu = await readMenu(fixture('other-pixel8-loss'), {
    mode: 'training',
    leader: 'candela',
    league: 'great',
    result: true,
  });

  expect(menu.screen).toBe('result');
  expect(at(menu, 0.5, 0.935)).toBe(true);
});

const GBL = { mode: 'gbl', result: false } as const;

test("taps GO Battle League's BATTLE on the Battle tab", async () => {
  const menu = await readMenu(fixture('menu-gbl-battle-tab'), { ...GBL, league: 'ultra' });

  expect(menu.screen).toBe('gbl');
  expect(near(menu, 0.3, 0.843)).toBe(true);
});

// Before a set the card has a line more and BATTLE sits low, its middle under the ✗.
test("taps GO Battle League's BATTLE clear of the ✗ before a set", async () => {
  const menu = await readMenu(fixture('menu-gbl-new-set'), { ...GBL, league: 'ultra' });

  expect(menu.screen).toBe('gbl');
  expect(near(menu, 0.3, 0.903)).toBe(true);
});

// The same green on the same white as USE THIS PARTY, which it was taken for.
test("taps LET'S GO! on GO Battle League's welcome before a set", async () => {
  const menu = await readMenu(fixture('menu-gbl-welcome'), { ...GBL, league: 'ultra' });

  expect(menu.screen).toBe('welcome');
  expect(near(menu, 0.3, 0.895)).toBe(true);
});

test('scrolls the Battle tab back up to GO Battle League, and never taps a leader for it', async () => {
  expect(await readMenu(fixture('menu-training'), { ...GBL, league: 'ultra' })).toEqual({
    screen: 'battle-tab',
    swipe: [
      [0.5, 0.35],
      [0.5, 0.75],
    ],
  });
});

// Next week's leagues are listed faded under the ones on now, Master League among them: only the one on now is tapped.
test.each([
  ['ultra', 0.54, 0.43],
  ['Master League', 0.64, 0.57],
  ['fantasy cup', 0.62, 0.71],
])('taps the GO Battle League %s card', async (league, x, y) => {
  const menu = await readMenu(fixture('menu-gbl-league'), { ...GBL, league });

  expect(menu.screen).toBe('league');
  expect(near(menu, x, y)).toBe(true);
});

test('refuses a league that is not on now, naming those that are', async () => {
  await expect(readMenu(fixture('menu-gbl-league'), { ...GBL, league: 'great' })).rejects.toThrow(
    '--league great is not on now: ultra league; master league mega edition; fantasy cup great league edition',
  );
});

// Two cards read in full but not the heading over the first: the list may have opened part way down, the league asked
// for above them, so it is scrolled up rather than refused.
test('scrolls the league list up rather than refuse a league where its heading went unread', async () => {
  const unheaded = async (image: Parameters<typeof ocr>[0]) =>
    (await ocr(image)).filter((line) => fold(line.text) !== 'choose your league');

  expect(await readMenu(fixture('menu-gbl-league'), { ...GBL, league: 'great' }, unheaded)).toEqual({
    screen: 'league',
    swipe: [
      [0.5, 0.42],
      [0.5, 0.85],
    ],
  });
});

test('scrolls the league list to its top where it opened part way down', async () => {
  expect(await readMenu(fixture('menu-gbl-league-scrolled'), { ...GBL, league: 'ultra' })).toEqual({
    screen: 'league',
    swipe: [
      [0.5, 0.42],
      [0.5, 0.85],
    ],
  });
});

// The party's name, which is all `isParty` matches: the icon beside it reads as litter, `i7` under one engine and `7`
// under another.
const RECOMMENDED = expect.stringMatching(/^recommended battle party\b/);

// Master League's party says `No limit` where Ultra's says 2,500: read off the same screen, its line rewritten.
test('reads no cap off a GO Battle League party with no limit', async () => {
  const unlimited = async (image: Parameters<typeof ocr>[0]) =>
    (await ocr(image)).map((line) =>
      fold(line.text).startsWith('max cp') ? { ...line, text: 'Max CP per Pokémon: No limit' } : line,
    );

  expect(await readMenu(fixture('menu-gbl-party'), { ...GBL, league: 'master' }, unlimited)).toEqual({
    screen: 'party',
    tap: [0.5, expect.closeTo(0.87, 3)],
    cap: null,
    title: RECOMMENDED,
    cps: [2500, 2495, 2336],
  });
});

// Ultra League's `Max CP per Pokémon: 2,500` under its name, which a cup's title does not say; and each card's CP.
test("taps USE THIS PARTY on GO Battle League's recommended party, reading the league's cap", async () => {
  expect(await readMenu(fixture('menu-gbl-party'), { ...GBL, league: 'ultra' })).toEqual({
    screen: 'party',
    tap: [0.5, expect.closeTo(0.87, 3)],
    cap: 2500,
    title: RECOMMENDED,
    cps: [2500, 2495, 2336],
  });
});

test('waits while GO Battle League finds an opponent', async () => {
  expect(await readMenu(fixture('menu-gbl-matchmaking'), { ...GBL, league: 'ultra' })).toEqual({
    screen: 'matchmaking',
  });
});

test("taps NEXT BATTLE on GO Battle League's result, and the ✓ in Training", async () => {
  const gbl = await readMenu(fixture('menu-gbl-result'), { ...GBL, league: 'ultra', result: true });
  const training = await readMenu(fixture('menu-gbl-result'), {
    mode: 'training',
    leader: 'blanche',
    league: 'ultra',
    result: true,
  });

  expect(gbl.screen).toBe('result');
  expect(near(gbl, 0.5, 0.854)).toBe(true);
  expect(training).toEqual({ screen: 'result', tap: [0.5, expect.closeTo(0.935, 3)] });
});

// A set's last battle has no NEXT BATTLE, only the ✓.
test("taps the ✓ on the result of a GO Battle League set's last battle", async () => {
  expect(await readMenu(fixture('menu-gbl-result-last'), { ...GBL, league: 'ultra', result: true })).toEqual({
    screen: 'result',
    tap: [0.5, expect.closeTo(0.935, 3)],
  });
});

test('finds no battle on the GO Battle League card while its reward waits to be collected', async () => {
  expect(await readMenu(fixture('menu-gbl-collect'), { ...GBL, league: 'ultra' })).toEqual({ screen: 'no-battle' });
});

// The carousel of Ultra League's three saved parties on a Pixel 8 Pro, each read by the title of the one in front.
test.each([
  ['party-test4', 'test 4'],
  ['party-test3', 'test 3'],
  ['party-gbl', 'gbl'],
])('reads the title of the party in front off %s', async (name, title) => {
  const menu = await readMenu(pixel8(name), { mode: 'gbl', league: 'ultra', result: false });

  expect(menu).toMatchObject({ screen: 'party', title });
});

// Its words whole and in order: one letter from another party's name is another party, not a misreading of it.
test.each([
  ['test 4', 'Test 4', true],
  ['test 4', 'Test 3', false],
  ['gbl', 'GBL', true],
  ['pgs recommended battle party v', 'Recommended Battle Party', true],
  ['test 40', 'Test 4', false],
])('takes %j for the party named %j: %s', (title, name, is) => {
  expect(isParty(title, name)).toBe(is);
});

/** The steps a search takes, the carousel being Test 4, Test 3 and GBL, from the title in front at each. */
function walk(titles: readonly (string | undefined)[], name: string): string[] {
  const search = carousel();

  return titles.map((title) => searchParty(search, title, name));
}

test('searches the carousel on from the party it opens on', () => {
  expect(walk(['test 4', 'test 3', 'gbl'], 'GBL')).toEqual(['next', 'next', 'use']);
});

// A swipe that leaves the same party in front is the end of the carousel, and the search turns back from it.
test('turns back at the end of the carousel to find a party before it', () => {
  expect(walk(['gbl', 'gbl', 'test 3', 'test 4'], 'Test 4')).toEqual(['next', 'back', 'back', 'use']);
});

test('waits for a read of the title rather than swipe past what it could not read', () => {
  expect(walk([undefined, 'test 4'], 'Test 4')).toEqual(['unread', 'use']);
});

test('stops at the second end without the party, naming those it passed', () => {
  const search = carousel();

  for (const title of ['test 4', 'test 3', 'gbl', 'gbl', 'test 3', 'test 4']) {
    searchParty(search, title, 'Great');
  }

  expect(() => searchParty(search, 'test 4', 'Great')).toThrow(
    'no party named Great saved for this league: test 4, test 3, gbl, test 3, test 4',
  );
});

// A title misread one way and then another never shows an end, so the search is held to a number of swipes instead.
test('stops after so many swipes where the carousel never shows an end', () => {
  const search = carousel();
  const swipe = (n: number) => searchParty(search, n % 2 === 0 ? 'test 4' : 'test 3', 'GBL');

  for (let n = 0; n < 24; n++) {
    swipe(n);
  }

  expect(() => swipe(24)).toThrow('no party named GBL saved for this league');
});

// Stream frames from a Pixel 4 XL and a Pixel 8 Pro, and the full-size screenshots of the result a run reads it off.
test.each([
  ['other-win', 'won'],
  ['menu-result', 'won'],
  ['menu-gbl-result-last', 'won'],
  ['other-loss', 'lost'],
  ['other-pixel8-loss', 'lost'],
  ['menu-gbl-result', 'lost'],
  ['menu-unknown-medal', undefined],
  ['battle-deoxys', undefined],
] as const)('reads %s as %s', async (name, outcome) => {
  expect(await readOutcome(fixture(name))).toBe(outcome);
});
