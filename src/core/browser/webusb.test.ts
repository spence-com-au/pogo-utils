/**
 * How the page reads a command's exit status off a phone too old for the shell protocol, which carries none: `legacy`
 * has the phone print it after the output, and `statusCut` takes it back off. Tested on bytes alone, a phone being the
 * one thing this suite cannot plug in — and, for when `connect` and `reconnect` reach a phone at all, on a browser's
 * USB and a device stood in for, Tango's side of the connection being no claim of this module's.
 */

import { afterEach, expect, test, vi } from 'vitest';

import { answered, connect, reconnect, release, statusCut, within } from './webusb.js';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  usb: { requestDevice: vi.fn(), getDevices: vi.fn() },
}));

vi.mock('@yume-chan/adb', () => ({
  Adb: class {
    disconnected = new Promise<void>(() => undefined);
  },
  AdbDaemonTransport: { authenticate: mocks.authenticate },
}));
vi.mock('@yume-chan/adb-daemon-webusb', () => ({
  AdbDaemonWebUsbDevice: { DeviceBusyError: class extends Error {} },
  AdbDaemonWebUsbDeviceManager: { BROWSER: mocks.usb },
}));

afterEach(() => {
  vi.resetAllMocks();
});

const bytes = (...parts: (string | number[])[]) =>
  Uint8Array.from(parts.flatMap((part) => (typeof part === 'string' ? [...new TextEncoder().encode(part)] : part)));

test('a zero status is cut off and the output answered whole, binary and all', () => {
  // A PNG's signature and a stray newline in the middle of what the command wrote, neither of which is the marker.
  const output = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x0a, 0x00];

  expect(statusCut(bytes(output, '\npogo-utils-exit:0'), ['screencap', '-p'])).toStrictEqual(Uint8Array.from(output));
});

test('a status other than zero fails the command, naming it and the status', () => {
  expect(() => statusCut(bytes('half a png', '\npogo-utils-exit:1'), ['screencap', '-p'])).toThrow(
    /^screencap -p exited 1$/,
  );
});

test('output with no status after it fails rather than passing for a success', () => {
  expect(() => statusCut(bytes('cut off'), ['screencap', '-p'])).toThrow(/exited without saying how/);

  // The marker made it but the digits after it did not, which would otherwise read as `Number('')`: a clean 0.
  expect(() => statusCut(bytes('half a png', '\npogo-utils-exit:'), ['screencap', '-p'])).toThrow(
    /exited without saying how/,
  );
});

test('the last marker is the one read, where the output itself holds the same text', () => {
  expect(new TextDecoder().decode(statusCut(bytes('\npogo-utils-exit:1', '\npogo-utils-exit:0'), ['cat']))).toBe(
    '\npogo-utils-exit:1',
  );
});

test('a connection let go of is closed both ways, though one way fails', async () => {
  const connection = {
    readable: { cancel: vi.fn(() => Promise.resolve()) },
    writable: { close: vi.fn(() => Promise.reject(new TypeError('the stream is errored'))) },
  };

  await expect(release(connection)).resolves.toBeUndefined();
  expect(connection.writable.close).toHaveBeenCalledOnce();
  expect(connection.readable.cancel).toHaveBeenCalledOnce();
});

test('a command the phone never answers fails after 30s, naming it, and a prompt answer clears the timer', async () => {
  vi.useFakeTimers();

  try {
    const stuck = expect(within(['screencap', '-p'], new Promise(() => undefined))).rejects.toThrow(
      /^screencap -p: no answer after 30s; is the phone still connected\?$/,
    );

    await vi.advanceTimersByTimeAsync(30_000);
    await stuck;

    await expect(within(['true'], Promise.resolve(bytes('ok')))).resolves.toStrictEqual(bytes('ok'));
    expect(vi.getTimerCount(), 'no timer left behind').toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test('a command that exits non-zero fails with its status and stderr, and one that exits zero answers its stdout', () => {
  const result = (exitCode: number) => ({ stdout: bytes('out'), stderr: bytes('nope\n'), exitCode });

  expect(answered(['ls'], result(0))).toStrictEqual(bytes('out'));
  expect(() => answered(['ls', '/x'], result(2))).toThrow(/^ls \/x exited 2: nope$/);
});

/** A WebUSB device as the page is handed it, `claimed` saying whether this context holds an interface of it already. */
function device(serial: string, claimed = false) {
  return {
    serial,
    name: `Phone ${serial}`,
    raw: { configuration: { interfaces: [{ claimed: false }, { claimed }] } },
    connect: vi.fn(async () => ({})),
  };
}

test('a chooser dismissed answers null, having connected to nothing', async () => {
  mocks.usb.requestDevice.mockResolvedValue(undefined);

  await expect(connect()).resolves.toBeNull();
  expect(mocks.authenticate).not.toHaveBeenCalled();
});

test('a phone this context already holds answers null rather than being connected to a second time', async () => {
  const held = device('HELD', true);

  mocks.usb.requestDevice.mockResolvedValue(held);

  await expect(connect()).resolves.toBeNull();
  expect(held.connect).not.toHaveBeenCalled();
  expect(mocks.authenticate).not.toHaveBeenCalled();
});

test('a phone picked that nothing holds is connected to, and answered with its name and serial', async () => {
  const picked = device('ABC123');

  mocks.usb.requestDevice.mockResolvedValue(picked);
  mocks.authenticate.mockResolvedValue({});

  await expect(connect()).resolves.toMatchObject({ name: 'Phone ABC123', serial: 'ABC123' });
  expect(picked.connect).toHaveBeenCalledOnce();
});

test('a phone not among those the site was granted fails, naming its serial, and none is connected to', async () => {
  const granted = [device('ONE'), device('TWO')];

  mocks.usb.getDevices.mockResolvedValue(granted);

  await expect(reconnect('GONE')).rejects.toThrow(
    /^the phone GONE is not plugged in, or this site may no longer reach it$/,
  );

  for (const one of granted) {
    expect(one.connect).not.toHaveBeenCalled();
  }
});

test('a phone is reconnected to by its serial, without the chooser, though others were granted too', async () => {
  const [one, two] = [device('ONE'), device('TWO')];

  mocks.usb.getDevices.mockResolvedValue([one, two]);
  mocks.authenticate.mockResolvedValue({});

  await expect(reconnect('TWO')).resolves.toMatchObject({ serial: 'TWO' });
  expect(two.connect).toHaveBeenCalledOnce();
  expect(one.connect).not.toHaveBeenCalled();
  expect(mocks.usb.requestDevice).not.toHaveBeenCalled();
});
