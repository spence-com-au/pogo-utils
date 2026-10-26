/**
 * The held shell `pnpm battle` drives the phone through, against a stand-in `adb` whose `shell` is the computer's own
 * `sh`: what a command prints and how it exits come back as from the phone, and the shell can be made to exit as a
 * dropped connection would.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { adbHeld } from './adb-cli.mts';

let bin: string;

beforeAll(() => {
  bin = mkdtempSync(join(tmpdir(), 'adb-'));
  writeFileSync(
    join(bin, 'adb'),
    '#!/bin/sh\n[ "$1" = -s ] && shift 2\ncase "$1" in\n  shell) exec sh ;;\n  get-state) echo device ;;\nesac\n',
    { mode: 0o755 },
  );
  vi.stubEnv('PATH', `${bin}${delimiter}${process.env['PATH']}`);
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(bin, { recursive: true });
});

const text = (output: Uint8Array) => new TextDecoder().decode(output);

test('answers each command with its own output, one after another', async () => {
  const held = adbHeld();

  try {
    const [first, second, bare] = await Promise.all([
      held.shell(['echo', 'one']),
      held.shell(['echo', 'two']),
      held.shell(['printf', 'no newline']),
    ]);

    expect([text(first), text(second), text(bare)]).toEqual(['one\n', 'two\n', 'no newline']);
    expect(text(await held.shell(['echo', "it's $HOME and `x`"])), 'quoted as written').toBe("it's $HOME and `x`\n");
    expect((await held.state()).trim(), 'a process of its own').toBe('device');
  } finally {
    held.close();
  }
});

test('a command that fails rejects with what it wrote, and the next still runs', async () => {
  const held = adbHeld();

  try {
    await expect(held.shell(['sh', '-c', 'echo nope >&2; exit 3'])).rejects.toThrow(/nope/);
    await expect(held.shell(['false'])).rejects.toThrow(/exited 1/);
    expect(text(await held.shell(['echo', 'after']))).toBe('after\n');
  } finally {
    held.close();
  }
});

/** As unplugging the phone ends `adb shell`: the command under way and every one after it fail, none left hanging. */
test('the shell exiting fails the command under way and every one after it', async () => {
  const held = adbHeld();

  try {
    await expect(held.shell(['exit', '0'])).rejects.toThrow(/exited; is the phone still connected\?/);
    await expect(held.shell(['echo', 'into nothing'])).rejects.toThrow(/is the phone still connected\?/);
  } finally {
    held.close();
  }
});
