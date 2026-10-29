/**
 * Keeping the phone awake for a run and putting it back, over a phone whose settings answer as Android's do and the
 * IndexedDB a page and its Worker share: put back as found, and found again by the next connect where it was not.
 */

import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { keepAwake, putBack } from './awake.js';

/**
 * The phone `serial` names, its setting `before`: `settings` and `svc` run as a process each, every one kept in `ran`,
 * and failing as an unplugged phone's do while `unplugged`.
 */
function phone(serial: string, before = '1') {
  const settings = new Map([['stay_on_while_plugged_in', before]]);
  const ran: string[] = [];

  const reached = {
    serial,
    ran,
    settings,
    unplugged: false,
    transport: {
      shell: (command: readonly string[]) => {
        ran.push(command.join(' '));

        if (reached.unplugged) {
          return Promise.reject(new Error('the device was unplugged'));
        }

        const [verb, action, , key = '', value = ''] = command;

        if (verb === 'settings' && action === 'put') {
          settings.set(key, value);
        } else if (verb === 'svc') {
          settings.set('stay_on_while_plugged_in', '2');
        }

        return Promise.resolve(new TextEncoder().encode(action === 'get' ? `${settings.get(key)}\n` : ''));
      },
    },
  };

  return reached;
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('keeps the phone awake for a run, and puts it back as found, leaving nothing for the next connect', async () => {
  const pixel = phone('pixel', '1');
  const said: string[] = [];

  const restore = await keepAwake('pixel', pixel.transport, (line) => said.push(line));

  expect(pixel.settings.get('stay_on_while_plugged_in')).toBe('2');

  await restore();

  expect(pixel.settings.get('stay_on_while_plugged_in')).toBe('1');
  expect(pixel.ran).toEqual([
    'settings get global stay_on_while_plugged_in',
    'svc power stayon usb',
    'settings put global stay_on_while_plugged_in 1',
  ]);
  expect(said).toEqual([]);

  const again = phone('pixel', '2');
  await putBack(again);
  expect(again.ran).toEqual([]);
});

test('says where the setting cannot be put back, and puts it back at the phone’s next connect', async () => {
  const pixel = phone('pixel', '1');
  const said: string[] = [];
  const restore = await keepAwake('pixel', pixel.transport, (line) => said.push(line));

  pixel.unplugged = true;
  await restore();

  expect(said).toEqual([
    'stay_on_while_plugged_in not put back to 1 until the phone is next connected: the device was unplugged',
  ]);

  const other = phone('other', '2');
  await putBack(other);
  expect(other.ran, 'another phone has nothing kept').toEqual([]);

  const back = phone('pixel', '2');
  await putBack(back);
  await putBack(back);

  expect(back.settings.get('stay_on_while_plugged_in')).toBe('1');
  expect(back.ran, 'put back once, then forgotten').toEqual(['settings put global stay_on_while_plugged_in 1']);
});

test('keeps what it was put back to where that fails at the next connect too, for the connect after', async () => {
  const pixel = phone('pixel', '3');
  const restore = await keepAwake('pixel', pixel.transport, () => {});
  pixel.unplugged = true;
  await restore();

  const flaky = phone('pixel', '2');
  flaky.unplugged = true;
  await expect(putBack(flaky)).rejects.toThrow('the device was unplugged');

  const back = phone('pixel', '2');
  await putBack(back);
  expect(back.settings.get('stay_on_while_plugged_in')).toBe('3');
});

test('puts back what a run cut short found, rather than what it left, where the next run comes first', async () => {
  const pixel = phone('pixel', '1');
  await keepAwake('pixel', pixel.transport, () => {});

  // Its tab closed, the phone left set; the next run reads the setting the first one left and keeps the first's.
  const restore = await keepAwake('pixel', pixel.transport, () => {});
  await restore();

  expect(pixel.settings.get('stay_on_while_plugged_in')).toBe('1');
});

test('reads a setting Android does not answer with a number as off, as `pnpm battle` does', async () => {
  const pixel = phone('pixel', 'null');
  const restore = await keepAwake('pixel', pixel.transport, () => {});
  await restore();

  expect(pixel.ran.at(-1)).toBe('settings put global stay_on_while_plugged_in 0');
});

test('runs where nothing can be kept, saying a closed tab leaves the phone awake, and still puts it back', async () => {
  vi.stubGlobal('indexedDB', undefined);
  const pixel = phone('pixel', '1');
  const said: string[] = [];

  const restore = await keepAwake('pixel', pixel.transport, (line) => said.push(line));
  await restore();

  expect(said).toEqual([expect.stringMatching(/^stay_on_while_plugged_in not kept, so closing this tab mid-run/)]);
  expect(pixel.settings.get('stay_on_while_plugged_in')).toBe('1');
  await expect(putBack(phone('pixel')), 'nothing kept to put back').resolves.toBeUndefined();
});

test('puts the setting back and fails where the phone will not stay awake', async () => {
  const pixel = phone('pixel', '1');
  const svc = pixel.transport.shell;
  pixel.transport.shell = (command) =>
    command[0] === 'svc' ? Promise.reject(new Error('svc: not found')) : svc(command);

  await expect(keepAwake('pixel', pixel.transport, () => {})).rejects.toThrow('svc: not found');
  expect(pixel.ran.at(-1)).toBe('settings put global stay_on_while_plugged_in 1');
});
