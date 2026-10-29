/**
 * The page's `Phone` over a stand-in for the phone reached over WebUSB, with `FakeDecoder` in place of WebCodecs: what
 * it writes to the shell it holds, what it records the screen with, and what it answers the battle loop.
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { fixture } from '../testing/fixture.js';
import { create, report, write } from '../tools/inventory/touchscreen.mts';
import { battlePhone, heldShell } from './phone.js';
import { FakeChunk, FakeDecoder, fakeConnection } from './test-phone.js';

const H264 = fixture(new URL('../tools/battle/fixtures/charge.h264', import.meta.url));

beforeEach(() => {
  FakeDecoder.made = [];
  FakeDecoder.failing = false;
  vi.stubGlobal('VideoDecoder', FakeDecoder);
  vi.stubGlobal('EncodedVideoChunk', FakeChunk);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('holds one shell, its stderr sent to stdout, and writes each command and its marker in one write', async () => {
  const phone = fakeConnection('pixel', H264);
  const held = await heldShell(phone.connection);

  expect(new TextDecoder().decode(await held.shell(['dumpsys', 'input']))).toContain('pogo-utils touch');
  await held.shell(['echo', 'two']);

  expect(phone.spawned).toEqual(['sh']);
  expect(phone.commands).toEqual(['dumpsys input', 'echo two']);
  expect(phone.writes[0]).toBe('exec 2>&1\n');
  expect(phone.writes.slice(1)).toEqual([
    expect.stringMatching(/^dumpsys input\ns=\$\?; echo "\n\S+ \$s"\n$/),
    expect.stringMatching(/^echo two\ns=\$\?; echo "\n\S+ \$s"\n$/),
  ]);

  held.close();
  await expect(held.shell(['echo', 'after'])).rejects.toThrow(/adb shell closed/);
  expect(phone.killed).toEqual(['sh']);
});

test('fails every command once the shell is gone, as when the phone is unplugged', async () => {
  const phone = fakeConnection('pixel', H264);
  const held = await heldShell(phone.connection);

  // Its stdout ending unasked for, which is what the page hears of an unplugged phone's shell.
  phone.processes[0]?.kill();

  await expect(held.shell(['echo', 'into nothing'])).rejects.toThrow(/exited; is the phone still connected\?/);
  await expect(held.shell(['echo', 'nor this'])).rejects.toThrow(/is the phone still connected\?/);
});

test('makes the touchscreen through the held shell, taps through it, and answers frames once the screen sends one', async () => {
  const phone = fakeConnection('pixel', H264);
  const battle = await battlePhone(phone.connection);

  try {
    // The stream's shape out of a screenshot shaped as a Pixel 4 XL's screen, as `pnpm battle` takes it.
    expect(phone.spawned).toEqual([
      'sh',
      'screenrecord --output-format=h264 --size=360x760 --bit-rate=2000000 --time-limit=180 -',
    ]);
    expect(phone.commands).toEqual(['command exec 3<>/dev/uhid 4<>/dev/uhid', write(create()), 'dumpsys input']);
    expect(battle.frame()).toMatchObject({ width: 360, height: 760 });
    expect((await battle.screenshot()).width).toBe(144);

    phone.commands.length = 0;
    await battle.tap([0.1, 0.2]);
    expect(phone.commands).toEqual([`${write(report(true, [0.1, 0.2]))}; ${write(report(false, [0.1, 0.2]))}`]);
  } finally {
    battle.close();
  }

  await vi.waitFor(() => expect(new Set(phone.killed)).toEqual(new Set(['screenrecord', 'sh'])));
});
