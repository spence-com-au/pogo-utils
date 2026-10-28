/**
 * Which picture a species gets, and the table that decides it.
 *
 * Both halves fail by showing a reader the wrong thing rather than by failing to render: a URL built the wrong way
 * 404s and leaves a card with no picture, and a table missing a row leaves one card deriving a name `pogo_assets` does
 * not hold. Neither stops the page.
 *
 * `build:sprites` is run for real rather than its rule re-implemented here, which is the only way the fixture's shape
 * is actually read. It writes the same gitignored file the build does.
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { expect, test } from 'vitest';

import { ICON_BASE, ordinaryIcon, spriteOf, type Icons } from './icons.js';
import { POKEMON_ICONS, POKEMON_TYPES } from '../generated.js';
import { TYPE_COLOURS, type Types } from './types.js';

const run = promisify(execFile);

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const PIXELS = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';

test('a species with nothing said about it draws the icon its dex number derives', () => {
  expect(spriteOf(25, false, {})).toBe(`${ICON_BASE}pm25.icon.png`);

  // The shiny is `.s` ahead of the suffix rather than appended, which would ask for `pm25.icon.png.s.png`.
  expect(spriteOf(25, true, {})).toBe(`${ICON_BASE}pm25.s.icon.png`);
});

test('a named icon is used in place of the derived one, and its shiny is named from it', () => {
  const icons: Icons = { 201: 'pm201.fUNOWN_A.icon.png' };

  expect(spriteOf(201, false, icons)).toBe(`${ICON_BASE}pm201.fUNOWN_A.icon.png`);

  // The insertion has to survive a form suffix: Unown's shiny is `pm201.fUNOWN_A.s.icon.png`, so a rule that put `.s`
  // after the dex number instead would 404 on every species the table names.
  expect(spriteOf(201, true, icons)).toBe(`${ICON_BASE}pm201.fUNOWN_A.s.icon.png`);
});

test('a species the game has no artwork for falls back to a pixel sprite', () => {
  const icons: Icons = { 1025: null };

  expect(spriteOf(1025, false, icons)).toBe(`${PIXELS}/1025.png`);

  // The shiny set is a path segment before the number, so a URL built by appending to the name would 404 on every
  // shiny card while the ordinary ones carried on loading.
  expect(spriteOf(1025, true, icons)).toBe(`${PIXELS}/shiny/1025.png`);
});

test('`build:sprites` names every species whose icon the dex number cannot derive', async () => {
  const { stderr } = await run('node', ['scripts/build-sprites.mts'], { cwd: ROOT });

  const icons: Icons = JSON.parse(readFileSync(new URL(POKEMON_ICONS, new URL('../../', import.meta.url)), 'utf8'));
  const rows = Object.entries(icons);

  /*
   * The species that declare their forms over more than one `addForms`, held here and not only printed. For these the
   * order in `pokedex.ts` is the only thing saying which form stands for the species — a second call scopes a trailing
   * modifier and claims nothing about display order — so a thirteenth is a species whose leading group is suddenly
   * load-bearing and which nobody has checked. That is the case this list exists to stop passing quietly; the four
   * pinned below are the ones that were already wrong.
   */
  expect(stderr).toContain(
    '12 species split their forms over several calls — 327, 479, 550, 555, 648, 666, 669, 670, 671, 800, 931, 999',
  );

  /*
   * The counts a re-vend of `game-master.json` moves, pinned for the reason that file's own counts are: a species
   * released upstream changes which of these three a dex number falls in, and that is a reviewed commit rather than a
   * refresh. 962 of the 1025 draw the game's own render, 50 of them under a name only this table holds.
   */
  expect(rows).toHaveLength(113);
  expect(rows.filter(([, icon]) => icon === null)).toHaveLength(63);

  // A row is worth its place only where it differs from the derivation, which is what keeps this a table of exceptions
  // rather than a copy of the dex.
  expect(rows.filter(([dex, icon]) => icon === ordinaryIcon(Number(dex)))).toEqual([]);

  // Every name belongs to the species it is filed under. A table keyed one row out would still parse, still have the
  // right length, and give most of the dex somebody else's picture.
  expect(rows.filter(([dex, icon]) => icon !== null && !icon.startsWith(`pm${dex}.`))).toEqual([]);

  /*
   * Basculegion has no form in `game-master.json` at all, so the loop that writes this has to run over the dex rather
   * than over the species that file holds. Reading it there put `pm902.icon.png` on the card — a name `pogo_assets`
   * does not hold either, so it 404d and the card showed no picture instead of falling back.
   */
  expect(icons).toHaveProperty('902', null);

  /*
   * The form-only species, whose icon is the one `pokedex.ts` declares first. Every one of these is a species the
   * fixture lists its forms for alphabetically, so taking the first would name a form the game does not show for the
   * species — Mimikyu with its disguise already broken, the white Galarian Darmanitan for the plain Unovan one,
   * Aegislash drawn in its blade stance. Each is spelled out because the alphabetical pick is green against a count.
   */
  expect(icons).toMatchObject({
    201: 'pm201.fUNOWN_A.icon.png',
    412: 'pm412.fBURMY_PLANT.icon.png',
    422: 'pm422.fWEST_SEA.icon.png',
    550: 'pm550.fRED_STRIPED.icon.png',
    555: 'pm555.fSTANDARD.icon.png',
    666: 'pm666.fICY_SNOW.icon.png',
    681: 'pm681.fSHIELD.icon.png',
    745: 'pm745.fMIDDAY.icon.png',
    778: 'pm778.fDISGUISED.icon.png',
    854: 'pm854.fPHONY.icon.png',
    876: 'pm876.fMALE.icon.png',
    888: 'pm888.fHERO.icon.png',
    925: 'pm925.fFAMILY_OF_THREE.icon.png',
    982: 'pm982.fTWO.icon.png',
    1012: 'pm1012.fCOUNTERFEIT.icon.png',
  });

  // Spinda is the one species the declared form cannot name, its patterns being numbered, so it does take the first.
  expect(icons).toHaveProperty('327', 'pm327.f00.icon.png');

  /*
   * Four of the species the report above names as splitting their forms, pinned because each led with the group the
   * game does not show until that was corrected. In all four an `isRegional()` sits between the two `addForms` calls,
   * and the second call exists so that the marker stops at the forms declared before it: it says nothing about display
   * order, so the leading group has to be the one the game shows. Pinning the wrong form here is what held the bug in
   * place last round.
   */
  expect(icons).toMatchObject({
    669: 'pm669.fRED.icon.png',
    670: 'pm670.fRED.icon.png',
    671: 'pm671.fRED.icon.png',
    931: 'pm931.fGREEN.icon.png',
  });

  // And the ordinary case is absent, so the derivation above is what those cards actually use.
  expect(Object.keys(icons)).not.toContain('25');
});

/**
 * The types written beside the icons, which colour each entry. Read off the same form as the picture, so a species
 * whose ordinary form and regional one differ is drawn in the colour of the one shown.
 */
test('`build:sprites` writes every species its types, from the form its picture is', async () => {
  await run('node', ['scripts/build-sprites.mts'], { cwd: ROOT });

  const types: Types = JSON.parse(readFileSync(new URL(POKEMON_TYPES, new URL('../../', import.meta.url)), 'utf8'));

  // Every type named is one the page has a colour for, or that entry would be drawn in the fallback teal.
  expect([...new Set(Object.values(types).flat())].sort()).toEqual(Object.keys(TYPE_COLOURS).sort());

  expect(types).toMatchObject({
    1: ['Grass', 'Poison'],
    25: ['Electric'],

    // The plain Unovan Darmanitan rather than the Galarian one, whose ice would tint the fire species.
    555: ['Fire'],

    // Aegislash in its shield stance, which the picture shows.
    681: ['Steel', 'Ghost'],
  });

  // Basculegion has no form in the game master, so no types either; the entry is simply drawn without them.
  expect(types).not.toHaveProperty('902');
});
