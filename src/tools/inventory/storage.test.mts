/**
 * The walk to storage and the search typed into it, driven end to end through the two seams it reaches the world by: a
 * `Transport` standing in for the phone, recording what it is sent, and an OCR `Engine` answering every read with the
 * one storage screen.
 */

import { CLEAR_KEYS, Device, KEY, type Transport } from '../../core/adb.mts';
import { DEFAULTS, type Config } from './config.mts';
import { isDetail, parseDetail, readLines } from './detail.mts';
import { type GameData } from '../../core/game-master.mts';
import { useEngine } from '../../core/ocr.mts';
import { decodePng, encodePng, type Image } from '../../core/png.mts';
import { dialogOpen, storage, unsearchable } from './storage.mts';
import { tesseractCli } from '../../core/node/ocr-cli.mts';
import { useTestEngine, useWasmEngine } from '../../core/node/test-engine.mts';
import { readFileSync } from 'node:fs';
import { afterEach, expect, test } from 'vitest';

const DATA = JSON.parse(readFileSync(new URL('../../../data/game-master.json', import.meta.url), 'utf8')) as GameData;

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

/**
 * A phone showing storage, with `focus` in front as Android user `user`, that records every command and answers each
 * screenshot with the next of `screens`, and the last of them from then on. `dumpsys package` answers that the package
 * is installed for each of `installs`, in the form a Pixel 4 XL on Android 13 writes it, with a user it was uninstalled
 * for alongside so that the field is what is read.
 */
function phone(
  focus: string,
  {
    user = 0,
    installs = [0],
    screens = [SCREEN],
  }: { user?: number; installs?: readonly number[]; screens?: readonly Image[] } = {},
) {
  const sent: string[][] = [];
  const pngs = screens.map((screen) => encodePng(screen));
  const transport: Transport = {
    state: () => Promise.resolve('device'),
    shell: (args) => {
      sent.push([...args]);

      if (args[0] === 'dumpsys' && args[1] === 'package') {
        const line = (u: number, installed: boolean) =>
          `    User ${u}: ceDataInode=8192 installed=${installed} hidden=false suspended=false stopped=false`;

        return Promise.resolve(
          new TextEncoder().encode(
            [
              `Packages:`,
              `  Package [${args[2]}] (5a1b2c3):`,
              ...installs.map((u) => line(u, true)),
              line(11, false),
            ].join('\n'),
          ),
        );
      }

      return Promise.resolve(new TextEncoder().encode(`mCurrentFocus=Window{81ff99a u${user} ${focus}/.Main}`));
    },
    screencap: () => {
      const shot = sent.filter(([command]) => command === 'screencap').length;
      sent.push(['screencap']);

      return Promise.resolve(pngs[Math.min(shot, pngs.length - 1)] as Uint8Array);
    },
  };

  return { sent, device: new Device(transport) };
}

/** The power-up sheet a dropped drag opens over a detail screen, as OCR reads it: its title, and CANCEL at its foot. */
const DIALOG = [word(1, 'POWER UP: GEODUDE', 10, 60, 80, 10), word(2, 'CANCEL', 40, 185, 20, 8)].join('\n');

/**
 * OCR answering each screenshot in `sent` with the next of `screens`, and the last of them from then on. Counted by
 * screenshot rather than by read, a screen taking as many reads as what is asked of it: `readLines` reads the whole of
 * it and its top again, and `parseDetail` crops three more out of one that is not a detail screen.
 */
