/**
 * The command that turns the panel off or on, run by a local `sh` standing in for the phone's shell: the dex it writes
 * must be the committed one byte for byte, and a failure on the phone must reach the caller.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

import { screenPower } from './screen-power.mts';

const DEX = readFileSync(new URL('screen-power/ScreenPower.dex', import.meta.url));

/**
 * A phone whose shell is a local `sh`, joining each command's arguments with spaces as `adb shell` does, with
 * `/data/local/tmp` moved to a directory of its own and `app_process` standing for `app`. What each command wrote is
 * kept in `said`.
 */
function phone(app: string) {
  const dir = mkdtempSync(join(tmpdir(), 'screen-power-'));
  const said: string[] = [];

  const transport = {
    shell: async (args: readonly string[]) => {
      const command = args.join(' ').replaceAll('/data/local/tmp', dir).replace('app_process', app);
      const { stdout } = await promisify(execFile)('sh', ['-c', command]);
      said.push(stdout.trim());

      return new TextEncoder().encode(stdout);
    },
  };

  return { dir, said, transport };
}

test.each([['off'], ['on']] as const)('writes the dex whole and runs it %s', async (power) => {
  // A shell of its own, so `$CLASSPATH` is read as `app_process` would see it rather than before it is set.
  const { dir, said, transport } = phone(`sh -c 'echo "$CLASSPATH $*"' app_process`);

  await screenPower(transport, DEX, power);

  const dex = join(dir, 'pogo-utils-screen-power.dex');
  expect(said).toStrictEqual([`${dex} / ScreenPower ${power}`]);
  expect(readFileSync(dex)).toStrictEqual(DEX);
});

test("throws where the phone's app_process fails", async () => {
  await expect(screenPower(phone('false').transport, DEX, 'on')).rejects.toThrow();
});
