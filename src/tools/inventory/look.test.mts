/**
 * The look down a detail screen for its moves, driven against a phone that is recordings, `scrolling` through the
 * screens a test gives. The moves are read off them by the real Tesseract, and the overlay over them is whatever a test
 * says it reads as.
 */

import { DEFAULTS, type Config } from './config.mts';
import { type GameData } from '../../core/game-master.mts';
import { UNMEASURED_SWIPE, lookForMoves, type Looking } from './look.mts';
import { type Overlay } from './overlay.mts';
import { decodePng, type Image } from '../../core/png.mts';
import { type Reading } from './scan.mts';
import { offsetBetween } from './stitch.mts';
import { useTestEngine } from '../../core/node/test-engine.mts';
import { scrolling } from './test-phone.mts';
import { readFileSync } from 'node:fs';
import { afterAll, expect, test } from 'vitest';

afterAll(useTestEngine());

const DATA = JSON.parse(readFileSync(new URL('../../../data/game-master.json', import.meta.url), 'utf8')) as GameData;
const ELGYEM = DATA.forms.find((f) => f.species === 'Elgyem') ?? null;

/** `DEFAULTS` with nothing waited for, a recording having no animation to let settle. */
const CONFIG: Config = { ...DEFAULTS, waits: { launch: 0, tap: 0, swipe: 0, scroll: 0, menu: 0, search: 0 } };

const capture = (file: string) => decodePng(readFileSync(new URL(`fixtures/${file}`, import.meta.url)));

const DETAIL = capture('moves/elgyem-detail.png');
const MOVES = capture('moves/elgyem-moves.png');

/** The overlay the Elgyem's detail screen reads, `11/13/8` at level 8. */
const OVERLAY: Overlay = { levels: [8], iv: { attack: 11, defense: 13, stamina: 8 }, checked: true, form: null };

/** The Elgyem's reading off `DETAIL`, its stardust read so that none is looked for further down. */
const reading = (overlay: Overlay | null = OVERLAY): Reading => ({
  detail: {
    cp: 295,
    cps: [],
    name: 'Elgyem',
    hp: 57,
    weight: 7.6,
    height: 0.46,
    types: ['Psychic'],
    gender: null,
    favourite: false,
    lucky: false,
    size: null,
    tags: [],
    evolveCandy: null,
    powerUp: 800,
    max: null,
  },
  overlay,
  key: 'elgyem|57|7.6|0.46|11/13/8',
  id: {
    form: ELGYEM,
    levels: [8],
    nickname: null,
    notes: [],
    cp: 295,
    height: 0.46,
    alternatives: [],
    unseparated: [],
  },
  image: DETAIL,
  latest: DETAIL,
  faults: 0,
});

/** Looks down the phone's screens from `from`, answering what was found, what was kept and what was dismissed. */
async function look(screens: readonly Image[], from: Reading, scroll = false) {
  const { device, swipes } = scrolling(screens);
  const kept: { name: string; height: number; carry: Readonly<Record<string, string>> | undefined }[] = [];
  let dismissed = 0;

  const looking: Looking = {
    device,
    config: CONFIG,
    data: DATA,
    scroll,
    screen: DETAIL,
    overlayOf: async () => OVERLAY,
    dismiss: async () => void dismissed++,
    keep: (name, image, carry) => void kept.push({ name, height: image.height, carry }),
    read: () => expect.unreachable('the walk read again'),
    next: () => expect.unreachable('the walk swiped on'),
  };

  const looked = await lookForMoves(looking, from, '00001', ELGYEM);

  return { looked, swipes, kept, dismissed };
}

test('the moves are read one step down, and the screen scrolled back as far as it was measured to move', async () => {
  const { looked, swipes, kept } = await look([DETAIL, MOVES], reading());
  const moved = offsetBetween(DETAIL, MOVES, CONFIG.scrollBand) ?? expect.unreachable('the recordings do not line up');

  expect(looked).toStrictEqual({ moves: { fast: 'Astonish', charged: ['Dark Pulse'] }, powerUp: null, notes: [] });
  expect(kept.map(({ name }) => name)).toStrictEqual(['00001-moves']);

  // One swipe up, then down by what it moved rather than by what it dragged, give or take a pixel a drag rounds by.
  const [down, ...back] = swipes;

  expect(down?.way).toBe('up');
  expect(back.every(({ way }) => way === 'down')).toBe(true);
  expect(Math.abs(back.reduce((sum, { by }) => sum + by, 0) - moved)).toBeLessThanOrEqual(back.length);
});

test('`--scroll` keeps the stitch under the row’s own name, with the height the phone drew it at', async () => {
  const { looked, swipes, kept } = await look([DETAIL, MOVES], reading(), true);
  const [stitched] = kept;

  expect(looked).toStrictEqual({ moves: { fast: 'Astonish', charged: ['Dark Pulse'] }, powerUp: null, notes: [] });
  expect(kept.map(({ name, carry }) => [name, carry])).toStrictEqual([['00001', { Viewport: '1440x3040' }]]);
  expect(stitched?.height).toBeGreaterThan(DETAIL.height);

  // On to the moves and once more to find that the screen ends there, and back up.
  expect(swipes.map(({ way }) => way).slice(0, 3)).toStrictEqual(['up', 'up', 'down']);
});

test('a stitch begun from a later screenshot than the reading’s own says so', async () => {
  // An attempt before the last, as `bestOf` can keep: the same screen, photographed earlier.
  const earlier = capture('moves/elgyem-detail.png');
  const { looked } = await look([DETAIL, MOVES], { ...reading(), image: earlier }, true);

  expect(looked.notes).toStrictEqual([
    'the capture kept for this row is a later read of the screen than the row itself',
  ]);
});

test('a dialog the swipe to the moves opened is closed, and the row says so', async () => {
  const { looked, dismissed } = await look([DETAIL, capture('dialog/sableye-mega-level.png')], reading(null));

  expect(dismissed).toBe(1);
  expect(looked.notes).toStrictEqual([
    UNMEASURED_SWIPE,
    'a dialog opened on the swipe to the moves and was closed',
    'moves not fully read',
  ]);
});
