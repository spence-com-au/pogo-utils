/**
 * `Device` against a `Transport` standing in for the phone, recording what it is sent: the commands it composes, which
 * every tool goes through and which only the storage walk's tests reach incidentally.
 */

import { Device, type Transport } from './adb.mts';
import { expect, test } from 'vitest';

/** A phone in `state` that records every shell command and answers each with `answer`, or what `answer` makes of it. */
function phone(state = 'device', answer: string | ((args: readonly string[]) => string) = '') {
  const sent: string[][] = [];
  const transport: Transport = {
    state: () => Promise.resolve(state),
    shell: (args) => {
      sent.push([...args]);

      return Promise.resolve(new TextEncoder().encode(typeof answer === 'string' ? answer : answer(args)));
    },
    screencap: () => Promise.reject(new Error('no screenshot is taken here')),
  };

  return { sent, device: new Device(transport) };
}

test('a phone that is not a `device` fails the check, saying what adb reported', async () => {
  await expect(phone('device\n').device.check()).resolves.toBeUndefined();
  await expect(phone('offline\n').device.check()).rejects.toThrow(/^adb reports the phone as "offline"; /);
});

test('a tap and a swipe send whole pixels, a swipe lasting 300ms unless told otherwise', async () => {
  const { sent, device } = phone();

  await device.tap([10.4, 20.6]);
  await device.swipe([1.5, 2.4], [3.6, 4.5]);
  await device.swipe([0, 0], [0, 100], 120.4);

  expect(sent).toStrictEqual([
    ['input', 'tap', '10', '21'],
    ['input', 'swipe', '2', '2', '4', '5', '300'],
    ['input', 'swipe', '0', '0', '0', '100', '120'],
  ]);
});

test('typed text has its spaces sent as `%s` inside single quotes, which is how `input text` reads a space', async () => {
  const { sent, device } = phone();

  await device.type('+burmy & cp196');

  expect(sent).toStrictEqual([['input', 'text', "'+burmy%s&%scp196'"]]);
});

test('text the shell would read as anything but itself is refused before it is sent', async () => {
  const { sent, device } = phone();

  await expect(device.type('a; reboot')).rejects.toThrow(/^refusing to type "a; reboot": /);
  await expect(device.type("it's")).rejects.toThrow(/^refusing to type "it's": /);
  expect(sent).toStrictEqual([]);
});

test('a package listed under both `Packages:` and `Hidden system packages:` counts each user once', async () => {
  // As a phone with the game as an update over a system image writes it: the package twice, users and all.
  const { sent, device } = phone(
    'device',
    [
      'Packages:',
      '  Package [com.example] (5a1b2c3):',
      '    User 0: ceDataInode=8192 installed=true hidden=false',
      '    User 10: ceDataInode=8193 installed=true hidden=false',
      '    User 11: ceDataInode=8194 installed=false hidden=false',
      'Hidden system packages:',
      '  Package [com.example] (5a1b2c3):',
      '    User 0: ceDataInode=8192 installed=true hidden=false',
      '    User 10: ceDataInode=8193 installed=true hidden=false',
    ].join('\n'),
  );

  expect(await device.installs('com.example')).toStrictEqual([0, 10]);
  expect(sent).toStrictEqual([['dumpsys', 'package', 'com.example']]);
});

test('a package name the shell would read as anything but itself is refused before it is sent', async () => {
  const { sent, device } = phone();

  await expect(device.installs('x; reboot')).rejects.toThrow(/^refusing to launch "x; reboot": /);
  await expect(device.launch('x; reboot', 0)).rejects.toThrow(/^refusing to launch "x; reboot": /);
  expect(sent).toStrictEqual([]);
});

test('the views are what `uiautomator dump` writes to stdout through a pipe', async () => {
  const { sent, device } = phone('device', '<hierarchy rotation="0"/>');

  expect(await device.views()).toBe('<hierarchy rotation="0"/>');
  expect(sent).toStrictEqual([['uiautomator', 'dump', '/dev/stdout', '|', 'cat']]);
});

test.for([
  ['a phone', '\n'],
  ['an older phone, through a terminal', '\r\n'],
])('what %s says of itself is read from its properties, the screen size in force and its battery', async ([, eol]) => {
  const answers: Record<string, string[]> = {
    'getprop': [
      '[ro.boot.serialno]: []',
      '[ro.build.version.release]: [15]',
      '[ro.product.manufacturer]: [Google]',
      '[ro.product.model]: [Pixel 8 Pro]',
    ],
    'wm size': ['Physical size: 1344x2992', 'Override size: 1008x2244'],
    'dumpsys battery': [
      'Current Battery Service state:',
      '  USB powered: true',
      '  status: 2',
      '  level: 87',
      '  scale: 100',
    ],
  };
  const { sent, device } = phone('device', (args) => (answers[args.join(' ')] ?? []).join(eol));

  expect(await device.about()).toStrictEqual({
    maker: 'Google',
    model: 'Pixel 8 Pro',
    android: '15',
    screen: [1008, 2244],
    battery: 87,
  });
  expect(sent).toStrictEqual([['getprop'], ['wm', 'size'], ['dumpsys', 'battery']]);
});

test('a phone that says nothing of itself, as the demo phone does, reads as nothing known', async () => {
  expect(await phone().device.about()).toStrictEqual({
    maker: undefined,
    model: undefined,
    android: undefined,
    screen: undefined,
    battery: undefined,
  });
});
