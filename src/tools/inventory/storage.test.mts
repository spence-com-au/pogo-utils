/**
 * The walk to storage and the search typed into it, driven end to end through the two seams it reaches the world by: a
 * `Transport` standing in for the phone, recording what it is sent, and an OCR `Engine` answering every read with the
 * one storage screen. No test reached this while it lived in `scripts/inventory.mts`, which nothing can import.
 */

import { Device, KEY, type Transport } from './adb.mts';
import { DEFAULTS, type Config } from './config.mts';
import { type GameData } from './game-master.mts';
import { useEngine } from './ocr.mts';
import { encodePng } from './png.mts';
import { CLEAR_KEYS, dialogOpen, storage, unsearchable } from './storage.mts';
import { readFileSync } from 'node:fs';
import { afterEach, expect, test } from 'vitest';

const DATA = JSON.parse(readFileSync(new URL('fixtures/game-master.json', import.meta.url), 'utf8')) as GameData;

/** `DEFAULTS` with nothing waited for, there being no animation here to let settle. */
const CONFIG: Config = {
  ...DEFAULTS,
  waits: { launch: 0, tap: 0, swipe: 0, scroll: 0, menu: 0, search: 0 },
};

const SCREEN = { width: 100, height: 200, data: new Uint8Array(100 * 200 * 4) };

/** One Tesseract TSV word row, each on a line of its own. */
const word = (line: number, text: string, left: number, top: number, width: number, height: number) =>
  ['5', '1', '1', '1', String(line), '1', left, top, width, height, '95', text].join('\t');

/** The storage grid as OCR reads it: the tab's counter above the search box. */
const STORAGE = [word(1, '(12)', 70, 10, 20, 8), word(2, 'SEARCH', 40, 30, 20, 10)].join('\n');

/** A phone showing storage, with `focus` in front, that records every command and answers each screenshot alike. */
function phone(focus: string) {
  const sent: string[][] = [];
  const transport: Transport = {
    state: () => Promise.resolve('device'),
    shell: (args) => {
      sent.push([...args]);

      return Promise.resolve(new TextEncoder().encode(`mCurrentFocus=Window{81ff99a u0 ${focus}/.Main}`));
    },
    screencap: () => {
      sent.push(['screencap']);

      return Promise.resolve(encodePng(SCREEN));
    },
  };

  return { sent, device: new Device(transport) };
}

/** The power-up sheet a dropped drag opens over a detail screen, as OCR reads it: its title, and CANCEL at its foot. */
const DIALOG = [word(1, 'POWER UP: GEODUDE', 10, 60, 80, 10), word(2, 'CANCEL', 40, 185, 20, 8)].join('\n');

/**
 * OCR answering each screen with the next of `screens`, and the last of them from then on. Two reads to a screen, since
 * `readLines` reads the whole of it and then its top again.
 */
const reads = (...screens: string[]) => {
  let read = 0;
  useEngine({ tsv: () => Promise.resolve(screens[Math.min(Math.floor(read++ / 2), screens.length - 1)] as string) });
};

const tapped = (sent: readonly string[][]) =>
  sent.filter(([command, action]) => command === 'input' && action === 'tap');

afterEach(() => useEngine({ tsv: () => Promise.resolve(STORAGE) }));

useEngine({ tsv: () => Promise.resolve(STORAGE) });

test('a search taps the box OCR found, clears it, types the term and answers the count the game shows', async () => {
  const { sent, device } = phone(DEFAULTS.package);
  const said: string[] = [];
  const { search, matches } = storage(device, CONFIG, DATA, SCREEN, (message) => said.push(message));

  expect(matches(await search('shiny&4*'))).toBe(12);
  expect(said).toStrictEqual(['Pokémon GO is already in front']);
  expect(sent).toStrictEqual([
    ['dumpsys', 'window', 'displays'],
    ['screencap'],
    ['input', 'tap', '50', '35'],
    ['input', 'keyevent', String(KEY.MOVE_END), ...Array<string>(CLEAR_KEYS).fill(String(KEY.DEL))],
    ['input', 'text', "'shiny&4*'"],
    ['input', 'keyevent', String(KEY.ENTER)],
    ['screencap'],
  ]);
});

test('a game not in front is launched first, and the launch said', async () => {
  const { sent, device } = phone('NotificationShade');
  const said: string[] = [];
  const { search } = storage(device, CONFIG, DATA, SCREEN, (message) => said.push(message));

  await search('shiny');

  expect(said).toStrictEqual(['Launching Pokémon GO']);
  expect(sent[1]).toStrictEqual(['monkey', '-p', DEFAULTS.package, '-c', 'android.intent.category.LAUNCHER', '1']);
});

test('a package that is not an Android package name never reaches the shell', async () => {
  const { sent, device } = phone('NotificationShade');
  const { search } = storage(device, { ...CONFIG, package: 'x; reboot' }, DATA, SCREEN, () => {});

  await expect(search('shiny')).rejects.toThrow('only an Android package name');
  expect(sent).toStrictEqual([['dumpsys', 'window', 'displays']]);
});

test('a term the phone cannot be sent is refused, naming each character once', () => {
  expect(unsearchable("farfetch'd&nidoran♀,nidoran♀")).toBe("has characters the phone cannot be sent: ' ♀");
});

test('a term longer than the box can be cleared of is refused, and one that fits is not', () => {
  expect(unsearchable('a'.repeat(CLEAR_KEYS))).toBeNull();
  expect(unsearchable('a'.repeat(CLEAR_KEYS + 1))).toBe(
    `is ${CLEAR_KEYS + 1} characters, more than the ${CLEAR_KEYS} the box can be cleared of`,
  );
});

test("a dialog's buttons are what tells it from the detail screen beneath it", () => {
  const line = (text: string) => ({ text, left: 0, top: 0, width: 10, height: 10 });

  expect(dialogOpen([line('POWER UP: GEODUDE'), line('CANCEL')])).toBe(true);
  expect(dialogOpen([line('YES')])).toBe(true);
  expect(dialogOpen([line('POWER UP'), line('EVOLVE'), line('NEW ATTACK')])).toBe(false);
});

test('a dialog open over the screen is closed with Back before the walk to storage taps anything', async () => {
  const { sent, device } = phone(DEFAULTS.package);
  reads(DIALOG, STORAGE);
  const said: string[] = [];
  const { search } = storage(device, CONFIG, DATA, SCREEN, (message) => said.push(message));

  await search('shiny');

  expect(said).toContain('  a dialog was open; closing it with Back');
  expect(sent.slice(0, 4)).toStrictEqual([
    ['dumpsys', 'window', 'displays'],
    ['screencap'],
    ['input', 'keyevent', String(KEY.BACK)],
    ['screencap'],
  ]);

  // The search box's own tap and nothing before it: neither the close button nor the main menu, both at the foot of
  // the screen where the dialog keeps its buttons.
  expect(tapped(sent)).toStrictEqual([['input', 'tap', '50', '35']]);
});

test('the close button is not tapped while a dialog is open, nor on a screen that is not a detail screen', async () => {
  const { sent, device } = phone(DEFAULTS.package);
  reads(DIALOG, '');
  const { closeDetail } = storage(device, CONFIG, DATA, SCREEN, () => {});

  await closeDetail();

  expect(sent).toStrictEqual([['screencap'], ['input', 'keyevent', String(KEY.BACK)], ['screencap']]);
});
