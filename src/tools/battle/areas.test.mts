/**
 * Each reader against its own declared areas: every fixture of its screens read with everything outside them scrambled
 * has to read as it does whole. A reader that samples, reads or taps anything it has not declared reads differently,
 * or not at all, with that scrambled, so it cannot leave out of its areas what PGSharp's overlay must be kept clear of.
 *
 * OCR of the whole screen is the exception, Tesseract's lines shifting with whatever surrounds them however the rest is
 * scrambled. So the whole screen is read once, as it is, and a reader that reads it is handed only the lines that lie
 * wholly inside its areas, as though everything else were covered.
 */

import { type GameData } from '../inventory/game-master.mts';
import { decodePng, type Image } from '../inventory/png.mts';
import { ocr, type Line } from '../inventory/ocr.mts';
import { useWasmEngine } from '../inventory/test-engine.mts';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, test } from 'vitest';
import { type Area } from './layout.mts';
import { areas as menuAreas, readMenu, readOutcome } from './menus.mts';
import { areas as partyAreas, readCps, readParty, silhouetteOfIcon } from './party.mts';
import { areas as healthAreas, readHealth } from './health.mts';
import { areas as readAreas, readBanner, readBattle } from './read.mts';
import {
  areas as recogniseAreas,
  countdown,
  opponentShields,
  ownShields,
  pokemonLeft,
  readyButtons,
  recognise,
} from './recognise.mts';
import { areas as selectionAreas, isSelection, pinkCell, readPanel } from './selection.mts';
import { areas as typingAreas, iconColour, readTypes } from './typing.mts';

afterAll(useWasmEngine());

const dir = fileURLToPath(new URL('fixtures/', import.meta.url));
const fixture = (name: string) => decodePng(readFileSync(`${dir}${name}.png`));
const fixtures = (pattern: RegExp) =>
  readdirSync(dir)
    .map((file) => file.replace(/[.]png$/, ''))
    .filter((name) => pattern.test(name));

const DATA = JSON.parse(readFileSync(new URL('../../../data/game-master.json', import.meta.url), 'utf8')) as GameData;

const ICONS = readdirSync(new URL('fixtures/icons/', import.meta.url)).map((icon) => ({
  species: DATA.forms.find((form) => form.icon === icon)?.species ?? icon,
  silhouette: silhouetteOfIcon(fixture(`icons/${icon.replace(/[.]png$/, '')}`)),
}));

/** The side of the squares the screen is shuffled in, in widths: a letter or two, short of any word read. */
const BLOCK = 0.03;

/**
 * `image` with everything outside `areas` shuffled in `BLOCK` squares, at random but the same every run, so that no
 * word and no colour sampled there is where it was, but the screen's own colours and textures are all still there.
 * Tesseract takes its threshold from the whole image and finds its lines among its textures: painted flat, blurred or
 * greyed, the rest of the screen moved either far enough to lose words left whole, and scrambled pixel by pixel it read
 * for a minute.
 */
function masked(image: Image, areas: readonly Area[]): { image: Image; within: (line: Line) => boolean } {
  const { width, height } = image;
  const kept = new Uint8Array(width * height);

  for (const [left, top, right, bottom] of areas.flatMap((area) => area.boxes)) {
    for (let y = Math.max(0, Math.floor(top * height)); y < Math.min(height, Math.ceil(bottom * height)); y++) {
      kept.fill(
        1,
        y * width + Math.max(0, Math.floor(left * width)),
        y * width + Math.min(width, Math.ceil(right * width)),
      );
    }
  }

  const side = Math.max(1, Math.round(BLOCK * width));
  const across = Math.ceil(width / side);
  const blocks = across * Math.ceil(height / side);
  const from = Array.from({ length: blocks }, (_, i) => i);
  let seed = 1;

  // Fisher–Yates, by a linear congruential generator.
  for (let i = blocks - 1; i > 0; i--) {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
    const j = seed % (i + 1);
    [from[i], from[j]] = [from[j] ?? 0, from[i] ?? 0];
  }

  const data = Uint8Array.from(image.data);

  from.forEach((source, block) => {
    const [x, y] = [(block % across) * side, Math.floor(block / across) * side];
    const [sx, sy] = [(source % across) * side, Math.floor(source / across) * side];

    for (let row = 0; row < Math.min(side, height - y); row++) {
      for (let column = 0; column < Math.min(side, width - x); column++) {
        const at = (y + row) * width + x + column;

        if (!kept[at]) {
          // The blocks on the right and bottom edges are cut short, so a pixel taken from past one wraps around.
          const was = (((sy + row) % height) * width + ((sx + column) % width)) * 4;
          data.set(image.data.subarray(was, was + 4), at * 4);
        }
      }
    }
  });

  const within = ({ left, top, width: wide, height: tall }: Line) => {
    for (let y = top; y < top + tall; y++) {
      if (kept.subarray(y * width + left, y * width + left + wide).includes(0)) {
        return false;
      }
    }

    return true;
  };

  return { image: { width, height, data }, within };
}