const reads = (sent: readonly string[][], ...screens: string[]) => {
  const shot = () => sent.filter(([command]) => command === 'screencap').length - 1;
  useEngine({ tsv: () => Promise.resolve(screens[Math.min(shot(), screens.length - 1)] as string) });
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

/** What `launch` sends to start the game for Android user `user`. */
const LAUNCH = (user: number) => [
  'am',
  'start',
  '--user',
  String(user),
  '-a',
  'android.intent.action.MAIN',
  '-c',
  'android.intent.category.LAUNCHER',
  '-f',
  '0x10200000',
  DEFAULTS.package,
];

test('a game not in front is launched for the one user it is installed for, and the launch said', async () => {
  const { sent, device } = phone('NotificationShade');
  const said: string[] = [];
  const { search } = storage(device, CONFIG, DATA, SCREEN, (message) => said.push(message));

  await search('shiny');

  expect(said).toStrictEqual(['Launching Pokémon GO']);
  expect(sent.slice(0, 3)).toStrictEqual([
    ['dumpsys', 'window', 'displays'],
    ['dumpsys', 'package', DEFAULTS.package],
    LAUNCH(0),
  ]);
});

test('a game installed only in a work profile is launched there', async () => {
  const { sent, device } = phone('NotificationShade', { installs: [10] });
  const said: string[] = [];
  const { search } = storage(device, CONFIG, DATA, SCREEN, (message) => said.push(message));

  await search('shiny');

  expect(said).toStrictEqual(['Launching Pokémon GO for Android user 10']);
  expect(sent[2]).toStrictEqual(LAUNCH(10));
});

/** #594: `monkey` launched user 0's copy, signed in to another trainer than the work profile's the scan was run for. */
test('a game installed in two profiles with neither in front is refused rather than guessed at', async () => {
  const { sent, device } = phone('NotificationShade', { installs: [0, 10] });
  const { search } = storage(device, CONFIG, DATA, SCREEN, () => {});

  await expect(search('shiny')).rejects.toThrow('installed for Android users 0 and 10');
  expect(sent).toStrictEqual([
    ['dumpsys', 'window', 'displays'],
    ['dumpsys', 'package', DEFAULTS.package],
  ]);
});

test('a game in front in a work profile is driven there, without asking where it is installed', async () => {
  const { sent, device } = phone(DEFAULTS.package, { user: 10, installs: [0, 10] });
  const said: string[] = [];
  const { search } = storage(device, CONFIG, DATA, SCREEN, (message) => said.push(message));

  await search('shiny');

  expect(said).toStrictEqual(['Pokémon GO is already in front']);
  expect(sent[1]).toStrictEqual(['screencap']);
});

test("the user named is launched, even over the other profile's copy in front", async () => {
  const { sent, device } = phone(DEFAULTS.package, { user: 0, installs: [0, 10] });
  const said: string[] = [];
  const { search } = storage(device, { ...CONFIG, user: 10 }, DATA, SCREEN, (message) => said.push(message));

  await search('shiny');

  expect(said).toStrictEqual(['Launching Pokémon GO for Android user 10']);
  expect(sent.slice(0, 2)).toStrictEqual([['dumpsys', 'window', 'displays'], LAUNCH(10)]);
});

test('a game not installed at all is said to be, rather than launched', async () => {
  const { device } = phone('NotificationShade', { installs: [] });
  const { search } = storage(device, CONFIG, DATA, SCREEN, () => {});

  await expect(search('shiny')).rejects.toThrow(`${DEFAULTS.package} is not installed on the phone`);
});

test('a package that is not an Android package name never reaches the shell', async () => {
  const { sent, device } = phone('NotificationShade');
  const { search } = storage(device, { ...CONFIG, package: 'x; reboot' }, DATA, SCREEN, () => {});

  await expect(search('shiny')).rejects.toThrow('only an Android package name');
  expect(sent).toStrictEqual([['dumpsys', 'window', 'displays']]);
});

test('nor does it reach the shell through a launch for a user that was named', async () => {
  const { sent, device } = phone('NotificationShade');
  const { search } = storage(device, { ...CONFIG, package: 'x; reboot', user: 10 }, DATA, SCREEN, () => {});

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

test("a dialog's buttons and the power-up sheet's title are what tell it from the detail screen beneath it, but not in the sky", () => {
  const line = (text: string, top = 185) => ({ text, left: 0, top, width: 10, height: 10 });

  expect(dialogOpen([line('POWER UP: GEODUDE', 60), line('CANCEL')], SCREEN)).toBe(true);
  expect(dialogOpen([line('POWER UP: PERSIAN', 120)], SCREEN)).toBe(true);
  expect(dialogOpen([line('YES')], SCREEN)).toBe(true);
  expect(dialogOpen([line('YES', 20)], SCREEN)).toBe(false);
  expect(dialogOpen([line('POWER UP'), line('EVOLVE'), line('NEW ATTACK')], SCREEN)).toBe(false);
  expect(dialogOpen([line('© Power-Up Punch', 120)], SCREEN)).toBe(false);
});

const capture = (file: string) => decodePng(readFileSync(new URL(`fixtures/${file}`, import.meta.url)));

/**
 * The dialog the game raised on its own over a Dynamax Sableye, whose `OK` is white on a pale green pill: OCR reads no
 * line for it at all, so the button cannot be what tells this one from the screen beneath it. Asked with no lines, so
 * the scrim alone answers.
 */
test("a dialog whose button does not read is told by the scrim it draws over the detail screen's panel", () => {
  expect(dialogOpen([], capture('dialog/sableye-mega-level.png'))).toBe(true);
});

/**
 * The power-up sheet over a Persian, whose `CANCEL` neither engine reads, so its title is all that says it is open
 * (#967). Read under both engines whatever `INVENTORY_OCR` asks for, since both missed it and CI runs this file with the
 * CLI alone. The phone answers every screenshot with the sheet, so each of the walk's five looks closes it with Back
 * and none taps under it.
 */
test.for([
  ['the CLI', () => (useEngine(tesseractCli), () => Promise.resolve())],
  ['tesseract.js', useWasmEngine],
] as const)('the power-up sheet is closed with Back under %s, though its CANCEL does not read', async ([, use]) => {
  const finished = use();
  const image = capture('dialog/persian-power-up.png');
  const { sent, device } = phone(DEFAULTS.package, { screens: [image] });
  const { search } = storage(device, CONFIG, DATA, image, () => {});

  await expect(search('shiny').finally(finished)).rejects.toThrow('could not find Pokémon storage');
  expect(tapped(sent)).toStrictEqual([]);
  expect(sent.filter((command) => command.join(' ') === `input keyevent ${KEY.BACK}`)).toHaveLength(5);
});

/**
 * The screens the scrim must not be seen on: a detail screen scrolled down to its moves, whose panel runs the whole
 * height, and storage.
 */
test('a scrolled detail screen and storage read as having no dialog over them', () => {
  const open = ['moves/necrozma-cut-off.png', 'moves/rookidee-bounced.png', 'storage/grid.png'].filter((file) =>
    dialogOpen([], capture(file)),
  );

  expect(open).toStrictEqual([]);
});

/**
 * The two screen-shape reads the walk turns on, over real captures rather than hand-built lines, now the corpus test
 * that ran them over screenshots is gone: `isDetail`, which closes a Pokémon the walk opened by mistake, and
 * `dialogOpen`, which closes a sheet over one. The demo phone's `deoxys-attack.png` is a detail screen with nothing over
 * it; the map and a storage grid are neither. Read whatever `INVENTORY_OCR` asks for, since the page must read each the
 * same under both engines. #1142 keeps the demo capture and `overworld.png`.
 */
test('isDetail and dialogOpen read a detail screen, the map and storage for what they are', async () => {
  const finished = useTestEngine();

  const shape = async (file: string) => {
    const image = capture(file);
    const lines = await readLines(image);

    return { detail: isDetail(await parseDetail(lines, DATA, image)), dialog: dialogOpen(lines, image) };
  };

  try {
    expect(await shape('deoxys-attack.png')).toStrictEqual({ detail: true, dialog: false });
    expect((await shape('overworld.png')).detail).toBe(false);
    expect((await shape('storage/grid.png')).detail).toBe(false);
  } finally {
    await finished();
  }
});

test('a dialog open over the screen is closed with Back before the walk to storage taps anything', async () => {
  const { sent, device } = phone(DEFAULTS.package);
  reads(sent, DIALOG, STORAGE);
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
  reads(sent, DIALOG, '');
  const { closeDetail } = storage(device, CONFIG, DATA, SCREEN, () => {});

  await closeDetail();

  expect(sent).toStrictEqual([['screencap'], ['input', 'keyevent', String(KEY.BACK)], ['screencap']]);
});

test('a dialog that Back does not close is given up on after three tries, with nothing tapped', async () => {
  const { sent, device } = phone(DEFAULTS.package);
  reads(sent, DIALOG);
  const said: string[] = [];
  const { closeDetail } = storage(device, CONFIG, DATA, SCREEN, (message) => said.push(message));

  await expect(closeDetail()).resolves.toBeUndefined();

  expect(said).toStrictEqual(Array<string>(3).fill('  a dialog was open; closing it with Back'));
  expect(sent).toStrictEqual(
    Array(3)
      .fill([['screencap'], ['input', 'keyevent', String(KEY.BACK)]])
      .flat(),
  );
});

/** A detail screen as OCR reads it: the HP line `parseDetail` takes as the mark of one. */
const DETAIL = word(1, '80 / 80 HP', 30, 100, 40, 8);

test('the close button is tapped on a detail screen', async () => {
  const { sent, device } = phone(DEFAULTS.package);
  reads(sent, DETAIL);
  const { at, closeDetail } = storage(device, CONFIG, DATA, SCREEN, () => {});

  await closeDetail();

  expect(tapped(sent)).toStrictEqual([['input', 'tap', ...at(DEFAULTS.taps.closeDetail).map(String)]]);
});

/** The grid with a Pokémon in it, as OCR reads it: what the box shows once the suggestions panel is closed. */
const GRID = [STORAGE, word(3, 'CP415', 10, 50, 20, 8)].join('\n');

test('clearing the box over the suggestions panel closes it with Back, which leaves the grid', async () => {
  const { sent, device } = phone(DEFAULTS.package);
  reads(sent, STORAGE, STORAGE, GRID);
  const { search } = storage(device, CONFIG, DATA, SCREEN, () => {});

  await search('');
  expect(sent.slice(-3)).toStrictEqual([['screencap'], ['input', 'keyevent', String(KEY.BACK)], ['screencap']]);
  expect(tapped(sent)).toStrictEqual([['input', 'tap', '50', '35']]);
});

test('a screen Back leaves that is not storage is walked back to storage from', async () => {
  const { sent, device } = phone(DEFAULTS.package);
  reads(sent, STORAGE, STORAGE, '', STORAGE);
  const { search } = storage(device, CONFIG, DATA, SCREEN, () => {});

  await search('');

  expect(sent.slice(-4)).toStrictEqual([
    ['screencap'],
    ['input', 'keyevent', String(KEY.BACK)],
    ['screencap'],
    ['screencap'],
  ]);
});

/**
 * Each storage screen under real OCR, given an empty search, and whether it sent the Back that closes the suggestions
 * panel. `suggestions.png` is the panel a walk started from the map stopped on, its Recommended chips each carrying a
 * count — `362`, `631`, `405` and `296` at one height, which could be taken for a row of labels whose `CP`s misread —
 * so the Back was skipped and the panel's own counts read as the grid's (#816). `recent-cp.png` is the panel again with
 * `cp-1500` the first of its Recent searches, which reads as a line of its own and as a CP label (#829). The grids are
 * the other half, where a Back closes storage, and the two whose first row of labels misread are the ones that could be
 * taken for the panel.
 */
test.for([
  ['suggestions', true],
  ['recent-cp', true],
  ['grid', false],
  ['searched', false],
  ['sparkles', false],
  ['spheal', false],
] as const)(
  'an empty search over storage/%s.png sends Back only where it is the suggestions panel',
  async ([name, closed]) => {
    const finished = useTestEngine();
    const image = capture(`storage/${name}.png`);
    const { sent, device } = phone(DEFAULTS.package, { screens: [image] });
    const { search } = storage(device, CONFIG, DATA, image, () => {});

    await search('').finally(finished);

    expect(sent.some((command) => command.join(' ') === `input keyevent ${KEY.BACK}`)).toBe(closed);
  },
);

/** The map as OCR reads it, with a quest above the avatar that names Pokémon without being the menu's button. */
const MAP = word(1, 'Catch 500 Pokémon', 10, 165, 50, 8);

/** The main menu as OCR reads it: the Pokémon button's label, above its icon. */
const MENU = word(1, 'POKÉMON', 15, 150, 20, 8);

test('the map is walked to storage by the main menu, and the Pokémon button tapped once the menu shows', async () => {
  const { sent, device } = phone(DEFAULTS.package);
  reads(sent, MAP, MENU, STORAGE);
  const { search } = storage(device, CONFIG, DATA, SCREEN, () => {});

  await search('shiny');

  expect(tapped(sent)).toStrictEqual([
    ['input', 'tap', '50', '182'],
    ['input', 'tap', '25', '164'],
    ['input', 'tap', '50', '35'],
  ]);
});

/**
 * The map as the Search page reads it, with tesseract.js whatever `INVENTORY_OCR` asks for, since only that engine
 * reads a `yes` into the rooftops of `overworld.png` (#935). The phone answers every screenshot with the map, as it
 * would were it to drop every tap, so the menu never opens: the walk taps its button again each time the map is left
 * as it was (#1073) and stops once out of tries, having pressed no Back.
 */
test('the map is walked from by the main menu under tesseract.js, whatever its scenery reads as', async () => {
  const finished = useWasmEngine();
  const image = capture('overworld.png');
  const { sent, device } = phone(DEFAULTS.package, { screens: [image] });
  const { search, at } = storage(device, CONFIG, DATA, image, () => {});

  await expect(search('shiny').finally(finished)).rejects.toThrow('could not find Pokémon storage');
  expect(sent).not.toContainEqual(['input', 'keyevent', String(KEY.BACK)]);
  expect(tapped(sent)).toStrictEqual(
    Array(5).fill(['input', 'tap', ...at(DEFAULTS.taps.mainMenu).map((n) => String(Math.round(n)))]),
  );
});

/**
 * Taps on the main menu's button that the phone drops, leaving the map as it was, the button with it: two of them after
 * a dialog closed with Back, the furthest the walk's tries reach.
 */
test('menu taps the phone dropped are made again, two of them after a dialog, and storage reached', async () => {
  const { sent, device } = phone(DEFAULTS.package);
  reads(sent, DIALOG, MAP, MAP, MAP, MAP, MAP, MENU, STORAGE);
  const said: string[] = [];
  const { search } = storage(device, CONFIG, DATA, SCREEN, (message) => said.push(message));

  await search('shiny');

  expect(sent).toContainEqual(['input', 'keyevent', String(KEY.BACK)]);
  expect(said.filter((message) => message.includes('tapping it again'))).toStrictEqual(
    Array<string>(2).fill('  the main menu did not open, the map left as it was; tapping it again'),
  );
  expect(tapped(sent)).toStrictEqual([
    ['input', 'tap', '50', '182'],
    ['input', 'tap', '50', '182'],
    ['input', 'tap', '50', '182'],
    ['input', 'tap', '25', '164'],
    ['input', 'tap', '50', '35'],
  ]);
});

/**
 * A tap on the main menu's button that opens something else, the power-up sheet standing in for the stop a walking
 * avatar carried under the button, which draws something else where the button was. A second tap there would be a
 * guess at a screen the walk knows nothing of.
 */
test('a menu tap that opened anything but the menu stops the walk, without tapping where the button would be', async () => {
  const image = capture('pokedex/map.png');
  const { sent, device } = phone(DEFAULTS.package, { screens: [image, capture('dialog/persian-power-up.png')] });
  reads(sent, MAP);
  const { search, at } = storage(device, CONFIG, DATA, image, () => {});

  await expect(search('shiny')).rejects.toThrow('the main menu did not open');
  expect(tapped(sent)).toStrictEqual([
    ['input', 'tap', ...at(DEFAULTS.taps.mainMenu).map((n) => String(Math.round(n)))],
  ]);
});

test('a detail screen the close button never closes stops the walk after five taps', async () => {
  const { sent, device } = phone(DEFAULTS.package);
  reads(sent, DETAIL);
  const { search, at } = storage(device, CONFIG, DATA, SCREEN, () => {});

  await expect(search('shiny')).rejects.toThrow('could not find Pokémon storage; open it by hand and run again');
  expect(tapped(sent)).toStrictEqual(Array(5).fill(['input', 'tap', ...at(DEFAULTS.taps.closeDetail).map(String)]));
});

test('a map the main menu is walked from five times without reaching storage stops the walk', async () => {
  const { sent, device } = phone(DEFAULTS.package);
  reads(sent, ...Array<string[]>(5).fill([MAP, MENU]).flat());
  const { search } = storage(device, CONFIG, DATA, SCREEN, () => {});

  await expect(search('shiny')).rejects.toThrow('could not find Pokémon storage; open it by hand and run again');
  expect(tapped(sent)).toStrictEqual(
    Array(5)
      .fill([
        ['input', 'tap', '50', '182'],
        ['input', 'tap', '25', '164'],
      ])
      .flat(),
  );
});