/** `answer` with each fraction in it held to within half a hundredth, where an OCR line's edge may move a pixel. */
const near = (answer: unknown): unknown =>
  typeof answer === 'number' && !Number.isInteger(answer)
    ? expect.closeTo(answer, 2)
    : Array.isArray(answer)
      ? answer.map(near)
      : answer && typeof answer === 'object'
        ? Object.fromEntries(Object.entries(answer).map(([key, value]) => [key, near(value)]))
        : answer;

const MODES = [
  { mode: 'training', leader: 'blanche', league: 'ultra' },
  { mode: 'training', leader: 'spark', league: 'master' },
  { mode: 'gbl', league: 'ultra' },
] as const;

// The party screen's CPs are read by the menus' reader too, through `readCps`.
test.each(fixtures(/^(menu|other)-/))(
  'reads %s as it does whole with all but the menus’ areas scrambled',
  async (name) => {
    const image = fixture(name);
    const lines = await ocr(image);
    const painted = masked(image, [...menuAreas(image), ...partyAreas(image)]);
    const read = (on: Image, seen: readonly Line[]) =>
      Promise.all(
        MODES.map((mode) =>
          readMenu(on, { ...mode, result: false }, () => Promise.resolve([...seen])).catch((error: unknown) =>
            String(error),
          ),
        ),
      );

    expect(await read(painted.image, lines.filter(painted.within))).toEqual(near(await read(image, lines)));
  },
);

test.each(fixtures(/^(menu-result|menu-gbl-result|menu-unknown-loss|other-win|other-loss|other-pixel8-loss)/))(
  'reads the verdict on %s as it does whole with all but the menus’ areas scrambled',
  async (name) => {
    const image = fixture(name);

    expect(await readOutcome(masked(image, menuAreas(image)).image)).toEqual(await readOutcome(image));
  },
);

test.each(fixtures(/^menu(-pixel8)?-party/))(
  'reads the cards on %s as it does whole with all but theirs scrambled',
  async (name) => {
    const image = fixture(name);
    const painted = masked(image, partyAreas(image)).image;

    expect(readParty(painted, ICONS)).toEqual(readParty(image, ICONS));
    expect(await readCps(painted)).toEqual(await readCps(image));
  },
);

test.each(fixtures(/^menu-pixel8-(selection|search|held)/))(
  'tells %s for the selection screen or not with all but its areas scrambled',
  async (name) => {
    const image = fixture(name);
    const lines = await ocr(image);

    expect(isSelection(lines.filter(masked(image, selectionAreas(image)).within))).toBe(isSelection(lines));
  },
);

// A card is found in the grid's first row by a search that took. `menu-pixel8-selection` and `held-palkia-low` are
// unsearched, the card a row lower, which a run reaches only where its search did not take, and which the selection
// screen's areas do not allow for.
test.each(fixtures(/^menu-pixel8-(selection-searched|search|held)(?!-palkia-low)/))(
  'finds and reads the card on %s as it does whole with all but the selection screen’s areas scrambled',
  async (name) => {
    const image = fixture(name);
    const painted = masked(image, selectionAreas(image)).image;

    expect(pinkCell(painted)).toEqual(near(pinkCell(image)));
    expect(await readPanel(painted, DATA, null)).toEqual(await readPanel(image, DATA, null));
  },
);

/** Every frame of a battle, its prompts and its minigame, and the frames around it that are not one. */
const BATTLE = /^(battle|charged|shield|switch|other)-/;

/** The game's icon for each type's colour, as `run` reads the HUD's icons by. */
const TYPE_COLOURS = Object.fromEntries(
  DATA.types.map((type) => [type, iconColour(fixture(`types/POKEMON_TYPE_${type.toUpperCase()}`))]),
);

test.each(fixtures(BATTLE))('tells %s apart as it does whole with all but its areas scrambled', (name) => {
  const image = fixture(name);
  const painted = masked(image, recogniseAreas(image)).image;
  const told = (on: Image) => ({
    state: recognise(on),
    left: pokemonLeft(on),
    theirs: opponentShields(on),
    ours: ownShields(on),
    ready: readyButtons(on),
    countdown: countdown(on),
  });

  expect(told(painted)).toEqual(near(told(image)));
});

test.each(fixtures(BATTLE))('reads the HP bars on %s as it does whole with all but theirs scrambled', (name) => {
  const image = fixture(name);

  expect(readHealth(masked(image, healthAreas()).image)).toEqual(near(readHealth(image)));
});

test.each(fixtures(BATTLE))('reads the types on %s as it does whole with all but theirs scrambled', (name) => {
  const image = fixture(name);

  expect(readTypes(masked(image, typingAreas(image)).image, TYPE_COLOURS)).toEqual(readTypes(image, TYPE_COLOURS));
});

test.each(fixtures(/^(battle|charged|shield)-/))(
  'reads the names, labels and banner on %s as it does whole with all but theirs scrambled',
  async (name) => {
    const image = fixture(name);
    const painted = masked(image, readAreas(image)).image;
    const seen = await readBattle(image, DATA);

    expect(await readBattle(painted, DATA)).toEqual(seen);
    expect(await readBanner(painted, DATA, seen)).toEqual(await readBanner(image, DATA, seen));
  },
);
